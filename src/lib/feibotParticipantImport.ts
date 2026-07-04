import { getKV } from '@/lib/cloudflare/kv';

type AnyRecord = Record<string, any>;

type ParticipantImportInput = {
  eventId: string;
  source: 'feibot-fdb' | 'feibot-cloud-api';
  provider?: string | null;
  rawParticipants: AnyRecord[];
  timingConfiguration?: AnyRecord | null;
  courseIndex?: AnyRecord | null;
  ticketMapping?: AnyRecord | null;
  contestIndex?: AnyRecord | null;
  ageGroupIndex?: AnyRecord | null;
  importBatch?: string | null;
  generatedAt?: string;
};

export type NormalizedParticipantRecord = {
  bookingId: string;
  participantUuid: string;
  provider: string;
  providerUuid: string;
  providerTimingUuid: string;
  providerAthleteUuid: string;
  providerContestUuid: string;
  providerContestName: string;
  providerAgeGroupUuid: string;
  athleteUid: string | null;
  bib: string;
  chip: string;
  contestUuid: string;
  contestName: string;
  ageGroupUuid: string;
  ageGroupName: string;
  gender: string;
  dob: string;
  name: string;
  nameLower: string;
  email: string;
  emailLower: string;
  phone: string;
  clubLower: string;
  country: string;
  countryCode: string;
  city: string;
  state: string;
  club: string;
  clubId: string | null;
  photoURL: string | null;
  importBatch: string;
  recordNumber: number | null;
  sequenceNumber: number | null;
  providerRecordId: string;
  registration: Record<string, any>;
  mapping: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  source: string;
  raw: Record<string, any>;
};

export type ParticipantIndexPayload = {
  eventId: string;
  generatedAt: string;
  provider: string;
  source: string;
  participants: string[];
  participantCount: number;
  count: number;
  byBib: Record<string, string>;
  byUuid: Record<string, string>;
  byUUID: Record<string, string>;
  byProviderUuid: Record<string, string>;
  byChip: Record<string, string>;
  byBookingId: Record<string, string>;
  byBooking: Record<string, string>;
  byEmail: Record<string, string>;
  byAthleteUid: Record<string, string>;
  byContest: Record<string, string[]>;
  byAgeGroup: Record<string, string[]>;
  byName: Record<string, string>;
};

export type ParticipantImportStats = {
  downloaded: number;
  normalized: number;
  matchedUsers: number;
  userLookupFailures: number;
  participantFailures: number;
  duplicateByProviderUuid: number;
  duplicateByBookingId: number;
};

const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  india: 'IN',
  'united states': 'US',
  usa: 'US',
  'usa / canada': 'US',
  canada: 'CA',
  australia: 'AU',
  germany: 'DE',
  france: 'FR',
  singapore: 'SG',
  'united arab emirates': 'AE',
  afghanistan: 'AF',
  brazil: 'BR',
  china: 'CN',
  egypt: 'EG',
  japan: 'JP',
  mexico: 'MX',
  nigeria: 'NG',
  russia: 'RU',
  'south africa': 'ZA',
  uk: 'GB',
  'united kingdom': 'GB',
  other: 'XX',
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return normalize(value).toLowerCase();
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = normalize(value);
    if (text) return text;
  }
  return '';
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry)).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, any>).map((entry) => normalize(entry)).filter(Boolean);
  }
  return [];
}

function normalizeLookupKey(value: unknown) {
  return lower(value).replace(/[^a-z0-9]/g, '');
}

function getContestName(contestIndex: AnyRecord | null | undefined, contestUuid: string, fallback: string) {
  const contest = contestIndex?.[contestUuid] || contestIndex?.[contestUuid.toLowerCase()] || null;
  return firstNonEmpty(contest?.contestName, contest?.name, contest?.label, contest?.Name, fallback);
}

function getAgeGroupName(ageGroupIndex: AnyRecord | null | undefined, ageGroupUuid: string, fallback: string) {
  const ageGroup = ageGroupIndex?.byUuid?.[normalizeLookupKey(ageGroupUuid)] || ageGroupIndex?.byUuid?.[ageGroupUuid] || null;
  return firstNonEmpty(ageGroup?.name, ageGroup?.label, ageGroup?.ageGroupName, fallback);
}

function getCountryCodeFromValue(value: unknown) {
  const text = normalize(value);
  if (!text) return '';
  if (text.length === 2) return text.toUpperCase();
  return COUNTRY_CODE_BY_NAME[lower(text)] || '';
}

function getRawContestUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.contestUuid,
    row?.contest_uuid,
    row?.contestid,
    row?.contestId,
    row?.contest,
    row?.category,
    row?.categoryUuid,
    row?.category_uuid,
  );
}

function getRawAgeGroupUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.ageGroupUuid,
    row?.age_group_uuid,
    row?.agegroupuuid,
    row?.ageGroup,
    row?.age_group,
  );
}

function getRawParticipantUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.participantUuid,
    row?.participant_uuid,
    row?.uuid,
    row?.UUID,
    row?.id,
    row?.providerUuid,
    row?.provider_uuid,
  );
}

function getRawBookingId(row: AnyRecord, fallback: string) {
  return firstNonEmpty(row?.bookingId, row?.booking_id, row?.registrationId, row?.registration_id, fallback);
}

function extractUserCandidate(row: AnyRecord) {
  return firstNonEmpty(
    row?.athleteUid,
    row?.uid,
    row?.userId,
    row?.user_id,
    row?.bergmanAthleteId,
    row?.bergman_uid,
    row?.providerAthleteUid,
  ) || null;
}

function extractUserEmail(row: AnyRecord) {
  return firstNonEmpty(row?.email, row?.e_mail, row?.Email, row?.userEmail) || null;
}

function extractRegistration(row: AnyRecord, source: string) {
  return {
    status: firstNonEmpty(row?.status, row?.registrationStatus, row?.registration_status) || '',
    ticketStatus: firstNonEmpty(row?.ticketStatus, row?.ticket_status, row?.status, row?.registrationStatus) || '',
    ticketName: firstNonEmpty(row?.ticketName, row?.ticket_name, row?.ticket, row?.category, row?.contestName) || '',
    ticketUuid: firstNonEmpty(row?.ticketUuid, row?.ticket_uuid, row?.ticketId, row?.ticket_id) || '',
    source,
  };
}

function buildUserLookups(users: AnyRecord[]) {
  const byUid: Record<string, AnyRecord> = {};
  const byEmail: Record<string, AnyRecord> = {};
  for (const user of users) {
    const uid = normalize(user?.uid || user?.id);
    if (uid) byUid[normalizeLookupKey(uid)] = user;
    const email = lower(user?.email || user?.emailAddress || user?.mail);
    if (email) byEmail[email] = user;
  }
  return { byUid, byEmail };
}

async function loadUserProfiles(eventId: string) {
  const userIds = asStringArray(await getKV<any>('users:index', `feibot-participant-import:${eventId}`));
  if (userIds.length === 0) return { byUid: {}, byEmail: {} };

  const profiles: AnyRecord[] = [];
  const chunkSize = 25;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const chunkProfiles = await Promise.all(
      chunk.map(async (uid) => {
        const normalizedUid = normalize(uid);
        if (!normalizedUid) return null;

        const fromUsersKey = await getKV<AnyRecord>(`users:${normalizedUid}`, `feibot-participant-import:${eventId}`);
        if (fromUsersKey && typeof fromUsersKey === 'object') {
          return { ...fromUsersKey, uid: (fromUsersKey as AnyRecord)?.uid || normalizedUid };
        }

        const fromLegacyProfile = await getKV<AnyRecord>(`user:${normalizedUid}:profile`, `feibot-participant-import:${eventId}`);
        if (fromLegacyProfile && typeof fromLegacyProfile === 'object') {
          return { ...fromLegacyProfile, uid: (fromLegacyProfile as AnyRecord)?.uid || normalizedUid };
        }

        return null;
      }),
    );

    for (const profile of chunkProfiles) {
      if (profile) profiles.push(profile);
    }
  }

  return buildUserLookups(profiles.filter(Boolean) as AnyRecord[]);
}

function resolveMatchedUser(userLookups: { byUid: Record<string, AnyRecord>; byEmail: Record<string, AnyRecord> }, row: AnyRecord) {
  const candidateUid = extractUserCandidate(row);
  if (candidateUid) {
    const matchedByUid = userLookups.byUid[normalizeLookupKey(candidateUid)] || null;
    if (matchedByUid) return matchedByUid;
  }

  const email = extractUserEmail(row);
  if (email) {
    return userLookups.byEmail[lower(email)] || null;
  }

  return null;
}

