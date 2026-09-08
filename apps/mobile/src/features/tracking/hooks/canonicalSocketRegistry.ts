import { onlineManager } from "@tanstack/react-query";
import { AppState } from "react-native";

import { env } from "@/core/constants/env";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";
import { recordLivePerformance } from "@/features/tracking/livePerformanceDiagnostics";
import { normalizeProviderEventUuid } from "@/features/tracking/providerScope";
import {
  isSocketHeartbeatFresh,
  SOCKET_HEARTBEAT_INTERVAL_MS,
  SOCKET_HEALTH_CHECK_MS,
} from "./athleteDetailRefreshPolicy";
import { nextSocketReconnectDecision } from "./socketReconnectPolicy";

export type CanonicalChangeEvent = {
  type: "canonical_change" | "participant_changed" | "leaderboard_changed";
  eventId: string;
  providerEventUuid: string;
  participantUuid: string | null;
  providerParticipantUuid?: string | null;
  contestUuid: string | null;
  canonicalVersion: number;
  manifestVersion: string;
  publishedAt: string;
  acceptedAt?: string;
  sequence?: number;
  liveRevision?: number;
  delta?: Record<string, unknown>;
};

export type CanonicalSocketHealth = "degraded" | "healthy";
export type CanonicalSocketRecoveryReason =
  "FOREGROUND_RECOVERY" | "NETWORK_RECOVERY";

type SocketCircuitPhase =
  | "CLOSED"
  | "CONNECTING"
  | "HEALTHY"
  | "RETRYING"
  | "HTTP_FALLBACK"
  | "COOLDOWN_PROBE";

type SocketCircuit = {
  attempts: number;
  cooldownUntil: number;
  probeInFlight: boolean;
  consecutiveUnhealthyCycles: number;
  healthySince: number | null;
  socketGeneration: number;
  phase: SocketCircuitPhase;
};

type Consumer = {
  consumerId: string;
  participantUuid: string | null;
  onHealth: (health: CanonicalSocketHealth) => void;
  onMessage: (change: CanonicalChangeEvent) => void;
  onRecovery: (reason: CanonicalSocketRecoveryReason) => void;
};

type RegistryEntry = {
  subscriptionKey: string;
  eventId: string;
  providerEventUuid: string;
  consumers: Map<string, Consumer>;
  socket: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  appStateSubscription: { remove: () => void };
  onlineSubscription: () => void;
  wasOnline: boolean;
  health: CanonicalSocketHealth;
  lastHeartbeatAt: number;
  lastMessageAt: number;
  lastSequence: number;
  entityVersions: Map<
    string,
    { manifestVersion: string; canonicalVersion: number }
  >;
  needsRecovery: boolean;
  disposed: boolean;
  circuit: SocketCircuit;
};

type SubscribeInput = {
  eventId: string;
  providerEventUuid: string;
  consumerId: string;
  participantUuid?: string;
  onHealth: Consumer["onHealth"];
  onMessage: Consumer["onMessage"];
  onRecovery: Consumer["onRecovery"];
};

export type CanonicalSocketLease = {
  subscriptionKey: string;
  updateParticipantUuid: (participantUuid?: string) => void;
  release: (reason?: string) => void;
};

// One short hand-off window lets sibling event tabs exchange ownership without
// tearing down a healthy provider socket. It is not a reconnect delay.
export const CANONICAL_SOCKET_RELEASE_GRACE_MS = 1_000;

const socketRegistry = new Map<string, RegistryEntry>();
const transportCircuits = new Map<string, SocketCircuit>();

function circuitFor(subscriptionKey: string): SocketCircuit {
  const existing = transportCircuits.get(subscriptionKey);
  if (existing) return existing;
  const created: SocketCircuit = {
    attempts: 0,
    cooldownUntil: 0,
    probeInFlight: false,
    consecutiveUnhealthyCycles: 0,
    healthySince: null,
    socketGeneration: 0,
    phase: "CLOSED",
  };
  transportCircuits.set(subscriptionKey, created);
  return created;
}

function socketUrl(eventId: string, providerEventUuid: string): string {
  const base = env.liveTrackingEdgeBaseUrl
    .replace(/^http/i, "ws")
    .replace(/\/$/, "");
  return `${base}/v1/events/${encodeURIComponent(eventId)}/canonical/stream?providerEventUuid=${encodeURIComponent(providerEventUuid)}`;
}

