// src/lib/cloudflare/kv.ts
import { serializeValue } from '../utils';

const getApiBase = () => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    if (!accountId || !namespaceId) {
        throw new Error("Cloudflare Account ID and KV Namespace ID must be configured.");
    }
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
}

/**
 * Standardized retry helper for KV operations with exponential backoff.
 * Prevents 429/503 errors from crashing the UI.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        // Handle 503 Service Unavailable or 429 Too Many Requests
        const isTransientError = error.message?.includes('503') || error.message?.includes('429') || error.message?.includes('7010');
        
        if (retries > 0 && isTransientError) {
            const delay = (4 - retries) * 1500; // Progressive backoff
            await new Promise(res => setTimeout(res, delay));
            return withRetry(fn, retries - 1);
        }
        throw error;
    }
}

async function cfRequest(path: string, options: RequestInit = {}) {
    const { CLOUDFLARE_API_TOKEN } = process.env;
    if (!CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare API token is missing.");
    
    const response = await fetch(`${getApiBase()}${path}`, {
        ...options,
        headers: { ...options.headers, 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cloudflare API Error (${response.status}): ${errorText}`);
    }
    return response;
}

export async function getKV<T>(key: string, _source: string): Promise<T | null> {
    try {
        return await withRetry(async () => {
            const response = await cfRequest(`/values/${key}`);
            if (response.status === 404) return null;
            return await response.json() as T;
        });
    } catch (error: any) {
        console.warn(`[KV READ ERROR][Source: ${_source}] Key: ${key}. Error: ${error.message}`);
        return null;
    }
}

export async function putKV(key: string, value: any, _source: string): Promise<void> {
    const body = typeof value === 'string' ? value : JSON.stringify(serializeValue(value));
    return withRetry(async () => {
        await cfRequest(`/values/${key}`, {
            method: 'PUT',
            body,
            headers: { 'Content-Type': 'application/json' },
        });
    });
}

export async function deleteKV(key: string, _source: string): Promise<void> {
    return withRetry(async () => {
        try {
            await cfRequest(`/values/${key}`, { method: 'DELETE' });
        } catch (error: any) {
            if (!error.message.includes('404')) throw error;
        }
    });
}
