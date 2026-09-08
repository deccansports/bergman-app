import { Platform } from "react-native";

import { isLiveDiagnosticsEnabled } from "./liveDiagnosticsPolicy";

export type LiveTriggerSource =
  | "user_selection"
  | "socket"
  | "poll"
  | "foreground"
  | "watchlist"
  | "auth"
  | "repository"
  | "unknown";

type RequestContext = {
  method?: string;
  url: string;
  source?: string;
  trigger?: LiveTriggerSource;
  participantUuid?: string | null;
  bib?: string | null;
  queryKey?: unknown;
};

type RequestToken = RequestContext & {
  id: number;
  startedAt: number;
  normalizedEndpoint: string;
  duplicateCount: number;
};

type CounterState = {
  httpStarted: number;
  httpCompleted: number;
  httpCancelled: number;
  concurrentHttp: number;
  maxConcurrentHttp: number;
  duplicateRequests: number;
  tokenCalls: number;
  forcedTokenCalls: number;
  concurrentTokenCalls: number;
  maxConcurrentTokenCalls: number;
  secureStoreReads: number;
  secureStoreWrites: number;
  secureStoreDeletes: number;
  queryFetches: number;
  queryInvalidations: number;
  queryObserverUpdates: number;
  jsStalls50: number;
  jsStalls100: number;
  jsStalls250: number;
  jsStalls500: number;
};

const counters: CounterState = {
  httpStarted: 0,
  httpCompleted: 0,
  httpCancelled: 0,
  concurrentHttp: 0,
  maxConcurrentHttp: 0,
  duplicateRequests: 0,
  tokenCalls: 0,
  forcedTokenCalls: 0,
  concurrentTokenCalls: 0,
  maxConcurrentTokenCalls: 0,
  secureStoreReads: 0,
  secureStoreWrites: 0,
  secureStoreDeletes: 0,
  queryFetches: 0,
  queryInvalidations: 0,
  queryObserverUpdates: 0,
  jsStalls50: 0,
  jsStalls100: 0,
  jsStalls250: 0,
  jsStalls500: 0,
};

let requestSequence = 0;
let switchSequence = 0;
let activeSwitch:
  | {
      id: number;
      participantUuid: string;
      startedAt: number;
      baseline: CounterState;
    }
  | undefined;
const recentRequests = new Map<string, number[]>();
const endpointCounts = new Map<string, number>();
const sourceCounts = new Map<string, number>();

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function normalizedEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.replace(/^https?:\/\/[^/]+/i, "");
  }
}

