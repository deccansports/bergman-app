// src/lib/zoho/token.ts
import axios from "axios";

// ─── In-process token cache ────────────────────────────────────────────────
// Zoho access tokens are valid for 3600 seconds. Caching avoids hammering
// the token endpoint on every API call within a single sync, which triggers
// Zoho's "Access Denied / too many requests" rate-limit (400).
let _cachedToken: string | null = null;
let _tokenExpiresAt: number = 0; // epoch ms

export function clearZohoTokenCache() {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

export async function getZohoAccessToken(): Promise<string> {
  // Return cached token if it still has more than 60 seconds left
  const now = Date.now();
  if (_cachedToken && _tokenExpiresAt - now > 60_000) {
    return _cachedToken;
  }

  // Validate environment variables exist
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN) {
    console.error('[Zoho Token] Missing environment variables:', {
      hasClientId: !!process.env.ZOHO_CLIENT_ID,
      hasClientSecret: !!process.env.ZOHO_CLIENT_SECRET,
      hasRefreshToken: !!process.env.ZOHO_REFRESH_TOKEN,
    });
    throw new Error('Zoho OAuth credentials not configured');
  }

  const MAX_ATTEMPTS = 3;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await axios.post(
        "https://accounts.zoho.in/oauth/v2/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: process.env.ZOHO_CLIENT_ID!,
          client_secret: process.env.ZOHO_CLIENT_SECRET!,
          refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
        }),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 10000,
        }
      );

      if (!res.data?.access_token) {
        console.error('[Zoho Token] Response missing access_token:', res.data);
        throw new Error("Zoho access token missing from response");
      }

      // Cache the token; Zoho says expires_in=3600s, keep for 3500s to be safe
      const expiresIn = (res.data.expires_in ?? 3600) - 100;
      const accessToken: string = res.data.access_token;
      _cachedToken = accessToken;
      _tokenExpiresAt = Date.now() + expiresIn * 1000;

      if (attempt > 1) {
        console.log(`[Zoho Token] Token obtained on attempt ${attempt}.`);
      }
      return accessToken;
    } catch (error: any) {
      lastError = error;

      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        console.error(`[Zoho Token Error] Attempt ${attempt}/${MAX_ATTEMPTS} — Status: ${status}, Data:`, data);

        // Permanent credential errors — never retry
        if (status === 400) {
          const zohoErrorCode = data?.error;
          if (zohoErrorCode === 'invalid_grant') {
            throw new Error('[Zoho] Refresh token expired or invalid. Please re-authorize the app.');
          }
          if (zohoErrorCode === 'invalid_client') {
            throw new Error('[Zoho] Client ID or Secret is invalid. Check your credentials.');
          }
          // "Access Denied" = Zoho token-endpoint rate limit — retry with longer wait
          if (zohoErrorCode === 'Access Denied' || data?.error_description?.includes('too many requests')) {
            const waitMs = attempt * 8000; // 8s, 16s
            console.warn(`[Zoho Token] Rate-limited by token endpoint. Waiting ${waitMs}ms before retry...`);
            if (attempt < MAX_ATTEMPTS) {
              await new Promise(r => setTimeout(r, waitMs));
              continue;
            }
            throw new Error(`[Zoho] Token endpoint rate-limited. Retry in ~30 seconds.`);
          }
          // Unknown 400 — log full body and retry
          console.warn(`[Zoho Token] Unknown 400 error code: "${zohoErrorCode}". Body:`, JSON.stringify(data));
        }

        // 429 rate-limit header — always retry with longer backoff
        if (status === 429) {
          console.warn('[Zoho Token] Rate limited (429). Will retry.');
        }
      } else {
        console.error(`[Zoho Token Error] Attempt ${attempt}/${MAX_ATTEMPTS} — No HTTP response:`, error.message);
      }

      if (attempt < MAX_ATTEMPTS) {
        const delay = attempt * 1200; // 1.2s, 2.4s
        console.warn(`[Zoho Token] Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // All attempts exhausted
  const status = lastError?.response?.status;
  const msg = lastError?.message || 'Unknown error';
  console.error('[Zoho Token] All attempts failed. Last error:', msg);
  throw new Error(`Zoho token refresh failed after ${MAX_ATTEMPTS} attempts: ${msg}`);
}
