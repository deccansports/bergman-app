import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function asRows(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.participants)) return value.participants;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  if (value?.byUuid && typeof value.byUuid === 'object') return Object.values(value.byUuid);
  if (value?.byBib && typeof value.byBib === 'object') return Object.values(value.byBib);
  if (value?.byBookingId && typeof value.byBookingId === 'object') return Object.values(value.byBookingId);
  return [];
}

function countObjectKeys(value: any): number {
  return value && typeof value === 'object' ? Object.keys(value).length : 0;
}

function dedupeByRef(rows: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const key = String(
      row?.bookingId ||
      row?.providerParticipantUuid ||
      row?.participantUuid ||
      row?.participant_uuid ||
      row?.bib ||
      JSON.stringify(row),
    );
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function healthStatus(ok: boolean) {
  return ok ? 'PASS' : 'FAIL';
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = normalize(params?.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const [
      kvParticipantsPrimary,
      kvIndexPrimary,
      kvIndexSecondary,
      kvParticipantIndexPrimary,
      kvImportSummary,
      providerMetadata,
      kvConfigPrimary,
      kvConfigSecondary,
      kvProviderConfig,
    ] = await Promise.all([
      getKV<any>(`live:event:${eventId}:participants`, 'api-live-debug'),
      getKV<any>(`live:event:${eventId}:index`, 'api-live-debug'),
      getKV<any>(`event:${eventId}:index`, 'api-live-debug'),
      getKV<any>(`live:event:${eventId}:participant:index`, 'api-live-debug'),
      getKV<any>(`live:event:${eventId}:import-summary:latest`, 'api-live-debug'),
      getKV<any>(`event:${eventId}:provider:metadata`, 'api-live-debug'),
      getKV<any>(`live:event:${eventId}:config`, 'api-live-debug'),
      getKV<any>(`event:${eventId}:config`, 'api-live-debug'),
      getKV<any>(`live:event:${eventId}:provider-config`, 'api-live-debug'),
    ]);

    const kvParticipants = kvParticipantsPrimary || null;
    const kvIndex = kvIndexPrimary || kvIndexSecondary || null;
    const kvParticipantIndex = kvParticipantIndexPrimary || null;

    const participantRows = dedupeByRef([
      ...asRows(kvParticipants),
      ...asRows(kvIndex),
      ...asRows(kvParticipantIndex),
    ]);

    const byBib = kvIndex?.byBib || kvParticipants?.byBib || {};
    const byUuid = kvIndex?.byUuid || kvParticipants?.byUuid || {};
    const byChip = kvIndex?.byChip || kvParticipants?.byChip || {};
    const byBookingId = kvIndex?.byBookingId || kvParticipants?.byBookingId || {};
    const contestLookup = kvIndex?.contestLookup || kvParticipants?.contestLookup || {};

    const bibValues = participantRows.map((row) => normalize(row?.bib || row?.bibNumber)).filter(Boolean);
    const uuidValues = participantRows.map((row) => normalize(row?.providerParticipantUuid || row?.participantUuid || row?.participant_uuid)).filter(Boolean);
    const chipValues = participantRows.map((row) => normalize(row?.chip || row?.chipCode)).filter(Boolean);

    const missingBibs = participantRows.filter((row) => !normalize(row?.bib || row?.bibNumber)).length;
    const duplicateBibs = findDuplicates(bibValues);

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    const [eventSnap, participantsSnap, providerParticipantsSnap] = await Promise.all([
      eventRef.get(),
      eventRef.collection('participants').get(),
      eventRef.collection('providerParticipants').get(),
    ]);
    const eventData = eventSnap.exists ? (eventSnap.data() || {}) : {};
    const fireFeibotConfig = (eventData as any)?.liveTrackingHub?.feibotConfig || {};
    const fireCloudUuid = normalize(fireFeibotConfig?.cloud?.eventUuid || fireFeibotConfig?.eventUuid || '');
    const fireScoreUuid = normalize(fireFeibotConfig?.score?.eventUuid || '');

    const kvConfig = kvConfigPrimary || kvConfigSecondary || kvProviderConfig || {};
    const kvFeibotConfig = kvConfig?.feibotConfig || kvConfig?.providerConfig || {};
    const kvCloudUuid = normalize(kvFeibotConfig?.cloud?.eventUuid || kvFeibotConfig?.eventUuid || '');
    const kvScoreUuid = normalize(kvFeibotConfig?.score?.eventUuid || '');
    const linkedEventUuid = fireCloudUuid || kvCloudUuid || normalize(kvImportSummary?.detected?.eventUuid || '');

    const firestoreParticipantRows = participantsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const firestoreProviderRows = providerParticipantsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

    const importCount = Number(kvImportSummary?.counts?.participants || kvImportSummary?.counts?.activeParticipants || 0);
    const kvParticipantCount = participantRows.length;
    const kvIndexCount = Number(kvIndex?.participantCount || kvIndex?.count || asRows(kvIndex).length || 0);

    const sampleBib = normalize(req.nextUrl.searchParams.get('sampleBib')) || bibValues[0] || '';
    const sampleMatch = sampleBib ? (byBib?.[sampleBib] || byBib?.[sampleBib.replace(/^0+/, '')] || null) : null;

    const searchHealthOk = kvParticipantCount > 0 && countObjectKeys(byBib) > 0;
    const modalHealthOk = kvParticipantCount > 0 && (sampleBib ? Boolean(sampleMatch) : true);

    return NextResponse.json({
      success: true,
      eventId,
      diagnostics: {
        bergmanEventLink: linkedEventUuid ? 'Linked and ready' : 'Not linked',
        linkedEventUuid: linkedEventUuid || null,
        linkedUuidSource: fireCloudUuid ? 'firestore.liveTrackingHub.feibotConfig.cloud.eventUuid' : kvCloudUuid ? 'kv.config.feibotConfig.cloud.eventUuid' : normalize(kvImportSummary?.detected?.eventUuid || '') ? 'fdb-import.detected.eventUuid' : null,
        cloudUuid: fireCloudUuid || kvCloudUuid || null,
        eventUuid: normalize(fireFeibotConfig?.eventUuid || kvFeibotConfig?.eventUuid || '') || null,
        scoreEventUuid: fireScoreUuid || kvScoreUuid || null,
        participantImportCount: importCount,
        firestoreCount: participantsSnap.size,
        firestoreProviderCount: providerParticipantsSnap.size,
        kvParticipantCount,
        kvIndexCount,
        bibCount: countObjectKeys(byBib),
        uuidCount: countObjectKeys(byUuid),
        chipCount: countObjectKeys(byChip),
        bookingCount: countObjectKeys(byBookingId),
        contestCount: countObjectKeys(contestLookup),
        missingBibs,
        duplicateBibs,
        duplicateBibCount: duplicateBibs.length,
        indexStatus: healthStatus(kvIndexCount > 0 && countObjectKeys(byBib) > 0),
        searchHealth: healthStatus(searchHealthOk),
        modalHealth: healthStatus(modalHealthOk),
        sampleBib: sampleBib || null,
        sampleBibResolved: Boolean(sampleMatch),
        lastImport: normalize(kvImportSummary?.detected?.lastModified || kvImportSummary?.completedAt || kvImportSummary?.importedAt) || null,
        lastIndexBuild: normalize(kvIndex?.generatedAt || kvIndex?.updatedAt || providerMetadata?.athleteMasterIndex?.rebuiltAt) || null,
        lastKvSync: normalize(kvParticipants?.generatedAt || kvParticipants?.updatedAt || kvIndex?.generatedAt || kvIndex?.updatedAt) || null,
      },
      shapes: {
        kvParticipantsKeys: kvParticipants ? Object.keys(kvParticipants) : [],
        kvIndexKeys: kvIndex ? Object.keys(kvIndex) : [],
      },
      health: {
        firestoreEventExists: Boolean(eventSnap.exists),
        firestoreParticipantsLoaded: firestoreParticipantRows.length,
        firestoreProviderParticipantsLoaded: firestoreProviderRows.length,
      },
      testedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to run live debug diagnostics',
      },
      { status: 500 },
    );
  }
}
