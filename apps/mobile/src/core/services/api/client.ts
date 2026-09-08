import { env } from "@/core/constants/env";
import { getOptionalFirebaseIdToken } from "@/core/auth/firebase";

import { httpJson, httpText, type HttpOptions } from "./http";

function join(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function resolveUrl(base: string, pathOrUrl: string): string {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : join(base, pathOrUrl);
  return url;
}

export const api = {
  json<T>(path: string, options?: HttpOptions): Promise<T> {
    return httpJson<T>(resolveUrl(env.mobileApiBaseUrl, path), options);
  },
  text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
    const url = resolveUrl(env.mobileApiBaseUrl, pathOrUrl);
    return httpText(url, signal);
  },
};

function authenticatedApi(baseUrl: string) {
  return {
    async json<T>(path: string, options: HttpOptions = {}): Promise<T> {
      const suppliedAuthorization = options.headers?.Authorization;
      const token = suppliedAuthorization
        ? null
        : await getOptionalFirebaseIdToken();
      const withToken = (idToken: string | null) =>
        httpJson<T>(resolveUrl(baseUrl, path), {
          ...options,
          headers: {
            ...(options.headers ?? {}),
            ...(suppliedAuthorization
              ? { Authorization: suppliedAuthorization }
              : idToken
                ? { Authorization: `Bearer ${idToken}` }
                : {}),
          },
        });
      try {
        return await withToken(token);
      } catch (error) {
        const status = (error as { status?: number | null }).status;
        // A 403 is an authorization/policy or edge configuration failure, not
        // an expired Firebase ID token. Refreshing it repeats the exact request
        // (and masked the invalid mobile API-key incident as duplicate traffic).
        // Retain one forced refresh for a genuine 401 only.
        if (!suppliedAuthorization && token && status === 401) {
          const refreshedToken = await getOptionalFirebaseIdToken(true);
          if (refreshedToken) return withToken(refreshedToken);
        }
        throw error;
      }
    },
    text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
      return httpText(resolveUrl(baseUrl, pathOrUrl), signal);
    },
  };
}

export const liveApi = authenticatedApi(env.mobileApiBaseUrl);

/** Authenticated access to the Next.js web routes that own canonical KV reads. */
export const webApi = authenticatedApi(env.webAppBaseUrl);

export const edgeApi = {
  json<T>(path: string, options?: HttpOptions): Promise<T> {
    return httpJson<T>(resolveUrl(env.mobileApiBaseUrl, path), options);
  },
  text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
    const url = resolveUrl(env.mobileApiBaseUrl, pathOrUrl);
    return httpText(url, signal);
  },
};

/** Public read-only canonical publication. Never performs an auth lookup. */
export const canonicalReadApi = {
  json<T>(path: string, options?: HttpOptions): Promise<T> {
    return httpJson<T>(resolveUrl(env.liveTrackingEdgeBaseUrl, path), options);
  },
  text(pathOrUrl: string, signal?: AbortSignal): Promise<string> {
    return httpText(resolveUrl(env.liveTrackingEdgeBaseUrl, pathOrUrl), signal);
  },
};

export function canonicalReadUrl(path: string): string {
  return resolveUrl(env.liveTrackingEdgeBaseUrl, path);
}

export function backendUrl(path: string): string {
  return resolveUrl(env.mobileApiBaseUrl, path);
}
