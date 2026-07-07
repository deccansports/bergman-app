// src/lib/cloudflare/kv.ts
import { serializeValue } from '../utils';

type CachedKVValue = {
    expiresAt: number;
    value: unknown;
};

const getApiBase = () => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    if (!accountId || !namespaceId) {
        throw new Error("Cloudflare Account ID and KV Namespace ID must be configured.");
    }
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
}

// 🔥 Rate limiter: Prevents hammering Cloudflare API
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 50; // ms between requests

// In-memory read cache to reduce repeated hot-key reads.
// This is instance-local (per server process) and intentionally short-lived.
const kvReadCache = new Map<string, CachedKVValue>();
const kvReadInFlight = new Map<string, Promise<unknown>>();

const KV_READ_CACHE_TTL_MS = Math.max(
    Number(process.env.KV_READ_CACHE_TTL_MS || 15000),
    0
);
const KV_READ_CACHE_NULL_TTL_MS = Math.max(
    Number(process.env.KV_READ_CACHE_NULL_TTL_MS || 3000),
    0
);

function getCacheKey(key: string) {
    return key;
}

function shouldUseReadCache(key: string, source: string): boolean {
    if (KV_READ_CACHE_TTL_MS <= 0) return false;

    // Avoid caching highly-volatile live tracking feeds.
    const normalized = `${key} ${source}`.toLowerCase();
    if (
        normalized.includes('live') ||
        normalized.includes('finishline') ||
        normalized.includes('realtime')
    ) {
        return false;
    }

    return true;
}

function readFromCache<T>(cacheKey: string): T | null | undefined {
    const cached = kvReadCache.get(cacheKey);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
        kvReadCache.delete(cacheKey);
        return undefined;
    }
    return cached.value as T | null;
}

function writeToCache(cacheKey: string, value: unknown) {
    const ttl = value === null ? KV_READ_CACHE_NULL_TTL_MS : KV_READ_CACHE_TTL_MS;
    if (ttl <= 0) return;
    kvReadCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + ttl,
    });
}

function invalidateCacheKey(key: string) {
    kvReadCache.delete(getCacheKey(key));
    kvReadInFlight.delete(getCacheKey(key));
}

async function throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();
}

/**
 * Standardized retry helper for KV operations with exponential backoff.
 * Prevents 429/503 errors from crashing the UI.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    try {
        await throttleRequest(); // Apply rate limiting
        return await fn();
    } catch (error: any) {
        // Handle 503 Service Unavailable or 429 Too Many Requests
        const msg = String(error?.message || '');
        const isTransientError =
            msg.includes('503') ||
            msg.includes('504') ||
            msg.includes('522') ||
            msg.includes('524') ||
            msg.includes('429') ||
            msg.includes('7009') || // Upstream service unavailable
            msg.includes('7010');
        
        if (retries > 0 && isTransientError) {
            const delay = (4 - retries) * 2000; // Progressive backoff: 2s, 4s, 6s
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
        cache: 'no-store', // prevent Next.js fetch cache from returning stale KV data
        headers: { ...options.headers, 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
    });

    if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`Cloudflare API Error (${response.status}): ${errorText}`);
    }
    return response;
}

export async function getKV<T>(key: string, _source: string): Promise<T | null> {
    const useCache = shouldUseReadCache(key, _source);
    const cacheKey = getCacheKey(key);

    if (useCache) {
        const cached = readFromCache<T>(cacheKey);
        if (cached !== undefined) return cached;

        const inFlight = kvReadInFlight.get(cacheKey) as Promise<T | null> | undefined;
        if (inFlight) return inFlight;
    }

    const readPromise = (async () => {
        try {
            const value = await withRetry(async () => {
                const response = await cfRequest(`/values/${key}`);
                if (response.status === 404) return null;
                return await response.json() as T;
            });

            if (useCache) writeToCache(cacheKey, value);
            return value;
        } catch (error: any) {
            console.warn(`[KV READ ERROR][Source: ${_source}] Key: ${key}. Error: ${error.message}`);
            return null;
        } finally {
            if (useCache) kvReadInFlight.delete(cacheKey);
        }
    })();

    if (useCache) kvReadInFlight.set(cacheKey, readPromise as Promise<unknown>);

    try {
        return await readPromise;
    } catch (error: any) {
        console.warn(`[KV READ ERROR][Source: ${_source}] Key: ${key}. Error: ${error.message}`);
        return null;
    }
}

export async function putKV(key: string, value: any, _source: string): Promise<void> {
    invalidateCacheKey(key);

    const body = typeof value === 'string' ? value : JSON.stringify(serializeValue(value));
    const bodySizeKB = Math.round(body.length / 1024);
    
    // Cloudflare KV has a 25MB limit, but let's warn at 10MB
    if (bodySizeKB > 10240) {
        console.warn(`[KV WRITE WARNING][${_source}] Key: ${key}. Size: ${bodySizeKB}KB exceeds 10MB threshold`);
    }
    
    return withRetry(async () => {
        const response = await cfRequest(`/values/${key}`, {
            method: 'PUT',
            body,
            headers: { 'Content-Type': 'application/json' },
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[KV WRITE ERROR][${_source}] Key: ${key}. Status: ${response.status}. Error: ${errorText}`);
            throw new Error(`KV write failed: ${response.status} - ${errorText}`);
        }
        
        console.log(`[KV WRITE SUCCESS][${_source}] Key: ${key}. Size: ${bodySizeKB}KB`);
    });
}

/**
 * Batch KV reads with sequential (not parallel) execution to prevent rate limiting
 */
