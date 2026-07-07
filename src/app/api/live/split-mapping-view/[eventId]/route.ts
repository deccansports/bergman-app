import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Split mapping structure stored in KV
 */
interface SplitMapping {
  feibotSplitUuid: string;
  feibotSplitName: string;
  feibotContestUuid: string;
  feibotContestName: string;
  mappedToBergmanSplitId?: string | null;
  mappedToBergmanSplitName?: string | null;
  mappedToBergmanLeg?: 'swim' | 'bike' | 'run' | 'run1' | 'run2' | null;
  status?: 'mapped' | 'unmapped';
  mappedAt?: string | null;
  mappedBy?: string | null;
}

/**
 * Bergman course split structure
 */
interface BergmanSplit {
  id: string;
  name: string;
  distance: number;
  leg: 'swim' | 'bike' | 'run' | 'run1' | 'run2';
}

/**
 * Response row for UI
 */
export interface SplitMappingRow {
  feibotSplitUuid: string;
  feibotSplitName: string;
  feibotContestUuid: string;
  feibotContestName: string;
  distance?: string | null;
  categoryType?: string | null;
  mappedToBergmanSplitId?: string | null;
  mappedToBergmanSplitName?: string | null;
  mappedToBergmanLeg?: 'swim' | 'bike' | 'run' | 'run1' | 'run2' | null;
  status?: 'mapped' | 'unmapped';
  isMapped?: boolean;
}