function selectedParticipantUuid(entry: RegistryEntry): string | null {
  for (const consumer of entry.consumers.values()) {
    if (consumer.participantUuid) return consumer.participantUuid;
  }
  return null;
}

function logOwner(
  entry: RegistryEntry,
  action: string,
  consumerId: string,
  reason: string,
  participantUuid?: string | null,
) {
  if (!isLiveDiagnosticsEnabled) return;
  console.info("[CANONICAL_SOCKET_OWNER]", {
    subscriptionKey: entry.subscriptionKey,
    action,
    consumerId,
    refCount: entry.consumers.size,
    participantUuid:
      participantUuid ??
      entry.consumers.get(consumerId)?.participantUuid ??
      null,
    reason,
  });
}

function logDisposeDecision(
  entry: RegistryEntry,
  closeSocket: boolean,
  reason: string,
) {
  if (!isLiveDiagnosticsEnabled) return;
  console.info("[CANONICAL_SOCKET_DISPOSE_DECISION]", {
    subscriptionKey: entry.subscriptionKey,
    remainingConsumers: entry.consumers.size,
    closeSocket,
    reason,
  });
}

function logLifecycle(
  entry: RegistryEntry,
  lifecycle:
    | "SOCKET_CONNECTING"
    | "SOCKET_CONNECTED"
    | "SOCKET_HEARTBEAT"
    | "SOCKET_DEGRADED"
    | "SOCKET_RECONNECTING"
    | "SOCKET_CLOSED",
  reason: string,
  transport?: {
    closeCode?: number;
    closeReason?: string;
    wasClean?: boolean;
  },
) {
  const details = {
    eventId: entry.eventId,
    normalizedProviderEventUuid: entry.providerEventUuid,
    subscriptionKey: entry.subscriptionKey,
    participantUuid: selectedParticipantUuid(entry),
    lastHeartbeatAt: entry.lastHeartbeatAt || null,
    lastMessageAt: entry.lastMessageAt || null,
    health: entry.health,
    reason,
    ...(transport ?? {}),
  };
  if (isLiveDiagnosticsEnabled) {
    console.info(`[canonical-socket] ${lifecycle}`, details);
  } else if (lifecycle === "SOCKET_CLOSED" || lifecycle === "SOCKET_DEGRADED") {
    console.warn(`[canonical-socket] ${lifecycle}`, details);
  }
}

function logCircuitState(entry: RegistryEntry) {
  if (!isLiveDiagnosticsEnabled) return;
  console.info("[canonical-socket] CIRCUIT_STATE", {
    subscriptionKey: entry.subscriptionKey,
    state: entry.circuit.phase,
    consecutiveUnhealthyCycles: entry.circuit.consecutiveUnhealthyCycles,
    cooldownUntil: entry.circuit.cooldownUntil || null,
    healthySince: entry.circuit.healthySince,
    socketGeneration: entry.circuit.socketGeneration,
  });
}

function notifyHealth(entry: RegistryEntry, health: CanonicalSocketHealth) {
  entry.health = health;
  for (const consumer of entry.consumers.values()) consumer.onHealth(health);
}

function notifyRecovery(
  entry: RegistryEntry,
  reason: CanonicalSocketRecoveryReason,
) {
  for (const consumer of entry.consumers.values()) consumer.onRecovery(reason);
}

function clearHeartbeatTimers(entry: RegistryEntry) {
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer);
  if (entry.healthCheckTimer) clearInterval(entry.healthCheckTimer);
  entry.heartbeatTimer = null;
  entry.healthCheckTimer = null;
}

function closeSocket(
  entry: RegistryEntry,
  reason: string,
  updateHealth = true,
) {
  const socket = entry.socket;
  clearHeartbeatTimers(entry);
  if (!socket) {
    if (updateHealth) notifyHealth(entry, "degraded");
    return;
  }
  entry.socket = null;
  if (updateHealth) notifyHealth(entry, "degraded");
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.close();
  recordLivePerformance("socketCloses");
  logLifecycle(entry, "SOCKET_CLOSED", reason);
}

