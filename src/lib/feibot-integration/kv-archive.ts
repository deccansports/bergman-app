/**
 * Cloudflare KV Utilities for Feibot Integration
 * 
 * Handles archival of raw Feibot responses and processed state
 * Never modifies raw responses
 */

import { getKV, putKV } from '@/lib/cloudflare/kv';
import type { RawFeibotArchive } from './types';

const KV_NAMESPACE = 'api-contest-mapping';

/**
 * Archive raw Feibot API response
 */
export async function archiveRawResponse(
  eventUuid: string,
  endpoint: string,
  path: string,
  query: Record<string, string>,
  rawResponse: any,
  diagnostics: {
    method: string;
    httpStatus: number;
    responseTimeMs: number;
    requestSignature: string;
  }
): Promise<{ archiveId: string; kvKey: string }> {
  const timestamp = Date.now();
  const archiveId = `${eventUuid}:${timestamp}`;
  const kvKey = `live:${eventUuid}:raw:${timestamp}`;
  
  const archive: RawFeibotArchive = {
    archiveId,
    eventUuid,
    timestamp,
    apiEndpoint: endpoint,
    apiPath: path,
    queryParameters: query,
    requestMethod: diagnostics.method as any,
    httpStatus: diagnostics.httpStatus,
    responseTimeMs: diagnostics.responseTimeMs,
    rawResponse, // Never modified
    importStatus: 'pending',
    requestSignature: diagnostics.requestSignature,
  };
  
  try {
    await putKV(kvKey, archive, KV_NAMESPACE);
    return { archiveId, kvKey };
  } catch (error) {
    console.error(`Failed to archive response to KV ${kvKey}:`, error);
    throw error;
  }
}

/**
 * Retrieve archived raw response
 */
export async function getRawArchive(
  eventUuid: string,
  timestamp: number
): Promise<RawFeibotArchive | null> {
  const kvKey = `live:${eventUuid}:raw:${timestamp}`;
  
  try {
    const data = await getKV<RawFeibotArchive>(kvKey, KV_NAMESPACE);
    return data || null;
  } catch (error) {
    console.error(`Failed to retrieve archive ${kvKey}:`, error);
    return null;
  }
}

/**
 * List all archives for an event (latest first)
 */
export async function listEventArchives(
  eventUuid: string,
  limit: number = 100
): Promise<{ timestamp: number; archiveId: string; status: string }[]> {
  // Note: KV doesn't support listing by prefix in most implementations
  // This is a placeholder - actual implementation would use Workers KV API
  // or maintain a separate index in Firestore
  return [];
}

/**
 * Update archive import status
 */
export async function updateArchiveStatus(
  eventUuid: string,
  timestamp: number,
  status: 'pending' | 'processing' | 'complete' | 'failed',
  error?: string
): Promise<void> {
  const kvKey = `live:${eventUuid}:raw:${timestamp}`;
  
  try {
    const archive = await getKV<RawFeibotArchive>(kvKey, KV_NAMESPACE);
    
    if (!archive) {
      console.warn(`Archive not found: ${kvKey}`);
      return;
    }
    
    archive.importStatus = status;
    if (error) {
      archive.processingError = error;
    }
    
    await putKV(kvKey, archive, KV_NAMESPACE);
  } catch (error) {
    console.error(`Failed to update archive status ${kvKey}:`, error);
    throw error;
  }
}

/**
 * Save processed event configuration
 * This is the parsed version optimized for fast access
 */
export async function saveProcessedEventConfig(
  eventUuid: string,
  config: any
): Promise<{ kvKey: string }> {
  const kvKey = `live:${eventUuid}:config:processed:latest`;
  
  try {
    await putKV(
      kvKey,
      {
        eventUuid,
        timestamp: Date.now(),
        config,
        version: 1,
      },
      KV_NAMESPACE
    );
    
    return { kvKey };
  } catch (error) {
    console.error(`Failed to save processed config to KV ${kvKey}:`, error);
    throw error;
  }
}

/**
 * Get processed event configuration
 */
export async function getProcessedEventConfig(eventUuid: string): Promise<any | null> {
  const kvKey = `live:${eventUuid}:config:processed:latest`;
  
  try {
    const data = await getKV<any>(kvKey, KV_NAMESPACE);
    return data?.config || null;
  } catch (error) {
    console.error(`Failed to retrieve processed config ${kvKey}:`, error);
    return null;
  }
}

/**
 * Save processed live state
 * Optimized for fast leaderboard, athlete tracking, etc.
 */
export async function saveProcessedLiveState(
  eventUuid: string,
  state: any
): Promise<{ kvKey: string }> {
  const kvKey = `live:${eventUuid}:state:latest`;
  
  try {
    await putKV(
      kvKey,
      {
        eventUuid,
        timestamp: Date.now(),
        state,
        version: 1,
      },
      KV_NAMESPACE
    );
    
    return { kvKey };
  } catch (error) {
    console.error(`Failed to save live state to KV ${kvKey}:`, error);
    throw error;
  }
}

/**
 * Get processed live state
 */
export async function getProcessedLiveState(eventUuid: string): Promise<any | null> {
  const kvKey = `live:${eventUuid}:state:latest`;
  
  try {
    const data = await getKV<any>(kvKey, KV_NAMESPACE);
    return data?.state || null;
  } catch (error) {
    console.error(`Failed to retrieve live state ${kvKey}:`, error);
    return null;
  }
}

/**
 * Save synchronization metadata
 * Tracks what's been synced, when, and status
 */
export async function saveSyncMetadata(
  eventUuid: string,
  metadata: {
    lastSync: number;
    lastTimingRulesSync?: number;
    lastParticipantsSync?: number;
    lastResultsSync?: number;
    syncStatus: 'idle' | 'running' | 'failed';
    nextSyncTime?: number;
    errorMessage?: string;
    currentConfigVersion?: string;
    currentConfigUpdatedAt?: string;
    lastImportTimestamp?: string;
  }
): Promise<{ kvKey: string }> {
  const kvKey = `live:${eventUuid}:sync:metadata`;
  
  try {
    await putKV(kvKey, metadata, KV_NAMESPACE);
    return { kvKey };
  } catch (error) {
    console.error(`Failed to save sync metadata to KV ${kvKey}:`, error);
    throw error;
  }
}

/**
 * Get synchronization metadata
 */
export async function getSyncMetadata(eventUuid: string): Promise<any | null> {
  const kvKey = `live:${eventUuid}:sync:metadata`;
  
  try {
    return await getKV<any>(kvKey, KV_NAMESPACE);
  } catch (error) {
    console.error(`Failed to retrieve sync metadata ${kvKey}:`, error);
    return null;
  }
}
