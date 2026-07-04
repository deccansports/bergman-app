'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import { getKV } from '../cloudflare/kv';
import { serializeValue } from '../utils';
import { getRegistrationsCollectionRef, getTimingParticipantsCollectionRef } from '../eventDataPaths';

export type LiveTrackingParticipantMappingStatus = 'mapped' | 'unmatched' | 'needs_review';

export interface LiveTrackingParticipantDirectoryRow {
  bergmanParticipantId: string | null;
  bergmanAthleteUid: string | null;
  bergmanName: string | null;
  athleteEmail: string | null;
  athletePhone: string | null;
  athletePhotoUrl: string | null;
  athleteCountry: string | null;
  bib: string | null;
  category: string | null;
  ageGroup: string | null;
  gender: string | null;
  registrationStatus: string | null;
  ticketName: string | null;
  providerParticipantUuid: string | null;
  providerName: string | null;
  providerBib: string | null;
  providerContestUuid: string | null;
  providerContestName: string | null;
  providerStatus: string | null;
  providerChip: string | null;
  mappingStatus: LiveTrackingParticipantMappingStatus;
  mappingScore: number;
  mappingSource: string | null;
  referralCode: string | null;
  referredBy: string | null;
  referrerName: string | null;
  referrerPhone: string | null;
  isReferralParticipant: boolean;
  updatedAt: string;
}

export interface LiveTrackingParticipantDirectorySummary {
  totalBergmanParticipants: number;
  totalProviderParticipants: number;
  matchedParticipants: number;
  unmatchedParticipants: number;
  referralParticipants: number;
}

export interface LiveTrackingParticipantDirectoryResponse {
  eventId: string;
  updatedAt: string;
  summary: LiveTrackingParticipantDirectorySummary;
  participants: LiveTrackingParticipantDirectoryRow[];
}