function markFresh(
  entry: RegistryEntry,
  reason: "heartbeat" | "canonical_message",
) {
  entry.lastMessageAt = Date.now();
  if (reason === "heartbeat") entry.lastHeartbeatAt = entry.lastMessageAt;
  if (entry.health === "healthy") {
    if (reason === "heartbeat") logLifecycle(entry, "SOCKET_HEARTBEAT", "pong");
    return;
  }
  entry.circuit.attempts = 0;
  entry.circuit.cooldownUntil = 0;
  entry.circuit.probeInFlight = false;
  entry.circuit.consecutiveUnhealthyCycles = 0;
  entry.circuit.healthySince = Date.now();
  entry.circuit.phase = "HEALTHY";
  logCircuitState(entry);
  notifyHealth(entry, "healthy");
  logLifecycle(entry, "SOCKET_CONNECTED", reason);
  if (reason === "heartbeat") logLifecycle(entry, "SOCKET_HEARTBEAT", "pong");
  if (!entry.needsRecovery) return;
  entry.needsRecovery = false;
  notifyRecovery(entry, "NETWORK_RECOVERY");
}

function scheduleCooldownProbe(entry: RegistryEntry) {
  if (entry.disposed || entry.reconnectTimer || entry.consumers.size === 0)
    return;
  const delay = Math.max(0, entry.circuit.cooldownUntil - Date.now());
  recordLivePerformance("reconnectTimers");
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    connect(entry, "cooldown_probe");
  }, delay);
}

function scheduleReconnect(entry: RegistryEntry) {
  if (
    entry.disposed ||
    entry.consumers.size === 0 ||
    AppState.currentState !== "active" ||
    !onlineManager.isOnline()
  )
    return;
  const decision = nextSocketReconnectDecision(
    entry.circuit.attempts,
    Date.now(),
    entry.circuit.probeInFlight,
  );
  entry.circuit.attempts = decision.attempts;
  entry.circuit.probeInFlight = false;
  if (decision.kind === "cooldown") {
    entry.circuit.cooldownUntil = decision.until;
    entry.circuit.consecutiveUnhealthyCycles += 1;
    entry.circuit.phase = "HTTP_FALLBACK";
    entry.circuit.healthySince = null;
    logCircuitState(entry);
    logLifecycle(
      entry,
      "SOCKET_DEGRADED",
      "transport_retry_exhausted_http_fallback",
    );
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
    scheduleCooldownProbe(entry);
    return;
  }
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  entry.circuit.phase = "RETRYING";
  logCircuitState(entry);
  logLifecycle(entry, "SOCKET_RECONNECTING", `retry_in_${decision.delayMs}ms`);
  recordLivePerformance("reconnectTimers");
  entry.reconnectTimer = setTimeout(
    () => connect(entry, "socket_retry"),
    decision.delayMs,
  );
}

function dispatchMessage(entry: RegistryEntry, change: CanonicalChangeEvent) {
  if (
    ![
      "canonical_change",
      "participant_changed",
      "leaderboard_changed",
    ].includes(change.type) ||
    change.eventId !== entry.eventId ||
    normalizeProviderEventUuid(change.providerEventUuid) !==
      entry.providerEventUuid
  )
    return;
  const sequence = Number(change.sequence || 0);
  if (sequence && sequence <= entry.lastSequence) return;
  if (sequence) entry.lastSequence = sequence;
  const entityKey =
    change.participantUuid ||
    change.providerParticipantUuid ||
    `contest:${change.contestUuid || "event"}`;
  const eventVersion =
    change.type === "participant_changed"
      ? Number(change.liveRevision || 0)
      : change.canonicalVersion;
  const currentVersion = entry.entityVersions.get(entityKey);
  if (
    currentVersion?.manifestVersion === change.manifestVersion &&
    Number.isFinite(eventVersion) &&
    eventVersion <= currentVersion.canonicalVersion
  )
    return;
  entry.entityVersions.set(entityKey, {
    manifestVersion: change.manifestVersion,
    canonicalVersion: eventVersion,
  });
  for (const consumer of entry.consumers.values()) consumer.onMessage(change);
}