function resolveCountry(row: AnyRecord, user: AnyRecord | null) {
  const country = firstNonEmpty(user?.country, row?.country, row?.countryName, row?.country_code, row?.countryCode, row?.registration?.country, '');
  const countryCode = firstNonEmpty(user?.countryCode, row?.countryCode, row?.country_code, row?.registration?.countryCode, getCountryCodeFromValue(country)) || '';
  return { country, countryCode };
}

function resolveClub(row: AnyRecord, user: AnyRecord | null) {
  const club = firstNonEmpty(user?.clubName, row?.club, row?.clubName, row?.registration?.club, '') || '';
  const clubId = firstNonEmpty(user?.clubId, row?.clubId, row?.club_id, row?.registration?.clubId, '') || null;
  return { club, clubId };
}

function resolveName(row: AnyRecord) {
  return firstNonEmpty(row?.name, row?.fullName, row?.full_name, row?.athleteName, row?.athlete_name, row?.participantName, row?.participant_name, '') || '';
}

function resolvePhotoURL(user: AnyRecord | null) {
  return firstNonEmpty(
    user?.photoURL,
    user?.profile_image,
    user?.photoUrl,
    user?.profilePhoto,
    user?.picture,
    user?.avatar,
    user?.profileImage,
    '',
  ) || '';
}

function resolveGender(row: AnyRecord, user: AnyRecord | null) {
  return firstNonEmpty(user?.gender, row?.gender, row?.sex, row?.registration?.gender, '') || '';
}

function resolveDob(row: AnyRecord, user: AnyRecord | null) {
  return firstNonEmpty(user?.dob, user?.dateOfBirth, row?.dob, row?.dateOfBirth, row?.birth_date, row?.birthDate, row?.registration?.dob, '') || '';
}

function resolveContestUuidAndName(row: AnyRecord, contestIndex: AnyRecord | null | undefined) {
  const rawUuid = getRawContestUuid(row);
  const contestUuid = rawUuid || '';
  const contestName = firstNonEmpty(row?.contestName, row?.contest_name, row?.categoryName, row?.category, getContestName(contestIndex, contestUuid, '')) || '';
  return { contestUuid, contestName };
}

function getRawProviderContestUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.providerContestUuid,
    row?.provider_contest_uuid,
    row?.providerCategoryUuid,
    row?.provider_category_uuid,
    row?.providerContestId,
    row?.provider_contest_id,
    row?.contestProviderUuid,
    row?.contest_provider_uuid,
  );
}

function getRawProviderAgeGroupUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.providerAgeGroupUuid,
    row?.provider_age_group_uuid,
    row?.providerAgeGroupId,
    row?.provider_age_group_id,
  );
}

function getRawProviderTimingUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.providerTimingUuid,
    row?.provider_timing_uuid,
    row?.timingUuid,
    row?.timing_uuid,
    row?.detectionUuid,
    row?.detection_uuid,
    row?.readUuid,
    row?.read_uuid,
  );
}

function getRawProviderAthleteUuid(row: AnyRecord) {
  return firstNonEmpty(
    row?.providerAthleteUuid,
    row?.provider_athlete_uuid,
    row?.athleteUuid,
    row?.athlete_uuid,
    row?.providerUuid,
    row?.provider_uuid,
  );
}

function getRawProviderRecordId(row: AnyRecord) {
  return firstNonEmpty(
    row?.providerRecordId,
    row?.provider_record_id,
    row?.recordId,
    row?.record_id,
    row?.providerRowId,
    row?.provider_row_id,
    row?.id,
  );
}

