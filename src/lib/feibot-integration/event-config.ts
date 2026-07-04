/**
 * Feibot Event Configuration Importer
 * 
 * Fetches complete event configuration from Feibot
 * Archives raw response to KV before processing
 * Parses and stores for admin display
 */

import { getDecryptedCredentials } from './credentials';
import { fetchEventConfiguration } from './api-client';
import {
  archiveRawResponse,
  saveProcessedEventConfig,
  updateArchiveStatus,
  getSyncMetadata,
  saveSyncMetadata,
} from './kv-archive';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { getKV, listKVByPrefix, putKV } from '@/lib/cloudflare/kv';
import { rebuildSplitIndexInKv } from '@/lib/splitIndex';
import type { FeibotEventConfig } from './types';

type ConfigMeta = {
  version: string;
  updatedAt: string;
  updatedAtEpoch: number;
};

type SyncEntityResult = {
  entity: string;
  active: number;
  deleted: number;
};

type SynchronizeConfigResult = {
  success: boolean;
  changed: boolean;
  message: string;
  eventUuid: string;
  statusCode?: number;
  meta?: ConfigMeta;
  summary?: {
    contests: number;
    splits: number;
    devices: number;
    categories: number;
    ageGroups: number;
  };
  syncStats?: {
    archivedAt: string;
    entities: SyncEntityResult[];
    preservedMappings: {
      contests: boolean;
      splits: boolean;
      ageGroups: boolean;
    };
  };
  error?: string;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeIsoTimestamp(value: unknown) {
  const text = normalize(value);
  if (!text) return '';
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return text;
}

function normalizeEpochTimestamp(value: unknown) {
  const text = normalize(value);
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function extractConfigMeta(config: any): ConfigMeta {
  const timingMeta = config?.timing_rules?.meta || config?.timingRules?.meta || config?.meta || {};
  const version =
    normalize(timingMeta?.version) ||
    normalize(config?.version) ||
    normalize(config?.timing_rules?.version) ||
    'unknown';

  const updatedAt =
    normalizeIsoTimestamp(timingMeta?.updated_at) ||
    normalizeIsoTimestamp(timingMeta?.updatedAt) ||
    normalizeIsoTimestamp(config?.updated_at) ||
    normalizeIsoTimestamp(config?.updatedAt) ||
    new Date().toISOString();

  const updatedAtEpoch =
    normalizeEpochTimestamp(timingMeta?.updated_at) ||
    normalizeEpochTimestamp(timingMeta?.updatedAt) ||
    normalizeEpochTimestamp(config?.updated_at) ||
    normalizeEpochTimestamp(config?.updatedAt) ||
    Math.floor(Date.now() / 1000);

  return { version, updatedAt, updatedAtEpoch };
}

function asArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

function toObjectMap<T = any>(value: unknown): T[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value as Record<string, T>);
}

function resolveEntities(config: any, key: 'contests' | 'splits' | 'timingPoints' | 'devices' | 'ageGroups' | 'legs'): any[] {
  switch (key) {
    case 'contests':
      return asArray(config?.contests).concat(toObjectMap(config?.contest_map));
    case 'splits':
      return asArray(config?.splits).concat(asArray(config?.timing_rules?.splits));
    case 'timingPoints':
      return asArray(config?.timing_points)
        .concat(asArray(config?.timingPoints))
        .concat(asArray(config?.timing_rules?.timing_points));
    case 'devices':
      return asArray(config?.timing_devices)
        .concat(asArray(config?.devices))
        .concat(asArray(config?.timing_rules?.devices));
    case 'ageGroups':
      return asArray(config?.age_groups)
        .concat(asArray(config?.ageGroups))
        .concat(asArray(config?.timing_rules?.age_groups));
    case 'legs':
      return asArray(config?.legs).concat(asArray(config?.timing_rules?.legs));
    default:
      return [];
  }
}

function resolveUuid(value: any): string {
  return normalize(
    value?.uuid ||
      value?.contest_uuid ||
      value?.split_uuid ||
      value?.timing_point_uuid ||
      value?.timingPointUuid ||
      value?.device_uuid ||
      value?.age_group_uuid ||
      value?.leg_uuid ||
      value?.id,
  );
}

function uniqueByUuid(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const uuid = resolveUuid(row);
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    out.push(row);
  }
  return out;
}