function boundedDiagnosticText(value: unknown, limit = 160): string {
  const text = String(value ?? "");
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}…[${text.length} chars]`;
}

function summarizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return boundedDiagnosticText(value);
  if (value == null || typeof value !== "object") return value;
  if (depth >= 2) return `[${Array.isArray(value) ? "array" : "object"}]`;
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map((entry) => summarizeDiagnosticValue(entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 8)
      .map(([key, entry]) => [key, summarizeDiagnosticValue(entry, depth + 1)]),
  );
}

function safeQueryKey(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(summarizeDiagnosticValue(value)).slice(0, 500);
  } catch {
    return "[unserializable]";
  }
}

function snapshot(): CounterState {
  return { ...counters };
}

function delta(from: CounterState): CounterState {
  return Object.fromEntries(
    Object.entries(counters).map(([key, value]) => [
      key,
      value - from[key as keyof CounterState],
    ]),
  ) as CounterState;
}

export function startIosAthleteSwitch(
  participantUuid: string,
  source: string,
  bib?: string | null,
): number | null {
  if (!isLiveDiagnosticsEnabled || !participantUuid) return null;
  switchSequence += 1;
  activeSwitch = {
    id: switchSequence,
    participantUuid,
    startedAt: now(),
    baseline: snapshot(),
  };
  console.info("ATHLETE_SWITCH_START", {
    switchId: switchSequence,
    participantUuid,
    bib: bib || null,
    source,
    platform: Platform.OS,
    timestamp: new Date().toISOString(),
  });
  return switchSequence;
}

export function completeIosAthleteSwitch(participantUuid: string): void {
  if (!isLiveDiagnosticsEnabled || !activeSwitch) return;
  if (
    activeSwitch.participantUuid.toLowerCase() !== participantUuid.toLowerCase()
  )
    return;
  console.info("ATHLETE_SWITCH_RENDER_COMPLETE", {
    switchId: activeSwitch.id,
    participantUuid,
    platform: Platform.OS,
    durationMs: Math.max(0, now() - activeSwitch.startedAt),
    counters: delta(activeSwitch.baseline),
    concurrentHttp: counters.concurrentHttp,
    maxConcurrentHttp: counters.maxConcurrentHttp,
    timestamp: new Date().toISOString(),
  });
  activeSwitch = undefined;
}

export function startDiagnosticRequest(context: RequestContext): RequestToken {
  const method = String(context.method || "GET").toUpperCase();
  const endpoint = normalizedEndpoint(context.url);
  if (!isLiveDiagnosticsEnabled) {
    return {
      ...context,
      method,
      id: 0,
      startedAt: 0,
      normalizedEndpoint: endpoint,
      duplicateCount: 0,
    };
  }
  const trigger =
    activeSwitch &&
    (!context.trigger ||
      context.trigger === "unknown" ||
      context.trigger === "repository")
      ? "user_selection"
      : context.trigger;
  const duplicateKey = [
    method,
    endpoint,
    context.participantUuid || "",
    safeQueryKey(context.queryKey) || "",
  ].join("|");
  const timestamp = Date.now();
  const recent = (recentRequests.get(duplicateKey) || []).filter(
    (entry) => timestamp - entry <= 1_000,
  );
  recent.push(timestamp);
  recentRequests.set(duplicateKey, recent);
  const duplicateCount = recent.length;
  requestSequence += 1;
  const token: RequestToken = {
    ...context,
    trigger,
    method,
    id: requestSequence,
    startedAt: now(),
    normalizedEndpoint: endpoint,
    duplicateCount,
  };
  counters.httpStarted += 1;
  counters.concurrentHttp += 1;
  counters.maxConcurrentHttp = Math.max(
    counters.maxConcurrentHttp,
    counters.concurrentHttp,
  );
  endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + 1);
  const source = context.source || "unknown";
  sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  console.info("API_REQUEST_START", {
    requestId: token.id,
    method,
    endpoint,
    source,
    trigger: trigger || "unknown",
    participantUuid: context.participantUuid || null,
    bib: context.bib || null,
    queryKey: safeQueryKey(context.queryKey),
    concurrentHttp: counters.concurrentHttp,
    maxConcurrentHttp: counters.maxConcurrentHttp,
    timestamp: new Date().toISOString(),
  });
  if (duplicateCount > 1) {
    counters.duplicateRequests += 1;
    console.warn("DUPLICATE_REQUEST", {
      method,
      endpoint,
      participantUuid: context.participantUuid || null,
      queryKey: safeQueryKey(context.queryKey),
      countWithinOneSecond: duplicateCount,
    });
  }
  return token;
}

export function finishDiagnosticRequest(
  token: RequestToken,
  result: { status?: number | "ERR"; cancelled?: boolean },
): void {
  if (!isLiveDiagnosticsEnabled) return;
  counters.concurrentHttp = Math.max(0, counters.concurrentHttp - 1);
  if (result.cancelled) counters.httpCancelled += 1;
  else counters.httpCompleted += 1;
  console.info(result.cancelled ? "API_REQUEST_CANCELLED" : "API_REQUEST_END", {
    requestId: token.id,
    method: token.method,
    endpoint: token.normalizedEndpoint,
    source: token.source || "unknown",
    trigger: token.trigger || "unknown",
    participantUuid: token.participantUuid || null,
    queryKey: safeQueryKey(token.queryKey),
    status: result.status ?? null,
    durationMs: Math.max(0, now() - token.startedAt),
    concurrentHttp: counters.concurrentHttp,
    maxConcurrentHttp: counters.maxConcurrentHttp,
    timestamp: new Date().toISOString(),
  });
}

export async function measureFirebaseToken<T>(
  forced: boolean,
  source: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!isLiveDiagnosticsEnabled) return action();
  const startedAt = now();
  counters.tokenCalls += 1;
  if (forced) counters.forcedTokenCalls += 1;
  counters.concurrentTokenCalls += 1;
  counters.maxConcurrentTokenCalls = Math.max(
    counters.maxConcurrentTokenCalls,
    counters.concurrentTokenCalls,
  );
  try {
    return await action();
  } finally {
    counters.concurrentTokenCalls = Math.max(
      0,
      counters.concurrentTokenCalls - 1,
    );
    console.info("FIREBASE_TOKEN_OPERATION", {
      source,
      forced,
      durationMs: Math.max(0, now() - startedAt),
      concurrent: counters.concurrentTokenCalls,
      maxConcurrent: counters.maxConcurrentTokenCalls,
      platform: Platform.OS,
    });
  }
}

export async function measureSecureStore<T>(
  operation: "getItemAsync" | "setItemAsync" | "deleteItemAsync",
  key: string,
  source: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!isLiveDiagnosticsEnabled) return action();
  const startedAt = now();
  if (operation === "getItemAsync") counters.secureStoreReads += 1;
  if (operation === "setItemAsync") counters.secureStoreWrites += 1;
  if (operation === "deleteItemAsync") counters.secureStoreDeletes += 1;
  try {
    return await action();
  } finally {
    console.info("SECURE_STORE_OPERATION", {
      operation,
      key,
      source,
      durationMs: Math.max(0, now() - startedAt),
      platform: Platform.OS,
    });
  }
}

export function recordReactQueryDiagnostic(details: {
  type: string;
  queryHash?: string;
  queryKey?: unknown;
  fetchStatus?: string;
  status?: string;
  invalidated?: boolean;
}): void {
  if (!isLiveDiagnosticsEnabled) return;
  counters.queryObserverUpdates += 1;
  if (details.fetchStatus === "fetching") counters.queryFetches += 1;
  if (details.invalidated) counters.queryInvalidations += 1;
  if (
    details.type === "observerResultsUpdated" &&
    details.fetchStatus === "idle" &&
    details.status !== "error" &&
    !details.invalidated
  ) {
    return;
  }
  console.info("REACT_QUERY_EVENT", {
    type: details.type,
    queryHash: boundedDiagnosticText(details.queryHash, 240),
    queryKey: safeQueryKey(details.queryKey),
    fetchStatus: details.fetchStatus,
    status: details.status,
    invalidated: details.invalidated,
    activeSwitchParticipantUuid: activeSwitch?.participantUuid || null,
    platform: Platform.OS,
  });
}

export function startJsEventLoopStallMonitor(intervalMs = 100): () => void {
  // Browser background-tab timer throttling routinely turns a 100 ms interval
  // into ~1 second. That is not a JS stall and the resulting warning flood can
  // itself slow Expo web development. This diagnostic is for native iOS.
  if (!isLiveDiagnosticsEnabled || Platform.OS !== "ios")
    return () => undefined;
  let expectedAt = now() + intervalMs;
  const timer = setInterval(() => {
    const measuredAt = now();
    const stallMs = Math.max(0, measuredAt - expectedAt);
    expectedAt = measuredAt + intervalMs;
    if (stallMs < 50) return;
    counters.jsStalls50 += 1;
    if (stallMs >= 100) counters.jsStalls100 += 1;
    if (stallMs >= 250) counters.jsStalls250 += 1;
    if (stallMs >= 500) counters.jsStalls500 += 1;
    console.warn("JS_EVENT_LOOP_STALL", {
      durationMs: Math.round(stallMs),
      threshold:
        stallMs >= 500 ? 500 : stallMs >= 250 ? 250 : stallMs >= 100 ? 100 : 50,
      participantUuid: activeSwitch?.participantUuid || null,
      platform: Platform.OS,
      timestamp: new Date().toISOString(),
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

export function snapshotIosLiveDiagnostics() {
  return {
    platform: Platform.OS,
    counters: snapshot(),
    endpointCounts: Object.fromEntries(endpointCounts),
    sourceCounts: Object.fromEntries(sourceCounts),
    activeSwitchParticipantUuid: activeSwitch?.participantUuid || null,
  };
}

export function startIosLiveDiagnosticWindow(durationMs = 60_000): () => void {
  if (!isLiveDiagnosticsEnabled || Platform.OS !== "ios")
    return () => undefined;
  let baseline = snapshot();
  let endpointBaseline = new Map(endpointCounts);
  let sourceBaseline = new Map(sourceCounts);
  const timer = setInterval(() => {
    const countDelta = (
      current: Map<string, number>,
      prior: Map<string, number>,
    ) =>
      Object.fromEntries(
        [...current.entries()]
          .map(([key, value]) => [key, value - (prior.get(key) || 0)] as const)
          .filter(([, value]) => value > 0),
      );
    console.info("IOS_LIVE_DIAGNOSTIC_WINDOW", {
      durationMs,
      platform: Platform.OS,
      counters: delta(baseline),
      endpointCounts: countDelta(endpointCounts, endpointBaseline),
      sourceCounts: countDelta(sourceCounts, sourceBaseline),
      concurrentHttpAtEnd: counters.concurrentHttp,
      maxConcurrentHttpObserved: counters.maxConcurrentHttp,
      activeSwitchParticipantUuid: activeSwitch?.participantUuid || null,
      timestamp: new Date().toISOString(),
    });
    baseline = snapshot();
    endpointBaseline = new Map(endpointCounts);
    sourceBaseline = new Map(sourceCounts);
  }, durationMs);
  return () => clearInterval(timer);
}
