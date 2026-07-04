import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { synchronizeEventConfiguration } from '@/lib/feibot-integration/event-config';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { getFeibotRuntimeSecretsAsync } from '@/lib/feibot-integration/secure-credentials';
import { putKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizePhone(value: unknown) {
  return String(value ?? '').replace(/\D+/g, '').trim() || null;
}

function splitName(fullNameRaw: string | null) {
  const fullName = normalize(fullNameRaw);
  if (!fullName) return { firstName: null as string | null, lastName: null as string | null, fullName: null as string | null };
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || null, lastName: null, fullName };
  return {
    firstName: parts.slice(0, -1).join(' ') || null,
    lastName: parts[parts.length - 1] || null,
    fullName,
  };
}

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.SYNC_SECRET || process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const internal = req.headers.get('x-bergman-internal-token');
  return bearer === expectedToken || internal === expectedToken;
}

function resolveSyncInfo(eventId: string, eventData: any): { eventId: string; eventUuid: string; connectionId: string } {
  const topLevel = eventData?.feibotConfig || {};
  const hubConfig = eventData?.liveTrackingHub?.feibotConfig || {};
  const cloudConfig = hubConfig?.cloud || {};

  const eventUuid = normalize(topLevel?.eventUuid || cloudConfig?.eventUuid || hubConfig?.eventUuid);
  const connectionId = normalize(topLevel?.connectionId || hubConfig?.connectionId);

  return { eventId, eventUuid, connectionId };
}

