/*
import { NextRequest, NextResponse } from 'next/server';
import { getStorageInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import * as zlib from 'zlib';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

function normalizeString(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function splitName(fullNameRaw: string | null) {
  const fullName = String(fullNameRaw || '').trim();
  if (!fullName) return { firstName: null as string | null, lastName: null as string | null, fullName: null as string | null };
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || null, lastName: null, fullName };
  return {
    firstName: parts.slice(0, -1).join(' ') || null,
    lastName: parts[parts.length - 1] || null,
    fullName,
  };
}

function detectParticipantArray(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];

  const candidates = ['participants', 'rows', 'items', 'result', 'list', 'data'];
  for (const key of candidates) {
    const value = (input as any)[key];
    if (Array.isArray(value)) return value;
  }

  for (const value of Object.values(input)) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = detectParticipantArray(value);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function safeObjectName(input: string) {
  return String(input || 'payload')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 100) || 'payload';
}

async function storeRawPayloadInStorage(eventId: string, importTimeIso: string, provider: string, payloadJson: string) {
  const bucket = getStorageInstance().bucket();
  const objectPath = `live/provider-participants/${eventId}/${provider}/${importTimeIso.replace(/[:.]/g, '-')}-${safeObjectName('raw')}.json.gz`;
  const compressed = zlib.gzipSync(Buffer.from(payloadJson, 'utf8'));
  await bucket.file(objectPath).save(compressed, {
    resumable: false,
    metadata: {
      contentType: 'application/gzip',
      cacheControl: 'private, max-age=3600',
    },
  });
  return {
    storagePath: objectPath,
    storageCompressed: true,
    storageSize: compressed.length,
  };
}

async function writeParticipantsKv(eventId: string, payload: any) {
  await putKV(`event:${eventId}:providerParticipants`, payload, 'api-provider-participants');
  await putKV(`live:event:${eventId}:providerParticipants`, payload, 'api-provider-participants');
}

function normalizePhone(value: unknown) {
  return String(value ?? '').replace(/\D+/g, '').trim();
}

function getParticipantContact(row: any) {
  const email = normalizeString(row?.email || row?.buyerEmail || row?.registration?.email);
  const mobile = normalizeString(row?.mobile || row?.phone || row?.registration?.mobile || row?.registration?.phone);
  return {
    email: email ? String(email).toLowerCase() : null,
    mobile: mobile ? normalizePhone(mobile) : null,
  };
}

function getProviderContestFields(row: any) {
  const contestUuid = normalizeString(row?.contest_uuid || row?.contestUuid || row?.contest?.uuid || row?.contest?.UUID);
  const contestName = normalizeString(row?.contest_name || row?.contestName || row?.contest?.name || row?.contest?.Name || row?.category);
  const participantUuid = normalizeString(row?.participant_uuid || row?.participantUuid || row?.uuid || row?.id);
  const chip = normalizeString(row?.chip || row?.chip_code || row?.chipCode || row?.chip_id || row?.chipId);
  const bib = normalizeString(row?.bib || row?.bib_no || row?.bibNumber || row?.number || row?.no);
  return { contestUuid, contestName, participantUuid, chip, bib };
}

function getInitials(name: unknown) {
  const text = String(name ?? '').trim();
  if (!text) return 'AT';
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'AT';
}

type TicketMappingsKv = {
  ticketToContest?: Record<string, string>;
  ticketsById?: Record<string, any>;
  mapped?: number;
  missing?: number;
  coverage?: number;
};

async function loadTicketMappingsKv(eventId: string): Promise<TicketMappingsKv | null> {
  return (
    (await getKV<TicketMappingsKv>(`event:${eventId}:ticketMappings`, 'api-provider-participants')) ||
    (await getKV<TicketMappingsKv>(`live:event:${eventId}:ticketMappings`, 'api-provider-participants')) ||
    null
  );
}

function resolveContestFromTicket(ticketMappings: TicketMappingsKv | null, ticketId: string | null, subCategoryId: string | null) {
  if (!ticketMappings || !ticketId) return null;
  const normalizedSubCategoryId = String(subCategoryId || '').trim();
  const compositeKey = normalizedSubCategoryId ? `${ticketId}:${normalizedSubCategoryId}` : null;
  const fallbackBaseKey = `${ticketId}:base`;
  const contestUuid = normalizedSubCategoryId
    ? ((compositeKey ? ticketMappings.ticketToContest?.[compositeKey] : null) || ticketMappings.ticketToContest?.[ticketId] || null)
    : ticketMappings.ticketToContest?.[fallbackBaseKey] || ticketMappings.ticketToContest?.[ticketId] || null;
  if (!contestUuid) return null;
  const detail =
    normalizedSubCategoryId
      ? ((compositeKey ? (ticketMappings.ticketsById || {})[compositeKey] : null) || (ticketMappings.ticketsById || {})[ticketId] || null)
      : ((ticketMappings.ticketsById || {})[fallbackBaseKey] || (ticketMappings.ticketsById || {})[ticketId] || null);
  return {
    contestUuid,
    contestName: normalizeString(detail?.contestName),
    providerContestUuid: normalizeString(detail?.providerContestUuid || contestUuid),
    providerContestName: normalizeString(detail?.providerContestName || detail?.contestName),
  };
}

async function writeParticipantsIndexKv(eventId: string, participants: any[]) {
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byEmail: Record<string, any> = {};
  const byMobile: Record<string, any> = {};

  for (const participant of participants) {
    const bib = normalizeString(participant?.bib || participant?.providerBib || participant?.liveTracking?.bib);
    const chip = normalizeString(participant?.chip || participant?.providerChip || participant?.liveTracking?.chip);
    const uuid = normalizeString(participant?.participantUuid || participant?.providerUuid || participant?.id);
    const email = normalizeString(participant?.email);
    const mobile = normalizeString(participant?.mobile || participant?.phone);

    if (uuid) byUuid[uuid] = participant;
    if (bib) byBib[bib] = participant;
    if (chip) byChip[chip] = participant;
    if (email) byEmail[email.toLowerCase()] = participant;
    if (mobile) byMobile[normalizePhone(mobile)] = participant;
  }

  const payload = {
    byBib,
    byChip,
    byUuid,
    byEmail,
    byMobile,
    count: participants.length,
    generatedAt: new Date().toISOString(),
  };

  await putKV(`live:event:${eventId}:participants`, payload, 'api-provider-participants');
  return payload;
}

function normalizeProviderParticipant(provider: string, eventId: string, row: any, index: number) {
  const providerUuid =
    normalizeString(row?.providerUuid) ||
    normalizeString(row?.uuid) ||
    normalizeString(row?.participant_uuid) ||
    normalizeString(row?.participantUuid) ||
    normalizeString(row?.id) ||
    `${provider}:${eventId}:${index + 1}`;

  const bib =
    normalizeString(row?.bib) ||
    normalizeString(row?.bib_no) ||
    normalizeString(row?.bibNumber) ||
    normalizeString(row?.number) ||
    normalizeString(row?.no);

  const chip =
    normalizeString(row?.chip) ||
    normalizeString(row?.chip_code) ||
    normalizeString(row?.chipCode) ||
    normalizeString(row?.chip_id) ||
    normalizeString(row?.chipId);

  const fullNameCandidate =
    normalizeString(row?.fullName) ||
    normalizeString(row?.full_name) ||
    normalizeString(row?.name) ||
    [normalizeString(row?.firstName || row?.first_name), normalizeString(row?.lastName || row?.last_name)].filter(Boolean).join(' ').trim() || null;

  const split = splitName(fullNameCandidate);
  const participantUuid = normalizeString(row?.participant_uuid || row?.participantUuid || row?.uuid || row?.id) || providerUuid;
  const ticketId = normalizeString(row?.ticketId || row?.registrationTicketId || row?.ticket?.id || row?.ticket_uuid || row?.ticketUuid) || null;
  const ticketName = normalizeString(row?.ticketName || row?.registrationTicketName || row?.ticket?.ticketName || row?.ticket?.name) || null;
  const subCategoryId = normalizeString(row?.subCategoryId || row?.registrationSubCategoryId || row?.sub_category_id || row?.selectedSubCategoryId || row?.subCategory?.id) || null;
  const subCategoryName = normalizeString(row?.selectedSubCategory || row?.subCategoryName || row?.sub_category_name || row?.subCategory?.name) || null;
  const contestUuid = normalizeString(row?.contest_uuid || row?.contestUuid || row?.contest?.uuid || row?.contest?.UUID) || null;
  const contestName = normalizeString(row?.contest_name || row?.contestName || row?.contest?.name || row?.contest?.Name || row?.category) || null;
  const ageGroupUuid = normalizeString(row?.age_group_uuid || row?.ageGroupUuid || row?.ageGroup?.uuid || row?.ageGroup?.UUID) || null;
  const ageGroupName = normalizeString(row?.age_group_name || row?.ageGroupName || row?.ageGroup?.name || row?.ageGroup?.Name || row?.age_group || row?.ageGroup) || null;

  return {
    provider,
    eventId,
    providerUuid,
    participantUuid,
    participant_uuid: participantUuid,
    bib,
    chip,
    firstName: split.firstName,
    lastName: split.lastName,
    fullName: split.fullName,
    gender: normalizeString(row?.gender || row?.sex),
    dob: normalizeString(row?.dob || row?.birthDate || row?.birthday),
    email: normalizeString(row?.email),
    phone: normalizeString(row?.phone || row?.mobile),
    mobile: normalizeString(row?.mobile || row?.phone),
    nationality: normalizeString(row?.nationality || row?.nation || row?.country),
    team: normalizeString(row?.team || row?.teamName),
    club: normalizeString(row?.club || row?.clubName),
    ticketId,
    ticketName,
    subCategoryId,
    subCategoryName,
    contestUuid,
    contest_uuid: contestUuid,
    providerContestUuid: contestUuid,
    contestName,
    contest_name: contestName,
    providerContestName: contestName,
    ageGroupUuid,
    age_group_uuid: ageGroupUuid,
    ageGroupName,
    age_group_name: ageGroupName,
    category: normalizeString(row?.category || ageGroupName || row?.ageGroup || row?.age_group),
    providerBib: bib,
    providerChip: chip,
    relay: row?.relay ?? row?.isRelay ?? null,
    wave: normalizeString(row?.wave || row?.waveName),
    registrationStatus: normalizeString(row?.registrationStatus || row?.ticketStatus || row?.status),
    providerStatus: normalizeString(row?.providerStatus || row?.status),
    liveTracking: {
      provider,
      participantUuid,
      contestUuid,
      contestName,
      bib,
      chip,
    },
    raw: row || {},
    importedAt: new Date().toISOString(),
  };
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const ticketMappings = await loadTicketMappingsKv(eventId);
    const missingTicketIds = Object.values(ticketMappings?.ticketsById || {})
      .filter((row: any) => row?.ignored !== true && !row?.contestUuid)
      .map((row: any) => String(row?.ticketId || '').trim())
      .filter(Boolean);

    const actionableMissing = Number(ticketMappings?.missing ?? missingTicketIds.length ?? 0);
    const mappingComplete = !!ticketMappings && actionableMissing === 0 && missingTicketIds.length === 0;
    if (!mappingComplete) {
      return NextResponse.json(
        {
          success: false,
          message: 'Complete Contest Mapping first before importing participants.',
          code: 'CONTEST_MAPPING_REQUIRED',
          missingTicketIds,
          totalTickets: Number(ticketMappings?.mapped || 0) + Number(ticketMappings?.missing || 0),
        },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const provider = String(body?.provider || 'feibot').trim().toLowerCase() || 'feibot';
    const resetExisting = body?.resetExisting === true || body?.clearExisting === true;
    const rawResponse = body?.rawResponse ?? body?.raw ?? null;
    const participantRowsInput = Array.isArray(body?.participantRows) ? body.participantRows : null;
    const participantRows = participantRowsInput || detectParticipantArray(rawResponse);

    const importTimeIso = new Date().toISOString();
    const rawPayload = rawResponse ?? participantRows ?? {};
    const rawPayloadJson = JSON.stringify(rawPayload);
    const responseSize = Buffer.byteLength(rawPayloadJson, 'utf8');
    const importedCount = participantRows.length;
    const durationMs = Number(body?.metadata?.durationMs || 0) || null;
    const source = String(body?.metadata?.source || 'cloud_api').trim() || 'cloud_api';
    const shouldOffloadPayload = responseSize > 800_000;
    const payloadStorage = shouldOffloadPayload
      ? await storeRawPayloadInStorage(eventId, importTimeIso, provider, rawPayloadJson).catch((error) => {
          console.warn('Failed to store provider participants payload in storage', error instanceof Error ? error.message : error);
          return null;
        })
      : null;

    const normalizedParticipants = participantRows
      .map((row: any, index: number) => normalizeProviderParticipant(provider, eventId, row, index))
      .map((participant: any) => {
        const mappedContest = resolveContestFromTicket(ticketMappings, participant.ticketId, participant.subCategoryId);
        const contestUuid = participant.contestUuid || mappedContest?.contestUuid || null;
        const contestName = participant.contestName || mappedContest?.contestName || null;
        const providerContestUuid = participant.providerContestUuid || mappedContest?.providerContestUuid || contestUuid || null;
        const providerContestName = participant.providerContestName || mappedContest?.providerContestName || contestName || null;

        return {
          ...participant,
          contestUuid,
          contest_uuid: contestUuid,
          contestName,
          contest_name: contestName,
          providerContestUuid,
          providerContestName,
          liveTracking: {
            ...(participant.liveTracking || {}),
            contestUuid,
            contestName,
            providerContestUuid,
            providerContestName,
          },
        };
      });

    const kvPayload = {
      provider,
      eventId,
      importTime: importTimeIso,
      responseSize,
      importedCount,
      source,
      durationMs,
      providerVersion: String(body?.metadata?.providerVersion || 'v1'),
      payloadStoragePath: payloadStorage?.storagePath || null,
      payloadStorageCompressed: payloadStorage?.storageCompressed || null,
      payloadStorageSize: payloadStorage?.storageSize || null,
      participants: normalizedParticipants,
    };

    await writeParticipantsKv(eventId, kvPayload);
    const participantsIndex = await writeParticipantsIndexKv(eventId, normalizedParticipants);

    return NextResponse.json({
      success: true,
      eventId,
      provider,
      importedCount,
      importTime: importTimeIso,
      responseSize,
      source,
      durationMs,
      participantsIndexed: Number(participantsIndex?.count || 0),
      message: 'Provider participants persisted to KV (raw + indexed).',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to persist provider participants',
      },
      { status: 500 },
    );
  }
}

*/