function getRecordNumber(row: AnyRecord, fallback: number) {
  const text = firstNonEmpty(row?.recordNumber, row?.record_number, row?.recordNo, row?.record_no, '') || '';
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSequenceNumber(row: AnyRecord, fallback: number) {
  const text = firstNonEmpty(row?.sequenceNumber, row?.sequence_number, row?.sequenceNo, row?.sequence_no, '') || '';
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveContestDetails(row: AnyRecord, contestIndex: AnyRecord | null | undefined, courseIndex: AnyRecord | null | undefined, ticketMapping: AnyRecord | null | undefined) {
  const providerContestUuid = getRawProviderContestUuid(row) || '';
  const contestUuidCandidates = [
    getRawContestUuid(row),
    providerContestUuid,
    row?.contestId,
    row?.contest_id,
  ].filter(Boolean) as string[];
  const contestNameCandidates = [
    row?.contestName,
    row?.contest_name,
    row?.providerContestName,
    row?.provider_contest_name,
    row?.categoryName,
    row?.category_name,
    row?.category,
    row?.ticketName,
    row?.ticket_name,
  ];

  const providerContestName = firstNonEmpty(
    row?.providerContestName,
    row?.provider_contest_name,
    row?.categoryName,
    row?.category_name,
    row?.category,
    row?.ticketName,
    row?.ticket_name,
    '',
  ) || '';

  let contestUuid = firstNonEmpty(...contestUuidCandidates, '') || '';
  let contestName = firstNonEmpty(...contestNameCandidates, '', getContestName(contestIndex, contestUuid, '')) || '';

  const ticketContestUuid = firstNonEmpty(
    ticketMapping?.[providerContestUuid]?.contestUuid,
    ticketMapping?.[providerContestUuid]?.contest_uuid,
    ticketMapping?.[providerContestUuid]?.uuid,
    '',
  ) || '';
  const ticketContestName = firstNonEmpty(
    ticketMapping?.[providerContestUuid]?.contestName,
    ticketMapping?.[providerContestUuid]?.contest_name,
    ticketMapping?.[providerContestUuid]?.name,
    '',
  ) || '';

  if (!contestUuid && ticketContestUuid) contestUuid = ticketContestUuid;
  if (!contestName && ticketContestName) contestName = ticketContestName;

  if ((!contestUuid || !contestName) && courseIndex) {
    const contestFromCourse = courseIndex?.contests?.[contestUuid] || courseIndex?.contestIndex?.[contestUuid] || null;
    if (contestFromCourse) {
      contestUuid = contestUuid || firstNonEmpty(contestFromCourse?.contestUuid, contestFromCourse?.uuid, contestFromCourse?.id, '') || '';
      contestName = contestName || firstNonEmpty(contestFromCourse?.contestName, contestFromCourse?.name, contestFromCourse?.label, '') || '';
    }
  }

  return {
    contestUuid,
    contestName,
    providerContestUuid,
    providerContestName: providerContestName || contestName,
  };
}

function resolveAgeGroupDetails(row: AnyRecord, ageGroupIndex: AnyRecord | null | undefined) {
  const providerAgeGroupUuid = getRawProviderAgeGroupUuid(row) || '';
  const ageGroupUuid = firstNonEmpty(getRawAgeGroupUuid(row), providerAgeGroupUuid, '') || '';
  const ageGroupName = firstNonEmpty(
    row?.ageGroupName,
    row?.age_group_name,
    row?.ageGroupLabel,
    row?.age_group_label,
    getAgeGroupName(ageGroupIndex, ageGroupUuid, ''),
    '',
  ) || '';
  return {
    ageGroupUuid,
    ageGroupName,
    providerAgeGroupUuid,
  };
}

function resolveAgeGroupUuidAndName(row: AnyRecord, ageGroupIndex: AnyRecord | null | undefined) {
  const ageGroupUuid = getRawAgeGroupUuid(row);
  const ageGroupName = firstNonEmpty(row?.ageGroupName, row?.age_group_name, getAgeGroupName(ageGroupIndex, ageGroupUuid, '')) || '';
  return { ageGroupUuid, ageGroupName };
}

export async function buildFeibotParticipantImport(input: ParticipantImportInput): Promise<{
  participants: NormalizedParticipantRecord[];
  participantIndexPayload: ParticipantIndexPayload;
  stats: ParticipantImportStats;
}> {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const importBatch = input.importBatch || generatedAt;
  const courseIndex = input.courseIndex || input.timingConfiguration || null;
  const ticketMapping = input.ticketMapping || (input.timingConfiguration as AnyRecord | null | undefined)?.ticketMapping || (input.timingConfiguration as AnyRecord | null | undefined)?.ticketMappings || null;
  let userLookups: { byUid: Record<string, AnyRecord>; byEmail: Record<string, AnyRecord> } = { byUid: {}, byEmail: {} };
  try {
    userLookups = await loadUserProfiles(input.eventId);
  } catch {
    userLookups = { byUid: {}, byEmail: {} };
  }
  const participants: NormalizedParticipantRecord[] = [];
  const byProviderUuidIndex: Record<string, number> = {};
  const byBookingIdIndex: Record<string, number> = {};
  const stats: ParticipantImportStats = {
    downloaded: input.rawParticipants.length,
    normalized: 0,
    matchedUsers: 0,
    userLookupFailures: 0,
    participantFailures: 0,
    duplicateByProviderUuid: 0,
    duplicateByBookingId: 0,
  };

  for (let index = 0; index < input.rawParticipants.length; index += 1) {
    try {
      const row = input.rawParticipants[index] || {};
      const sourceBookingId = getRawBookingId(row, `${input.source === 'feibot-fdb' ? 'fdb' : 'cloud'}:${getRawParticipantUuid(row) || index + 1}`);
      const participantUuid = getRawParticipantUuid(row) || sourceBookingId;
      const providerUuid = firstNonEmpty(row?.providerUuid, row?.provider_uuid, row?.providerId, row?.provider_id, participantUuid) || participantUuid;
      const bib = firstNonEmpty(row?.bib, row?.bibNumber, row?.bib_number, row?.raceBib, '') || '';
      const chip = firstNonEmpty(row?.chip, row?.chipNumber, row?.chip_number, row?.chipCode, '') || '';
      const name = resolveName(row);
      const email = extractUserEmail(row) || '';
      const phone = firstNonEmpty(row?.phone, row?.mobile, row?.phoneNumber, row?.phone_number, '') || '';
      const contest = resolveContestDetails(row, input.contestIndex, courseIndex, ticketMapping);
      const ageGroup = resolveAgeGroupDetails(row, input.ageGroupIndex);

      const hasLookupCandidate = Boolean(extractUserCandidate(row) || extractUserEmail(row));
      const matchedUser = resolveMatchedUser(userLookups, row);
      if (hasLookupCandidate && !matchedUser) {
        stats.userLookupFailures += 1;
      }

      const athleteUid = matchedUser?.uid ? normalize(matchedUser.uid) : null;
      if (athleteUid) {
        stats.matchedUsers += 1;
      }

      const providerAthleteUuid = getRawProviderAthleteUuid(row) || athleteUid || '';
      const providerTimingUuid = getRawProviderTimingUuid(row) || providerUuid || '';
      const providerRecordId = getRawProviderRecordId(row) || sourceBookingId;
      const resolvedPhotoURL = resolvePhotoURL(matchedUser || row);
      const { country, countryCode } = resolveCountry(row, matchedUser);
      const { club, clubId } = resolveClub(row, matchedUser);
      const gender = resolveGender(row, matchedUser);
      const dob = resolveDob(row, matchedUser);
      const nameLower = lower(name);
      const emailLower = lower(email);
      const clubLower = lower(club);
      const registration = extractRegistration(row, input.source);
      const mapping = {
        matched: Boolean(matchedUser),
        source: matchedUser ? 'users-kv' : input.source,
        providerRecordId,
        providerTimingUuid,
        providerAthleteUuid,
        contestUuid: contest.contestUuid || '',
        contestName: contest.contestName || '',
        providerContestUuid: contest.providerContestUuid || '',
        providerContestName: contest.providerContestName || '',
        ageGroupUuid: ageGroup.ageGroupUuid || '',
        ageGroupName: ageGroup.ageGroupName || '',
        providerAgeGroupUuid: ageGroup.providerAgeGroupUuid || '',
      };

      const normalized: NormalizedParticipantRecord = {
        bookingId: sourceBookingId,
        participantUuid,
        provider: input.provider || 'feibot',
        providerUuid,
        providerTimingUuid,
        providerAthleteUuid,
        providerContestUuid: contest.providerContestUuid || contest.contestUuid || '',
        providerContestName: contest.providerContestName || contest.contestName || '',
        providerAgeGroupUuid: ageGroup.providerAgeGroupUuid || ageGroup.ageGroupUuid || '',
        athleteUid,
        bib,
        chip,
        contestUuid: contest.contestUuid || '',
        contestName: contest.contestName || '',
        ageGroupUuid: ageGroup.ageGroupUuid || '',
        ageGroupName: ageGroup.ageGroupName || '',
        gender,
        dob,
        name,
        nameLower,
        email,
        emailLower,
        phone,
        clubLower,
        country,
        countryCode,
        city: firstNonEmpty(matchedUser?.city, row?.city, row?.town, row?.registration?.city, '') || '',
        state: firstNonEmpty(matchedUser?.state, row?.state, row?.province, row?.registration?.state, '') || '',
        club,
        clubId,
        photoURL: resolvedPhotoURL || null,
        importBatch,
        recordNumber: getRecordNumber(row, index + 1),
        sequenceNumber: getSequenceNumber(row, index + 1),
        providerRecordId,
        registration,
        mapping,
        createdAt: generatedAt,
        updatedAt: generatedAt,
        source: input.source,
        raw: row,
      };

      const providerKey = normalizeLookupKey(providerUuid);
      const bookingKey = normalizeLookupKey(sourceBookingId);
      const existingIndex =
        (providerKey && Number.isFinite(byProviderUuidIndex[providerKey]) ? byProviderUuidIndex[providerKey] : undefined) ??
        (bookingKey && Number.isFinite(byBookingIdIndex[bookingKey]) ? byBookingIdIndex[bookingKey] : undefined);

      if (existingIndex !== undefined) {
        if (providerKey && Number.isFinite(byProviderUuidIndex[providerKey])) {
          stats.duplicateByProviderUuid += 1;
        }
        if (bookingKey && Number.isFinite(byBookingIdIndex[bookingKey])) {
          stats.duplicateByBookingId += 1;
        }
        participants[existingIndex] = normalized;
      } else {
        participants.push(normalized);
      }

      const finalIndex = existingIndex ?? (participants.length - 1);
      if (providerKey) byProviderUuidIndex[providerKey] = finalIndex;
      if (bookingKey) byBookingIdIndex[bookingKey] = finalIndex;
    } catch {
      stats.participantFailures += 1;
      continue;
    }
  }

  const byBib: Record<string, string> = {};
  const byUuid: Record<string, string> = {};
  const byUUID: Record<string, string> = {};
  const byProviderUuid: Record<string, string> = {};
  const byChip: Record<string, string> = {};
  const byBookingId: Record<string, string> = {};
  const byBooking: Record<string, string> = {};
  const byEmail: Record<string, string> = {};
  const byAthleteUid: Record<string, string> = {};
  const byContest: Record<string, string[]> = {};
  const byAgeGroup: Record<string, string[]> = {};
  const byName: Record<string, string> = {};

  for (const normalized of participants) {
    const bib = normalized.bib;
    const providerUuid = normalized.providerUuid;
    const participantUuid = normalized.participantUuid;
    const chip = normalized.chip;
    const sourceBookingId = normalized.bookingId;
    const emailLower = normalized.emailLower;
    const athleteUid = normalized.athleteUid;
    const nameLower = normalized.nameLower;

    if (bib) {
      byBib[bib] = participantUuid;
      const compactBib = bib.replace(/^0+/, '');
      if (compactBib) byBib[compactBib] = participantUuid;
    }
    if (providerUuid) {
      byProviderUuid[normalizeLookupKey(providerUuid)] = participantUuid;
    }
    if (participantUuid) {
      byUuid[normalizeLookupKey(participantUuid)] = participantUuid;
      byUUID[normalizeLookupKey(participantUuid)] = participantUuid;
    }
    if (chip) byChip[normalizeLookupKey(chip)] = participantUuid;
    if (sourceBookingId) {
      byBookingId[normalizeLookupKey(sourceBookingId)] = participantUuid;
      byBooking[normalizeLookupKey(sourceBookingId)] = participantUuid;
    }
    if (emailLower) byEmail[emailLower] = participantUuid;
    if (athleteUid) byAthleteUid[normalizeLookupKey(athleteUid)] = participantUuid;
    if (nameLower) byName[nameLower] = participantUuid;

    const contestKey = normalizeLookupKey(normalized.contestUuid);
    if (contestKey) {
      if (!byContest[contestKey]) byContest[contestKey] = [];
      byContest[contestKey].push(participantUuid);
    }
    const ageGroupKey = normalizeLookupKey(normalized.ageGroupUuid);
    if (ageGroupKey) {
      if (!byAgeGroup[ageGroupKey]) byAgeGroup[ageGroupKey] = [];
      byAgeGroup[ageGroupKey].push(participantUuid);
    }
  }

  stats.normalized = participants.length;

  const payload: ParticipantIndexPayload = {
    eventId: input.eventId,
    generatedAt,
    provider: input.provider || 'feibot',
    source: input.source,
    participants: participants.map((participant) => participant.participantUuid),
    participantCount: participants.length,
    count: participants.length,
    byBib,
    byUuid,
    byUUID,
    byProviderUuid,
    byChip,
    byBookingId,
    byBooking,
    byEmail,
    byAthleteUid,
    byContest,
    byAgeGroup,
    byName,
  };

  return { participants, participantIndexPayload: payload, stats };
}
