import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, listKVByPrefix, putKV } from '@/lib/cloudflare/kv';
import { loadParticipantIndex as loadParticipantIndexStore, loadParticipantPublicView } from '@/lib/liveTrackingParticipantStore';
import { isPublicTrackingEligibleParticipant, isPublicEligibleRegistrationStatus, isHiddenByRegistrationStatus } from '@/lib/liveTrackingEligibility';
import { canAccessPrivateLiveTracking, getParticipantLiveTrackingPrivacy, maskAnonymousAthlete } from '@/lib/liveTrackingPrivacy';
import { resolveLiveTrackingAccess } from '@/lib/liveTrackingAccess';

export const dynamic = 'force-dynamic';

const searchIndexCache = new Map<string, { loadedAt: number; index: Record<string, any> | null; sourceKey: string | null }>();
const rebuildAttemptCache = new Map<string, number>();
const REBUILD_RETRY_MS = 60_000;

function nowMs() {
  return Date.now();
}

function getCachedSearchIndex(eventId: string) {
  const cached = searchIndexCache.get(eventId);
  if (!cached) return null;
  return cached.index;
}

async function loadSearchIndex(eventId: string) {
  const cached = searchIndexCache.get(eventId);
  if (cached?.index) return cached.index;

  const liveParticipantIndex = await loadParticipantIndexStore(eventId);
  const liveParticipantCount = Array.isArray((liveParticipantIndex as any)?.participants)
    ? (liveParticipantIndex as any).participants.length
    : Object.keys(((liveParticipantIndex as any)?.byBib || {}) as Record<string, any>).length;
  if (liveParticipantIndex && typeof liveParticipantIndex === 'object' && liveParticipantCount > 0) {
    searchIndexCache.set(eventId, { loadedAt: nowMs(), index: liveParticipantIndex, sourceKey: `live:event:${eventId}:participant:index` });
    return liveParticipantIndex;
  }

  const liveAthletes = await getKV<any[]>(`live:event:${eventId}:athletes`, 'api-live-athlete-search');
  if (Array.isArray(liveAthletes) && liveAthletes.length > 0) {
    const byBib: Record<string, any> = {};
    const byUuid: Record<string, any> = {};
    const byChip: Record<string, any> = {};
    const byBookingId: Record<string, any> = {};
    for (const row of liveAthletes) {
      const bib = norm(row?.bib || row?.bibNumber);
      const compactBib = bib.replace(/^0+/, '');
      const uuid = lower(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.provider?.providerUuid || row?.id);
      const chip = lower(row?.chip || row?.chipCode || row?.chip_code);
      const bookingId = lower(row?.bookingId || row?.registrationId || row?.athleteUid || row?.bergmanAthleteId);
      if (bib) byBib[bib] = row;
      if (compactBib) byBib[compactBib] = row;
      if (uuid) byUuid[uuid] = row;
      if (chip) byChip[chip] = row;
      if (bookingId) byBookingId[bookingId] = row;
    }
    const fastIndex = {
      eventId,
      participants: liveAthletes,
      participantCount: liveAthletes.length,
      count: liveAthletes.length,
      generatedAt: new Date().toISOString(),
      byBib,
      byUuid,
      byChip,
      byBookingId,
    };
    searchIndexCache.set(eventId, { loadedAt: nowMs(), index: fastIndex, sourceKey: `live:event:${eventId}:athletes` });
    return fastIndex;
  }

  searchIndexCache.set(eventId, { loadedAt: nowMs(), index: null, sourceKey: null });
  return null;
}