export async function batchGetKV<T>(keys: string[], _source: string): Promise<(T | null)[]> {
    const results: (T | null)[] = [];
    
    // Execute sequentially with throttling to avoid 429 errors
    for (const key of keys) {
        const result = await getKV<T>(key, _source);
        results.push(result);
    }
    
    return results;
}

export async function deleteKV(key: string, _source: string): Promise<void> {
    invalidateCacheKey(key);

    return withRetry(async () => {
        try {
            await cfRequest(`/values/${key}`, { method: 'DELETE' });
        } catch (error: any) {
            if (!error.message.includes('404')) throw error;
        }
    });
}

/**
 * Batch delete KV keys using limited concurrency so large namespace cleanup finishes quickly
 * without hammering Cloudflare. The global request throttle still applies inside deleteKV().
 */
export async function batchDeleteKV(
    keys: string[],
    _source: string,
    concurrency = 12
): Promise<{ successful: number; failed: number; errors: string[] }> {
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    console.log(`[BATCH DELETE] Starting batch delete for ${keys.length} keys from ${_source}`);

    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
    const total = uniqueKeys.length;
    const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, total || 1));
    let nextIndex = 0;

    const runWorker = async () => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= total) return;
            const key = uniqueKeys[currentIndex];
            try {
                await deleteKV(key, `${_source}[batch:${currentIndex + 1}/${total}]`);
                successful++;

                if ((successful + failed) % 25 === 0 || currentIndex + 1 === total) {
                  console.log(`[BATCH DELETE] Progress: ${successful + failed}/${total} keys deleted`);
                }
            } catch (error) {
                failed++;
                const errorMsg = error instanceof Error ? error.message : String(error);
                errors.push(`${key}: ${errorMsg}`);
                console.error(`[BATCH DELETE] Failed to delete key "${key}":`, errorMsg);
            }
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    const message = `Batch delete completed: ${successful} successful, ${failed} failed out of ${total}`;
    console.log(`[BATCH DELETE] ${message}`);

    return { successful, failed, errors };
}

/**
 * Batch list KV keys with a prefix pattern
 * Returns all keys matching the pattern
 * Includes retry logic with exponential backoff for rate limiting (429 errors)
 */
export async function listKVByPrefix(
    prefix: string,
    _source: string
): Promise<string[]> {
    const maxRetries = 5;
    const baseDelayMs = 1000;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await cfRequest(
                `/keys?prefix=${encodeURIComponent(prefix)}&limit=1000`,
                { method: 'GET' }
            );
            
            const data = (await response.json()) as any;
            const keys = (data?.result || []).map((item: any) => item.name as string);
            
            console.log(`[LIST KV] Found ${keys.length} keys with prefix "${prefix}" from ${_source}`);
            return keys;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const is429 = errorMsg.includes('429') || errorMsg.includes('throttling');
            
            if (is429 && attempt < maxRetries) {
                const delayMs = baseDelayMs * Math.pow(2, attempt);
                console.warn(`[LIST KV] Rate limited (429). Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms for prefix "${prefix}"`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            
            console.error(`[LIST KV] Failed to list keys with prefix "${prefix}":`, error);
            return [];
        }
    }
    
    return [];
}
