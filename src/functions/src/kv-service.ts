// functions/src/kv-service.ts
import axios from 'axios';

const KV_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const KV_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID || '';
const KV_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

const MAX_FINISHERS = 10;

/**
 * Sync individual finisher to KV
 * Called by Cloud Function immediately after Firestore write
 */
export async function syncFinisherToKV(eventId: string, finisherData: any): Promise<void> {
  if (!KV_ACCOUNT_ID || !KV_NAMESPACE_ID || !KV_API_TOKEN) {
    console.warn('[KV-SERVICE] KV credentials not configured');
    return;
  }

  try {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${KV_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;

    // Get current finishers list
    const feedKey = `finish_line_feed:${eventId}`;
    const getUrl = `${baseUrl}/values/${encodeURIComponent(feedKey)}`;

    let currentFinishers: any[] = [];
    try {
      const getResponse = await axios.get(getUrl, {
        headers: { 'Authorization': `Bearer ${KV_API_TOKEN}` },
        timeout: 5000
      });
      currentFinishers = typeof getResponse.data === 'string' ? JSON.parse(getResponse.data) : getResponse.data;
    } catch (e) {
      // Key might not exist yet, start fresh
      console.log(`[KV-SERVICE] New finisher list for event ${eventId}`);
      currentFinishers = [];
    }

    // Add new finisher to front of list
    const updatedFinishers = [
      {
        ...finisherData,
        addedAt: new Date().toISOString()
      },
      ...currentFinishers
    ].slice(0, MAX_FINISHERS);

    // Write updated list back to KV
    const putUrl = `${baseUrl}/values/${encodeURIComponent(feedKey)}`;
    await axios.put(
      putUrl,
      JSON.stringify(updatedFinishers),
      {
        headers: {
          'Authorization': `Bearer ${KV_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    // Also cache latest finisher for quick lookup
    const latestKey = `finish_line_feed:${eventId}:latest`;
    const latestUrl = `${baseUrl}/values/${encodeURIComponent(latestKey)}`;
    await axios.put(
      latestUrl,
      JSON.stringify(finisherData),
      {
        headers: {
          'Authorization': `Bearer ${KV_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    // Update metadata
    const metaKey = `finish_line_feed:${eventId}:meta`;
    const metaUrl = `${baseUrl}/values/${encodeURIComponent(metaKey)}`;
    await axios.put(
      metaUrl,
      JSON.stringify({
        lastUpdate: new Date().toISOString(),
        lastFinisher: finisherData.name,
        totalInFeed: updatedFinishers.length,
        source: 'cloud-function'
      }),
      {
        headers: {
          'Authorization': `Bearer ${KV_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    console.log(`[KV-SERVICE] ✅ Synced finisher ${finisherData.name} (BIB: ${finisherData.bib}) to KV instantly`);
  } catch (error: any) {
    console.error('[KV-SERVICE] ❌ Error syncing to KV:', error.message);
    // Non-blocking - Firestore is primary, KV is cache
    throw new Error(`KV sync failed: ${error.message}`);
  }
}

/**
 * Get all finishers from KV for LED display
 * Used by LED HTML page for real-time updates
 */
export async function getFinishersFromKVDirect(eventId: string): Promise<any[]> {
  if (!KV_ACCOUNT_ID || !KV_NAMESPACE_ID || !KV_API_TOKEN) {
    console.warn('[KV-SERVICE] KV credentials not configured');
    return [];
  }

  try {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${KV_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;
    const feedKey = `finish_line_feed:${eventId}`;
    const getUrl = `${baseUrl}/values/${encodeURIComponent(feedKey)}`;

    const response = await axios.get(getUrl, {
      headers: { 'Authorization': `Bearer ${KV_API_TOKEN}` },
      timeout: 2000 // Ultra-fast timeout for LED display
    });

    const finishers = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    return Array.isArray(finishers) ? finishers : [];
  } catch (error: any) {
    console.warn('[KV-SERVICE] Could not fetch from KV, will fallback to Firestore');
    return [];
  }
}

export async function getKVJsonDirect<T>(key: string): Promise<T | null> {
  if (!KV_ACCOUNT_ID || !KV_NAMESPACE_ID || !KV_API_TOKEN) {
    console.warn('[KV-SERVICE] KV credentials not configured');
    return null;
  }

  try {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${KV_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;
    const getUrl = `${baseUrl}/values/${encodeURIComponent(key)}`;
    const response = await axios.get(getUrl, {
      headers: { 'Authorization': `Bearer ${KV_API_TOKEN}` },
      timeout: 3000,
    });

    return typeof response.data === 'string' ? JSON.parse(response.data) as T : response.data as T;
  } catch (error: any) {
    console.warn(`[KV-SERVICE] Could not fetch key ${key}: ${error?.message || 'Unknown error'}`);
    return null;
  }
}