async function loadAgeGroupIndex(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:ageGroup:index`, 'api-live-athlete-search')) ||
    null
  );
}

function getDirectLookupMap(index: Record<string, any> | null | undefined, key: string) {
  if (!index) return null;
  const source = index as any;
  const map = source?.[key];
  return map && typeof map === 'object' ? map : null;
}

function lookupAthlete(index: Record<string, any> | null | undefined, q: string, mode: 'bib' | 'name' | 'email') {
  if (!index) return null;
  const raw = norm(q);
  const lowerQ = raw.toLowerCase();
  const compactBib = raw.replace(/^0+/, '');

  const byBib = getDirectLookupMap(index, 'byBib');
  const byUuid = getDirectLookupMap(index, 'byUuid');
  const byBookingId = getDirectLookupMap(index, 'byBookingId');
  const byChip = getDirectLookupMap(index, 'byChip');
  const byName = getDirectLookupMap(index, 'byName');
  const byEmail = getDirectLookupMap(index, 'byEmail');
  const lowerRaw = raw.toLowerCase();

  if (mode === 'bib') {
    return byBib?.[raw] || byBib?.[compactBib] || byUuid?.[raw] || byUuid?.[lowerRaw] || byBookingId?.[raw] || byBookingId?.[lowerRaw] || byChip?.[raw] || byChip?.[lowerRaw] || null;
  }

  if (mode === 'email') {
    return byEmail?.[lowerQ] || byEmail?.[raw] || byUuid?.[raw] || byUuid?.[lowerRaw] || byBookingId?.[raw] || byBookingId?.[lowerRaw] || null;
  }

  return byName?.[lowerQ] || byName?.[raw] || byUuid?.[raw] || byUuid?.[lowerRaw] || byBookingId?.[raw] || byBookingId?.[lowerRaw] || byBib?.[raw] || byBib?.[compactBib] || null;
}

function resolveAgeGroupName(row: any, ageGroupIndex: Record<string, any> | null | undefined) {
  const direct = norm(row?.ageGroupName || row?.age_group_name);
  if (direct) return direct;

  const fallback = norm(row?.ageGroup || row?.age_group);
  if (fallback && !/^[a-z0-9_-]{6,}$/i.test(fallback)) return fallback;

  const ageGroupUuid = norm(row?.ageGroupUuid || row?.age_group_uuid || row?.provider?.ageGroupUuid || row?.provider?.age_group_uuid);
  if (!ageGroupUuid || !ageGroupIndex) return fallback || null;

  const mapped = ageGroupIndex?.byUuid?.[ageGroupUuid] || ageGroupIndex?.byUuid?.[ageGroupUuid.toLowerCase()] || ageGroupIndex?.byUuid?.[ageGroupUuid.toUpperCase()] || null;
  return norm(mapped?.name || mapped?.label || mapped?.ageGroup || mapped?.ageGroupName || fallback || null) || null;
}

type RegistrationRow = Record<string, any>;
type ProviderRow = Record<string, any>;

function norm(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return norm(value).toLowerCase();
}

function normPhone(value: unknown) {
  return norm(value).replace(/\D+/g, '');
}

function normalizeCategoryKey(value: unknown) {
  return norm(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueByKey<T = any>(rows: T[], getKey: (row: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const row of rows) {
    const key = getKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function isExcludedRegistrationStatus(value: unknown) {
  const status = norm(value).toLowerCase();
  if (!status) return false;
  return (
    status.includes('defer')
    || status.includes('cancel')
    || status.includes('transfer')
    || status.includes('refund')
    || status.includes('inactive')
    || status.includes('delete')
    || status.includes('hidden')
    || status.includes('void')
  );
}

function isActiveRegistrationRow(row: RegistrationRow) {
  const status = norm(row?.ticketStatus || row?.registrationStatus || row?.status).toLowerCase();
  if (isExcludedRegistrationStatus(status)) return false;
  const readyForLiveTiming = row?.readyForLiveTiming;
  if (readyForLiveTiming === false) return false;
  return status === 'active' || status === 'registered' || status === 'confirmed' || status === 'paid';
}

function isCancelledOrInactiveStatus(value: unknown) {
  const status = norm(value).toLowerCase();
  if (!status) return false;
  return (
    status.includes('cancel')
    || status.includes('refund')
    || status.includes('void')
    || status.includes('inactive')
    || status.includes('rejected')
  );
}

function splitName(fullNameRaw: string | null) {
  const fullName = norm(fullNameRaw);
  if (!fullName) return { firstName: null as string | null, lastName: null as string | null, fullName: null as string | null };
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || null, lastName: null, fullName };
  return {
    firstName: parts.slice(0, -1).join(' ') || null,
    lastName: parts[parts.length - 1] || null,
    fullName,
  };
}

function registrationDisplayName(row: RegistrationRow) {
  const name = norm(row?.name || row?.fullName || row?.full_name || row?.buyerName);
  if (name) return name;
  const first = norm(row?.firstName || row?.first_name);
  const last = norm(row?.lastName || row?.last_name);
  return norm(`${first} ${last}`);
}

function providerDisplayName(row: ProviderRow) {
  const name = norm(row?.fullName || row?.full_name || row?.name);
  if (name) return name;
  const first = norm(row?.firstName || row?.first_name);
  const last = norm(row?.lastName || row?.last_name);
  return norm(`${first} ${last}`);
}

function scoreProviderMatch(reg: RegistrationRow, prov: ProviderRow) {
  const regBib = norm(reg?.bibNumber || reg?.bib);
  const regChip = norm(reg?.chipCode || reg?.chip || reg?.timingChipId);
  const regEmail = lower(reg?.email || reg?.buyerEmail);
  const regPhone = normPhone(reg?.mobile || reg?.phone);
  const regId = norm(reg?.id || reg?.bookingId || reg?.participantUuid || reg?.providerParticipantUuid);
  const regName = lower(registrationDisplayName(reg));
  const regDob = norm(reg?.dob || reg?.dateOfBirth);

  const provBib = norm(prov?.bib || prov?.bib_no || prov?.bibNumber);
  const provChip = norm(prov?.chip || prov?.chip_code || prov?.chipCode);
  const provEmail = lower(prov?.email);
  const provPhone = normPhone(prov?.phone || prov?.mobile);
  const provRegId = norm(prov?.participantUuid || prov?.participant_uuid || prov?.registrationId || prov?.providerUuid || prov?.id);
  const provName = lower(providerDisplayName(prov));
  const provDob = norm(prov?.dob || prov?.birthDate);

  if (regBib && provBib && regBib === provBib) return { score: 100, matchedBy: 'Bib' };
  if (regEmail && provEmail && regEmail === provEmail) return { score: 95, matchedBy: 'Email' };
  if (regId && provRegId && regId === provRegId) return { score: 90, matchedBy: 'Participant UUID' };
  if (regPhone && provPhone && regPhone === provPhone) return { score: 85, matchedBy: 'Phone' };
  if (regName && provName && regName === provName && regDob && provDob && regDob === provDob) return { score: 75, matchedBy: 'Full Name + DOB' };
  if (regName && provName && regName === provName) return { score: 60, matchedBy: 'Full Name' };
  if (regChip && provChip && regChip === provChip) return { score: 55, matchedBy: 'Chip' };
  return { score: 0, matchedBy: null as string | null };
}

function normalizeProviderRow(row: ProviderRow): ProviderRow {
  const providerUuid = norm(
    row?.providerUuid ||
    row?.providerParticipantUuid ||
    row?.participantUuid ||
    row?.participant_uuid ||
    row?.provider?.providerUuid ||
    row?.provider?.uuid ||
    row?.raw?.participant_uuid ||
    row?.raw?.participantUuid
  );
  const contestName = norm(row?.contestName || row?.contest_name || row?.category || row?.raw?.contest_name || row?.raw?.contestName || row?.raw?.category);
  const ageGroupName = norm(
    row?.ageGroupName ||
    row?.age_group_name ||
    row?.ageGroup ||
    row?.age_group ||
    row?.raw?.age_group_name ||
    row?.raw?.ageGroupName ||
    row?.raw?.age_group ||
    row?.raw?.ageGroup,
  );
  return {
    ...(row || {}),
    provider: norm(row?.provider || 'feibot') || 'feibot',
    providerUuid,
    providerParticipantUuid: providerUuid,
    participantUuid: norm(row?.participantUuid || row?.participant_uuid || row?.raw?.participant_uuid || row?.raw?.participantUuid || providerUuid),
    participant_uuid: norm(row?.participant_uuid || row?.participantUuid || row?.raw?.participant_uuid || row?.raw?.participantUuid || providerUuid),
    bib: norm(row?.bib || row?.bib_no || row?.bibNumber || row?.raw?.bib || row?.raw?.bib_number || row?.raw?.bibNumber),
    chip: norm(row?.chip || row?.chip_code || row?.chipCode || row?.raw?.chip || row?.raw?.chip_code || row?.raw?.chipCode),
    contestUuid: norm(row?.contestUuid || row?.contest_uuid || row?.raw?.contest_uuid || row?.raw?.contestUuid),
    contestName,
    contest_name: contestName,
    category: norm(row?.category || contestName),
    ageGroupUuid: norm(row?.ageGroupUuid || row?.age_group_uuid || row?.raw?.age_group_uuid || row?.raw?.ageGroupUuid),
    ageGroupName,
    age_group_name: ageGroupName,
    ageGroup: norm(row?.ageGroup || row?.age_group || ageGroupName),
    age_group: norm(row?.age_group || row?.ageGroup || ageGroupName),
    gender: norm(row?.gender || row?.raw?.gender),
    dob: norm(row?.dob || row?.birthDate || row?.dateOfBirth || row?.raw?.dob || row?.raw?.birthDate || row?.raw?.dateOfBirth),
    email: norm(row?.email || row?.raw?.email),
    phone: norm(row?.phone || row?.mobile || row?.raw?.phone || row?.raw?.mobile),
    mobile: norm(row?.mobile || row?.phone || row?.raw?.mobile || row?.raw?.phone),
    status: norm(row?.status || row?.registrationStatus || 'active') || 'active',
  };
}

function isLikelyProviderRow(row: any) {
  if (!row || typeof row !== 'object') return false;

  const providerUuid = norm(
    row?.providerUuid ||
    row?.providerParticipantUuid ||
    row?.participantUuid ||
    row?.participant_uuid ||
    row?.provider?.providerUuid ||
    row?.provider?.uuid ||
    row?.raw?.participant_uuid ||
    row?.raw?.participantUuid,
  );
  const contestUuid = norm(
    row?.contestUuid ||
    row?.contest_uuid ||
    row?.provider?.contestUuid ||
    row?.raw?.contest_uuid ||
    row?.raw?.contestUuid,
  );
  const chip = norm(row?.chip || row?.chipCode || row?.chip_code || row?.provider?.chip);
  const hasProviderBlock = Boolean(row?.provider && typeof row.provider === 'object');

  return Boolean(providerUuid || chip || (contestUuid && hasProviderBlock));
}

function providerRowQuality(row: ProviderRow) {
  let score = 0;
  if (norm(row?.participantUuid || row?.participant_uuid || row?.providerParticipantUuid)) score += 5;
  if (norm(row?.contestUuid || row?.contest_uuid)) score += 4;
  if (norm(row?.contestName || row?.contest_name || row?.category)) score += 3;
  if (norm(row?.ageGroup || row?.age_group || row?.ageGroupName || row?.age_group_name)) score += 2;
  if (norm(row?.chip || row?.chipCode || row?.chip_code)) score += 1;
  if (norm(row?.email)) score += 1;
  if (norm(row?.bib)) score += 1;
  return score;
}

function athleteRowQuality(row: any) {
  let score = 0;
  if (row?.provider?.mapped) score += 5;
  if (norm(row?.contestUuid || row?.contest_uuid || row?.provider?.contestUuid)) score += 4;
  if (norm(row?.contestName || row?.contest_name || row?.category || row?.provider?.contestName)) score += 3;
  if (norm(row?.ageGroup || row?.ageGroupName || row?.age_group_name)) score += 2;
  if (norm(row?.provider?.chip || row?.chip || row?.chipCode)) score += 1;
  if (norm(row?.provider?.providerUuid || row?.participantUuid || row?.participant_uuid)) score += 2;
  if (norm(row?.registration?.email || row?.email)) score += 1;
  return score;
}

function upsertBest(target: Record<string, any>, key: string, row: any) {
  const normalizedKey = norm(key);
  if (!normalizedKey) return;
  const existing = target[normalizedKey];
  if (!existing) {
    target[normalizedKey] = row;
    return;
  }
  const currentScore = athleteRowQuality(existing);
  const nextScore = athleteRowQuality(row);
  if (nextScore >= currentScore) {
    target[normalizedKey] = row;
  }
}

async function loadProviderRowsFromKv(eventId: string) {
  const [providerIndexLive, providerIndexEvent, providerPayloadEvent, providerPayloadLive, participantIndexLive] = await Promise.all([
    getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants:index`, 'api-live-athlete-search-rebuild'),
    getKV<Record<string, any>>(`event:${eventId}:providerParticipants:index`, 'api-live-athlete-search-rebuild'),
    getKV<Record<string, any>>(`event:${eventId}:providerParticipants`, 'api-live-athlete-search-rebuild'),
    getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-live-athlete-search-rebuild'),
    getKV<Record<string, any>>(`live:event:${eventId}:participant:index`, 'api-live-athlete-search-rebuild'),
  ]);

  const providerPayloadCandidates = [
    providerIndexLive,
    providerIndexEvent,
    providerPayloadEvent,
    providerPayloadLive,
  ].filter(Boolean);

  const legacyParticipantCandidates = [
    participantIndexLive,
  ].filter(Boolean);

  const rowsFromPayload = providerPayloadCandidates.flatMap((payload: any) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.participants)) return payload.participants;
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.data)) return payload.data;
    if (payload?.byProviderUuid && typeof payload.byProviderUuid === 'object') return Object.values(payload.byProviderUuid);
    if (payload?.byUuid && typeof payload.byUuid === 'object') return Object.values(payload.byUuid);
    return [];
  });

  const rowsFromLegacyParticipants = legacyParticipantCandidates.length === 0 ? [] : legacyParticipantCandidates.flatMap((payload: any) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.participants)) return payload.participants;
    if (Array.isArray(payload?.rows)) return payload.rows;
    if (Array.isArray(payload?.data)) return payload.data;
    if (payload?.byProviderUuid && typeof payload.byProviderUuid === 'object') return Object.values(payload.byProviderUuid);
    if (payload?.byUuid && typeof payload.byUuid === 'object') return Object.values(payload.byUuid);
    return [];
  });

  const [participantKeys, legacyTimingParticipantKeys] = await Promise.all([
    listKVByPrefix(`live:event:${eventId}:participant:`, 'api-live-athlete-search-rebuild'),
    listKVByPrefix(`live:event:${eventId}:timingParticipant:`, 'api-live-athlete-search-rebuild'),
  ]);

  const candidateKeys = [
    ...participantKeys.flat(),
    ...legacyTimingParticipantKeys.flat(),
  ].filter((key: string) => !key.endsWith(':participant:index') && !key.endsWith(':participant:mapping'));

  const rows: ProviderRow[] = [];
  const chunkSize = 25;
  for (let index = 0; index < candidateKeys.length; index += chunkSize) {
    const chunk = candidateKeys.slice(index, index + chunkSize);
    const values = await Promise.all(chunk.map((key) => getKV<Record<string, any>>(key, 'api-live-athlete-search-rebuild')));
    for (const row of values) {
      if (!row || typeof row !== 'object') continue;
      if (!isLikelyProviderRow(row)) continue;
      rows.push(normalizeProviderRow(row));
    }
  }

  const mergedRows = [...rowsFromPayload, ...rowsFromLegacyParticipants, ...rows]
    .filter((row) => isLikelyProviderRow(row))
    .map((row) => normalizeProviderRow(row));

  return uniqueByKey(mergedRows, (row: ProviderRow) => {
    const providerUuid = norm(row?.providerUuid || row?.participantUuid || row?.participant_uuid);
    if (providerUuid) return `provider:${providerUuid}`;
    const bib = norm(row?.bib);
    if (bib) return `bib:${bib}`;
    const email = lower(row?.email);
    if (email) return `email:${email}`;
    const chip = norm(row?.chip);
    if (chip) return `chip:${chip}`;
    return '';
  }).map((row: ProviderRow) => normalizeProviderRow(row));
}

