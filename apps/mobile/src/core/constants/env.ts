const DEFAULT_MOBILE_API_URL = "https://api-mobile.bergmantri.com";
const DEFAULT_WEB_APP_URL = "https://bergmantri.com";

export const env = {
  mobileApiBaseUrl:
    process.env.EXPO_PUBLIC_MOBILE_API_URL ?? DEFAULT_MOBILE_API_URL,
  webAppBaseUrl: process.env.EXPO_PUBLIC_WEB_APP_URL ?? DEFAULT_WEB_APP_URL,
  liveTrackingEdgeBaseUrl:
    process.env.EXPO_PUBLIC_LIVE_TRACKING_EDGE_API_BASE ??
    "https://api.bergmantri.com",
  environment: (process.env.EXPO_PUBLIC_ENV ??
    (process.env.NODE_ENV === "production" ? "production" : "development")) as
    "development" | "staging" | "production",
} as const;

export const isDevelopment = env.environment === "development";
