import { isDevelopment } from "@/core/constants/env";
import { isLiveDiagnosticsEnabled } from "@/core/services/performance/liveDiagnosticsPolicy";

import type { ApiError } from "@/core/types";
import {
  finishDiagnosticRequest,
  startDiagnosticRequest,
  type LiveTriggerSource,
} from "@/core/services/performance/iosLiveDiagnostics";
import {
  recordLiveRequestFinish,
  recordLiveRequestStart,
  recordLiveResponsePayload,
} from "@/features/tracking/liveRequestDiagnostics";

export type HttpOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
  diagnostic?: {
    source: string;
    trigger?: LiveTriggerSource;
    participantUuid?: string | null;
    bib?: string | null;
    queryKey?: unknown;
  };
};

const DEFAULT_TIMEOUT_MS = 15000;

type HeaderMap = Record<string, string>;

function normalizeHeaders(headers: HeadersInit | undefined): HeaderMap {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.map(([key, value]) => [String(key), String(value)]),
    );
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key), String(value)]),
  );
}

function redactHeaders(headers: HeaderMap): HeaderMap {
  const redacted = { ...headers };
  if (redacted.Authorization) {
    redacted.Authorization = "Bearer [redacted]";
  }
  return redacted;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function logTextResponseSummary(payload: string) {
  const trimmed = payload.trim();
  const isGpx = /<gpx(?:\s|>)/i.test(trimmed);
  if (isGpx) {
    console.log("Response summary:", {
      type: "gpx",
      characters: payload.length,
      trackPoints: (payload.match(/<trkpt\b/gi) ?? []).length,
    });
    return;
  }
  if (payload.length > 1000) {
    console.log("Response summary:", {
      type: "text",
      characters: payload.length,
    });
    return;
  }
  console.log("Response summary:", {
    type: "text",
    characters: payload.length,
  });
}

function logApiLine(prefix: string, value: unknown) {
  if (!isLiveDiagnosticsEnabled) return;
  console.log(`${prefix}: ${safeStringify(value)}`);
}

export function debugApiLog(label: string, value: unknown) {
  if (!isLiveDiagnosticsEnabled) return;
  console.log(`${label}: ${safeStringify(value)}`);
}

function logRequest(
  method: string,
  url: string,
  status: number | "ERR",
  startedAt: number,
) {
  if (!isLiveDiagnosticsEnabled) return;
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  console.log(
    `${method.toUpperCase()} ${url}\nStatus ${status}\n${elapsedMs} ms`,
  );
}

function logResponse(
  method: string,
  url: string,
  status: number,
  payload: unknown,
) {
  if (!isLiveDiagnosticsEnabled) return;

  const eventCount =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { events?: unknown[] }).events)
      ? (payload as { events: unknown[] }).events.length
      : undefined;

  console.log(`${method.toUpperCase()} ${url}`);
  console.log(`Status: ${status}`);
  if (url.includes("/api/watchlist") && Array.isArray(payload)) {
    console.log("Response summary:", { itemCount: payload.length });
    return;
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const data =
      record.data &&
      typeof record.data === "object" &&
      !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : undefined;
    const participants = Array.isArray(record.participants)
      ? record.participants
      : Array.isArray(data?.participants)
        ? data.participants
        : undefined;
    const rows = Array.isArray(record.rows)
      ? record.rows
      : Array.isArray(data?.rows)
        ? data.rows
        : undefined;
    const event = (record.event ?? data?.event) as
      Record<string, unknown> | undefined;
    if (url.includes("/api/firebase-config")) {
      console.log("Response summary:", {
        success: record.success,
        projectId: data?.projectId,
        configured: Boolean(data?.projectId),
      });
    } else if (
      event &&
      (url.includes("/api/events/") || url.includes("/v1/events/"))
    ) {
      console.log("Response summary:", {
        success: record.success,
        eventId: event.id ?? event.eventId,
        eventName: event.eventName ?? event.name,
        contests: Array.isArray(event.contests)
          ? event.contests.length
          : Array.isArray(event.ticketDefinitions)
            ? event.ticketDefinitions.length
            : 0,
        participants: Array.isArray(event.participants)
          ? event.participants.length
          : undefined,
        liveTrackingEnabled:
          event.liveTrackingEnabled ??
          (event.liveTracking as Record<string, unknown> | undefined)?.enabled,
      });
    } else if (eventCount !== undefined) {
      console.log("Response summary:", {
        success: record.success,
        events: eventCount,
      });
    } else if (
      url.includes("/api/live/athlete-modal/") ||
      url.includes("/canonical/athlete")
    ) {
      const identity = (data?.identity ?? record.identity) as
        Record<string, unknown> | undefined;
      const rawStatus = data?.status ?? record.status;
      const athleteStatus =
        rawStatus && typeof rawStatus === "object" && !Array.isArray(rawStatus)
          ? (rawStatus as Record<string, unknown>)
          : undefined;
      const splits = Array.isArray(data?.splits)
        ? data.splits
        : Array.isArray(record.splits)
          ? record.splits
          : [];
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId ?? data?.eventId,
        bib: identity?.bib,
        status:
          athleteStatus?.code ?? athleteStatus?.status ?? rawStatus ?? null,
        splitCount: splits.length,
      });
    } else if (url.includes("/api/watchlist")) {
      const items = Array.isArray(record.items)
        ? record.items
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(record.data)
            ? record.data
            : null;
      console.log("Response summary:", {
        success: record.success,
        responseKind:
          typeof record.watched === "boolean" ? "mutation_ack" : "list",
        // A POST acknowledgement such as { watched: true } does not contain
        // the account collection. Reporting its absent array as itemCount: 0
        // falsely implied that the optimistic watchlist had been cleared.
        itemCount: items?.length ?? null,
        watched: record.watched,
      });
    } else if (url.includes("/api/live/events/") && url.includes("/search")) {
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId ?? data?.eventId,
        count: rows?.length ?? record.total ?? data?.total ?? 0,
        state: record.state ?? data?.state,
      });
    } else if (url.includes("/api/live/leaderboard/")) {
      const athletes = Array.isArray(record.athletes)
        ? record.athletes
        : Array.isArray(data?.athletes)
          ? data.athletes
          : [];
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId,
        source: record.source ?? data?.source,
        athletes: athletes.length,
        total: record.total ?? data?.total,
      });
    } else if ((participants?.length ?? 0) > 20 || (rows?.length ?? 0) > 20) {
      console.log("Response summary:", {
        success: record.success,
        eventId: record.eventId ?? data?.eventId,
        state: record.state ?? data?.state,
        source: record.source ?? data?.source,
        participants: participants?.length,
        rows: rows?.length,
      });
    } else {
      const serialized = safeStringify(payload);
      console.log("Response summary:", {
        type: "json",
        characters: serialized.length,
        keys: Object.keys(record).slice(0, 20),
      });
    }
  } else if (typeof payload === "string") {
    logTextResponseSummary(payload);
  } else {
    console.log("Response summary:", {
      type: typeof payload,
      present: payload !== null && payload !== undefined,
    });
  }
}