function normalize(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function lower(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
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

function extractReferral(row: Record<string, any>) {
  const referralCode = normalize(
    row?.referralCode ||
      row?.referral_code ||
      row?.referral ||
      row?.referredByCode ||
      row?.referredByReferralCode ||
      row?.refCode,
  );
  const referredBy = normalize(
    row?.referredBy ||
      row?.referred_by ||
      row?.referrer ||
      row?.referrerName ||
      row?.referredByName ||
      row?.referralSource,
  );
  const referrerName = normalize(row?.referrerName || row?.referrer_name || row?.referrerFullName || row?.referrer?.name || row?.referrer?.fullName || null);
  const referrerPhone = normalizePhone(row?.referrerPhone || row?.referrer_phone || row?.referrerMobile || row?.referrer?.phone || row?.referrer?.mobile || null);

  return {
    referralCode,
    referredBy,
    referrerName,
    referrerPhone,
    isReferralParticipant: Boolean(referralCode || referredBy || referrerName || referrerPhone),
  };
}

function extractAthletePhotoUrl(row: Record<string, any>) {
  return normalize(
    row?.photoUrl ||
      row?.photoURL ||
      row?.avatarUrl ||
      row?.avatarURL ||
      row?.profilePhotoUrl ||
      row?.profilePhotoURL ||
      row?.user?.photoUrl ||
      row?.user?.photoURL ||
      row?.user?.avatarUrl ||
      row?.user?.avatarURL,
  );
}

function scoreMatch(bergmanRow: Record<string, any>, providerRow: Record<string, any>) {
  const bergmanBib = normalize(bergmanRow?.bibNumber || bergmanRow?.bib);
  const bergmanUid = normalize(bergmanRow?.participantUuid || bergmanRow?.id || bergmanRow?.bookingId);
  const bergmanEmail = lower(bergmanRow?.email || bergmanRow?.buyerEmail);
  const bergmanPhone = normalizePhone(bergmanRow?.mobile || bergmanRow?.phone);
  const bergmanName = lower(splitName(normalize(bergmanRow?.name || bergmanRow?.fullName || bergmanRow?.buyerName)).fullName || bergmanRow?.name);

  const providerBib = normalize(providerRow?.bib || providerRow?.bib_no || providerRow?.bibNumber);
  const providerUuid = normalize(providerRow?.participant_uuid || providerRow?.participantUuid || providerRow?.providerUuid || providerRow?.id);
  const providerEmail = lower(providerRow?.email);
  const providerPhone = normalizePhone(providerRow?.mobile || providerRow?.phone);
  const providerName = lower(splitName(normalize(providerRow?.name || providerRow?.fullName)).fullName || providerRow?.name);

  if (bergmanBib && providerBib && bergmanBib === providerBib) return 100;
  if (bergmanUid && providerUuid && bergmanUid === providerUuid) return 95;
  if (bergmanEmail && providerEmail && bergmanEmail === providerEmail) return 85;
  if (bergmanPhone && providerPhone && bergmanPhone === providerPhone) return 75;
  if (bergmanName && providerName && bergmanName === providerName) return 60;
  return 0;
}

export async function getLiveTrackingParticipantDirectoryAction(eventId: string): Promise<{ success: boolean; message: string; data?: LiveTrackingParticipantDirectoryResponse }> {
  try {
    const normalizedEventId = normalize(eventId);
    if (!normalizedEventId) {
      return { success: false, message: 'Event ID is required.' };
    }

    const db = getFirestoreInstance();
    const [bergmanSnap, providerSnap, mappingKv, providerKv] = await Promise.all([
      getRegistrationsCollectionRef(db, normalizedEventId).get().catch(() => null),
      getTimingParticipantsCollectionRef(db, normalizedEventId).get().catch(() => null),
      getKV<Record<string, any>>(`event:${normalizedEventId}:participantMappings`, 'live-tracking-participant-directory').catch(() => null),
      getKV<Record<string, any>>(`live:event:${normalizedEventId}:providerParticipants:index`, 'live-tracking-participant-directory').catch(() => null),
    ]);

    const bergmanRows = (bergmanSnap?.docs || []).map((doc) => serializeValue({ id: doc.id, ...doc.data() }) as Record<string, any>);
    const providerRows = (providerSnap?.docs || []).map((doc) => serializeValue({ id: doc.id, ...doc.data() }) as Record<string, any>);
    const kvMappedRows = Array.isArray(providerKv?.participants) ? providerKv.participants : [];
    const mappingRows = Array.isArray(mappingKv?.mappings) ? mappingKv.mappings : [];

    const providerIndex = new Map<string, Record<string, any>>();
    for (const row of providerRows.concat(kvMappedRows)) {
      const keyCandidates = [
        normalize(row?.participant_uuid || row?.participantUuid || row?.providerUuid || row?.id),
        normalize(row?.bib || row?.bib_no || row?.bibNumber),
      ].filter(Boolean) as string[];
      for (const key of keyCandidates) providerIndex.set(key, row);
    }

    const mappingByBib = new Map<string, Record<string, any>>();
    const mappingByUid = new Map<string, Record<string, any>>();
    const mappingByProvider = new Map<string, Record<string, any>>();
    for (const row of mappingRows) {
      const bib = normalize(row?.bib);
      const uid = normalize(row?.bergmanAthleteUid || row?.bergmanParticipantId || row?.bergmanBookingId);
      const providerUuid = normalize(row?.feibotParticipantUUID || row?.providerParticipantUuid);
      if (bib) mappingByBib.set(bib, row);
      if (uid) mappingByUid.set(uid, row);
      if (providerUuid) mappingByProvider.set(providerUuid, row);
    }

    const participants: LiveTrackingParticipantDirectoryRow[] = [];

    for (const row of bergmanRows) {
      const bib = normalize(row?.bibNumber || row?.bib);
      const uid = normalize(row?.participantUuid || row?.id || row?.bookingId);
      const name = normalize(row?.name || row?.fullName || row?.buyerName);
      const referral = extractReferral(row);
      const byBib = bib ? mappingByBib.get(bib) : null;
      const byUid = uid ? mappingByUid.get(uid) : null;
      const matchedMapping = byBib || byUid || null;
      const providerUuid = normalize(matchedMapping?.feibotParticipantUUID || matchedMapping?.providerParticipantUuid);
      const providerRow = (providerUuid ? providerIndex.get(providerUuid) : null) || (bib ? providerIndex.get(bib) : null) || null;
      const providerContestUuid = normalize(matchedMapping?.contestUUID || providerRow?.contestUuid || providerRow?.contest_uuid);
      const providerContestName = normalize(matchedMapping?.contest_name || providerRow?.contestName || providerRow?.contest_name);
      const mappingScore = matchedMapping ? 100 : providerRow ? scoreMatch(row, providerRow) : 0;
      const mappingStatus: LiveTrackingParticipantMappingStatus = matchedMapping ? 'mapped' : providerRow ? (mappingScore >= 60 ? 'needs_review' : 'unmatched') : 'unmatched';

      participants.push({
        bergmanParticipantId: normalize(row?.id || row?.bookingId),
        bergmanAthleteUid: uid,
        bergmanName: name,
        athleteEmail: normalize(row?.email || row?.buyerEmail),
        athletePhone: normalizePhone(row?.mobile || row?.phone),
        athletePhotoUrl: extractAthletePhotoUrl(row),
        athleteCountry: normalize(row?.country || row?.nationality || row?.region),
        bib,
        category: normalize(row?.category || row?.raceCategory || row?.ticketName),
        ageGroup: normalize(row?.ageGroup || row?.selectedSubCategory || row?.category || row?.raceCategory),
        gender: normalize(row?.gender),
        registrationStatus: normalize(row?.registrationStatus || row?.ticketStatus || row?.status),
        ticketName: normalize(row?.ticketName || row?.raceCategory),
        providerParticipantUuid: providerUuid || normalize(providerRow?.participant_uuid || providerRow?.participantUuid || providerRow?.providerUuid || providerRow?.id),
        providerName: normalize(providerRow?.name || providerRow?.fullName),
        providerBib: normalize(providerRow?.bib || providerRow?.bib_no || providerRow?.bibNumber),
        providerContestUuid,
        providerContestName,
        providerStatus: normalize(providerRow?.status || providerRow?.registrationStatus),
        providerChip: normalize(providerRow?.chip || providerRow?.chip_code || providerRow?.chipCode || providerRow?.chip_id || providerRow?.chipId),
        mappingStatus,
        mappingScore,
        mappingSource: normalize(matchedMapping?.source || matchedMapping?.mappingSource || matchedMapping?.origin) || (matchedMapping ? 'manual-or-auto' : null),
        ...referral,
        updatedAt: new Date().toISOString(),
      });
    }

    const providerOnlyRows = providerRows.filter((providerRow) => {
      const providerUuid = normalize(providerRow?.participant_uuid || providerRow?.participantUuid || providerRow?.providerUuid || providerRow?.id);
      const providerBib = normalize(providerRow?.bib || providerRow?.bib_no || providerRow?.bibNumber);
      return !participants.some((participant) => participant.providerParticipantUuid === providerUuid || (providerBib && participant.bib === providerBib));
    });

    for (const providerRow of providerOnlyRows) {
      const providerUuid = normalize(providerRow?.participant_uuid || providerRow?.participantUuid || providerRow?.providerUuid || providerRow?.id);
      const providerBib = normalize(providerRow?.bib || providerRow?.bib_no || providerRow?.bibNumber);
      const referral = extractReferral(providerRow);
      participants.push({
        bergmanParticipantId: null,
        bergmanAthleteUid: null,
        bergmanName: normalize(providerRow?.name || providerRow?.fullName),
        athleteEmail: normalize(providerRow?.email),
        athletePhone: normalizePhone(providerRow?.mobile || providerRow?.phone),
        athletePhotoUrl: extractAthletePhotoUrl(providerRow),
        athleteCountry: normalize(providerRow?.country || providerRow?.nationality),
        bib: providerBib,
        category: normalize(providerRow?.category || providerRow?.contestName),
        ageGroup: normalize(providerRow?.ageGroup || providerRow?.age_group),
        gender: normalize(providerRow?.gender),
        registrationStatus: null,
        ticketName: null,
        providerParticipantUuid: providerUuid,
        providerName: normalize(providerRow?.name || providerRow?.fullName),
        providerBib,
        providerContestUuid: normalize(providerRow?.contestUuid || providerRow?.contest_uuid),
        providerContestName: normalize(providerRow?.contestName || providerRow?.contest_name),
        providerStatus: normalize(providerRow?.status || providerRow?.registrationStatus),
        providerChip: normalize(providerRow?.chip || providerRow?.chip_code || providerRow?.chipCode || providerRow?.chip_id || providerRow?.chipId),
        mappingStatus: 'unmatched',
        mappingScore: 0,
        mappingSource: null,
        ...referral,
        updatedAt: new Date().toISOString(),
      });
    }

    const summary: LiveTrackingParticipantDirectorySummary = {
      totalBergmanParticipants: bergmanRows.length,
      totalProviderParticipants: providerRows.length,
      matchedParticipants: participants.filter((row) => row.mappingStatus === 'mapped').length,
      unmatchedParticipants: participants.filter((row) => row.mappingStatus === 'unmatched').length,
      referralParticipants: participants.filter((row) => row.isReferralParticipant).length,
    };

    participants.sort((a, b) => {
      const scoreDelta = (b.mappingScore || 0) - (a.mappingScore || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(a.bib || '').localeCompare(String(b.bib || ''));
    });

    return {
      success: true,
      message: 'Participant directory loaded.',
      data: {
        eventId: normalizedEventId,
        updatedAt: new Date().toISOString(),
        summary,
        participants,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Failed to load live tracking participant directory.',
    };
  }
}