function connect(entry: RegistryEntry, reason = "initial") {
  if (
    entry.disposed ||
    entry.consumers.size === 0 ||
    AppState.currentState !== "active" ||
    !onlineManager.isOnline()
  )
    return;
  if (
    entry.socket &&
    (entry.socket.readyState === WebSocket.OPEN ||
      entry.socket.readyState === WebSocket.CONNECTING)
  )
    return;
  const now = Date.now();
  if (entry.circuit.cooldownUntil > now) {
    notifyHealth(entry, "degraded");
    entry.circuit.phase = "HTTP_FALLBACK";
    logCircuitState(entry);
    logLifecycle(entry, "SOCKET_DEGRADED", "transport_cooldown_http_fallback");
    scheduleCooldownProbe(entry);
    return;
  }
  const cooldownProbe = entry.circuit.cooldownUntil > 0;
  if (cooldownProbe) {
    entry.circuit.cooldownUntil = 0;
    entry.circuit.probeInFlight = true;
    entry.circuit.phase = "COOLDOWN_PROBE";
  } else {
    entry.circuit.phase = reason === "initial" ? "CONNECTING" : "RETRYING";
  }
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  entry.reconnectTimer = null;
  closeSocket(entry, "socket_replaced");
  entry.lastHeartbeatAt = 0;
  entry.lastMessageAt = 0;
  entry.circuit.healthySince = null;
  entry.circuit.socketGeneration += 1;
  logCircuitState(entry);
  logLifecycle(
    entry,
    reason === "initial" ? "SOCKET_CONNECTING" : "SOCKET_RECONNECTING",
    reason,
  );
  const socket = new WebSocket(
    socketUrl(entry.eventId, entry.providerEventUuid),
  );
  recordLivePerformance("socketCreates");
  entry.socket = socket;
  socket.onopen = () => {
    if (entry.disposed || entry.socket !== socket) return;
    recordLivePerformance("socketOpens");
    notifyHealth(entry, "degraded");
    socket.send("ping");
    entry.heartbeatTimer = setInterval(() => {
      if (entry.socket === socket && socket.readyState === WebSocket.OPEN)
        socket.send("ping");
    }, SOCKET_HEARTBEAT_INTERVAL_MS);
    entry.healthCheckTimer = setInterval(() => {
      if (entry.socket !== socket) return;
      if (
        isSocketHeartbeatFresh({
          readyState: socket.readyState,
          openReadyState: WebSocket.OPEN,
          lastMessageAt: entry.lastMessageAt,
          now: Date.now(),
        })
      )
        return;
      entry.needsRecovery = true;
      notifyHealth(entry, "degraded");
      logLifecycle(entry, "SOCKET_DEGRADED", "heartbeat_stale");
      socket.close(4000, "heartbeat stale");
    }, SOCKET_HEALTH_CHECK_MS);
  };
  socket.onmessage = (message) => {
    if (
      entry.disposed ||
      entry.socket !== socket ||
      typeof message.data !== "string"
    )
      return;
    if (message.data === "pong") {
      markFresh(entry, "heartbeat");
      return;
    }
    markFresh(entry, "canonical_message");
    try {
      dispatchMessage(entry, JSON.parse(message.data) as CanonicalChangeEvent);
    } catch {
      // Ignore malformed transport messages; the connection remains healthy.
    }
  };
  socket.onclose = (event) => {
    if (
      entry.disposed ||
      entry.socket !== socket ||
      AppState.currentState !== "active"
    )
      return;
    clearHeartbeatTimers(entry);
    recordLivePerformance("socketCloses");
    entry.socket = null;
    entry.needsRecovery = true;
    notifyHealth(entry, "degraded");
    logLifecycle(
      entry,
      "SOCKET_CLOSED",
      event.reason || `transport_close_${event.code}`,
      {
        closeCode: event.code,
        closeReason: event.reason || "",
        wasClean: event.wasClean,
      },
    );
    logLifecycle(entry, "SOCKET_DEGRADED", "transport_closed");
    scheduleReconnect(entry);
  };
  socket.onerror = () => {
    logLifecycle(entry, "SOCKET_DEGRADED", "transport_error_before_close");
    if (entry.socket === socket) socket.close();
  };
}

function disposeEntry(entry: RegistryEntry, reason: string) {
  if (entry.disposed) return;
  entry.disposed = true;
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
  entry.releaseTimer = null;
  entry.reconnectTimer = null;
  entry.appStateSubscription.remove();
  entry.onlineSubscription();
  closeSocket(entry, reason, false);
  entry.circuit.phase = "CLOSED";
  socketRegistry.delete(entry.subscriptionKey);
}