async function upsertEntityCollection(params: {
  eventUuid: string;
  entityName: 'contest' | 'split' | 'timingPoint' | 'device' | 'ageGroup' | 'leg';
  rows: any[];
  sourceVersion: string;
  sourceUpdatedAt: string;
  syncedAt: string;
}): Promise<SyncEntityResult> {
  const { eventUuid, entityName, rows, sourceVersion, sourceUpdatedAt, syncedAt } = params;
  const uniqueRows = uniqueByUuid(rows);
  const activeUuids = new Set<string>();

  for (const row of uniqueRows) {
    const uuid = resolveUuid(row);
    if (!uuid) continue;
    activeUuids.add(uuid);

    await putKV(
      `event:${eventUuid}:${entityName}:${uuid}`,
      {
        uuid,
        eventUuid,
        objectType: entityName,
        sourceVersion,
        sourceUpdatedAt,
        lastSyncTime: syncedAt,
        status: 'active',
        source: 'feibot',
        sourcePayload: row,
      },
      'feibot-config-sync',
    );
  }

  const existingKeys = await listKVByPrefix(`event:${eventUuid}:${entityName}:`, 'feibot-config-sync');
  let deleted = 0;

  for (const key of existingKeys) {
    const uuid = normalize(key.split(':').pop());
    if (!uuid || activeUuids.has(uuid)) continue;

    const existing = await getKV<any>(key, 'feibot-config-sync');
    await putKV(
      key,
      {
        ...(existing || {}),
        uuid,
        eventUuid,
        objectType: entityName,
        sourceVersion,
        sourceUpdatedAt,
        lastSyncTime: syncedAt,
        status: 'deleted',
        deletedAt: syncedAt,
      },
      'feibot-config-sync',
    );
    deleted += 1;
  }

  return {
    entity: entityName,
    active: activeUuids.size,
    deleted,
  };
}

async function normalizeConfigToKV(eventUuid: string, config: any, meta: ConfigMeta, syncedAt: string) {
  const entities: SyncEntityResult[] = [];
  const timingConfiguration = (await getKV<Record<string, any>>(`event:${eventUuid}:timingConfiguration`, 'feibot-config-sync')) ||
    (await getKV<Record<string, any>>(`live:event:${eventUuid}:timingConfiguration`, 'feibot-config-sync')) ||
    config?.timingConfiguration ||
    config?.timingRules ||
    config?.timing_rules ||
    config || {};

  entities.push(
    await upsertEntityCollection({
      eventUuid,
      entityName: 'contest',
      rows: resolveEntities(config, 'contests'),
      sourceVersion: meta.version,
      sourceUpdatedAt: meta.updatedAt,
      syncedAt,
    }),
  );

  entities.push(
    await upsertEntityCollection({
      eventUuid,
      entityName: 'split',
      rows: resolveEntities(config, 'splits'),
      sourceVersion: meta.version,
      sourceUpdatedAt: meta.updatedAt,
      syncedAt,
    }),
  );

  entities.push(
    await upsertEntityCollection({
      eventUuid,
      entityName: 'timingPoint',
      rows: resolveEntities(config, 'timingPoints'),
      sourceVersion: meta.version,
      sourceUpdatedAt: meta.updatedAt,
      syncedAt,
    }),
  );

  entities.push(
    await upsertEntityCollection({
      eventUuid,
      entityName: 'device',
      rows: resolveEntities(config, 'devices'),
      sourceVersion: meta.version,
      sourceUpdatedAt: meta.updatedAt,
      syncedAt,
    }),
  );

  entities.push(
    await upsertEntityCollection({
      eventUuid,
      entityName: 'ageGroup',
      rows: resolveEntities(config, 'ageGroups'),
      sourceVersion: meta.version,
      sourceUpdatedAt: meta.updatedAt,
      syncedAt,
    }),
  );

  entities.push(
    await upsertEntityCollection({
      eventUuid,
      entityName: 'leg',
      rows: resolveEntities(config, 'legs'),
      sourceVersion: meta.version,
      sourceUpdatedAt: meta.updatedAt,
      syncedAt,
    }),
  );

  await putKV(
    `event:${eventUuid}:config`,
    {
      eventUuid,
      source: 'feibot',
      version: meta.version,
      updatedAt: meta.updatedAt,
      importedAt: syncedAt,
      syncStatus: 'complete',
      status: 'active',
      sourcePayload: config,
    },
    'feibot-config-sync',
  );

  await rebuildSplitIndexInKv({
    eventId: eventUuid,
    timingConfiguration,
    provider: 'feibot',
    generatedBy: 'feibot-config-sync',
    syncType: 'feibot-config-sync',
    sourceVersion: meta.version,
  });

  await putKV(
    `live:${eventUuid}:config:refresh:signal`,
    {
      eventUuid,
      refreshedAt: syncedAt,
      version: meta.version,
      updatedAt: meta.updatedAt,
    },
    'feibot-config-sync',
  );

  return entities;
}

