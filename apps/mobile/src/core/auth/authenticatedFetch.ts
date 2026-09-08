import { backendUrl } from "@/core/services/api";
import {
  apiError,
  fetchWithLogging,
  httpJson,
  type HttpOptions,
} from "@/core/services/api/http";
import { getOptionalFirebaseIdToken } from "./firebase";

/**
 * Authenticated API client. Mirrors the web's `authenticatedFetch`:
 *  - attaches `Authorization: Bearer <Firebase ID token>`
 *  - on 401, force-refreshes the shared token broker and retries once
 *
 * The single place tokens are attached. Repositories call this; screens never do.
 */
export async function authenticatedJson<T>(
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const url = backendUrl(path);
  const token = await getOptionalFirebaseIdToken();
  if (!token) {
    throw apiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  const withToken = async (token: string | null): Promise<T> => {
    const headers = {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "Authorization Header:",
        headers.Authorization ? "Bearer [redacted]" : undefined,
      );
    }
    return httpJson<T>(url, {
      ...options,
      headers,
      diagnostic: options.diagnostic ?? {
        source: `authenticatedJson:${path}`,
        trigger: "auth",
      },
    });
  };

  try {
    return await withToken(token);
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === 401) {
      return withToken(await getOptionalFirebaseIdToken(true));
    }
    throw error;
  }
}

/**
 * API client for endpoints that accept either a Firebase user or an anonymous
 * device. A signed-in user is still authenticated and retried after a token
 * refresh; a guest sends no fabricated account identity.
 */
export async function optionalAuthenticatedJson<T>(
  path: string,
  options: HttpOptions = {},
): Promise<T> {
  const url = backendUrl(path);

  const withToken = async (token: string | null): Promise<T> => {
    const headers = {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return httpJson<T>(url, {
      ...options,
      headers,
      diagnostic: options.diagnostic ?? {
        source: `optionalAuthenticatedJson:${path}`,
        trigger: "auth",
      },
    });
  };

  const token = await getOptionalFirebaseIdToken();
  if (!token) return withToken(null);

  try {
    return await withToken(token);
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (status === 401) {
      return withToken(await getOptionalFirebaseIdToken(true));
    }
    throw error;
  }
}

/**
 * Authenticated multipart upload (e.g. profile photo). Same token + 401/403
 * retry semantics as `authenticatedJson`; lets the fetch runtime set the
 * multipart boundary (never set Content-Type manually for FormData).
 */
export async function authenticatedUpload<T>(
  path: string,
  form: FormData,
): Promise<T> {
  const url = backendUrl(path);
  const token = await getOptionalFirebaseIdToken();
  if (!token) {
    throw apiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  const send = async (token: string | null): Promise<T> => {
    const res = await fetchWithLogging(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      diagnostic: {
        source: `authenticatedUpload:${path}`,
        trigger: "auth",
      },
    });
    if (!res.ok) {
      throw apiError(
        res.status,
        `HTTP_${res.status}`,
        `Upload failed with HTTP ${res.status}`,
      );
    }
    return (await res.json()) as T;
  };

  try {
    return await send(token);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      return send(await getOptionalFirebaseIdToken(true));
    }
    throw error;
  }
}
