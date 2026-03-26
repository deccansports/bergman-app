// src/lib/zoho/fetch.ts
import axios from "axios";
import { getZohoAccessToken } from "./token";

/**
 * Standardized retry helper for Zoho operations with exponential backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let delay = 800;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error: any) {
            console.warn(`[Zoho Retry] Attempt ${i + 1} failed: ${error.message}`);
            if (i === attempts - 1) throw error;
            await new Promise(r => setTimeout(r, delay));
            delay *= 2; 
        }
    }
    throw new Error("Retry logic terminated unexpectedly.");
}

/**
 * Centralized Zoho Books API Fetcher with Enhanced Debugging
 */
export async function zohoFetch(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: any;
    params?: any;
  } = {}
) {
  const token = await getZohoAccessToken();
  const zohoApiDomain = process.env.ZOHO_API_DOMAIN;
  const orgId = process.env.ZOHO_ORG_ID || "60013782026";

  if (!zohoApiDomain) {
    throw new Error("Zoho API domain is not configured (ZOHO_API_DOMAIN).");
  }

  const url = `${zohoApiDomain}/books/v3${path}`;
  const isPdfRequest = options.params?.accept === 'pdf';

  try {
    const res = await axios({
      url,
      method: options.method ?? "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
        "X-Com-Zoho-Organization-Id": orgId,
      },
      params: {
        organization_id: orgId,
        ...(options.params ?? {}),
      },
      data: options.body,
      responseType: isPdfRequest ? 'arraybuffer' : 'json',
    });
    
    if (isPdfRequest) return Buffer.from(res.data);

    // Capture Zoho-specific error codes in the response body
    if (res.data?.code && res.data.code !== 0) {
      const msg = res.data.message || JSON.stringify(res.data);
      const err = new Error(msg);
      (err as any).zohoCode = res.data.code;
      (err as any).zohoMessage = msg;
      throw err;
    }

    return res.data;
  } catch (error: any) {
    // Extract specific Zoho error details for actionable logging
    const errorData = error.response?.data || error;
    
    // Aggressively search for a descriptive message in Zoho's nested response
    const zohoMsg = errorData?.message || (errorData?.error?.message) || errorData?.error || error.message || "Unknown Zoho Error";
    const zohoCode = errorData?.code || error.response?.status || "Unknown Code";

    const finalMsg = `Zoho Error ${zohoCode}: ${zohoMsg}`;
    console.error(`[Zoho API Response Error] Path: ${path}, Status: ${error.response?.status}, Msg: ${zohoMsg}`);
    
    const detailedError = new Error(finalMsg);
    (detailedError as any).zohoCode = zohoCode;
    (detailedError as any).zohoMessage = zohoMsg;
    throw detailedError;
  }
}

export async function findPaymentByReference(referenceNumber: string): Promise<any | null> {
  if (!referenceNumber) return null;
  try {
    const data = await zohoFetch('/customerpayments', { params: { reference_number: referenceNumber } });
    if (!data.customerpayments || !Array.isArray(data.customerpayments)) return null;
    
    const ref = String(referenceNumber).trim().toUpperCase();
    return data.customerpayments.find((p: any) => 
        String(p.reference_number).trim().toUpperCase() === ref
    ) || null;
  } catch { return null; }
}