function createEntry(
  subscriptionKey: string,
  eventId: string,
  providerEventUuid: string,
): RegistryEntry {
  const entry: RegistryEntry = {
    subscriptionKey,
    eventId,
    providerEventUuid,
    consumers: new Map<string, Consumer>(),
    socket: null,
    reconnectTimer: null,
    releaseTimer: null,
    heartbeatTimer: null,
    healthCheckTimer: null,
    appStateSubscription: { remove: () => undefined },
    onlineSubscription: () => undefined,
    wasOnline: onlineManager.isOnline(),
    health: "degraded" as const,
    lastHeartbeatAt: 0,
    lastMessageAt: 0,
    lastSequence: 0,
    entityVersions: new Map(),
    needsRecovery: false,
    disposed: false,
    circuit: circuitFor(subscriptionKey),
  };
  entry.appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      notifyRecovery(entry, "FOREGROUND_RECOVERY");
      connect(entry, "foreground");
    } else {
      closeSocket(entry, `app_state_${state}`);
    }
  });
  entry.onlineSubscription = onlineManager.subscribe((online) => {
    const recovered = online && !entry.wasOnline;
    entry.wasOnline = online;
    if (!online) {
      closeSocket(entry, "network_offline");
      return;
    }
    if (!recovered || AppState.currentState !== "active") return;
    notifyRecovery(entry, "NETWORK_RECOVERY");
    connect(entry, "network_recovered");
  });
  return entry;
}

export function subscribeCanonicalSocket(
  input: SubscribeInput,
): CanonicalSocketLease {
  const providerEventUuid = normalizeProviderEventUuid(input.providerEventUuid);
  const subscriptionKey = `${input.eventId}:${providerEventUuid}`;
  let entry = socketRegistry.get(subscriptionKey);
  if (!entry) {
    entry = createEntry(subscriptionKey, input.eventId, providerEventUuid);
    socketRegistry.set(subscriptionKey, entry);
  }
  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  const consumer: Consumer = {
    consumerId: input.consumerId,
    participantUuid: String(input.participantUuid ?? "").trim() || null,
    onHealth: input.onHealth,
    onMessage: input.onMessage,
    onRecovery: input.onRecovery,
  };
  entry.consumers.set(input.consumerId, consumer);
  logOwner(entry, "acquire", input.consumerId, "effect_mounted");
  input.onHealth(entry.health);
  connect(entry, "initial");

  let released = false;
  return {
    subscriptionKey,
    updateParticipantUuid(participantUuid?: string) {
      if (released) return;
      const current = entry?.consumers.get(input.consumerId);
      if (!current) return;
      current.participantUuid = String(participantUuid ?? "").trim() || null;
      logOwner(
        entry,
        "message_filter_updated",
        input.consumerId,
        "participant_changed",
      );
    },
    release(reason = "effect_disposed") {
      if (released || !entry) return;
      released = true;
      const participantUuid =
        entry.consumers.get(input.consumerId)?.participantUuid ?? null;
      entry.consumers.delete(input.consumerId);
      logOwner(entry, "release", input.consumerId, reason, participantUuid);
      if (entry.consumers.size > 0) {
        logDisposeDecision(entry, false, "remaining_consumers");
        return;
      }
      logDisposeDecision(entry, false, "handoff_grace");
      entry.releaseTimer = setTimeout(() => {
        if (!entry || entry.consumers.size > 0) {
          if (entry) logDisposeDecision(entry, false, "consumer_reacquired");
          return;
        }
        logDisposeDecision(entry, true, "final_consumer_released");
        disposeEntry(entry, "final_consumer_released");
      }, CANONICAL_SOCKET_RELEASE_GRACE_MS);
    },
  };
}

export function canonicalSocketRegistrySnapshot() {
  return Array.from(socketRegistry.values()).map((entry) => ({
    subscriptionKey: entry.subscriptionKey,
    refCount: entry.consumers.size,
    socketGeneration: entry.circuit.socketGeneration,
    health: entry.health,
    hasSocket: Boolean(entry.socket),
  }));
}