function isApplicationError(payload: unknown): payload is {
  success: false;
  message?: string;
  error?: string;
  detail?: string;
} {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as { success?: unknown }).success === false,
  );
}

function safeParseJson(text: string, method: string, url: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (isDevelopment) {
      console.error("[API JSON PARSE ERROR]", {
        method,
        url,
        error: error instanceof Error ? error.message : String(error),
        bodyPreview: text.slice(0, 1000),
      });
    }
    return text;
  }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export async function fetchWithLogging(
  url: string,
  init: RequestInit & {
    timeoutMs?: number;
    signal?: AbortSignal;
    diagnostic?: HttpOptions["diagnostic"];
  } = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    method = "GET",
    headers,
    diagnostic,
    ...rest
  } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  const requestHeaders = normalizeHeaders(headers);
  if (signal) signal.addEventListener("abort", onExternalAbort);
  const startedAt = Date.now();
  const diagnosticKind = recordLiveRequestStart(url);
  const diagnosticRequest = startDiagnosticRequest({
    method,
    url,
    source: diagnostic?.source || "httpJson",
    trigger: diagnostic?.trigger || "repository",
    participantUuid: diagnostic?.participantUuid,
    bib: diagnostic?.bib,
    queryKey: diagnostic?.queryKey,
  });

  if (isLiveDiagnosticsEnabled) {
    logApiLine("Request URL", url);
    logApiLine("Request method", method.toUpperCase());
    logApiLine("Request headers", redactHeaders(requestHeaders));
    logApiLine(
      "Authorization header present",
      Boolean(requestHeaders.Authorization),
    );
  }

  try {
    const res = await fetch(url, {
      ...rest,
      headers,
      method,
      signal: controller.signal,
    });
    logRequest(method, url, res.status, startedAt);
    recordLiveRequestFinish(
      diagnosticKind,
      res.status,
      res.headers.get("content-length"),
    );
    finishDiagnosticRequest(diagnosticRequest, { status: res.status });
    if (isLiveDiagnosticsEnabled) {
      logApiLine("Response headers", Object.fromEntries(res.headers.entries()));
    }
    return res;
  } catch (e) {
    const externallyAborted = signal?.aborted === true;
    recordLiveRequestFinish(diagnosticKind, "ERR");
    finishDiagnosticRequest(diagnosticRequest, {
      status: "ERR",
      cancelled: externallyAborted || controller.signal.aborted,
    });
    if (!externallyAborted) logRequest(method, url, "ERR", startedAt);
    if (isDevelopment && !externallyAborted) {
      logApiLine(
        "Network exception",
        e instanceof Error ? { name: e.name, message: e.message } : e,
      );
    }
    // React Query aborts its signal when a screen unmounts or its query key is
    // replaced. Preserve that cancellation without converting it into a false
    // NETWORK_ERROR or printing an application failure.
    if (externallyAborted) throw e;
    if (controller.signal.aborted && !signal?.aborted) {
      throw apiError(
        null,
        "TIMEOUT",
        `${method.toUpperCase()} ${url} timed out`,
      );
    }
    throw apiError(
      null,
      "NETWORK_ERROR",
      `${method.toUpperCase()} ${url} network exception: ${e instanceof Error ? e.message : "Network error"}`,
    );
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

function buildUrl(url: string, params?: HttpOptions["params"]): string {
  if (!params) return url;
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.append(k, String(v));
  });
  const qs = usp.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

