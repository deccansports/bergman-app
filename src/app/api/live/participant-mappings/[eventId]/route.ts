import { NextRequest, NextResponse } from 'next/server';
import { getKV, putKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';

function normalizeString(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

async function loadMappingPayload(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping`, 'api-participant-mappings')) ||
    null
  );
}

async function loadUidPayload(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping-by-uid`, 'api-participant-mappings')) ||
    null
  );
}

async function loadProviderPayload(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping-by-provider`, 'api-participant-mappings')) ||
    null
  );
}

async function loadReviewPayload(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping-review`, 'api-participant-mappings')) ||
    null
  );
}

async function saveAllIndexes(eventId: string, payloads: {
  byBib: Record<string, any>;
  byUid: Record<string, any>;
  byProvider: Record<string, any>;
  summary: Record<string, any> | null;
  reviewQueue: any[];
}) {
  const updatedAt = new Date().toISOString();
  const byBibPayload = { eventId, updatedAt, byBib: payloads.byBib, summary: payloads.summary || null };
  const byUidPayload = { eventId, updatedAt, byUid: payloads.byUid, summary: payloads.summary || null };
  const byProviderPayload = { eventId, updatedAt, byProvider: payloads.byProvider, summary: payloads.summary || null };
  const reviewPayload = { eventId, updatedAt, reviewQueue: payloads.reviewQueue, total: payloads.reviewQueue.length };

  const legacyMappings = Object.values(payloads.byProvider).map((row: any) => ({
    bergmanParticipantId: normalizeString(row?.registrationId),
    bergmanAthleteId: normalizeString(row?.bergmanUid || row?.registrationId),
    bergmanAthleteUid: normalizeString(row?.bergmanUid),
    bergmanBookingId: normalizeString(row?.registrationId),
    feibotParticipantUUID: normalizeString(row?.providerParticipantUuid),
    eventId,
    contestUUID: normalizeString(row?.contestUuid),
    contest_name: normalizeString(row?.category),
    bib: normalizeString(row?.bib),
    chipCode: null,
    synced: true,
    syncedAt: normalizeString(row?.matchedAt) || updatedAt,
    lastUpdated: normalizeString(row?.matchedAt) || updatedAt,
    lastSync: normalizeString(row?.matchedAt) || updatedAt,
    status: 'matched',
  }));

  const legacyPayload = {
    updatedAt,
    mappings: legacyMappings,
    summary: payloads.summary || null,
  };

  await Promise.all([
    putKV(`live:event:${eventId}:participant-mapping`, byBibPayload, 'api-participant-mappings'),
    putKV(`live:event:${eventId}:participant-mapping-by-uid`, byUidPayload, 'api-participant-mappings'),
    putKV(`live:event:${eventId}:participant-mapping-by-provider`, byProviderPayload, 'api-participant-mappings'),
    putKV(`live:event:${eventId}:participant-mapping-review`, reviewPayload, 'api-participant-mappings'),
    putKV(`live:event:${eventId}:participantMappings`, legacyPayload, 'api-participant-mappings'),
  ]);

  return { updatedAt, legacyMappings };
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const snapshot = (await getKV<Record<string, any>>(`live:event:${eventId}:participantMappings`, 'api-participant-mappings')) ||
      null;

    const reviewPayload = await loadReviewPayload(eventId);
    const latestImportReport =
      (await getKV<Record<string, any>>(`live:event:${eventId}:participant-import-report:latest`, 'api-participant-mappings')) ||
      null;

    const mappings = Array.isArray(snapshot?.mappings) ? snapshot.mappings : [];

    return NextResponse.json({
      success: true,
      eventId,
      updatedAt: snapshot?.updatedAt || null,
      summary: snapshot?.summary || null,
      mappings,
      reviewQueue: Array.isArray(reviewPayload?.reviewQueue) ? reviewPayload.reviewQueue : [],
      importReport: latestImportReport,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to read participant mappings',
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    if (body?.action === 'approve-review') {
      const providerParticipantUuid = normalizeString(body?.providerParticipantUuid || body?.participantUuid || body?.feibotParticipantUUID);
      const bergmanUid = normalizeString(body?.bergmanUid || body?.athleteUid || body?.uid);
      const registrationId = normalizeString(body?.registrationId || body?.bergmanParticipantId || body?.bookingId);
      const bib = normalizeString(body?.bib);
      const contestUuid = normalizeString(body?.contestUuid || body?.contestUUID);
      const category = normalizeString(body?.category);

      if (!providerParticipantUuid || !contestUuid || (!bergmanUid && !registrationId && !bib)) {
        return NextResponse.json(
          { success: false, message: 'providerParticipantUuid, contestUuid and at least one Bergman identifier are required' },
          { status: 400 },
        );
      }

      const [mappingPayload, uidPayload, providerPayload, reviewPayload] = await Promise.all([
        loadMappingPayload(eventId),
        loadUidPayload(eventId),
        loadProviderPayload(eventId),
        loadReviewPayload(eventId),
      ]);

      const byBib = { ...((mappingPayload?.byBib || mappingPayload || {}) as Record<string, any>) };
      const byUid = { ...((uidPayload?.byUid || uidPayload || {}) as Record<string, any>) };
      const byProvider = { ...((providerPayload?.byProvider || providerPayload || {}) as Record<string, any>) };
      const reviewQueue = Array.isArray(reviewPayload?.reviewQueue) ? [...reviewPayload.reviewQueue] : [];

      const record = {
        bergmanUid,
        registrationId,
        bib,
        category,
        contestUuid,
        provider: 'feibot',
        providerParticipantUuid,
        confidence: Number(body?.confidence || 100),
        matchedBy: normalizeString(body?.matchedBy || 'manual') || 'manual',
        matchedAt: new Date().toISOString(),
        status: 'matched',
      };

      if (bib) byBib[bib] = record;
      if (bergmanUid) byUid[bergmanUid] = record;
      byProvider[providerParticipantUuid] = record;

      const nextReviewQueue = reviewQueue.filter((item: any) => {
        const itemUuid = normalizeString(item?.participant?.participantUuid || item?.participant?.providerUuid || item?.providerParticipantUuid);
        return itemUuid !== providerParticipantUuid;
      });

      const summary = {
        ...(mappingPayload?.summary || providerPayload?.summary || {}),
        manualApprovals: Number((mappingPayload?.summary?.manualApprovals || 0)) + 1,
        unresolvedReview: nextReviewQueue.length,
      };

      const result = await saveAllIndexes(eventId, {
        byBib,
        byUid,
        byProvider,
        summary,
        reviewQueue: nextReviewQueue,
      });

      return NextResponse.json({
        success: true,
        eventId,
        updatedAt: result.updatedAt,
        record,
        reviewRemaining: nextReviewQueue.length,
      });
    }

    const mappings = Array.isArray(body?.mappings) ? body.mappings : [];
    const summary = body?.summary && typeof body.summary === 'object' ? body.summary : null;
    const updatedAt = new Date().toISOString();

    const normalized = mappings.map((mapping: any) => ({
      bergmanParticipantId: normalizeString(mapping?.bergmanParticipantId),
      bergmanAthleteId: normalizeString(mapping?.bergmanAthleteId || mapping?.bergmanAthleteUid || mapping?.bergmanParticipantId),
      bergmanAthleteUid: normalizeString(mapping?.bergmanAthleteUid),
      bergmanBookingId: normalizeString(mapping?.bergmanBookingId),
      feibotParticipantUUID: normalizeString(mapping?.feibotParticipantUUID || mapping?.feibotParticipantId),
      eventId,
      contestUUID: normalizeString(mapping?.contestUUID),
      contest_name: normalizeString(mapping?.contest_name || mapping?.contestName),
      bib: normalizeString(mapping?.bib),
      chipCode: normalizeString(mapping?.chipCode),
      synced: Boolean(mapping?.synced),
      syncedAt: normalizeString(mapping?.syncedAt) || updatedAt,
      lastUpdated: normalizeString(mapping?.lastUpdated) || updatedAt,
      lastSync: normalizeString(mapping?.lastSync) || updatedAt,
      status: normalizeString(mapping?.status) || 'matched',
    }));

    const payload = {
      updatedAt,
      mappings: normalized,
      summary,
    };

    const byBib: Record<string, any> = {};
    const byUid: Record<string, any> = {};
    const byProvider: Record<string, any> = {};
    for (const row of normalized) {
      const record = {
        bergmanUid: normalizeString(row?.bergmanAthleteUid),
        registrationId: normalizeString(row?.bergmanParticipantId || row?.bergmanBookingId),
        bib: normalizeString(row?.bib),
        category: normalizeString(row?.contest_name),
        contestUuid: normalizeString(row?.contestUUID),
        provider: 'feibot',
        providerParticipantUuid: normalizeString(row?.feibotParticipantUUID),
        confidence: Number((row as any)?.confidence || 100),
        matchedBy: normalizeString((row as any)?.matchedBy || 'manual') || 'manual',
        matchedAt: normalizeString(row?.lastUpdated) || updatedAt,
      };
      if (record.bib) byBib[record.bib] = record;
      if (record.bergmanUid) byUid[record.bergmanUid] = record;
      if (record.providerParticipantUuid) byProvider[record.providerParticipantUuid] = record;
    }

    await Promise.all([
      putKV(`live:event:${eventId}:participantMappings`, payload, 'api-participant-mappings'),
      putKV(`live:event:${eventId}:participant-mapping`, { eventId, updatedAt, byBib, summary }, 'api-participant-mappings'),
      putKV(`live:event:${eventId}:participant-mapping-by-uid`, { eventId, updatedAt, byUid, summary }, 'api-participant-mappings'),
      putKV(`live:event:${eventId}:participant-mapping-by-provider`, { eventId, updatedAt, byProvider, summary }, 'api-participant-mappings'),
    ]);

    return NextResponse.json({ success: true, eventId, updatedAt, mappings: normalized, summary });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save participant mappings',
      },
      { status: 500 },
    );
  }
}