function pickParticipantRows(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];

  const candidates = ['participants', 'rows', 'items', 'result', 'list', 'data'];
  for (const key of candidates) {
    const value = input[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function normalizeParticipant(provider: string, eventId: string, row: any, index: number) {
  const providerUuid = normalize(row?.participant_uuid || row?.participantUuid || row?.uuid || row?.id || `${provider}:${eventId}:${index + 1}`);
  const bib = normalize(row?.bib || row?.bib_no || row?.bibNumber || row?.number || row?.no);
  const chip = normalize(row?.chip || row?.chip_code || row?.chipCode || row?.chip_id || row?.chipId);
  const fullNameCandidate = normalize(row?.fullName || row?.full_name || row?.name || [row?.firstName || row?.first_name, row?.lastName || row?.last_name].filter(Boolean).join(' ')) || null;
  const split = splitName(fullNameCandidate);

  return {
    provider,
    eventId,
    providerUuid,
    participantUuid: providerUuid,
    participant_uuid: providerUuid,
    bib,
    chip,
    firstName: split.firstName,
    lastName: split.lastName,
    fullName: split.fullName,
    gender: normalize(row?.gender || row?.sex),
    email: normalize(row?.email),
    phone: normalize(row?.phone || row?.mobile),
    mobile: normalize(row?.mobile || row?.phone),
    nationality: normalize(row?.nationality || row?.nation || row?.country),
    team: normalize(row?.team || row?.teamName),
    club: normalize(row?.club || row?.clubName),
    contestUuid: normalize(row?.contest_uuid || row?.contestUuid || row?.contest?.uuid || row?.contest?.UUID) || null,
    contestName: normalize(row?.contest_name || row?.contestName || row?.contest?.name || row?.contest?.Name || row?.category) || null,
    ageGroupName: normalize(row?.age_group_name || row?.ageGroupName || row?.ageGroup?.name || row?.ageGroup?.Name || row?.age_group || row?.ageGroup) || null,
    category: normalize(row?.category || row?.ageGroup || row?.age_group),
    registrationStatus: normalize(row?.registrationStatus || row?.ticketStatus || row?.status),
    providerStatus: normalize(row?.providerStatus || row?.status),
    liveTracking: {
      bib,
      chip,
      contestUuid: normalize(row?.contest_uuid || row?.contestUuid || row?.contest?.uuid || row?.contest?.UUID) || null,
      contestName: normalize(row?.contest_name || row?.contestName || row?.contest?.name || row?.contest?.Name || row?.category) || null,
    },
    updatedAt: new Date().toISOString(),
    source: 'feibot-live-sync',
  };
}

function buildIndexes(participants: any[]) {
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byUuid: Record<string, any> = {};

  for (const participant of participants) {
    const bib = normalize(participant?.bib);
    const chip = normalize(participant?.chip);
    const uuid = normalize(participant?.participantUuid || participant?.providerUuid || participant?.id);
    if (bib) byBib[bib] = participant;
    if (chip) byChip[chip] = participant;
    if (uuid) byUuid[uuid] = participant;
  }

  return {
    byBib,
    byChip,
    byUuid,
    count: participants.length,
    generatedAt: new Date().toISOString(),
  };
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const force = req.nextUrl.searchParams.get('force') === '1';
    const requestedEventId = normalize(req.nextUrl.searchParams.get('eventId'));

    const db = getFirestoreInstance();
    const runtime = await getFeibotRuntimeSecretsAsync();

    const targets: Array<{ eventId: string; eventUuid: string; connectionId: string }> = [];

    if (requestedEventId) {
      const doc = await db.collection('events').doc(requestedEventId).get();
      if (!doc.exists) {
        return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
      }
      const resolved = resolveSyncInfo(doc.id, doc.data() || {});
      if (resolved.eventUuid && resolved.connectionId) targets.push(resolved);
    } else {
      const snapshot = await db.collection('events').limit(500).get();
      for (const doc of snapshot.docs) {
        const resolved = resolveSyncInfo(doc.id, doc.data() || {});
        if (resolved.eventUuid && resolved.connectionId) targets.push(resolved);
      }
    }

    const results: Array<{
      eventId: string;
      eventUuid: string;
      success: boolean;
      timingSynced: boolean;
      participantsSynced: boolean;
      participantCount: number;
      message: string;
      error?: string;
    }> = [];

    for (const target of targets) {
      try {
        const timingSync = await synchronizeEventConfiguration(target.eventId, target.eventUuid, target.connectionId, { force });

        const client = {
          accountId: runtime.accountId,
          accessKey: runtime.accessKey,
          secretKey: runtime.secretKey,
          apiBaseUrl: runtime.apiBaseUrl || 'https://apicn.feibot.com',
        };

        const participantsResponse = await callFeibotAPI<any>(client, '/temporary/participantsGetAll', {
          method: 'GET',
          query: { event_uuid: target.eventUuid },
        });
        const participantSyncError = (participantsResponse as any)?.diagnostics?.error
          || (participantsResponse as any)?.error
          || 'Feibot participants request failed';

        if (!participantsResponse.ok) {
          results.push({
            eventId: target.eventId,
            eventUuid: target.eventUuid,
            success: false,
            timingSynced: timingSync.success,
            participantsSynced: false,
            participantCount: 0,
            message: 'Timing synced, participant sync failed',
            error: participantSyncError,
          });
          continue;
        }

        const rows = pickParticipantRows(participantsResponse.data);
        const normalizedParticipants = rows.map((row, index) => normalizeParticipant('feibot', target.eventId, row, index));
        const indexes = buildIndexes(normalizedParticipants);
        const updatedAt = new Date().toISOString();

        const providerParticipantsPayload = {
          eventId: target.eventId,
          provider: 'feibot',
          eventUuid: target.eventUuid,
          count: normalizedParticipants.length,
          generatedAt: updatedAt,
          participants: normalizedParticipants,
        };

        const participantIndexPayload = {
          ...indexes,
          provider: 'feibot',
          eventId: target.eventId,
          eventUuid: target.eventUuid,
          updatedAt,
        };

        await putKV(`event:${target.eventId}:providerParticipants`, providerParticipantsPayload, 'feibot-live-sync');
        await putKV(`live:event:${target.eventId}:providerParticipants`, providerParticipantsPayload, 'feibot-live-sync');
        await putKV(`event:${target.eventId}:participants`, participantIndexPayload, 'feibot-live-sync');
        await putKV(`live:event:${target.eventId}:participants`, participantIndexPayload, 'feibot-live-sync');

        const collectionRef = db.collection('events').doc(target.eventId).collection('providerParticipants');
        const batches = chunk(normalizedParticipants, 400);
        for (const group of batches) {
          const batch = db.batch();
          for (const participant of group) {
            const docId = normalize(participant.participantUuid || participant.providerUuid || participant.bib || `${target.eventId}-${Math.random().toString(36).slice(2)}`);
            batch.set(collectionRef.doc(docId), participant, { merge: true });
          }
          await batch.commit();
        }

        results.push({
          eventId: target.eventId,
          eventUuid: target.eventUuid,
          success: timingSync.success,
          timingSynced: timingSync.success,
          participantsSynced: true,
          participantCount: normalizedParticipants.length,
          message: 'Timing and participant sync completed',
        });
      } catch (error) {
        results.push({
          eventId: target.eventId,
          eventUuid: target.eventUuid,
          success: false,
          timingSynced: false,
          participantsSynced: false,
          participantCount: 0,
          message: 'Sync failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((row) => row.success).length;
    const participantTotal = results.reduce((sum, row) => sum + row.participantCount, 0);

    return NextResponse.json({
      success: results.length > 0 && successCount === results.length,
      message: 'Feibot live tracking sync job completed',
      stats: {
        total: results.length,
        successCount,
        failedCount: results.length - successCount,
        participantTotal,
        force,
      },
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Job failed',
      },
      { status: 500 },
    );
  }
}
