import { getKV } from '@/lib/cloudflare/kv';
import { buildTimingConfigurationFromCourseIndex } from '@/lib/courseIndexView';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return normalize(value).toLowerCase();
}

function normalizeLookupKey(value: unknown) {
  return lower(value).replace(/[^a-z0-9]/g, '');
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function getContestNameFromTimingConfiguration(contestUuid: string | null, timingConfiguration: any) {
  const target = lower(contestUuid);
  if (!target || !timingConfiguration) return null;

  const contests = [
    ...asArray(timingConfiguration?.course?.contests),
    ...asArray(timingConfiguration?.contests),
  ];

  const contest = contests.find((row: any) => {
    const uuid = lower(row?.UUID || row?.uuid || row?.contestUuid || row?.contest_uuid || row?.id);
    return uuid === target;
  }) || null;

  return normalize(contest?.contestName || contest?.name || contest?.label || contest?.Name) || null;
}

function resolveContestFromTimingConfigurationByName(contestName: string | null, timingConfiguration: any) {
  const target = lower(contestName);
  if (!target || !timingConfiguration) return { contestUuid: null as string | null, contestName: null as string | null };

  const contests = [
    ...asArray(timingConfiguration?.course?.contests),
    ...asArray(timingConfiguration?.contests),
  ];

  const match = contests.find((row: any) => {
    const rowName = lower(row?.contestName || row?.name || row?.label || row?.Name || row?.category);
    return rowName === target;
  }) || null;

  return {
    contestUuid: normalize(match?.UUID || match?.uuid || match?.contestUuid || match?.contest_uuid || match?.id) || null,
    contestName: normalize(match?.contestName || match?.name || match?.label || match?.Name || match?.category) || null,
  };
}

async function loadTimingConfiguration(eventId: string) {
  return (await getKV<any>(`live:event:${eventId}:timingConfiguration`, 'liveTrackingParticipantStore')) || null;
}

async function loadCourseIndex(eventId: string) {
  return (await getKV<any>(`live:event:${eventId}:course:index`, 'liveTrackingParticipantStore')) || null;
}

async function loadStaticParticipantByUuid(eventId: string, participantUuid: string | null, bookingId?: string | null) {
  const uuid = normalize(participantUuid);
  const booking = normalize(bookingId);

  const candidates = [
    uuid ? `live:event:${eventId}:participant:${uuid}` : null,
    uuid ? `live:event:${eventId}:timingParticipant:${uuid}` : null,
    booking ? `live:event:${eventId}:timingParticipant:${booking}` : null,
    booking ? `live:event:${eventId}:participant:${booking}` : null,
  ].filter(Boolean) as string[];

  for (const key of candidates) {
    const value = await getKV<any>(key, 'liveTrackingParticipantStore');
    if (value && typeof value === 'object') return value;
  }

  return null;
}

async function loadTicketMappings(eventId: string) {
  return (await getKV<any>(`live:event:${eventId}:ticketMappings`, 'liveTrackingParticipantStore')) || null;
}

function resolveContestFromTicketMappings(ticketMappings: any, ticketId: string | null, subCategoryId: string | null) {
  if (!ticketMappings || !ticketId) return { contestUuid: null as string | null, contestName: null as string | null };
  const normalizedTicketId = normalize(ticketId);
  const normalizedSubCategoryId = normalize(subCategoryId);
  const ticketToContest = ticketMappings?.ticketToContest && typeof ticketMappings.ticketToContest === 'object' ? ticketMappings.ticketToContest : {};
  const ticketsById = ticketMappings?.ticketsById && typeof ticketMappings.ticketsById === 'object' ? ticketMappings.ticketsById : {};
  const mappingKey = normalizedSubCategoryId ? `${normalizedTicketId}:${normalizedSubCategoryId}` : normalizedTicketId;
  const contestUuid = normalize(ticketToContest[mappingKey] || ticketToContest[normalizedTicketId] || '').trim() || null;
  const detail = ticketsById[mappingKey] || ticketsById[normalizedTicketId] || null;
  const contestName = normalize(detail?.contestName || detail?.providerContestName || '').trim() || null;
  return { contestUuid, contestName };
}

function lookupIndexValue(index: any, mapName: string, keys: string[]) {
  const map = index?.[mapName] && typeof index[mapName] === 'object' ? index[mapName] : null;
  if (!map) return null;
  for (const key of keys) {
    const normalized = normalize(key);
    if (!normalized) continue;
    const candidates = [normalized, lower(normalized), normalized.replace(/^0+/, '')];
    for (const candidate of candidates) {
      if (candidate && Object.prototype.hasOwnProperty.call(map, candidate)) return map[candidate];
    }
  }
  return null;
}

export async function loadParticipantIndex(eventId: string) {
  const primary =
    (await getKV<any>(`live:event:${eventId}:participant:index`, 'liveTrackingParticipantStore')) || null;

  if (primary) {
    const storedParticipants = Array.isArray(primary?.participants) ? primary.participants : [];
    const participantUuids = new Set<string>();

    for (const item of storedParticipants) {
      if (typeof item === 'string') {
        const uuid = normalize(item);
        if (uuid) participantUuids.add(uuid);
      }
    }

    for (const mapName of ['byUuid', 'byUUID', 'byBib', 'byBookingId', 'byBooking', 'byProviderUuid', 'byChip', 'byEmail', 'byAthleteUid', 'byName']) {
      const map = primary?.[mapName] && typeof primary[mapName] === 'object' ? primary[mapName] : null;
      if (!map) continue;
      for (const value of Object.values(map)) {
        if (typeof value !== 'string') continue;
        const uuid = normalize(value);
        if (uuid) participantUuids.add(uuid);
      }
    }

    if (participantUuids.size > 0) {
      const records: any[] = [];
      const uuids = Array.from(participantUuids);
      for (let i = 0; i < uuids.length; i += 50) {
        const chunk = uuids.slice(i, i + 50);
        const values = await Promise.all(chunk.map((uuid) => loadStaticParticipantByUuid(eventId, uuid)));
        for (const value of values) {
          if (value && typeof value === 'object') records.push(value);
        }
      }

      if (records.length > 0) {
        const byBib: Record<string, any> = {};
        const byUuid: Record<string, any> = {};
        const byProviderUuid: Record<string, any> = {};
        const byChip: Record<string, any> = {};
        const byBookingId: Record<string, any> = {};
        const byName: Record<string, any> = {};
        const byEmail: Record<string, any> = {};
        const byAthleteUid: Record<string, any> = {};

        for (const row of records) {
          const bib = normalize(row?.bib || row?.bibNumber);
          const compactBib = bib.replace(/^0+/, '');
          const uuid = lower(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.provider?.providerUuid || row?.id);
          const providerUuid = lower(row?.providerUuid || row?.provider_uuid || row?.providerParticipantUuid || row?.provider?.providerUuid);
          const chip = lower(row?.chip || row?.chipCode || row?.chip_code);
          const bookingId = lower(row?.bookingId || row?.registrationId || row?.athleteUid || row?.bergmanAthleteId);
          const name = lower(row?.name || row?.fullName || row?.athleteName || row?.participantName);
          const email = lower(row?.email || row?.emailAddress || row?.mail);
          const athleteUid = lower(row?.athleteUid || row?.userId || row?.bergmanAthleteId);
          if (bib) byBib[bib] = row;
          if (compactBib) byBib[compactBib] = row;
          if (uuid) byUuid[uuid] = row;
          if (providerUuid) byProviderUuid[providerUuid] = row;
          if (chip) byChip[chip] = row;
          if (bookingId) byBookingId[bookingId] = row;
          if (name) byName[name] = row;
          if (email) byEmail[email] = row;
          if (athleteUid) byAthleteUid[athleteUid] = row;
        }

        return {
          eventId,
          participants: records,
          participantCount: records.length,
          count: records.length,
          generatedAt: new Date().toISOString(),
          byBib,
          byUuid,
          byProviderUuid,
          byChip,
          byBookingId,
          byName,
          byEmail,
          byAthleteUid,
        };
      }
    }

    const legacyParticipants = await getKV<any[]>(`live:event:${eventId}:timingParticipant:index`, 'liveTrackingParticipantStore').catch(() => null);
    if (Array.isArray(legacyParticipants) && legacyParticipants.length > 0) {
      return {
        ...primary,
        participants: legacyParticipants,
        participantCount: legacyParticipants.length,
        count: legacyParticipants.length,
      };
    }

    return primary;
  }

  const liveAthletes =
    (await getKV<any[]>(`live:event:${eventId}:athletes`, 'liveTrackingParticipantStore')) ||
    [];
  if (Array.isArray(liveAthletes) && liveAthletes.length > 0) {
    const byBib: Record<string, any> = {};
    const byUuid: Record<string, any> = {};
    const byProviderUuid: Record<string, any> = {};
    const byChip: Record<string, any> = {};
    const byBookingId: Record<string, any> = {};
    const byName: Record<string, any> = {};
    const byEmail: Record<string, any> = {};
    const byAthleteUid: Record<string, any> = {};

    for (const row of liveAthletes) {
      const bib = normalize(row?.bib || row?.bibNumber);
      const compactBib = bib.replace(/^0+/, '');
      const uuid = lower(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.provider?.providerUuid || row?.id);
      const providerUuid = lower(row?.providerUuid || row?.provider_uuid || row?.providerParticipantUuid || row?.providerParticipantUuid);
      const chip = lower(row?.chip || row?.chipCode || row?.chip_code);
      const bookingId = lower(row?.bookingId || row?.registrationId || row?.athleteUid || row?.bergmanAthleteId);
      const name = lower(row?.name || row?.fullName || row?.athleteName || row?.participantName);
      const email = lower(row?.email || row?.emailAddress || row?.mail);
      const athleteUid = lower(row?.athleteUid || row?.userId || row?.bergmanAthleteId);
      if (bib) byBib[bib] = row;
      if (compactBib) byBib[compactBib] = row;
      if (uuid) byUuid[uuid] = row;
      if (providerUuid) byProviderUuid[providerUuid] = row;
      if (chip) byChip[chip] = row;
      if (bookingId) byBookingId[bookingId] = row;
      if (name) byName[name] = row;
      if (email) byEmail[email] = row;
      if (athleteUid) byAthleteUid[athleteUid] = row;
    }

    return {
      eventId,
      participants: liveAthletes,
      participantCount: liveAthletes.length,
      count: liveAthletes.length,
      generatedAt: new Date().toISOString(),
      byBib,
      byUuid,
      byProviderUuid,
      byChip,
      byBookingId,
      byName,
      byEmail,
      byAthleteUid,
    };
  }

  return (
    null
  );
}

export function getParticipantRowsFromIndex(index: any): any[] {
  if (!index) return [];
  if (Array.isArray(index)) return index;
  if (Array.isArray(index?.participants)) return index.participants;
  if (Array.isArray(index?.rows)) return index.rows;
  if (Array.isArray(index?.data)) return index.data;
  if (index?.byUuid && typeof index.byUuid === 'object') return Object.values(index.byUuid);
  if (index?.byBib && typeof index.byBib === 'object') return Object.values(index.byBib);
  return [];
}

export function resolveBookingIdFromIndex(index: any, query: { bookingId?: string | null; bib?: string | null; athleteUid?: string | null; providerParticipantUuid?: string | null; email?: string | null }) {
  const bookingId = normalize(query.bookingId);
  const bib = normalize(query.bib).replace(/^0+/, '');
  const athleteUid = normalize(query.athleteUid);
  const providerParticipantUuid = normalize(query.providerParticipantUuid);
  const providerLookupKey = normalizeLookupKey(providerParticipantUuid);
  const athleteLookupKey = normalizeLookupKey(athleteUid);
  const email = lower(query.email);

  if (index && typeof index === 'object') {
    const byBookingId = index?.byBookingId && typeof index.byBookingId === 'object' ? index.byBookingId : null;
    const byBib = index?.byBib && typeof index.byBib === 'object' ? index.byBib : null;
    const byUuid = index?.byUuid && typeof index.byUuid === 'object' ? index.byUuid : null;
    const byProviderUuid = index?.byProviderUuid && typeof index.byProviderUuid === 'object' ? index.byProviderUuid : null;
    const byChip = index?.byChip && typeof index.byChip === 'object' ? index.byChip : null;
    const byName = index?.byName && typeof index.byName === 'object' ? index.byName : null;
    const byEmail = index?.byEmail && typeof index.byEmail === 'object' ? index.byEmail : null;
    const byAthleteUid = index?.byAthleteUid && typeof index.byAthleteUid === 'object' ? index.byAthleteUid : null;

    const direct =
      (athleteLookupKey && byAthleteUid?.[athleteLookupKey]) ||
      (providerLookupKey && (byProviderUuid?.[providerLookupKey] || byUuid?.[providerLookupKey])) ||
      (bib && (byBib?.[bib] || byBib?.[bib.replace(/^0+/, '')])) ||
      (email && byEmail?.[email]) ||
      (providerLookupKey && byUuid?.[providerLookupKey]) ||
      (bookingId && (byBookingId?.[bookingId] || byUuid?.[bookingId])) ||
      null;

    if (direct) {
      const resolvedDirectBookingId =
        bookingId ||
        normalize(direct?.bookingId || direct?.id || direct?.participantId || direct?.registrationId) ||
        null;
      return { row: direct, bookingId: resolvedDirectBookingId };
    }
  }

  const rows = getParticipantRowsFromIndex(index);

  const row = rows.find((item: any) => {
    const rowBookingId = normalize(item?.bookingId || item?.id || item?.participantId || item?.registrationId);
    const rowBib = normalize(item?.bib || item?.bibNumber).replace(/^0+/, '');
    const rowAthleteUid = normalize(item?.athleteUid || item?.userId || item?.bergmanAthleteId);
    const rowProviderParticipantUuid = normalize(item?.providerParticipantUuid || item?.participantUuid || item?.providerUuid || item?.provider?.providerUuid);
    const rowEmail = lower(item?.email || item?.emailAddress || item?.mail);

    return (
      (!!athleteUid && rowAthleteUid === athleteUid)
      || (!!providerParticipantUuid && rowProviderParticipantUuid === providerParticipantUuid)
      || (!!bib && rowBib === bib)
      || (!!email && rowEmail === email)
      || (!!bookingId && rowBookingId === bookingId)
    );
  }) || null;

  const resolvedBookingId = bookingId || normalize(row?.bookingId || row?.id || row?.participantId || row?.registrationId) || null;
  return { row, bookingId: resolvedBookingId };
}

async function loadStaticParticipant(eventId: string, bookingId: string | null, participantUuid?: string | null) {
  const staticParticipant = await loadStaticParticipantByUuid(eventId, participantUuid || bookingId || null, bookingId);
  if (staticParticipant) return staticParticipant;
  if (!bookingId) return null;
  return (await getKV<any>(`live:event:${eventId}:timingParticipant:${bookingId}`, 'liveTrackingParticipantStore')) || null;
}

async function loadLiveParticipant(eventId: string, bookingId: string | null) {
  if (!bookingId) return null;
  return (await getKV<any>(`live:event:${eventId}:participantLive:${bookingId}`, 'liveTrackingParticipantStore')) || null;
}

export async function loadParticipantPublicView(eventId: string, query: { bookingId?: string | null; bib?: string | null; athleteUid?: string | null; providerParticipantUuid?: string | null; email?: string | null }) {
  const [index, ticketMappings] = await Promise.all([
    loadParticipantIndex(eventId),
    loadTicketMappings(eventId),
  ]);
  const { row: indexRow, bookingId } = resolveBookingIdFromIndex(index, query);
  const fallbackBookingId = normalize(indexRow?.bookingId || indexRow?.id || indexRow?.participantId || indexRow?.registrationId) || null;
  const resolvedBookingId = bookingId || fallbackBookingId;
  if (!resolvedBookingId && !indexRow) return null;

  const [participantDoc, participantLive, courseIndex] = await Promise.all([
    loadStaticParticipant(eventId, resolvedBookingId, indexRow?.participantUuid || indexRow?.participant_uuid || null),
    loadLiveParticipant(eventId, resolvedBookingId),
    loadCourseIndex(eventId),
  ]);

  const timingConfiguration = courseIndex
    ? buildTimingConfigurationFromCourseIndex(courseIndex)
    : await loadTimingConfiguration(eventId);

  const participant = participantDoc || indexRow || null;
  if (!participant) return null;

  const participantProviderUuid = normalize(participant?.providerUuid || participant?.provider_uuid || participant?.providerParticipantUuid || participant?.providerParticipantUuid || participant?.provider?.providerUuid || participant?.provider?.uuid) || null;
  const participantUuid = normalize(participant?.participantUuid || participant?.participant_uuid || participant?.uuid || participant?.id) || null;
  const participantEmail = lower(participant?.email || participant?.emailLower || participant?.registration?.email || '');
  const participantAthleteUid = normalize(participant?.athleteUid || participant?.registration?.athleteUid || participant?.userId || '') || null;
  const providerLookup = participantProviderUuid ? lookupIndexValue(index, 'byProviderUuid', [participantProviderUuid]) || lookupIndexValue(index, 'byUuid', [participantProviderUuid]) : null;
  const uuidLookup = participantUuid ? lookupIndexValue(index, 'byUuid', [participantUuid]) : null;
  const emailLookup = participantEmail ? lookupIndexValue(index, 'byEmail', [participantEmail]) : null;
  const athleteUidLookup = participantAthleteUid ? lookupIndexValue(index, 'byAthleteUid', [participantAthleteUid.toLowerCase()]) : null;
  const bookingLookup = bookingId ? lookupIndexValue(index, 'byBookingId', [bookingId]) : null;
  const indexParticipant = providerLookup || uuidLookup || emailLookup || athleteUidLookup || bookingLookup || participant;

  const ticketId = normalize(
    participantLive?.ticketId || participantLive?.ticket_id || participant?.ticketId || participant?.ticket_id || participant?.registration?.ticketId || participant?.registration?.ticket_id || participant?.ticket?.id || '',
  ) || null;
  const subCategoryId = normalize(
    participantLive?.subCategoryId || participantLive?.selectedSubCategoryId || participantLive?.sub_category_id || participant?.subCategoryId || participant?.selectedSubCategoryId || participant?.sub_category_id || participant?.registration?.subCategoryId || participant?.registration?.selectedSubCategoryId || participant?.subCategory?.id || '',
  ) || null;
  const mappedContest = resolveContestFromTicketMappings(ticketMappings, ticketId, subCategoryId);
  const fallbackContestName = normalize(
    participantLive?.contestName
    || participantLive?.contest_name
    || participant?.contestName
    || participant?.contest_name
    || participant?.category
    || participant?.providerContestName
    || participant?.provider?.contestName
    || participant?.registration?.category
    || participant?.ticketName
    || participant?.registration?.ticketName
    || '',
  ) || null;
  const inferredContest = !mappedContest.contestUuid && fallbackContestName
    ? resolveContestFromTimingConfigurationByName(fallbackContestName, timingConfiguration)
    : { contestUuid: null as string | null, contestName: null as string | null };

  const contestUuid = normalize(
    mappedContest.contestUuid || inferredContest.contestUuid || participantLive?.contestUuid || participantLive?.contest_uuid || participant?.contestUuid || participant?.contest_uuid || participant?.providerContestUuid || '',
  ) || null;

  const contestName = normalize(
    mappedContest.contestName || inferredContest.contestName || participantLive?.contestName || participantLive?.contest_name || participant?.contestName || participant?.contest_name || fallbackContestName || getContestNameFromTimingConfiguration(contestUuid, timingConfiguration) || '',
  ) || null;

  return {
    participant: indexParticipant,
    participantLive: participantLive || null,
    timingConfiguration,
    bookingId: resolvedBookingId,
    contestUuid,
    contestName,
    merged: {
      ...participant,
      ...participantLive,
      bookingId: resolvedBookingId,
      contestUuid,
      contestName,
      providerContestUuid: normalize(mappedContest.contestUuid || inferredContest.contestUuid || participant?.providerContestUuid || participant?.provider?.contestUuid || contestUuid) || null,
      providerContestName: normalize(mappedContest.contestName || inferredContest.contestName || participant?.providerContestName || participant?.provider?.contestName || contestName) || null,
    },
  };
}