export function apiError(
  status: number | null,
  code: string,
  message: string,
  extra?: Partial<ApiError>,
): ApiError {
  const isNetworkError = status === null;
  const isAuthError = status === 401 || status === 403;
  return {
    status,
    code,
    message,
    userMessage: message || "Something went wrong. Please try again.",
    isNetworkError,
    isAuthError,
    retryable: isNetworkError || (status !== null && status >= 500),
    ...extra,
  };
}

/**
 * Low-level fetch JSON helper with normalized errors. Used by repositories via
 * the public and authenticated clients. Repositories are the only callers.
 */
export async function httpJson<T>(
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    params,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    diagnostic,
  } = options;
  const finalUrl = buildUrl(url, params);

  const res = await fetchWithLogging(finalUrl, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    timeoutMs,
    diagnostic,
  });

  const text = await res.text();
  recordLiveResponsePayload(finalUrl, text);
  const contentType = res.headers.get("content-type") ?? "";
  const shouldParseJson =
    Boolean(text) &&
    (res.ok || contentType.includes("application/json") || looksLikeJson(text));
  const data = shouldParseJson
    ? safeParseJson(text, method, finalUrl)
    : undefined;

  logResponse(method, finalUrl, res.status, data ?? text);

  if (!res.ok) {
    const msg = `${method.toUpperCase()} ${finalUrl} -> HTTP ${res.status}: ${safeStringify(data ?? text)}`;
    throw apiError(res.status, `HTTP_${res.status}`, msg);
  }

  if (isApplicationError(data)) {
    const msg = `${method.toUpperCase()} ${finalUrl} -> API_ERROR: ${safeStringify(data)}`;
    throw apiError(res.status, "API_ERROR", msg);
  }

  return data as T;
}

/**
 * Fetch raw text (e.g. a GPX course file). Same timeout/abort handling as
 * `httpJson`; used for public course assets referenced by the backend config.
 */
export async function httpText(
  url: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  try {
    const res = await fetchWithLogging(url, { signal, timeoutMs });
    const text = await res.text();
    recordLiveResponsePayload(url, text);
    logResponse("GET", url, res.status, text);
    if (!res.ok) {
      throw apiError(
        res.status,
        `HTTP_${res.status}`,
        `GET ${url} -> HTTP ${res.status}: ${text || res.statusText}`,
      );
    }
    return text;
  } catch (e) {
    throw e;
  }
}