import { NextRequest as _NextRequest, NextResponse as _NextResponse } from 'next/server';
import { getStorageInstance as _getStorageInstance, getFirestoreInstance as _getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV as _getKV, putKV as _putKV, deleteKV as _deleteKV } from '@/lib/cloudflare/kv';
import * as _zlib from 'zlib';

export const dynamic = 'force-dynamic';

type _TicketMappingsKv = {
  ticketToContest?: Record<string, string>;
  ticketsById?: Record<string, any>;
  mapped?: number;
  missing?: number;
};

type _MatchMethod = 'providerUuid' | 'bib' | 'chip' | 'registrationId' | 'email' | 'mobile' | 'name+dob' | 'name+contest' | 'name';

const _MATCH_CONFIDENCE: Record<_MatchMethod, number> = {
  providerUuid: 100,
  bib: 100,
  chip: 100,
  registrationId: 100,
  'name+dob': 90,
  'name+contest': 88,
  email: 80,
  mobile: 75,
  name: 60,
};

const _AUTO_MAP_THRESHOLD = 90;

const _EXCLUDED_PROVIDER_STATUSES = new Set([
  'deferred',
  'cancelled',
  'canceled',
  'cancel',
  'withdrawn',
  'withdraw',
  'refunded',
  'refund',
  'rejected',
  'void',
  'inactive',
]);