async function loadTimingRules(eventId: string, eventUuid: string) {
  if (!eventUuid) return null;
  try {
    const config = await getKV<any>(
      `live:event:${eventId}:provider-config`,
      'split-mapping-view'
    );
    const apiBaseUrl = normalize(config?.apiBaseUrl || '');
    const accessKey = normalize(config?.accessKey || '');
    const secretKey = normalize(config?.secretKey || '');

    if (!apiBaseUrl || !accessKey || !secretKey) {
      console.log('[split-mapping-view] Missing credentials', {
        eventId,
        hasApiBaseUrl: !!apiBaseUrl,
        hasAccessKey: !!accessKey,
        hasSecretKey: !!secretKey,
      });
      return null;
    }

    const url = `${apiBaseUrl}/eventConfigFile/timingRulesGet?event_uuid=${encodeURIComponent(
      eventUuid
    )}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Access-Key': accessKey,
        'X-Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.log('[split-mapping-view] Timing rules API error', {
        eventId,
        eventUuid,
        status: response.status,
        responseText: text.slice(0, 500),
      });
      return null;
    }

    const data = await response.json();
    return data?.timing_rules || null;
  } catch (error) {
    console.log('[split-mapping-view] Error loading timing rules', {
      eventId,
      eventUuid,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadBergmanCourseConfig(eventId: string) {
  try {
    const db = getFirestoreInstance();
    const snap = await db
      .collection('events')
      .doc(eventId)
      .collection('courseConfig')
      .doc('config')
      .get();

    if (!snap.exists) return null;
    const data = snap.data();

    const splits: BergmanSplit[] = [];

    // Load swim splits
    if (Array.isArray(data?.swimSplits)) {
      for (const split of data.swimSplits) {
        splits.push({
          id: normalize(split?.id || split?.uuid || ''),
          name: normalize(split?.name || ''),
          distance: Number(split?.distance || 0) || 0,
          leg: 'swim',
        });
      }
    }

    // Load bike splits
    if (Array.isArray(data?.bikeSplits)) {
      for (const split of data.bikeSplits) {
        splits.push({
          id: normalize(split?.id || split?.uuid || ''),
          name: normalize(split?.name || ''),
          distance: Number(split?.distance || 0) || 0,
          leg: 'bike',
        });
      }
    }

    // Load run splits (check both runSplits and run1Splits/run2Splits)
    if (Array.isArray(data?.runSplits)) {
      for (const split of data.runSplits) {
        splits.push({
          id: normalize(split?.id || split?.uuid || ''),
          name: normalize(split?.name || ''),
          distance: Number(split?.distance || 0) || 0,
          leg: 'run',
        });
      }
    }

    if (Array.isArray(data?.run1Splits)) {
      for (const split of data.run1Splits) {
        splits.push({
          id: normalize(split?.id || split?.uuid || ''),
          name: normalize(split?.name || ''),
          distance: Number(split?.distance || 0) || 0,
          leg: 'run1',
        });
      }
    }

    if (Array.isArray(data?.run2Splits)) {
      for (const split of data.run2Splits) {
        splits.push({
          id: normalize(split?.id || split?.uuid || ''),
          name: normalize(split?.name || ''),
          distance: Number(split?.distance || 0) || 0,
          leg: 'run2',
        });
      }
    }

    return splits;
  } catch (error) {
    console.log('[split-mapping-view] Error loading Bergman course config', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadSplitMapping(eventId: string) {
  try {
    const kvMapping = await getKV<Record<string, SplitMapping>>(
      `live:event:${eventId}:split:mapping`,
      'split-mapping-view'
    ).catch(() => null);

    if (kvMapping) return kvMapping;

    const firestore = await getFirestoreInstance()
      .collection('events')
      .doc(eventId)
      .collection('liveTracking')
      .doc('splitMapping')
      .get()
      .catch(() => null);

    if (firestore?.exists) {
      return firestore.data();
    }

    return null;
  } catch (error) {
    console.log('[split-mapping-view] Error loading split mapping', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const eventId = normalize(params.eventId);
  if (!eventId) {
    return NextResponse.json(
      { success: false, message: 'Event ID is required' },
      { status: 400 }
    );
  }

  try {
    // Load provider config to get event UUID and credentials
    const providerConfig = await getKV<any>(
      `live:event:${eventId}:provider-config`,
      'split-mapping-view'
    );

    const eventUuid = normalize(providerConfig?.eventUuid || '');
    if (!eventUuid) {
      console.log('[split-mapping-view] No event UUID configured', { eventId });
      return NextResponse.json(
        {
          success: true,
          importedSplits: [],
          bergmanSplits: [],
          splitMappings: [],
          message: 'No Feibot event configured yet',
        },
        { status: 200 }
      );
    }

    // Load Feibot timing rules
    const timingRules = await loadTimingRules(eventId, eventUuid);
    const feibotSplits = safeArray<any>(timingRules?.splits || []);

    console.log('[split-mapping-view] Feibot splits loaded', {
      eventId,
      eventUuid,
      splitCount: feibotSplits.length,
    });

    // Load Bergman course config splits
    const bergmanSplits = await loadBergmanCourseConfig(eventId);
    const splitsByLeg = new Map<string, BergmanSplit[]>();

    if (Array.isArray(bergmanSplits)) {
      for (const split of bergmanSplits) {
        if (!splitsByLeg.has(split.leg)) {
          splitsByLeg.set(split.leg, []);
        }
        splitsByLeg.get(split.leg)!.push(split);
      }
    }

    console.log('[split-mapping-view] Bergman splits loaded', {
      eventId,
      splitCount: bergmanSplits?.length || 0,
      byLeg: Object.fromEntries(
        [...splitsByLeg.entries()].map(([leg, splits]) => [leg, splits.length])
      ),
    });

    // Load existing split mappings
    const existingMappings = await loadSplitMapping(eventId);
    const mappingByFeibotSplitUuid = new Map<string, SplitMapping>(
      Object.entries(existingMappings || {}).map(([uuid, mapping]) => [uuid, mapping])
    );

    // Build response rows - combine Feibot splits with their mappings
    const importedSplits: SplitMappingRow[] = feibotSplits.map((split: any) => {
      const splitUuid = normalize(split?.splitUuid || split?.uuid || split?.id || '');
      const splitName = normalize(split?.splitName || split?.name || '');
      const contestUuid = normalize(split?.contestUuid || split?.contest_uuid || '');
      const contestName = normalize(split?.contestName || split?.contest_name || '');

      const mapping = mappingByFeibotSplitUuid.get(splitUuid);

      return {
        feibotSplitUuid: splitUuid,
        feibotSplitName: splitName,
        feibotContestUuid: contestUuid,
        feibotContestName: contestName,
        distance: normalize(split?.distance || split?.distance_m || null) || null,
        categoryType: normalize(split?.category || split?.type || null) || null,
        mappedToBergmanSplitId: mapping?.mappedToBergmanSplitId || null,
        mappedToBergmanSplitName: mapping?.mappedToBergmanSplitName || null,
        mappedToBergmanLeg: mapping?.mappedToBergmanLeg || null,
        status: mapping ? 'mapped' : 'unmapped',
        isMapped: !!mapping,
      };
    });

    const mappedCount = importedSplits.filter((row) => row.status === 'mapped').length;
    const unmappedCount = importedSplits.length - mappedCount;

    console.log('[split-mapping-view] response summary', {
      eventId,
      eventUuid,
      importedSplitCount: importedSplits.length,
      mappedCount,
      unmappedCount,
      bergmanSplitCount: bergmanSplits?.length || 0,
    });

    return NextResponse.json(
      {
        success: true,
        eventId,
        eventUuid,
        importedSplits,
        bergmanSplits: bergmanSplits || [],
        splitMappings: Array.from(mappingByFeibotSplitUuid.values()),
        summary: {
          importedCount: importedSplits.length,
          mappedCount,
          unmappedCount,
          bergmanSplitCount: bergmanSplits?.length || 0,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[split-mapping-view] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const eventId = normalize(params.eventId);
  if (!eventId) {
    return NextResponse.json(
      { success: false, message: 'Event ID is required' },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    const mapping: SplitMapping = {
      feibotSplitUuid: normalize(body.feibotSplitUuid),
      feibotSplitName: normalize(body.feibotSplitName),
      feibotContestUuid: normalize(body.feibotContestUuid),
      feibotContestName: normalize(body.feibotContestName),
      mappedToBergmanSplitId: body.mappedToBergmanSplitId || null,
      mappedToBergmanSplitName: body.mappedToBergmanSplitName || null,
      mappedToBergmanLeg: body.mappedToBergmanLeg || null,
      status: body.mappedToBergmanSplitId ? 'mapped' : 'unmapped',
      mappedAt: new Date().toISOString(),
      mappedBy: 'admin', // Could be enhanced to track actual user
    };

    // Save to KV
    const kvKey = `live:event:${eventId}:split:mapping`;
    const existing = (await getKV<Record<string, SplitMapping>>(kvKey, 'split-mapping-view').catch(
      () => null
    )) || {};

    const updated = {
      ...existing,
      [mapping.feibotSplitUuid]: mapping,
    };

    await putKV(kvKey, updated, 'split-mapping-view');

    console.log('[split-mapping-view] Split mapping saved', {
      eventId,
      feibotSplitUuid: mapping.feibotSplitUuid,
      mappedToBergmanSplitId: mapping.mappedToBergmanSplitId,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Split mapping saved',
        mapping,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[split-mapping-view] POST Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