/**
 * Auto-sync Feibot configuration for an event.
 * Detects changes using timing_rules.meta.version and timing_rules.meta.updated_at.
 */
export async function synchronizeEventConfiguration(
  eventId: string,
  eventUuid: string,
  connectionId: string,
  options: { force?: boolean } = {},
): Promise<SynchronizeConfigResult> {
  try {
    const credentials = await getDecryptedCredentials(connectionId);
    if (!credentials) {
      return {
        success: false,
        changed: false,
        message: 'Failed to retrieve credentials',
        eventUuid,
        error: 'Credentials not found or failed to decrypt',
      };
    }

    const fetchResult = await fetchEventConfiguration(credentials, eventUuid, { eventId });
    if (!fetchResult.ok || !fetchResult.data) {
      return {
        success: false,
        changed: false,
        message: `Feibot API error: ${fetchResult.error}`,
        eventUuid,
        statusCode: Number((fetchResult as any)?.status || 502) || 502,
        error: fetchResult.error,
      };
    }

    const config = fetchResult.data;
    const meta = extractConfigMeta(config);
    const previous = await getSyncMetadata(eventUuid);
    const previousVersion = normalize(previous?.currentConfigVersion);
    const previousUpdatedAt = normalize(previous?.currentConfigUpdatedAt);

    const changed =
      options.force === true ||
      !previousVersion ||
      !previousUpdatedAt ||
      previousVersion !== meta.version ||
      previousUpdatedAt !== meta.updatedAt;

    if (!changed) {
      await saveSyncMetadata(eventUuid, {
        ...(previous || {}),
        lastSync: Date.now(),
        lastTimingRulesSync: Date.now(),
        syncStatus: 'idle',
      });

      return {
        success: true,
        changed: false,
        message: 'Configuration unchanged (version/updated_at match)',
        eventUuid,
        meta,
      };
    }

    const syncedAt = new Date().toISOString();

    const archiveResult = await archiveRawResponse(
      eventUuid,
      'timingRulesGet',
      '/eventConfigFile/timingRulesGet',
      { event_uuid: eventUuid },
      config,
      {
        method: 'GET',
        httpStatus: 200,
        responseTimeMs: fetchResult.diagnostics.responseTimeMs,
        requestSignature: fetchResult.diagnostics.requestSignature,
      },
    );

    const archiveTimestamp = Number(archiveResult.archiveId.split(':')[1] || Date.now());
    await updateArchiveStatus(eventUuid, archiveTimestamp, 'complete');

    await putKV(`event:${eventUuid}:config:${archiveTimestamp}`, config, 'feibot-config-sync');

    await saveProcessedEventConfig(eventUuid, config);
    const entityStats = await normalizeConfigToKV(eventUuid, config, meta, syncedAt);

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    await eventRef.set(
      {
        feibotConfig: {
          eventUuid,
          connectionId,
          version: meta.version,
          updatedAt: meta.updatedAt,
          importedAt: syncedAt,
          syncStatus: 'complete',
          rawArchiveKey: archiveResult.kvKey,
          contests: config.contests?.length || 0,
          splits: config.splits?.length || 0,
          devices: config.timing_devices?.length || 0,
          categories: config.categories?.length || 0,
          ageGroups: config.age_groups?.length || 0,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await saveSyncMetadata(eventUuid, {
      ...(previous || {}),
      lastSync: Date.now(),
      lastTimingRulesSync: Date.now(),
      syncStatus: 'idle',
      currentConfigVersion: meta.version,
      currentConfigUpdatedAt: meta.updatedAt,
      lastImportTimestamp: syncedAt,
      nextSyncTime: Date.now() + 5 * 60 * 1000,
    } as any);

    return {
      success: true,
      changed: true,
      message: 'Configuration synchronized successfully',
      eventUuid,
      meta,
      summary: {
        contests: config.contests?.length || 0,
        splits: config.splits?.length || 0,
        devices: config.timing_devices?.length || 0,
        categories: config.categories?.length || 0,
        ageGroups: config.age_groups?.length || 0,
      },
      syncStats: {
        archivedAt: syncedAt,
        entities: entityStats,
        preservedMappings: {
          contests: true,
          splits: true,
          ageGroups: true,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      changed: false,
      message: 'Failed to synchronize event configuration',
      eventUuid,
      statusCode: 500,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Import complete event configuration from Feibot
 * 
 * Returns:
 * 1. Raw response archived to KV (immutable)
 * 2. Processed config saved to Firestore
 * 3. Summary for admin display
 */
export async function importEventConfiguration(
  eventId: string,
  eventUuid: string,
  connectionId: string
): Promise<{
  success: boolean;
  message: string;
  eventUuid: string;
  config?: FeibotEventConfig;
  summary?: {
    contests: number;
    splits: number;
    devices: number;
    categories: number;
    ageGroups: number;
  };
  statusCode?: number;
  error?: string;
}> {
  try {
    const syncResult = await synchronizeEventConfiguration(eventId, eventUuid, connectionId, { force: true });
    if (!syncResult.success) {
      return {
        success: false,
        message: syncResult.message,
        eventUuid,
        statusCode: syncResult.statusCode,
        error: syncResult.error,
      };
    }

    const config = await getKV<any>(`event:${eventUuid}:config`, 'feibot-config-sync');
    const sourcePayload = config?.sourcePayload || {};
    
    const summary = {
      contests: sourcePayload.contests?.length || 0,
      splits: sourcePayload.splits?.length || 0,
      devices: sourcePayload.timing_devices?.length || 0,
      categories: sourcePayload.categories?.length || 0,
      ageGroups: sourcePayload.age_groups?.length || 0,
    };
    
    return {
      success: true,
      message: `Successfully imported event configuration (${summary.contests} contests, ${summary.splits} splits)`,
      eventUuid,
      config: (sourcePayload || null) as any,
      summary,
    };
  } catch (error) {
    console.error(`Error importing event configuration for ${eventUuid}:`, error);
    
    return {
      success: false,
      message: 'Failed to import event configuration',
      eventUuid,
      statusCode: 500,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get previously imported event configuration
 */
export async function getImportedEventConfig(eventId: string): Promise<{
  success: boolean;
  config?: FeibotEventConfig;
  eventUuid?: string;
  lastImported?: string;
  error?: string;
}> {
  try {
    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    
    if (!eventSnap.exists) {
      return {
        success: false,
        error: 'Event not found',
      };
    }
    
    const feibotConfig = eventSnap.data()?.feibotConfig;
    
    if (!feibotConfig?.eventUuid) {
      return {
        success: false,
        error: 'No Feibot configuration found for this event',
      };
    }
    
    // Get from KV
    const { getProcessedEventConfig } = await import('./kv-archive');
    const config = await getProcessedEventConfig(feibotConfig.eventUuid);
    
    return {
      success: !!config,
      config,
      eventUuid: feibotConfig.eventUuid,
      lastImported: feibotConfig.lastImported,
    };
  } catch (error) {
    console.error(`Error retrieving event configuration for ${eventId}:`, error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retrieve configuration',
    };
  }
}

/**
 * Extract high-level summary for admin display
 */
export function extractConfigSummary(config: FeibotEventConfig): {
  eventName: string;
  contests: Array<{ id: string; name: string; type?: string }>;
  splits: Array<{ id: string; name: string; sequence: number }>;
  categories: Array<{ id: string; name: string }>;
  ageGroups: Array<{ id: string; name: string; minAge?: number; maxAge?: number }>;
} {
  return {
    eventName: config.event_name || 'Unknown Event',
    contests: (config.contests || []).map((c) => ({
      id: c.contest_uuid,
      name: c.contest_name,
      type: c.contest_type,
    })),
    splits: (config.splits || [])
      .sort((a, b) => (a.split_sequence || 0) - (b.split_sequence || 0))
      .map((s) => ({
        id: s.split_id,
        name: s.split_name,
        sequence: s.split_sequence || 0,
      })),
    categories: (config.categories || []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
    })),
    ageGroups: (config.age_groups || []).map((a) => ({
      id: a.age_group_id,
      name: a.age_group_name,
      minAge: a.min_age,
      maxAge: a.max_age,
    })),
  };
}