function _isTrackableProviderStatus(value: unknown) {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return true;
  return !_EXCLUDED_PROVIDER_STATUSES.has(status);
}

function _auth(req: _NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

const _now = () => new Date().toISOString();
const _str = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t || null;
};
const _email = (v: unknown) => {
  const t = _str(v);
  return t ? t.toLowerCase() : null;
};
const _name = (v: unknown) => {
  const raw = String(v ?? '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
  return raw.replace(/\s+/g, ' ').trim() || null;
};
const _bib = (v: unknown) => {
  const t = _str(v);
  if (!t) return null;
  const compact = t.replace(/\s+/g, '');
  return /^\d+$/.test(compact) ? String(Number(compact)) : compact.toUpperCase();
};
const _phone = (v: unknown) => {
  const digits = String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
};
const _dob = (v: unknown) => {
  const t = _str(v);
  if (!t) return null;
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const _safeObjName = (v: string) => String(v || 'payload').trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100) || 'payload';

const getInitials = (name: unknown) => {
  const text = String(name ?? '').trim();
  if (!text) return 'AT';
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'AT';
};

function _splitName(fullNameRaw: string | null) {
  const fullName = String(fullNameRaw || '').trim();
  if (!fullName) return { firstName: null as string | null, lastName: null as string | null, fullName: null as string | null };
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || null, lastName: null, fullName };
  return { firstName: parts.slice(0, -1).join(' ') || null, lastName: parts[parts.length - 1] || null, fullName };
}

function _participantArray(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  for (const key of ['participants', 'rows', 'items', 'result', 'list', 'data']) {
    const v = (input as any)[key];
    if (Array.isArray(v)) return v;
  }
  for (const v of Object.values(input)) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const nested = _participantArray(v);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function _diff(oldMapping: any, nextMapping: any) {
  const fields = ['bergmanUid', 'registrationId', 'bib', 'category', 'contestUuid', 'providerParticipantUuid', 'confidence', 'matchedBy'];
  const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];
  for (const f of fields) {
    const a = oldMapping?.[f] ?? null;
    const b = nextMapping?.[f] ?? null;
    if (String(a ?? '') !== String(b ?? '')) changes.push({ field: f, oldValue: a, newValue: b });
  }
  return changes;
}

function _csvEscape(value: unknown) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function _toCsv(rows: Record<string, any>[]) {
  const headers = ['bib', 'athleteName', 'bergmanUid', 'registrationId', 'providerParticipantUuid', 'contestUuid', 'confidence', 'matchedBy', 'status', 'reason', 'timestamp'];
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((k) => _csvEscape(row[k])).join(','));
  return lines.join('\n');
}

async function _storeRaw(eventId: string, importTimeIso: string, provider: string, payloadJson: string) {
  const bucket = _getStorageInstance().bucket();
  const objectPath = `live/provider-participants/${eventId}/${provider}/${importTimeIso.replace(/[:.]/g, '-')}-${_safeObjName('raw')}.json.gz`;
  const compressed = _zlib.gzipSync(Buffer.from(payloadJson, 'utf8'));
  await bucket.file(objectPath).save(compressed, {
    resumable: false,
    metadata: { contentType: 'application/gzip', cacheControl: 'private, max-age=3600' },
  });
  return { storagePath: objectPath, storageCompressed: true, storageSize: compressed.length };
}

async function _writeProviderParticipants(eventId: string, payload: any) {
  await _putKV(`event:${eventId}:providerParticipants`, payload, 'api-provider-participants-v2');
  await _putKV(`live:event:${eventId}:providerParticipants`, payload, 'api-provider-participants-v2');
}

async function _loadTicketMappings(eventId: string): Promise<_TicketMappingsKv | null> {
  return (
    (await _getKV<_TicketMappingsKv>(`event:${eventId}:ticketMappings`, 'api-provider-participants-v2')) ||
    (await _getKV<_TicketMappingsKv>(`live:event:${eventId}:ticketMappings`, 'api-provider-participants-v2')) ||
    null
  );
}

async function _loadTimingConfiguration(eventId: string): Promise<any | null> {
  return (
    (await _getKV<Record<string, any>>(`event:${eventId}:timingConfiguration`, 'api-provider-participants-v2')) ||
    (await _getKV<Record<string, any>>(`live:event:${eventId}:timingConfiguration`, 'api-provider-participants-v2')) ||
    null
  );
}