async function loadTicketMappings(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:ticketMappings`, 'api-live-athlete-search-rebuild')) ||
    null
  );
}

async function loadParticipantIndex(eventId: string) {
  const primary =
    (await getKV<Record<string, any>>(`live:event:${eventId}:index`, 'api-live-athlete-search')) ||
    null;

  if (primary) return primary;

  const participantsPayload =
    (await getKV<Record<string, any>>(`live:event:${eventId}:participants`, 'api-live-athlete-search')) ||
    null;

  if (!participantsPayload) return null;

  const participants = Array.isArray(participantsPayload?.participants)
    ? participantsPayload.participants
    : Object.values((participantsPayload?.byUuid || participantsPayload?.byBib || {}) as Record<string, any>);

  if (!Array.isArray(participants) || participants.length === 0) return participantsPayload;

  const byBib: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byBookingId: Record<string, any> = {};
  const contestLookup: Record<string, { contestUuid: string | null; contestName: string | null; participantCount: number }> = {};

  for (const rawRow of participants) {
    const row = normalizeAthlete(rawRow);
    const bib = norm(row?.bib || row?.bibNumber);
    const uuid = norm(row?.providerParticipantUuid || row?.participantUuid || row?.participant_uuid || row?.provider?.providerUuid || row?.bergmanAthleteId || row?.athleteUid || row?.id);
    const chip = norm(row?.chip || row?.chipCode || row?.provider?.chip);
    const bookingId = norm(row?.bookingId || row?.registrationId || row?.participantId || row?.id);
    const contestUuid = norm(row?.contestUuid || row?.contest_uuid || row?.provider?.contestUuid) || null;
    const contestName = norm(row?.contestName || row?.contest_name || row?.category || row?.provider?.contestName) || null;

    if (bib) {
      byBib[bib] = row;
      const compactBib = bib.replace(/^0+/, '');
      if (compactBib) byBib[compactBib] = row;
    }
    if (uuid) byUuid[uuid] = row;
    if (chip) byChip[chip] = row;
    if (bookingId) byBookingId[bookingId] = row;

    if (contestUuid || contestName) {
      const key = String(contestUuid || contestName || '').toLowerCase();
      const entry = contestLookup[key] || { contestUuid, contestName, participantCount: 0 };
      entry.participantCount += 1;
      contestLookup[key] = entry;
    }
  }

  return {
    eventId,
    generatedAt: participantsPayload?.generatedAt || participantsPayload?.updatedAt || new Date().toISOString(),
    participants,
    participantCount: participants.length,
    count: participants.length,
    byBib,
    byUuid,
    byChip,
    byBookingId,
    contestLookup,
  };
}

function normalizeAthlete(row: any) {
  const fullName = String(
    row?.fullName
    || row?.name
    || [row?.firstName, row?.lastName].filter(Boolean).join(' ')
    || 'Unknown Athlete',
  ).trim() || 'Unknown Athlete';
  return {
    ...(row || {}),
    fullName,
    name: fullName,
    initials: String(row?.initials || fullName)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'AT',
    contestName: String(row?.contestName || row?.category || 'Unknown').trim() || 'Unknown',
    ageGroup: String(row?.ageGroup || row?.ageGroupName || row?.registration?.ageGroup || 'Unknown').trim() || 'Unknown',
  };
}

async function rebuildAthleteMasterIndex(eventId: string) {
  const db = getFirestoreInstance();
  const eventRef = db.collection('events').doc(eventId);
  const [registrationSnap, providerSnap, kvProviders, ticketMappings] = await Promise.all([
    eventRef.collection('participants').get(),
    eventRef.collection('providerParticipants').get(),
    loadProviderRowsFromKv(eventId),
    loadTicketMappings(eventId),
  ]);
  const allRegistrations: RegistrationRow[] = registrationSnap.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() || {}) } as RegistrationRow));
  const registrations = allRegistrations.filter((row) => isActiveRegistrationRow(row));
  const firestoreProviders: ProviderRow[] = providerSnap.docs.map((doc: any) => normalizeProviderRow({ id: doc.id, ...(doc.data() || {}) } as ProviderRow));
  const providers = [...firestoreProviders, ...kvProviders]
    .map((row) => normalizeProviderRow(row))
    .filter((row) => Boolean(row?.providerUuid || row?.participantUuid || row?.bib || row?.email));

  const dedupedProviders = new Map<string, ProviderRow>();
  for (const provider of providers) {
    const providerUuid = norm(provider?.providerUuid || provider?.participantUuid || provider?.participant_uuid);
    const key = providerUuid
      || `bib:${norm(provider?.bib)}`
      || `email:${lower(provider?.email)}`
      || `row:${dedupedProviders.size + 1}`;
    const existing = dedupedProviders.get(key) || null;
    if (!existing) {
      dedupedProviders.set(key, provider);
      continue;
    }
    const currentScore = providerRowQuality(existing);
    const nextScore = providerRowQuality(provider);
    if (nextScore >= currentScore) {
      dedupedProviders.set(key, provider);
    }
  }

  const providerRows = Array.from(dedupedProviders.values());

  console.log('[AthleteIndexRebuild] KV participant keys found:', kvProviders.length);
  console.log('[AthleteIndexRebuild] Firestore registrations:', allRegistrations.length);
  console.log('[AthleteIndexRebuild] Active registrations:', registrations.length);
  console.log('[AthleteIndexRebuild] Firestore provider participants:', firestoreProviders.length);
  console.log('[AthleteIndexRebuild] Provider pool size:', providerRows.length);

  const usedProviderIds = new Set<string>();
  const indexDocs: Array<{ id: string; value: Record<string, any> }> = [];
  const providerOnlyDocs: Array<{ id: string; value: Record<string, any> }> = [];

  const ticketToContest = ((ticketMappings?.ticketToContest || {}) as Record<string, string>);
  const ticketsById = ((ticketMappings?.ticketsById || {}) as Record<string, any>);

  const resolveAllowedContestUuids = (reg: RegistrationRow) => {
    const ticketId = norm(reg?.ticketId || reg?.ticketUuid || reg?.registration?.ticketId);
    const subCategoryId = norm(reg?.subCategoryId || reg?.selectedSubCategoryId || reg?.selectedSubCategory || reg?.registration?.subCategoryId);
    const categoryName = normalizeCategoryKey(reg?.raceCategory || reg?.ticketName || reg?.category || reg?.registration?.raceCategory);
    const allowed = new Set<string>();

    if (ticketId) {
      const keys = [
        subCategoryId ? `${ticketId}:${subCategoryId}` : '',
        ticketId,
        `${ticketId}:base`,
      ].filter(Boolean);

      for (const key of keys) {
        const contestUuid = norm(ticketToContest[key]);
        if (contestUuid) allowed.add(contestUuid);

        const detail = ticketsById[key];
        const detailContest = norm(detail?.contestUuid || detail?.providerContestUuid);
        if (detailContest) allowed.add(detailContest);
      }
    }

    if (categoryName) {
      for (const row of Object.values(ticketsById)) {
        const labels = [
          normalizeCategoryKey((row as any)?.displayName),
          normalizeCategoryKey((row as any)?.ticketName),
          normalizeCategoryKey((row as any)?.parentTicketName),
          normalizeCategoryKey((row as any)?.subCategoryName),
        ].filter(Boolean);
        if (!labels.some((label) => label === categoryName || label.includes(categoryName) || categoryName.includes(label))) continue;
        const contestUuid = norm((row as any)?.contestUuid || (row as any)?.providerContestUuid);
        if (contestUuid) allowed.add(contestUuid);
      }
    }

    return allowed;
  };

  for (const reg of registrations) {
    let bestProvider: ProviderRow | null = null;
    let bestScore = 0;
    let matchedBy: string | null = null;
    const allowedContestUuids = resolveAllowedContestUuids(reg);

    for (const prov of providerRows) {
      const providerIdentity = norm(prov?.providerUuid || prov?.participantUuid || prov?.participant_uuid || prov?.id);
      if (providerIdentity && usedProviderIds.has(providerIdentity)) continue;
      const providerContestUuid = norm(prov?.contestUuid || prov?.contest_uuid);
      if (allowedContestUuids.size > 0 && (!providerContestUuid || !allowedContestUuids.has(providerContestUuid))) continue;
      const match = scoreProviderMatch(reg, prov);
      const score = Number(match?.score || 0);
      if (score > bestScore) {
        bestScore = score;
        bestProvider = prov;
        matchedBy = match?.matchedBy || null;
      }
    }

    if (bestProvider && bestScore >= 60) {
      const providerIdentity = norm(bestProvider?.providerUuid || bestProvider?.participantUuid || bestProvider?.participant_uuid || bestProvider?.id);
      if (providerIdentity) usedProviderIds.add(providerIdentity);
    }

    const fullName = registrationDisplayName(reg);
    const split = splitName(fullName || providerDisplayName(bestProvider || {}) || null);
    const mapped = Boolean(bestProvider && bestScore >= 60);
    const providerAgeGroup = norm(bestProvider?.ageGroup || bestProvider?.age_group);
    const providerAgeGroupName = norm(bestProvider?.ageGroupName || bestProvider?.age_group_name || providerAgeGroup);

    indexDocs.push({
      id: norm(reg?.id || reg?.bookingId) || `reg-${indexDocs.length + 1}`,
      value: {
        bergmanAthleteId: norm(reg?.id || reg?.bookingId) || null,
        bib: norm(reg?.bibNumber || reg?.bib) || norm(bestProvider?.bib) || null,
        fullName: split.fullName,
        firstName: split.firstName,
        lastName: split.lastName,
        gender: norm(reg?.gender) || norm(bestProvider?.gender) || null,
        dob: norm(reg?.dob || reg?.dateOfBirth) || norm(bestProvider?.dob) || null,
        country: norm(reg?.country || reg?.countryCode || reg?.country_code || reg?.countryName || reg?.countryAtRace || reg?.nationality) || norm(bestProvider?.country || bestProvider?.countryCode || bestProvider?.country_code || bestProvider?.countryName || bestProvider?.countryAtRace || bestProvider?.nationality) || null,
        countryCode: norm(reg?.countryCode || reg?.country_code || reg?.country) || norm(bestProvider?.countryCode || bestProvider?.country_code || bestProvider?.country) || null,
        countryName: norm(reg?.countryName || reg?.countryAtRace || reg?.country) || norm(bestProvider?.countryName || bestProvider?.countryAtRace || bestProvider?.country) || null,
        nationality: norm(reg?.nationality) || norm(bestProvider?.nationality) || null,
        club: norm(reg?.clubName || reg?.club) || norm(bestProvider?.club) || null,
        category: norm(reg?.raceCategory || reg?.ticketName) || norm(bestProvider?.category || bestProvider?.contestName) || null,
        ageGroup: norm(reg?.ageGroup || reg?.selectedSubCategory || reg?.age_category || providerAgeGroupName) || null,
        ageGroupUuid: mapped ? norm(bestProvider?.ageGroupUuid || bestProvider?.age_group_uuid) || null : null,
        ageGroupName: mapped ? providerAgeGroupName || null : null,
        age_group_name: mapped ? providerAgeGroupName || null : null,
        contestUuid: mapped ? norm(bestProvider?.contestUuid) || null : null,
        contestName: mapped ? norm(bestProvider?.contestName || bestProvider?.category) || null : null,
        provider: {
          mapped,
          provider: mapped ? norm(bestProvider?.provider || 'feibot') : null,
          providerUuid: mapped ? norm(bestProvider?.providerUuid || bestProvider?.participantUuid || bestProvider?.id) : null,
          chip: mapped ? norm(bestProvider?.chip || bestProvider?.chipCode) : norm(reg?.chipCode || reg?.chip) || null,
          country: mapped ? norm(bestProvider?.country || bestProvider?.countryCode || bestProvider?.country_code || bestProvider?.countryName || bestProvider?.countryAtRace || bestProvider?.nationality) || null : null,
          countryCode: mapped ? norm(bestProvider?.countryCode || bestProvider?.country_code || bestProvider?.country) || null : null,
          countryName: mapped ? norm(bestProvider?.countryName || bestProvider?.countryAtRace || bestProvider?.country) || null : null,
          nationality: mapped ? norm(bestProvider?.nationality) || null : null,
          contestUuid: mapped ? norm(bestProvider?.contestUuid) || null : null,
          contestName: mapped ? norm(bestProvider?.contestName || bestProvider?.category) || null : null,
          mappingScore: bestScore || 0,
          matchedBy,
        },
        registration: {
          email: norm(reg?.email || reg?.buyerEmail) || null,
          phone: norm(reg?.mobile || reg?.phone) || null,
          country: norm(reg?.country || reg?.countryCode || reg?.country_code || reg?.countryName || reg?.countryAtRace || reg?.nationality) || null,
          countryCode: norm(reg?.countryCode || reg?.country_code || reg?.country) || null,
          countryName: norm(reg?.countryName || reg?.countryAtRace || reg?.country) || null,
          nationality: norm(reg?.nationality) || null,
          status: norm(reg?.ticketStatus || reg?.registrationStatus || reg?.status) || 'registered',
          selectedSubCategory: norm(reg?.selectedSubCategory) || null,
          ageGroup: norm(reg?.ageGroup || reg?.selectedSubCategory || reg?.age_category) || null,
          ticketId: norm(reg?.ticketId) || null,
        },
        mapping: {
          matched: mapped,
          matchedBy,
          score: bestScore || 0,
        },
        live: {
          status: 'registered',
          currentSplit: null,
          lastTimingPoint: null,
          elapsed: null,
          estimatedFinish: null,
          currentRank: null,
          categoryRank: null,
        },
        result: {
          finishTime: null,
          overallRank: null,
          categoryRank: null,
        },
        updatedAt: new Date().toISOString(),
        isActive: !isCancelledOrInactiveStatus(reg?.ticketStatus || reg?.status),
        readyForLiveTiming: mapped,
        publicEligible: Boolean(
          mapped
          && norm(bestProvider?.contestUuid)
          && isPublicEligibleRegistrationStatus(reg?.ticketStatus || reg?.status)
          && !isHiddenByRegistrationStatus(reg?.ticketStatus || reg?.status)
        ),
      },
    });
  }

  // provider-only athletes (not added to searchable/public index)
  for (const prov of providerRows) {
    const providerIdentity = norm(prov?.providerUuid || prov?.participantUuid || prov?.participant_uuid || prov?.id);
    if (providerIdentity && usedProviderIds.has(providerIdentity)) continue;
    const fullName = providerDisplayName(prov);
    const split = splitName(fullName || null);
    const providerUuid = norm(prov?.providerUuid || prov?.participantUuid || prov?.participant_uuid || prov?.id) || `provider-${indexDocs.length + 1}`;

    providerOnlyDocs.push({
      id: `provider:${providerUuid}`,
      value: {
        bergmanAthleteId: null,
        bib: norm(prov?.bib || prov?.bib_no || prov?.bibNumber) || null,
        fullName: split.fullName,
        firstName: split.firstName,
        lastName: split.lastName,
        gender: norm(prov?.gender) || null,
        dob: norm(prov?.dob) || null,
        country: norm(prov?.country || prov?.countryCode || prov?.country_code || prov?.countryName || prov?.countryAtRace || prov?.nationality) || null,
        countryCode: norm(prov?.countryCode || prov?.country_code || prov?.country) || null,
        countryName: norm(prov?.countryName || prov?.countryAtRace || prov?.country) || null,
        nationality: norm(prov?.nationality) || null,
        club: norm(prov?.club) || null,
        category: norm(prov?.category || prov?.contestName) || null,
        ageGroup: norm(prov?.ageGroup || prov?.age_group || prov?.ageGroupName || prov?.age_group_name) || null,
        ageGroupUuid: norm(prov?.ageGroupUuid || prov?.age_group_uuid) || null,
        ageGroupName: norm(prov?.ageGroupName || prov?.age_group_name || prov?.ageGroup || prov?.age_group) || null,
        age_group_name: norm(prov?.age_group_name || prov?.ageGroupName || prov?.ageGroup || prov?.age_group) || null,
        contestUuid: norm(prov?.contestUuid) || null,
        contestName: norm(prov?.contestName || prov?.category) || null,
        provider: {
          mapped: true,
          provider: norm(prov?.provider || 'feibot') || 'feibot',
          providerUuid,
          chip: norm(prov?.chip || prov?.chipCode) || null,
          country: norm(prov?.country || prov?.countryCode || prov?.country_code || prov?.countryName || prov?.countryAtRace || prov?.nationality) || null,
          countryCode: norm(prov?.countryCode || prov?.country_code || prov?.country) || null,
          countryName: norm(prov?.countryName || prov?.countryAtRace || prov?.country) || null,
          nationality: norm(prov?.nationality) || null,
          contestUuid: norm(prov?.contestUuid) || null,
          contestName: norm(prov?.contestName || prov?.category) || null,
          mappingScore: 0,
          matchedBy: 'Provider only',
        },
        registration: {
          email: norm(prov?.email) || null,
          phone: norm(prov?.phone || prov?.mobile) || null,
          country: norm(prov?.country || prov?.countryCode || prov?.country_code || prov?.countryName || prov?.countryAtRace || prov?.nationality) || null,
          countryCode: norm(prov?.countryCode || prov?.country_code || prov?.country) || null,
          countryName: norm(prov?.countryName || prov?.countryAtRace || prov?.country) || null,
          nationality: norm(prov?.nationality) || null,
          status: 'provider_only',
          selectedSubCategory: null,
          ageGroup: norm(prov?.ageGroup || prov?.age_group) || null,
          ticketId: null,
        },
        mapping: {
          matched: true,
          matchedBy: 'Provider only',
          score: 0,
        },
        live: {
          status: 'provider_only',
          currentSplit: null,
          lastTimingPoint: null,
          elapsed: null,
          estimatedFinish: null,
          currentRank: null,
          categoryRank: null,
        },
        result: {
          finishTime: null,
          overallRank: null,
          categoryRank: null,
        },
        updatedAt: new Date().toISOString(),
        isActive: !isCancelledOrInactiveStatus(prov?.status || prov?.registrationStatus),
        publicEligible: false,
        providerOnly: true,
      },
    });
  }

  const byUuid: Record<string, any> = {};
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byBookingId: Record<string, any> = {};

  for (const item of indexDocs) {
    const row = item.value;
    const uuid = norm(item.id || row?.provider?.providerUuid || row?.participantUuid || row?.participant_uuid);
    const bib = norm(row?.bib || row?.bibNumber);
    const chip = norm(row?.provider?.chip || row?.chip || row?.chipCode);
    const booking = norm(row?.bergmanAthleteId || row?.bookingId || row?.registrationId || item.id);

    if (uuid) upsertBest(byUuid, uuid, row);
    if (bib) {
      upsertBest(byBib, bib, row);
      const compactBib = bib.replace(/^0+/, '');
      if (compactBib) upsertBest(byBib, compactBib, row);
    }
    if (chip) upsertBest(byChip, chip, row);
    if (booking) upsertBest(byBookingId, booking, row);
  }

  const indexPayload = {
    eventId,
    participants: indexDocs.map((item) => item.value),
    participantCount: indexDocs.length,
    count: indexDocs.length,
    generatedAt: new Date().toISOString(),
    byUuid,
    byBib,
    byChip,
    byBookingId,
    contestLookup: (() => {
      const lookup: Record<string, { contestUuid: string | null; contestName: string | null; participantCount: number }> = {};
      for (const item of indexDocs) {
        const contestUuid = norm(item?.value?.contestUuid || item?.value?.provider?.contestUuid) || null;
        const contestName = norm(item?.value?.contestName || item?.value?.category || item?.value?.provider?.contestName) || null;
        const key = String(contestUuid || contestName || '').toLowerCase();
        if (!key) continue;
        const existing = lookup[key] || { contestUuid, contestName, participantCount: 0 };
        existing.participantCount += 1;
        lookup[key] = existing;
      }
      return lookup;
    })(),
  };

  const categoryContestMapping: Record<string, string> = {};
  for (const row of indexPayload.participants) {
    const category = normalizeCategoryKey(row?.category || row?.registration?.category || row?.ticketName);
    const contestUuid = norm(row?.provider?.contestUuid || row?.contestUuid);
    if (!category || !contestUuid) continue;
    categoryContestMapping[category] = contestUuid;
  }

  const duplicateStats = (rows: RegistrationRow[], selector: (row: RegistrationRow) => string) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = selector(row);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Array.from(counts.entries()).filter(([, count]) => count > 1).length;
  };

  const mergedAthletes = indexPayload.participants.filter((row: any) => Boolean(row?.provider?.mapped));
  const unmatchedAthletes = indexPayload.participants.filter((row: any) => !row?.provider?.mapped);
  const contestMismatch = indexPayload.participants.filter((row: any) => {
    const registrationCategory = normalizeCategoryKey(row?.category || row?.registration?.category || row?.ticketName);
    const mappedContest = norm(row?.provider?.contestUuid || row?.contestUuid);
    if (!registrationCategory || !mappedContest) return false;
    const expected = categoryContestMapping[registrationCategory];
    return Boolean(expected && expected !== mappedContest);
  }).length;

  const mappingDiagnostics = {
    mergedAthletes: mergedAthletes.length,
    providerOnlyAthletes: providerOnlyDocs.length,
    unmatchedBergmanAthletes: unmatchedAthletes.length,
    duplicateBib: duplicateStats(registrations, (row) => norm(row?.bibNumber || row?.bib)),
    duplicateEmail: duplicateStats(registrations, (row) => lower(row?.email || row?.buyerEmail)),
    duplicatePhone: duplicateStats(registrations, (row) => normPhone(row?.mobile || row?.phone)),
    contestMismatch,
  };

  console.log('[AthleteIndexRebuild] Participant Count:', indexPayload.participantCount);
  console.log('[AthleteIndexRebuild] Bib Count:', Object.keys(indexPayload.byBib || {}).length);
  console.log('[AthleteIndexRebuild] UUID Count:', Object.keys(indexPayload.byUuid || {}).length);
  console.log('[AthleteIndexRebuild] Booking Count:', Object.keys(indexPayload.byBookingId || {}).length);
  console.log('[AthleteIndexRebuild] Chip Count:', Object.keys(indexPayload.byChip || {}).length);
  console.log('[AthleteIndexRebuild] Merged Athletes:', mappingDiagnostics.mergedAthletes);
  console.log('[AthleteIndexRebuild] Provider-only Athletes:', mappingDiagnostics.providerOnlyAthletes);
  console.log('[AthleteIndexRebuild] Unmatched Bergman Athletes:', mappingDiagnostics.unmatchedBergmanAthletes);
  console.log('[AthleteIndexRebuild] Duplicate Bib:', mappingDiagnostics.duplicateBib);
  console.log('[AthleteIndexRebuild] Duplicate Email:', mappingDiagnostics.duplicateEmail);
  console.log('[AthleteIndexRebuild] Duplicate Phone:', mappingDiagnostics.duplicatePhone);
  console.log('[AthleteIndexRebuild] Contest Mismatch:', mappingDiagnostics.contestMismatch);

  // Purge the legacy Firestore athleteMasterIndex subcollection so the
  // participant document remains the only canonical Firestore source of truth.
  const legacyMasterIndexSnap = await eventRef.collection('athleteMasterIndex').get();
  for (let i = 0; i < legacyMasterIndexSnap.docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of legacyMasterIndexSnap.docs.slice(i, i + 400)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  await putKV(`live:event:${eventId}:participant:index`, indexPayload, 'api-live-athlete-search-rebuild');
  await putKV(`event:${eventId}:contest:mapping`, categoryContestMapping, 'api-live-athlete-search-rebuild');

  await eventRef.collection('provider').doc('metadata').set(
    {
      athleteMasterIndex: {
        count: indexDocs.length,
        rebuiltAt: new Date().toISOString(),
        providerPool: providerRows.length,
        registrations: registrations.length,
        totalRegistrations: allRegistrations.length,
        providerOnly: providerOnlyDocs.length,
        unmatched: mappingDiagnostics.unmatchedBergmanAthletes,
      },
      mappingDiagnostics,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    count: indexDocs.length,
    participantCount: indexPayload.participantCount,
    bibCount: Object.keys(indexPayload.byBib || {}).length,
    uuidCount: Object.keys(indexPayload.byUuid || {}).length,
    bookingCount: Object.keys(indexPayload.byBookingId || {}).length,
    chipCount: Object.keys(indexPayload.byChip || {}).length,
    providerPool: providerRows.length,
    kvParticipantRecords: kvProviders.length,
    mappingDiagnostics,
  };
}

function matchScoreForQuery(q: string, row: any, mode: 'bib' | 'name' | 'email') {
  const qLower = lower(q);

  const bib = lower(row?.bib);
  const fullName = lower(row?.fullName);
  const firstName = lower(row?.firstName);
  const lastName = lower(row?.lastName);

  if (mode === 'bib') {
    if (qLower && bib && bib === qLower) return 120;
    return 0;
  }

  if (mode === 'name') {
    if (qLower && fullName && fullName.includes(qLower)) return 100;
    if (qLower && firstName && firstName.includes(qLower)) return 90;
    if (qLower && lastName && lastName.includes(qLower)) return 90;
    return 0;
  }

  if (mode === 'email') {
    const email = lower(row?.registration?.email || row?.email);
    if (qLower && email && email.includes(qLower)) return 100;
    return 0;
  }

  return 0;
}

async function rebuildAthleteMasterIndexFromLive(eventId: string) {
  const [liveIndex, participantKeys, bookingKeys] = await Promise.all([
    getKV<Record<string, any>>(`live:event:${eventId}:participant:index`, 'api-live-athlete-search-rebuild-live'),
    listKVByPrefix(`live:event:${eventId}:participant:`, 'api-live-athlete-search-rebuild-live'),
    listKVByPrefix(`live:event:${eventId}:timingParticipant:`, 'api-live-athlete-search-rebuild-live'),
  ]);

  const existingParticipants = Array.isArray(liveIndex?.participants) ? liveIndex.participants : [];
  let rows = existingParticipants;

  if (rows.length === 0 && liveIndex && typeof liveIndex === 'object') {
    const byBibRows = Object.values((liveIndex as any)?.byBib || {}) as Record<string, any>[];
    const byUuidRows = Object.values((liveIndex as any)?.byUuid || {}) as Record<string, any>[];
    const byBookingRows = Object.values((liveIndex as any)?.byBookingId || {}) as Record<string, any>[];
    const deduped = new Map<string, Record<string, any>>();
    for (const row of [...byBibRows, ...byUuidRows, ...byBookingRows]) {
      if (!row || typeof row !== 'object') continue;
      const dedupeKey = norm((row as any)?.bookingId || (row as any)?.id || (row as any)?.participantId || (row as any)?.registrationId || (row as any)?.participantUuid || (row as any)?.participant_uuid || (row as any)?.providerUuid || (row as any)?.bib || '');
      if (!dedupeKey) continue;
      if (!deduped.has(dedupeKey)) deduped.set(dedupeKey, row as Record<string, any>);
    }
    rows = Array.from(deduped.values());
  }

  if (rows.length === 0) {
    const keys = [...participantKeys.flat(), ...bookingKeys.flat()].filter((key) => key.includes(':participant:') || key.includes(':timingParticipant:'));
    const values: Array<Record<string, any>> = [];
    const chunkSize = 50;
    for (let index = 0; index < keys.length; index += chunkSize) {
      const chunk = keys.slice(index, index + chunkSize);
      const chunkValues = await Promise.all(
        chunk.map(async (key) => {
          try {
            const value = await getKV<Record<string, any>>(key, 'api-live-athlete-search-rebuild-live');
            return value && typeof value === 'object' ? value : null;
          } catch (error) {
            console.warn('[AthleteSearch] Skipping unreadable timingParticipant record', {
              eventId,
              key,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        }),
      );
      values.push(...(chunkValues.filter((row): row is Record<string, any> => Boolean(row))));
    }
    rows = values;
  }

  const byBib: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byBookingId: Record<string, any> = {};
  const byProviderUuid: Record<string, any> = {};
  const byAthleteUid: Record<string, any> = {};
  const byEmail: Record<string, any> = {};
  const contestLookup: Record<string, { contestUuid: string | null; contestName: string | null; participantCount: number }> = {};
  let skippedRows = 0;

  for (const source of rows) {
    try {
      if (!source || typeof source !== 'object') {
        skippedRows += 1;
        continue;
      }
      const row = normalizeAthlete(source);
      const bib = norm(row?.bib || row?.bibNumber);
      const uuid = norm(row?.participantUuid || row?.participant_uuid || row?.provider?.providerUuid || row?.providerUuid || row?.id);
      const providerUuid = norm(row?.provider?.providerUuid || row?.providerUuid || row?.participantUuid || row?.participant_uuid);
      const athleteUid = norm(row?.athleteUid || row?.bergmanAthleteId || row?.userId);
      const chip = norm(row?.chip || row?.chipCode || row?.provider?.chip);
      const email = lower(row?.registration?.email || row?.email);
      const bookingId = norm(row?.bookingId || row?.registrationId || row?.bergmanAthleteId || row?.id);
      const contestUuid = norm(row?.contestUuid || row?.provider?.contestUuid) || null;
      const contestName = norm(row?.contestName || row?.provider?.contestName || row?.category) || null;

      if (bib) {
        byBib[bib] = row;
        const compactBib = bib.replace(/^0+/, '');
        if (compactBib) byBib[compactBib] = row;
      }
      if (uuid) byUuid[uuid] = row;
      if (providerUuid) byProviderUuid[providerUuid] = row;
      if (athleteUid) byAthleteUid[athleteUid] = row;
      if (chip) byChip[chip] = row;
      if (email) byEmail[email] = row;
      if (bookingId) byBookingId[bookingId] = row;

      const contestKey = String(contestUuid || contestName || '').toLowerCase();
      if (contestKey) {
        const entry = contestLookup[contestKey] || { contestUuid, contestName, participantCount: 0 };
        entry.participantCount += 1;
        contestLookup[contestKey] = entry;
      }
    } catch (error) {
      skippedRows += 1;
      console.warn('[AthleteSearch] Skipping malformed participant row during rebuild', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const payload = {
    eventId,
    generatedAt: new Date().toISOString(),
    participants: rows,
    participantCount: rows.length,
    count: rows.length,
    byBib,
    byUuid,
    byChip,
    byBookingId,
    byProviderUuid,
    byAthleteUid,
    byEmail,
    contestLookup,
  };

  await putKV(`live:event:${eventId}:participant:index`, payload, 'api-live-athlete-search-rebuild-live');
  await putKV(`live:event:${eventId}:participant:bib`, Object.fromEntries(Object.entries(byBib).map(([key, value]) => [key, norm((value as any)?.bookingId || (value as any)?.id) || null])), 'api-live-athlete-search-rebuild-live');
  await putKV(`live:event:${eventId}:participant:providerUuid`, Object.fromEntries(Object.entries(byProviderUuid).map(([key, value]) => [key, norm((value as any)?.bookingId || (value as any)?.id) || null])), 'api-live-athlete-search-rebuild-live');
  await putKV(`live:event:${eventId}:participant:uuid`, Object.fromEntries(Object.entries(byUuid).map(([key, value]) => [key, norm((value as any)?.bookingId || (value as any)?.id) || null])), 'api-live-athlete-search-rebuild-live');
  await putKV(`live:event:${eventId}:participant:athleteUid`, Object.fromEntries(Object.entries(byAthleteUid).map(([key, value]) => [key, norm((value as any)?.bookingId || (value as any)?.id) || null])), 'api-live-athlete-search-rebuild-live');
  await putKV(`live:event:${eventId}:participant:email`, Object.fromEntries(Object.entries(byEmail).map(([key, value]) => [key, norm((value as any)?.bookingId || (value as any)?.id) || null])), 'api-live-athlete-search-rebuild-live');
  await putKV(`live:event:${eventId}:participant:chip`, Object.fromEntries(Object.entries(byChip).map(([key, value]) => [key, norm((value as any)?.bookingId || (value as any)?.id) || null])), 'api-live-athlete-search-rebuild-live');

  searchIndexCache.set(eventId, { loadedAt: nowMs(), index: payload, sourceKey: `live:event:${eventId}:participant:index` });

  return {
    participantCount: rows.length,
    bibCount: Object.keys(byBib).length,
    uuidCount: Object.keys(byUuid).length,
    bookingCount: Object.keys(byBookingId).length,
    chipCount: Object.keys(byChip).length,
    skippedRows,
  };
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = norm(params.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const q = norm(req.nextUrl.searchParams.get('q'));
    if (!q) {
      return NextResponse.json({ success: false, message: 'q is required' }, { status: 400 });
    }
    const modeRaw = lower(req.nextUrl.searchParams.get('mode'));
    const mode: 'bib' | 'name' | 'email' = modeRaw === 'name' ? 'name' : modeRaw === 'email' ? 'email' : 'bib';
    const kvOnly = req.nextUrl.searchParams.get('kvOnly') === '1' || req.nextUrl.searchParams.get('kvOnly') === 'true';
    const access = await resolveLiveTrackingAccess(req);

    const timings: Array<{ step: string; ms: number }> = [];
    const searchStart = nowMs();
    console.log('[AthleteSearch] Search Started', { eventId, q, mode });
    if (kvOnly) {
      console.log('[AthleteSearch] KV-only mode enabled', { eventId, q, mode });
    }

    const loadStart = nowMs();
    const participantIndex = await loadSearchIndex(eventId);
    timings.push({ step: 'KV Loaded', ms: nowMs() - loadStart });

    const lookupStart = nowMs();
    const rawMatch = lookupAthlete(participantIndex, q, mode);
    const match = rawMatch ? normalizeAthlete(rawMatch) : null;
    timings.push({ step: 'Lookup Complete', ms: nowMs() - lookupStart });

    if (!match) {
      const lastAttempt = rebuildAttemptCache.get(eventId) || 0;
      if (nowMs() - lastAttempt > REBUILD_RETRY_MS) {
        rebuildAttemptCache.set(eventId, nowMs());
        const rebuildStart = nowMs();
        try {
          const rebuilt = await rebuildAthleteMasterIndexFromLive(eventId);
          const rebuiltIndex = await getKV<Record<string, any>>(`live:event:${eventId}:participant:index`, 'api-live-athlete-search');
          if (rebuiltIndex && typeof rebuiltIndex === 'object') {
            searchIndexCache.set(eventId, { loadedAt: nowMs(), index: rebuiltIndex, sourceKey: `live:event:${eventId}:participant:index` });
          }
          timings.push({ step: 'Index Rebuilt', ms: nowMs() - rebuildStart });
          console.log('[AthleteSearch] Rebuilt index on empty lookup', { eventId, rebuilt });
        } catch (rebuildError: any) {
          timings.push({ step: 'Index Rebuild Failed', ms: nowMs() - rebuildStart });
          console.warn('[AthleteSearch] Rebuild failed', { eventId, error: rebuildError?.message || 'unknown' });
        }
      }
    }

    const reloadedIndex = searchIndexCache.get(eventId)?.index || participantIndex;
    const secondRawMatch = match ? rawMatch : lookupAthlete(reloadedIndex, q, mode);
    const secondMatch = secondRawMatch ? normalizeAthlete(secondRawMatch) : null;

    const ageGroupLoadStart = nowMs();
    const ageGroupIndex = secondMatch ? await loadAgeGroupIndex(eventId) : null;
    timings.push({ step: 'Age Group Loaded', ms: nowMs() - ageGroupLoadStart });

    const resolvedMatch = secondMatch
      ? await (async () => {
        const bookingId = String((secondMatch as any)?.bookingId || (secondMatch as any)?.id || '').trim();
        const bib = String((secondMatch as any)?.bib || '').trim();
        const athleteUid = String((secondMatch as any)?.athleteUid || (secondMatch as any)?.bergmanAthleteId || (secondMatch as any)?.userId || '').trim();
        const providerParticipantUuid = String((secondMatch as any)?.providerUuid || (secondMatch as any)?.provider?.providerUuid || (secondMatch as any)?.participantUuid || (secondMatch as any)?.participant_uuid || '').trim();
        const email = String((secondMatch as any)?.registration?.email || (secondMatch as any)?.email || '').trim();
        const resolved = await loadParticipantPublicView(eventId, { bookingId, bib, athleteUid, providerParticipantUuid, email });
        return resolved?.merged ? { ...resolved.merged, participantLive: resolved.participantLive || null } : secondMatch;
      })()
      : null;

    const matches = resolvedMatch ? [resolvedMatch] : [];

    const byBib = getDirectLookupMap(reloadedIndex, 'byBib') || {};
    const byUuid = getDirectLookupMap(reloadedIndex, 'byUuid') || {};
    const byChip = getDirectLookupMap(reloadedIndex, 'byChip') || {};
    const byBookingId = getDirectLookupMap(reloadedIndex, 'byBookingId') || {};

    const hasLiveSource = Boolean(reloadedIndex && (Array.isArray((reloadedIndex as any)?.participants) || Object.keys(byBib).length > 0));
    console.log('[AthleteSearch] KV source', hasLiveSource ? 'loaded' : 'missing');
    console.log('[AthleteSearch] Index sizes', {
      participants: Array.isArray((reloadedIndex as any)?.participants) ? (reloadedIndex as any).participants.length : 0,
      byBib: Object.keys(byBib).length,
      byUuid: Object.keys(byUuid).length,
      byChip: Object.keys(byChip).length,
      byBookingId: Object.keys(byBookingId).length,
    });
    console.log('[AthleteSearch] Direct bib lookup', byBib?.[q] || byBib?.[q.replace(/^0+/, '')] || null);

    const visibleMatches = matches
      .map((row: any) => {
        const ageGroupName = resolveAgeGroupName(row, ageGroupIndex);
        const privacy = getParticipantLiveTrackingPrivacy(row);
        const outputRow = {
          ...row,
          resolvedBookingId: norm(row?.bookingId || row?.id || row?.registrationId || row?.bergmanAthleteId) || null,
          providerUuid: norm(row?.provider?.providerUuid || row?.providerUuid || row?.participantUuid || row?.participant_uuid) || null,
          athleteUid: norm(row?.athleteUid || row?.bergmanAthleteId || row?.userId || row?.participantUuid || row?.participant_uuid) || null,
          country: norm(row?.country || row?.countryCode || row?.country_code || row?.countryName || row?.countryAtRace || row?.nationality || row?.registration?.country || row?.registration?.countryCode || row?.registration?.countryName || row?.registration?.countryAtRace || row?.registration?.nationality || row?.provider?.country || row?.provider?.countryCode || row?.provider?.countryName || row?.provider?.countryAtRace || row?.provider?.nationality) || null,
          countryCode: norm(row?.countryCode || row?.country_code || row?.country || row?.registration?.countryCode || row?.provider?.countryCode) || null,
          countryName: norm(row?.countryName || row?.countryAtRace || row?.country || row?.registration?.countryName || row?.registration?.countryAtRace || row?.provider?.countryName || row?.provider?.countryAtRace) || null,
          nationality: norm(row?.nationality || row?.registration?.nationality || row?.provider?.nationality) || null,
          contestUuid: norm(row?.contestUuid || row?.provider?.contestUuid || row?.contest_uuid) || null,
          contestName: norm(row?.contestName || row?.provider?.contestName || row?.contest_name || row?.category) || null,
          bib: norm(row?.bib || row?.bibNumber) || null,
          ageGroupName: ageGroupName || row?.ageGroupName || row?.ageGroup || 'Unknown',
          ageGroup: ageGroupName || row?.ageGroupName || row?.ageGroup || 'Unknown',
        };
        if (privacy === 'PRIVATE' && !canAccessPrivateLiveTracking(outputRow, access)) return null;
        if (privacy === 'ANONYMOUS' && access.isPublic) return maskAnonymousAthlete(outputRow);
        return outputRow;
      })
      .filter(Boolean);

    timings.push({ step: 'Response Built', ms: nowMs() - loadStart - timings.reduce((sum, item) => sum + item.ms, 0) });
    const totalDuration = nowMs() - searchStart;
    timings.push({ step: 'Total Duration', ms: totalDuration });
    const slowest = timings.reduce((prev, curr) => (curr.ms > prev.ms ? curr : prev), timings[0] || { step: '—', ms: 0 });
    console.log('[AthleteSearch] Stage timings', timings);
    console.log('[AthleteSearch] Total Duration', totalDuration);
    if (totalDuration > 200) {
      console.warn('[AthleteSearch] Slow lookup', { totalDuration, slowestStage: slowest });
    }

    if (visibleMatches.length > 0) {
      const row = visibleMatches[0] as any;
      console.log('[AthleteSearch] Match', {
        bib: row?.bib || null,
        athleteUid: row?.athleteUid || row?.participantUuid || null,
        bookingId: row?.bookingId || row?.id || null,
        contestUuid: row?.contestUuid || row?.provider?.contestUuid || null,
        contestName: row?.contestName || row?.provider?.contestName || row?.category || null,
        ageGroupUuid: row?.ageGroupUuid || row?.provider?.ageGroupUuid || null,
      });
    }

    console.log('[AthleteSearch] Response Built', {
      resultCount: visibleMatches.length,
      sourceKey: searchIndexCache.get(eventId)?.sourceKey || null,
    });

    return NextResponse.json({
      success: true,
      eventId,
      q,
      mode,
      totalIndex: Array.isArray((reloadedIndex as any)?.participants) ? (reloadedIndex as any).participants.length : Object.keys(byBib).length,
      matches: visibleMatches,
      diagnostics: {
        searchMode: kvOnly ? 'kv-only' : 'default-kv',
        timings,
        totalDurationMs: totalDuration,
        sourceKey: searchIndexCache.get(eventId)?.sourceKey || null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to search Athlete Master Index',
      },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = norm(params.eventId);
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const rebuilt = await rebuildAthleteMasterIndexFromLive(eventId);
    return NextResponse.json({
      success: true,
      eventId,
      rebuilt,
      message: 'Athlete Master Index rebuilt.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to rebuild Athlete Master Index',
      },
      { status: 500 },
    );
  }
}