async function _loadMasterRegistrationIndex(eventId: string): Promise<any[]> {
  const eventIndex = await _getKV<any[]>(`event:${eventId}:index`, 'api-provider-participants-v2').catch(() => null);
  if (Array.isArray(eventIndex) && eventIndex.length > 0) return eventIndex;
  const liveIndex = await _getKV<any[]>(`live:event:${eventId}:index`, 'api-provider-participants-v2').catch(() => null);
  if (Array.isArray(liveIndex) && liveIndex.length > 0) return liveIndex;
  const liveParticipantsIndex = await _getKV<any[]>(`live:event:${eventId}:participants:index`, 'api-provider-participants-v2').catch(() => null);
  if (Array.isArray(liveParticipantsIndex) && liveParticipantsIndex.length > 0) return liveParticipantsIndex;

  try {
    const db = _getFirestoreInstance();
    const snap = await db.collection('events').doc(eventId).collection('participants').get();
    if (snap && Array.isArray(snap.docs) && snap.docs.length > 0) {
      return snap.docs.map((doc: any) => ({
        ...(doc.data() || {}),
        id: doc.id,
        bookingId: doc.id,
        participantId: doc.id,
        eventId,
      }));
    }
  } catch (error) {
    console.warn('[api-provider-participants-v2] Firestore fallback for master registrations failed', {
      eventId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return [];
}

async function _loadStoredProviderParticipants(eventId: string): Promise<Record<string, any> | null> {
  return (
    (await _getKV<Record<string, any>>(`event:${eventId}:providerParticipants`, 'api-provider-participants-v2')) ||
    (await _getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-provider-participants-v2')) ||
    null
  );
}

function _resolveContestFromTicket(ticketMappings: _TicketMappingsKv | null, ticketId: string | null, subCategoryId: string | null) {
  if (!ticketMappings || !ticketId) return null;
  const sub = String(subCategoryId || '').trim();
  const compositeKey = sub ? `${ticketId}:${sub}` : null;
  const baseKey = `${ticketId}:base`;
  const contestUuid = sub
    ? ((compositeKey ? ticketMappings.ticketToContest?.[compositeKey] : null) || ticketMappings.ticketToContest?.[ticketId] || null)
    : ticketMappings.ticketToContest?.[baseKey] || ticketMappings.ticketToContest?.[ticketId] || null;
  if (!contestUuid) return null;
  const detail = sub
    ? ((compositeKey ? (ticketMappings.ticketsById || {})[compositeKey] : null) || (ticketMappings.ticketsById || {})[ticketId] || null)
    : ((ticketMappings.ticketsById || {})[baseKey] || (ticketMappings.ticketsById || {})[ticketId] || null);
  return {
    contestUuid,
    contestName: _str(detail?.contestName),
    providerContestUuid: _str(detail?.providerContestUuid || contestUuid),
    providerContestName: _str(detail?.providerContestName || detail?.contestName),
  };
}

function _buildContestNameMap(ticketMappings: _TicketMappingsKv | null, timingConfiguration: any | null) {
  const map: Record<string, string> = {};
  const add = (nameRaw: unknown, uuidRaw: unknown) => {
    const n = _name(nameRaw);
    const u = _str(uuidRaw);
    if (!n || !u) return;
    map[n] = u;
  };
  for (const row of Object.values(ticketMappings?.ticketsById || {})) {
    add((row as any)?.contestName, (row as any)?.contestUuid || (row as any)?.providerContestUuid);
    add((row as any)?.ticketName, (row as any)?.contestUuid || (row as any)?.providerContestUuid);
    add((row as any)?.displayName, (row as any)?.contestUuid || (row as any)?.providerContestUuid);
  }
  const contests = Array.isArray(timingConfiguration?.course?.contests)
    ? timingConfiguration.course.contests
    : Array.isArray(timingConfiguration?.contests)
      ? timingConfiguration.contests
      : [];
  for (const contest of contests) {
    const uuid = _str((contest as any)?.contestUuid || (contest as any)?.providerContestUuid || (contest as any)?.UUID || (contest as any)?.uuid || (contest as any)?.id);
    add((contest as any)?.contestName || (contest as any)?.name || (contest as any)?.Name || (contest as any)?.label, uuid);
  }
  return map;
}

function _resolveContestFromCategory(categoryRaw: unknown, map: Record<string, string>) {
  const n = _name(categoryRaw);
  if (!n) return null;
  if (map[n]) return map[n];
  const key = Object.keys(map).find((k) => k.includes(n) || n.includes(k));
  return key ? map[key] : null;
}

function _keyNameBib(name: unknown, bib: unknown) {
  const n = _name(name);
  const b = _bib(bib);
  if (!n || !b) return null;
  return `${n}|${b}`;
}

function _keyNameContest(name: unknown, contest: unknown) {
  const n = _name(name);
  const c = _name(contest);
  if (!n || !c) return null;
  return `${n}|${c}`;
}

function _keyNameDob(name: unknown, dob: unknown) {
  const n = _name(name);
  const d = _dob(dob);
  if (!n || !d) return null;
  return `${n}|${d}`;
}

function _normalizeProviderParticipant(provider: string, eventId: string, row: any, index: number) {
  const providerUuid =
    _str(row?.providerUuid) ||
    _str(row?.uuid) ||
    _str(row?.participant_uuid) ||
    _str(row?.participantUuid) ||
    _str(row?.id) ||
    `${provider}:${eventId}:${index + 1}`;

  const bib = _str(row?.bib) || _str(row?.bib_no) || _str(row?.bibNumber) || _str(row?.bib_number) || _str(row?.startNumber) || _str(row?.start_number) || _str(row?.number) || _str(row?.no);
  const chip = _str(row?.chip) || _str(row?.chip_code) || _str(row?.chipCode) || _str(row?.chip_id) || _str(row?.chipId) || _str(row?.chipNumber) || _str(row?.chip_number);
  const fullNameCandidate =
    _str(row?.fullName) ||
    _str(row?.full_name) ||
    _str(row?.name) ||
    [_str(row?.firstName || row?.first_name), _str(row?.lastName || row?.last_name)].filter(Boolean).join(' ').trim() || null;

  const split = _splitName(fullNameCandidate);
  const participantUuid = _str(row?.participant_uuid || row?.participantUuid || row?.uuid || row?.id) || providerUuid;
  const ticketId = _str(row?.ticketId || row?.registrationTicketId || row?.ticket?.id || row?.ticket_uuid || row?.ticketUuid) || null;
  const subCategoryId = _str(row?.subCategoryId || row?.registrationSubCategoryId || row?.sub_category_id || row?.selectedSubCategoryId || row?.subCategory?.id) || null;
  const contestUuid = _str(row?.contest_uuid || row?.contestUuid || row?.contest?.uuid || row?.contest?.UUID) || null;
  const contestName = _str(row?.contest_name || row?.contestName || row?.contest?.name || row?.contest?.Name || row?.category) || null;
  const ageGroupName = _str(row?.ageGroupName || row?.age_group_name || row?.ageGroup || row?.age_group || row?.registration?.ageGroup || row?.selectedSubCategory) || null;
  const registrationId = _str(row?.registrationId || row?.registration_id || row?.bookingId || row?.bergmanRegistrationId || row?.bergmanBookingId) || null;

  return {
    provider,
    eventId,
    providerUuid,
    participantUuid,
    participant_uuid: participantUuid,
    bib,
    chip,
    firstName: split.firstName,
    lastName: split.lastName,
    fullName: split.fullName,
    initials: getInitials(split.fullName),
    gender: _str(row?.gender || row?.sex),
    dob: _str(row?.dob || row?.birthDate || row?.birthday),
    email: _str(row?.email),
    phone: _str(row?.phone || row?.mobile),
    mobile: _str(row?.mobile || row?.phone),
    ticketId,
    subCategoryId,
    contestUuid,
    contest_uuid: contestUuid,
    providerContestUuid: contestUuid,
    contestName,
    contest_name: contestName,
    providerContestName: contestName,
    category: contestName,
    ageGroup: ageGroupName,
    ageGroupName: ageGroupName,
    age_group_name: ageGroupName,
    registrationId,
    providerBib: bib,
    providerChip: chip,
    providerStatus: _str(row?.providerStatus || row?.status),
    liveTracking: { provider, participantUuid, contestUuid, contestName, bib, chip },
    raw: row || {},
    importedAt: _now(),
  };
}

function _buildBergmanIndexes(registrationRows: any[]) {
  const byBib: Record<string, any[]> = {};
  const byChip: Record<string, any[]> = {};
  const byRegistrationId: Record<string, any[]> = {};
  const byUid: Record<string, any[]> = {};
  const byNameBib: Record<string, any[]> = {};
  const byNameDob: Record<string, any[]> = {};
  const byNameContest: Record<string, any[]> = {};
  const byEmail: Record<string, any[]> = {};
  const byMobile: Record<string, any[]> = {};
  const byName: Record<string, any[]> = {};

  const push = (map: Record<string, any[]>, key: string | null, value: any) => {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(value);
  };

  for (const row of registrationRows) {
    const bib = _bib(row?.bib || row?.bibNumber);
    const chip = _str(row?.chipCode || row?.chip || row?.timingChipId);
    const registrationId = _str(row?.registrationId || row?.id || row?.bookingId || row?.participantId);
    const bergmanUid = _str(row?.athleteUid || row?.uid || row?.userId || row?.bergmanUid || row?.registrationUid);
    const name = _str(row?.fullName || row?.name);
    const dob = _dob(row?.dob || row?.dateOfBirth);
    const contest = _str(row?.contestName || row?.category || row?.eventCategory || row?.ticketName);
    const email = _email(row?.email || row?.buyerEmail);
    const mobile = _phone(row?.mobile || row?.phone);

    push(byBib, bib, row);
    push(byChip, chip, row);
    push(byRegistrationId, registrationId, row);
    push(byUid, bergmanUid, row);
    push(byNameBib, _keyNameBib(name, bib), row);
    push(byNameDob, _keyNameDob(name, dob), row);
    push(byNameContest, _keyNameContest(name, contest), row);
    push(byEmail, email, row);
    push(byMobile, mobile, row);
    push(byName, _name(name), row);
  }

  return { byBib, byChip, byRegistrationId, byUid, byNameBib, byNameDob, byNameContest, byEmail, byMobile, byName };
}

function _buildProviderIndexes(participants: any[]) {
  const byProviderUuid: Record<string, any> = {};
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byContestUuid: Record<string, any[]> = {};

  for (const participant of participants) {
    const providerUuid = _str(participant?.participantUuid || participant?.providerUuid || participant?.participant_uuid || participant?.uuid || participant?.id);
    const bib = _bib(participant?.bib || participant?.providerBib);
    const chip = _str(participant?.chip || participant?.providerChip);
    const contestUuid = _str(participant?.contestUuid || participant?.contest_uuid || participant?.providerContestUuid);
    if (providerUuid) byProviderUuid[providerUuid] = participant;
    if (bib) byBib[bib] = participant;
    if (chip) byChip[chip] = participant;
    if (contestUuid) {
      if (!byContestUuid[contestUuid]) byContestUuid[contestUuid] = [];
      byContestUuid[contestUuid].push(participant);
    }
  }

  return { byProviderUuid, byBib, byChip, byContestUuid };
}

function _single(rows: any[] | undefined | null) {
  if (!Array.isArray(rows) || rows.length === 0) return { candidate: null as any, ambiguous: false };
  if (rows.length === 1) return { candidate: rows[0], ambiguous: false };
  return { candidate: null as any, ambiguous: true };
}

function _syntheticCandidateFromMapping(providerUuid: string, mapping: any) {
  const name = _str(mapping?.athleteName || mapping?.name || mapping?.fullName);
  const contest = _str(mapping?.category || mapping?.contestName);
  return {
    id: _str(mapping?.registrationId || mapping?.bergmanUid || mapping?.bergmanAthleteUid || providerUuid),
    athleteUid: _str(mapping?.bergmanUid || mapping?.bergmanAthleteUid || mapping?.bergmanAthleteId),
    uid: _str(mapping?.bergmanUid || mapping?.bergmanAthleteUid || mapping?.bergmanAthleteId),
    userId: _str(mapping?.bergmanUid || mapping?.bergmanAthleteUid || mapping?.bergmanAthleteId),
    registrationId: _str(mapping?.registrationId || mapping?.bergmanBookingId || mapping?.bergmanParticipantId),
    bib: _bib(mapping?.bib),
    bibNumber: _bib(mapping?.bib),
    fullName: name,
    name,
    contestName: contest,
    category: contest,
    eventCategory: contest,
    ticketName: contest,
    providerParticipantUuid: providerUuid,
  };
}

function _resolvePreviouslyMappedCandidate(providerUuid: string, existingByProvider: Record<string, any> | null, bergmanIndexes: ReturnType<typeof _buildBergmanIndexes>) {
  if (!providerUuid || !existingByProvider?.[providerUuid]) return null;
  const mapping = existingByProvider[providerUuid];
  const bergmanUid = _str(mapping?.bergmanUid || mapping?.bergmanAthleteUid || mapping?.bergmanAthleteId);
  const registrationId = _str(mapping?.registrationId || mapping?.bergmanBookingId || mapping?.bergmanParticipantId);
  const bib = _bib(mapping?.bib);

  const candidate =
    (bergmanUid && bergmanIndexes.byUid[bergmanUid]?.[0]) ||
    (registrationId && bergmanIndexes.byRegistrationId[registrationId]?.[0]) ||
    (bib && bergmanIndexes.byBib[bib]?.[0]) ||
    null;

  return {
    matched: candidate || _syntheticCandidateFromMapping(providerUuid, mapping),
    method: 'providerUuid' as const,
    confidence: 100,
    ambiguous: false,
    reason: 'Previously mapped provider UUID',
  };
}

function _tryMatchParticipant(providerRow: any, bergmanIndexes: ReturnType<typeof _buildBergmanIndexes>, existingByProvider: Record<string, any> | null) {
  const providerUuid = _str(providerRow?.participantUuid || providerRow?.providerUuid || providerRow?.participant_uuid || providerRow?.uuid || providerRow?.id);
  const providerBib = _bib(providerRow?.bib || providerRow?.providerBib);
  const providerChip = _str(providerRow?.chip || providerRow?.providerChip);
  const providerRegistrationId = _str(providerRow?.registrationId);
  const providerName = _str(providerRow?.fullName || providerRow?.name);
  const providerDob = _dob(providerRow?.dob);
  const providerEmail = _email(providerRow?.email);
  const providerMobile = _phone(providerRow?.mobile || providerRow?.phone);
  const providerContest = _str(providerRow?.contestName || providerRow?.category || providerRow?.contest || providerRow?.providerContestName);

  const existingMatch = _resolvePreviouslyMappedCandidate(providerUuid || '', existingByProvider, bergmanIndexes);
  if (existingMatch) return existingMatch;

  const attempts: Array<{ method: _MatchMethod; candidate: any; ambiguous: boolean }> = [];
  attempts.push({ method: 'bib', ..._single(providerBib ? bergmanIndexes.byBib[providerBib] : null) });
  attempts.push({ method: 'chip', ..._single(providerChip ? (bergmanIndexes as any).byChip?.[providerChip] : null) });
  attempts.push({ method: 'registrationId', ..._single(providerRegistrationId ? bergmanIndexes.byRegistrationId[providerRegistrationId] : null) });
  attempts.push({ method: 'email', ..._single(providerEmail ? bergmanIndexes.byEmail[providerEmail] : null) });
  attempts.push({ method: 'mobile', ..._single(providerMobile ? bergmanIndexes.byMobile[providerMobile] : null) });
  attempts.push({ method: 'name+dob', ..._single(bergmanIndexes.byNameDob[_keyNameDob(providerName, providerDob) || '']) });
  attempts.push({ method: 'name+contest', ..._single(bergmanIndexes.byNameContest[_keyNameContest(providerName, providerContest) || '']) });
  attempts.push({ method: 'name', ..._single(bergmanIndexes.byName[_name(providerName) || '']) });

  for (const attempt of attempts) {
    if (attempt.candidate) {
      return {
        matched: attempt.candidate,
        method: attempt.method,
        confidence: _MATCH_CONFIDENCE[attempt.method],
        ambiguous: false,
        reason: `Matched by ${attempt.method}`,
      };
    }
    if (attempt.ambiguous) {
      return {
        matched: null,
        method: attempt.method,
        confidence: _MATCH_CONFIDENCE[attempt.method],
        ambiguous: true,
        reason: `Ambiguous ${attempt.method} match`,
      };
    }
  }

  return { matched: null, method: null as _MatchMethod | null, confidence: 0, ambiguous: false, reason: 'No confident match found' };
}

function _providerGroupKey(row: any) {
  const providerUuid = _str(row?.participantUuid || row?.providerUuid || row?.participant_uuid || row?.uuid || row?.id);
  if (providerUuid) return `uuid:${providerUuid}`;
  const bib = _bib(row?.bib || row?.providerBib);
  if (bib) return `bib:${bib}`;
  const name = _name(row?.fullName || row?.name);
  const dob = _dob(row?.dob);
  const contest = _name(row?.contestName || row?.category || row?.contest || row?.providerContestName);
  if (name && dob && contest) return `name-dob-contest:${name}|${dob}|${contest}`;
  if (name && contest) return `name-contest:${name}|${contest}`;
  return providerUuid ? `uuid:${providerUuid}` : `row:${_str(row?.id || row?.registrationId || Math.random())}`;
}

function _mergeProviderGroup(rows: any[]) {
  const base = rows[0] || {};
  const providerUuids = Array.from(new Set(rows.map((row) => _str(row?.participantUuid || row?.providerUuid || row?.participant_uuid || row?.uuid || row?.id)).filter(Boolean)));
  const providerBib = rows.map((row) => _bib(row?.bib || row?.providerBib)).find(Boolean) || null;
  const providerChip = rows.map((row) => _str(row?.chip || row?.providerChip)).find(Boolean) || null;
  const fullName = rows.map((row) => _str(row?.fullName || row?.name)).find(Boolean) || null;
  const dob = rows.map((row) => _dob(row?.dob)).find(Boolean) || null;
  const contestName = rows.map((row) => _str(row?.contestName || row?.category || row?.contest || row?.providerContestName)).find(Boolean) || null;
  return {
    ...base,
    participantUuid: _str(base?.participantUuid || base?.providerUuid || base?.participant_uuid || base?.uuid || base?.id || providerUuids[0] || ''),
    providerUuid: _str(base?.providerUuid || base?.participantUuid || base?.uuid || base?.id || providerUuids[0] || ''),
    providerBib,
    providerChip,
    fullName,
    name: fullName,
    dob,
    contestName,
    category: contestName,
    providerUuids,
    duplicateMerged: rows.length > 1,
    mergedCount: rows.length,
    mergedRows: rows,
  };
}

function _buildLeanReviewItem(participant: any, match: any, reason: string) {
  return {
    providerParticipantUuid: _str(participant?.participantUuid || participant?.providerUuid || participant?.participant_uuid),
    providerName: _str(participant?.fullName || participant?.name),
    providerBib: _bib(participant?.bib || participant?.providerBib),
    providerChip: _str(participant?.chip || participant?.providerChip),
    providerContest: _str(participant?.contestName || participant?.providerContestName || participant?.category),
    suggestedAthleteUid: _str(match?.matched?.athleteUid || match?.matched?.uid || match?.matched?.userId || null),
    confidence: Number(match?.confidence || 0),
    reason,
    matchedBy: match?.method || null,
    providerNameNormalized: _name(participant?.fullName || participant?.name),
    createdAt: _now(),
  };
}

async function _writeParticipantsIndex(eventId: string, participants: any[]) {
  const byBib: Record<string, any> = {};
  const byChip: Record<string, any> = {};
  const byUuid: Record<string, any> = {};
  const byEmail: Record<string, any> = {};
  const byMobile: Record<string, any> = {};

  for (const participant of participants) {
    const bib = _str(participant?.bib || participant?.providerBib || participant?.liveTracking?.bib);
    const chip = _str(participant?.chip || participant?.providerChip || participant?.liveTracking?.chip);
    const uuid = _str(participant?.participantUuid || participant?.providerUuid || participant?.id);
    const email = _str(participant?.email);
    const mobile = _str(participant?.mobile || participant?.phone);
    if (uuid) byUuid[uuid] = participant;
    if (bib) byBib[bib] = participant;
    if (chip) byChip[chip] = participant;
    if (email) byEmail[email.toLowerCase()] = participant;
    if (mobile) byMobile[_phone(mobile) || mobile] = participant;
  }

  const payload = { byBib, byChip, byUuid, byEmail, byMobile, count: participants.length, generatedAt: _now() };
  await _putKV(`live:event:${eventId}:participants`, payload, 'api-provider-participants-v2');
  return payload;
}

export async function PUT(req: _NextRequest, { params }: { params: { eventId: string } }) {
  const startedAtMs = Date.now();
  const timeline: Array<{ at: string; stage: string }> = [];
  const addStage = (stage: string) => timeline.push({ at: _now(), stage });

  try {
    if (!_auth(req)) return _NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

    const eventId = String(params.eventId || '').trim();
    if (!eventId) return _NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    addStage('Loading contest mappings');
    const ticketMappings = await _loadTicketMappings(eventId);
    const ticketRows = Object.values(ticketMappings?.ticketsById || {}) as any[];
    const actionableTicketRows = ticketRows.filter((row: any) => row?.ignored !== true);
    const missingTicketIds = actionableTicketRows
      .filter((row: any) => !row?.contestUuid)
      .map((row: any) => String(row?.ticketId || row?.mappingId || '').trim())
      .filter(Boolean);

    const actionableMapped = actionableTicketRows.filter((row: any) => !!row?.contestUuid).length;
    const actionableMissing = actionableTicketRows.length - actionableMapped;
    const mappingComplete = !!ticketMappings && actionableTicketRows.length > 0 && actionableMissing === 0;
    if (!mappingComplete) {
      return _NextResponse.json({
        success: false,
        message: 'Complete Contest Mapping first before importing participants.',
        code: 'CONTEST_MAPPING_REQUIRED',
        missingTicketIds,
        totalTickets: actionableTicketRows.length,
        actionableMapped,
        actionableMissing,
      }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const provider = String(body?.provider || 'feibot').trim().toLowerCase() || 'feibot';
    const rawResponse = body?.rawResponse ?? body?.raw ?? null;
    const resetExisting = body?.resetExisting === true || body?.clearExisting === true;
    const participantRowsInput = Array.isArray(body?.participantRows)
      ? body.participantRows
      : Array.isArray(body?.participants)
        ? body.participants
        : null;
    const useStoredParticipants = body?.useStoredParticipants === true;

    const storedProviderParticipants = !participantRowsInput && !rawResponse && useStoredParticipants
      ? await _loadStoredProviderParticipants(eventId)
      : null;

    addStage('Downloading participants');
    const detectedRows = rawResponse ? _participantArray(rawResponse) : [];
    const storedRows = Array.isArray(storedProviderParticipants?.participants) ? storedProviderParticipants.participants : [];
    const participantRows = participantRowsInput && participantRowsInput.length > 0
      ? participantRowsInput
      : detectedRows.length > 0
        ? detectedRows
        : storedRows;
    addStage(`${participantRows.length} participants downloaded`);

    const importTimeIso = _now();
    const rawPayload = rawResponse ?? participantRows ?? {};
    const rawPayloadJson = JSON.stringify(rawPayload);
    const responseSize = Buffer.byteLength(rawPayloadJson, 'utf8');
    const downloadedCount = participantRows.length;
    const source = String(body?.metadata?.source || 'cloud_api').trim() || 'cloud_api';
    const payloadStorage = responseSize > 800_000
      ? await _storeRaw(eventId, importTimeIso, provider, rawPayloadJson).catch(() => null)
      : null;

    addStage('Loading Bergman participants');
    const registrationRows = await _loadMasterRegistrationIndex(eventId);

    addStage('Building contest mapping');
    const timingConfiguration = await _loadTimingConfiguration(eventId);
    const contestNameMap = _buildContestNameMap(ticketMappings, timingConfiguration);

    addStage('Building Bergman lookup indexes');
    const bergmanIndexes = _buildBergmanIndexes(registrationRows);

    const normalizedAllParticipants = participantRows
      .map((row: any, index: number) => _normalizeProviderParticipant(provider, eventId, row, index))
      .map((participant: any) => {
        const participantAny = participant as any;
        const mappedContest = _resolveContestFromTicket(ticketMappings, participant.ticketId, participant.subCategoryId);
        const mappedContestAny = mappedContest as any;
        const contestUuid = mappedContest?.contestUuid || participant.contestUuid || null;
        const contestName = mappedContest?.contestName || participant.contestName || participant.category || 'Unknown';
        const ageGroupName = participantAny?.ageGroupName || participant.ageGroup || participant.registration?.ageGroup || mappedContestAny?.ageGroupName || 'Unknown';
        return {
          ...participant,
          contestUuid,
          contest_uuid: contestUuid,
          contestName,
          contest_name: contestName,
          providerContestUuid: participant.providerContestUuid || mappedContest?.providerContestUuid || contestUuid || null,
          providerContestName: participant.providerContestName || mappedContest?.providerContestName || contestName || null,
          category: contestName,
          ageGroup: ageGroupName,
          ageGroupName,
          age_group_name: ageGroupName,
          liveTracking: { ...(participant.liveTracking || {}), contestUuid, contestName },
        };
      });

    const normalizedParticipants = normalizedAllParticipants.filter((participant: any) => _isTrackableProviderStatus(
      participant?.providerStatus
      || participant?.registrationStatus
      || participant?.raw?.status,
    ));

    const groupedParticipantsMap = new Map<string, any[]>();
    for (const participant of normalizedParticipants) {
      const key = _providerGroupKey(participant);
      if (!groupedParticipantsMap.has(key)) groupedParticipantsMap.set(key, []);
      groupedParticipantsMap.get(key)?.push(participant);
    }

    const groupedParticipants = Array.from(groupedParticipantsMap.entries()).map(([groupKey, rows]) => {
      const merged = _mergeProviderGroup(rows);
      return {
        ...merged,
        groupKey,
        groupCount: rows.length,
      };
    });

    if (resetExisting) {
      addStage('Resetting provider-only state');
      await Promise.all([
        _deleteKV(`live:event:${eventId}:providerParticipants`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:participantMappings`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:participant-mapping`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:participant-mapping-by-uid`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:participant-mapping-by-provider`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:participant-mapping-review`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:providerLookup`, 'api-provider-participants-v2'),
        _deleteKV(`live:event:${eventId}:providerIndex`, 'api-provider-participants-v2'),
      ]);
    }

    const importedCount = groupedParticipants.length;
    const excludedCount = Math.max(downloadedCount - normalizedParticipants.length, 0);
    const duplicatesMerged = Math.max(normalizedParticipants.length - groupedParticipants.length, 0);

    addStage('Loading existing mapping indexes');
    const existingByBibKv = (await _getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping`, 'api-provider-participants-v2')) || null;
    const existingByUidKv = (await _getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping-by-uid`, 'api-provider-participants-v2')) || null;
    const existingByProviderKv = (await _getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping-by-provider`, 'api-provider-participants-v2')) || null;

    const byBib: Record<string, any> = { ...(existingByBibKv?.byBib || {}) };
    const byUid: Record<string, any> = { ...(existingByUidKv?.byUid || {}) };
    const byProvider: Record<string, any> = { ...(existingByProviderKv?.byProvider || {}) };
    const providerIndexes = _buildProviderIndexes(groupedParticipants);

    addStage('Matching athletes');
    const logs: any[] = [];
    const reviewQueue: any[] = [];
    const matchedByStats: Record<string, number> = { providerUuid: 0, bib: 0, chip: 0, registrationId: 0, email: 0, mobile: 0, 'name+dob': 0, 'name+contest': 0, name: 0, manual: 0 };
    const contestStats: Record<string, { imported: number; mapped: number; skipped: number; review: number; failed: number }> = {};

    let mapped = 0;
    let updated = 0;
    let skipped = 0;
    let needsReview = 0;
    let failed = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const participant of groupedParticipants) {
      const rowAt = _now();
      const providerUuid = _str(participant?.participantUuid || participant?.providerUuid || participant?.participant_uuid);
      const providerBib = _bib(participant?.bib || participant?.providerBib);
      const providerChip = _str(participant?.chip || participant?.providerChip);
      const providerName = _str(participant?.fullName || participant?.name);
      const match = _tryMatchParticipant(participant, bergmanIndexes, byProvider);
      const matched = match.matched;
      const matchedBy = match.method;
      const confidence = Number(match.confidence || 0);
      const bergmanUid = _str(matched?.athleteUid || matched?.uid || matched?.userId);
      const registrationId = _str(matched?.registrationId || matched?.id || matched?.bookingId);
      const bergmanBib = _bib(matched?.bib || matched?.bibNumber || providerBib);
      const bergmanCategory = _str(matched?.eventCategory || matched?.category || matched?.raceCategory || matched?.ticketName);
      const mappedContestFromTicket = _resolveContestFromTicket(ticketMappings, _str(matched?.ticketId || participant?.ticketId), _str(matched?.subCategoryId || participant?.subCategoryId));
      const contestUuid = _str(mappedContestFromTicket?.contestUuid) || _resolveContestFromCategory(bergmanCategory, contestNameMap) || _str(participant?.contestUuid || participant?.providerContestUuid);
      const contestName = _str(mappedContestFromTicket?.contestName || participant?.contestName || bergmanCategory);

      const mappingRecord = {
        bergmanUid,
        registrationId,
        bib: bergmanBib || providerBib,
        category: bergmanCategory,
        contestUuid,
        provider: 'feibot',
        providerParticipantUuid: providerUuid,
        confidence,
        matchedBy,
        matchedAt: rowAt,
        status: 'matched',
      };

      const contestKey = _str(contestName || bergmanCategory || participant?.contestName || participant?.category) || 'UNRESOLVED_CONTEST';
      if (!contestStats[contestKey]) contestStats[contestKey] = { imported: 0, mapped: 0, skipped: 0, review: 0, failed: 0 };
      contestStats[contestKey].imported += 1;

      const existing = (providerUuid ? byProvider[providerUuid] : null) || (bergmanUid ? byUid[bergmanUid] : null) || ((bergmanBib || providerBib) ? byBib[String(bergmanBib || providerBib)] : null) || null;
      if (confidence > 0) {
        confidenceSum += confidence;
        confidenceCount += 1;
      }

      const markLog = (status: 'MAPPED' | 'UPDATED' | 'SKIPPED' | 'REVIEW_REQUIRED' | 'FAILED', reason: string, extra?: any) => {
        const entry = {
          timestamp: rowAt,
          status,
          reason,
          providerUuid,
          bib: providerBib,
          providerBib,
          providerChip,
          athleteName: providerName,
          bergmanUid,
          bergmanBib,
          registrationId,
          providerParticipantUuid: providerUuid,
          contestUuid,
          confidence,
          matchedBy,
          matchReason: match.reason,
          providerUuids: Array.isArray(participant?.providerUuids) ? participant.providerUuids : [providerUuid].filter(Boolean),
          duplicateMerged: Boolean(participant?.duplicateMerged),
          ...extra,
        };
        logs.push(entry);
        if (status === 'MAPPED' || status === 'UPDATED') {
          console.log('[provider-participants][match]', {
            providerUuid,
            providerBib,
            bergmanBib,
            matchedBy,
            confidence,
            reason: match.reason,
          });
        }
      };

      if (match.ambiguous || !matchedBy || !matched) {
        needsReview += 1;
        contestStats[contestKey].review += 1;
        reviewQueue.push(_buildLeanReviewItem(participant, match, match.ambiguous ? 'Multiple possible matches' : 'No confident match found'));
        markLog('REVIEW_REQUIRED', match.ambiguous ? 'Multiple possible matches' : 'No confident match found');
        continue;
      }

      if (confidence < _AUTO_MAP_THRESHOLD) {
        needsReview += 1;
        contestStats[contestKey].review += 1;
        reviewQueue.push(_buildLeanReviewItem(participant, match, 'Confidence below threshold'));
        matchedByStats[matchedBy] = Number(matchedByStats[matchedBy] || 0) + 1;
        markLog('REVIEW_REQUIRED', 'Confidence below threshold');
        continue;
      }

      if (!contestUuid) {
        failed += 1;
        contestStats[contestKey].failed += 1;
        markLog('FAILED', 'Contest UUID could not be resolved', { category: bergmanCategory });
        continue;
      }

      if (existing) {
        const changes = _diff(existing, mappingRecord);
        if (changes.length === 0) {
          skipped += 1;
          contestStats[contestKey].skipped += 1;
          markLog('SKIPPED', 'Already mapped, no changes detected');
          continue;
        }
        updated += 1;
        contestStats[contestKey].mapped += 1;
        matchedByStats[matchedBy] = Number(matchedByStats[matchedBy] || 0) + 1;
        markLog('UPDATED', 'Mapping updated', { changes });
      } else {
        mapped += 1;
        contestStats[contestKey].mapped += 1;
        matchedByStats[matchedBy] = Number(matchedByStats[matchedBy] || 0) + 1;
        markLog('MAPPED', 'Mapped during import');
      }

      if (mappingRecord.bib) byBib[mappingRecord.bib] = mappingRecord;
      if (mappingRecord.bergmanUid) byUid[mappingRecord.bergmanUid] = mappingRecord;
      if (mappingRecord.providerParticipantUuid) byProvider[mappingRecord.providerParticipantUuid] = mappingRecord;
    }

    addStage('Saving mappings');
    const averageConfidence = confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(2)) : 0;
    const summary = {
      downloaded: downloadedCount,
      imported: importedCount,
      excluded: excludedCount,
      mapped,
      updated,
      skipped,
      needsReview,
      failed,
      duplicatesMerged,
      averageConfidence,
      autoMapThreshold: _AUTO_MAP_THRESHOLD,
      matchedBy: matchedByStats,
      contestMapping: { successful: Object.keys(contestNameMap).length, total: Object.keys(contestNameMap).length },
      contestStats,
      mappingSummary: {
        totalProviderParticipants: importedCount,
        totalRegistrations: registrationRows.length,
        mapped: mapped + updated,
        unmatched: needsReview + failed,
        onlyInBergman: Math.max(registrationRows.length - (mapped + updated), 0),
        onlyInProvider: Math.max(importedCount - (mapped + updated), 0),
        providerBibDuplicates: 0,
        providerChipDuplicates: 0,
        registrationDuplicates: 0,
        conflicts: 0,
        ambiguous: needsReview,
        duplicatesMerged,
      },
    };

    const timestamp = _now();
    const byBibPayload = { eventId, updatedAt: timestamp, byBib, summary };
    const byUidPayload = { eventId, updatedAt: timestamp, byUid, summary };
    const byProviderPayload = { eventId, updatedAt: timestamp, byProvider, summary };

    const legacyMappingsPayload = {
      eventId,
      updatedAt: timestamp,
      mappings: Object.values(byProvider).map((row: any) => ({
        bergmanParticipantId: row?.registrationId || null,
        bergmanAthleteId: row?.bergmanUid || row?.registrationId || null,
        bergmanAthleteUid: row?.bergmanUid || null,
        bergmanBookingId: row?.registrationId || null,
        feibotParticipantUUID: row?.providerParticipantUuid || null,
        contestUUID: row?.contestUuid || null,
        contest_name: row?.category || null,
        bib: row?.bib || null,
        chipCode: null,
        synced: true,
        syncedAt: row?.matchedAt || timestamp,
        lastUpdated: row?.matchedAt || timestamp,
        lastSync: row?.matchedAt || timestamp,
        status: 'matched',
        confidence: row?.confidence ?? null,
        matchedBy: row?.matchedBy ?? null,
      })),
      summary: summary.mappingSummary,
      logs,
    };

    const reviewPayload = { eventId, updatedAt: timestamp, reviewQueue, total: reviewQueue.length };

    addStage('Updating KV');
    await Promise.all([
      _putKV(`live:event:${eventId}:participant-mapping`, byBibPayload, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:participant-mapping-by-uid`, byUidPayload, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:participant-mapping-by-provider`, byProviderPayload, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:participantMappings`, legacyMappingsPayload, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:participant-mapping-review`, reviewPayload, 'api-provider-participants-v2'),
    ]);

    const importReport = {
      eventId,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: timestamp,
      durationMs: Date.now() - startedAtMs,
      provider,
      source,
      imported: importedCount,
      mapped,
      updated,
      skipped,
      review: needsReview,
      failed,
      averageConfidence,
      timeline,
      summary,
      logs,
    };

    const history = (await _getKV<any[]>(`live:event:${eventId}:participant-import-history`, 'api-provider-participants-v2')) || [];
    history.unshift({
      startedAt: importReport.startedAt,
      completedAt: importReport.completedAt,
      downloaded: importedCount,
      mapped,
      updated,
      skipped,
      review: needsReview,
      failed,
      durationMs: importReport.durationMs,
      averageConfidence,
    });

    await Promise.all([
      _putKV(`live:event:${eventId}:participant-import-report:latest`, importReport, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:participant-import-history`, history.slice(0, 50), 'api-provider-participants-v2'),
    ]);

    const kvPayload = {
      provider,
      eventId,
      importTime: importTimeIso,
      responseSize,
      downloadedCount,
      importedCount,
      excludedCount,
      source,
      durationMs: importReport.durationMs,
      providerVersion: String(body?.metadata?.providerVersion || 'v1'),
      payloadStoragePath: payloadStorage?.storagePath || null,
      payloadStorageCompressed: payloadStorage?.storageCompressed || null,
      payloadStorageSize: payloadStorage?.storageSize || null,
      mappingSummary: summary.mappingSummary,
      importSummary: summary,
      participants: groupedParticipants,
      importReport,
    };

    const providerLookupPayload = {
      provider,
      eventId,
      updatedAt: timestamp,
      byProviderUuid: providerIndexes.byProviderUuid,
      byBib: providerIndexes.byBib,
      byChip: providerIndexes.byChip,
      byContestUuid: providerIndexes.byContestUuid,
      count: groupedParticipants.length,
      importedCount,
      source,
    };

    const providerIndexPayload = {
      provider,
      eventId,
      updatedAt: timestamp,
      participants: groupedParticipants,
      count: groupedParticipants.length,
      importedCount,
      byProviderUuid: providerIndexes.byProviderUuid,
      byBib: providerIndexes.byBib,
      byChip: providerIndexes.byChip,
      byContestUuid: providerIndexes.byContestUuid,
    };

    await _writeProviderParticipants(eventId, kvPayload);
    const participantsIndex = await _writeParticipantsIndex(eventId, groupedParticipants);
    await Promise.all([
      _putKV(`event:${eventId}:providerLookup`, providerLookupPayload, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:providerLookup`, providerLookupPayload, 'api-provider-participants-v2'),
      _putKV(`event:${eventId}:providerIndex`, providerIndexPayload, 'api-provider-participants-v2'),
      _putKV(`live:event:${eventId}:providerIndex`, providerIndexPayload, 'api-provider-participants-v2'),
    ]);

    addStage('Import Complete');

    return _NextResponse.json({
      success: true,
      eventId,
      provider,
      downloadedCount,
      importedCount,
      excludedCount,
      importTime: importTimeIso,
      responseSize,
      source,
      durationMs: importReport.durationMs,
      participantsIndexed: Number(participantsIndex?.count || 0),
      summary,
      timeline,
      report: importReport,
      message: 'Provider participants imported with automatic Bergman↔Feibot mapping and detailed logs.',
    });
  } catch (error) {
    return _NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to persist provider participants' }, { status: 500 });
  }
}

export async function POST(req: _NextRequest, ctx: { params: { eventId: string } }) {
  return PUT(req, ctx);
}

export async function GET(req: _NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = String(params.eventId || '').trim();
    if (!eventId) return _NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    const format = String(req.nextUrl.searchParams.get('format') || '').toLowerCase();
    const reportMode = String(req.nextUrl.searchParams.get('report') || '').toLowerCase();

    const metadata =
      (await _getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-provider-participants-v2')) ||
      null;
    const latestReport =
      (await _getKV<Record<string, any>>(`live:event:${eventId}:participant-import-report:latest`, 'api-provider-participants-v2')) ||
      null;
    const reviewQueue =
      (await _getKV<Record<string, any>>(`live:event:${eventId}:participant-mapping-review`, 'api-provider-participants-v2')) ||
      null;

    if (format === 'csv' && latestReport) {
      const csvRows = Array.isArray(latestReport?.logs)
        ? latestReport.logs.map((row: any) => ({
            bib: row?.bib || '',
            athleteName: row?.athleteName || '',
            bergmanUid: row?.bergmanUid || '',
            registrationId: row?.registrationId || '',
            providerParticipantUuid: row?.providerParticipantUuid || '',
            contestUuid: row?.contestUuid || '',
            confidence: row?.confidence ?? '',
            matchedBy: row?.matchedBy || '',
            status: row?.status || '',
            reason: row?.reason || '',
            timestamp: row?.timestamp || '',
          }))
        : [];
      return new _NextResponse(_toCsv(csvRows), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="participant-import-${eventId}.csv"`,
        },
      });
    }

    if (reportMode === 'latest') {
      return _NextResponse.json({ success: true, eventId, report: latestReport, reviewQueue: reviewQueue?.reviewQueue || [] });
    }

    return _NextResponse.json({
      success: true,
      eventId,
      metadata,
      summary: metadata?.importSummary || latestReport?.summary || null,
      report: latestReport,
      reviewQueue: reviewQueue?.reviewQueue || [],
      participants: Array.isArray(metadata?.participants) ? metadata.participants : [],
    });
  } catch (error) {
    return _NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to read provider participants' }, { status: 500 });
  }
}

