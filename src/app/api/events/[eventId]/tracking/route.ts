import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { getParticipantRowsFromIndex } from '@/lib/liveTrackingParticipantStore';
import { canAccessPrivateLiveTracking, getParticipantLiveTrackingPrivacy, maskAnonymousAthlete } from '@/lib/liveTrackingPrivacy';
import { resolveLiveTrackingAccess } from '@/lib/liveTrackingAccess';

export const dynamic = 'force-dynamic';

function normalizeAthletes(value: any) {
  if (!Array.isArray(value)) return [];
  return value;
}

function normalizeAthleteFromIndex(row: any) {
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

function isCancelledOrInactiveStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return false;
  return (
    status.includes('cancel')
    || status.includes('refund')
    || status.includes('void')
    || status.includes('inactive')
    || status.includes('rejected')
  );
}

function normalizeTrackingAthlete(row: any) {
  const normalized = { ...(row || {}) };
  const splitCount = Array.isArray(normalized?.splits) ? normalized.splits.length : 0;
  const leg = String(normalized?.leg || '').trim().toUpperCase();
  const status = String(normalized?.status || '').trim();
  const registrationStatus = String(normalized?.registrationStatus || normalized?.ticketStatus || normalized?.registration?.status || '').trim();

  if (isCancelledOrInactiveStatus(status) || isCancelledOrInactiveStatus(registrationStatus)) {
    return null;
  }

  if (!status || (status.toLowerCase() === 'on course' && splitCount === 0 && (!leg || leg === 'NOT_STARTED'))) {
    normalized.status = 'Not Started';
    normalized.leg = 'NOT_STARTED';
  }

  const provider = normalized?.provider && typeof normalized.provider === 'object' ? normalized.provider : {};
  normalized.provider = {
    ...provider,
    mapped: provider?.mapped === true || Boolean(normalized?.contestUuid || normalized?.contest_uuid || normalized?.participantUuid || normalized?.participant_uuid),
  };

  return normalized;
}

function getTrackingAthleteDedupKey(row: any) {
  const bib = String(row?.bib || row?.bibNumber || '').trim();
  const contestKey = String(row?.contestUuid || row?.contest_uuid || row?.providerContestUuid || row?.ticketId || row?.liveTracking?.contestUuid || '').trim();
  if (bib) return `bib:${bib.toLowerCase()}${contestKey ? `:${contestKey.toLowerCase()}` : ''}`;

  const participantUuid = String(row?.participantUuid || row?.participant_uuid || row?.providerParticipantUuid || row?.providerUuid || row?.id || '').trim();
  if (participantUuid) return `participant:${participantUuid.toLowerCase()}`;

  const athleteUid = String(row?.athleteUid || row?.bergmanAthleteId || '').trim();
  if (athleteUid) return `athlete:${athleteUid.toLowerCase()}`;

  const name = String(row?.fullName || row?.name || '').trim();
  return name ? `name:${name.toLowerCase()}` : '';
}

export async function GET(_req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    const eventId = String(params.eventId || '').trim();
    if (!eventId) return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });

    const [athletes, monitoring, participantIndex, access] = await Promise.all([
      getKV<any[]>(`live:event:${eventId}:athletes`, 'api-events-tracking'),
      getKV<Record<string, any>>(`live:event:${eventId}:monitoring`, 'api-events-tracking'),
      getKV<Record<string, any>>(`live:event:${eventId}:participant:index`, 'api-events-tracking'),
      resolveLiveTrackingAccess(_req),
    ]);

    const liveAthletes = normalizeAthletes(athletes);
    const participantPayload = participantIndex || null;
    const indexRows = participantPayload ? getParticipantRowsFromIndex(participantPayload) : [];

    const liveByBib = new Map<string, any>();
    const liveByProviderUuid = new Map<string, any>();
    const liveByAthleteUid = new Map<string, any>();
    for (const row of liveAthletes) {
      const bib = String(row?.bib || row?.bibNumber || '').trim();
      const providerUuid = String(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.id || '').trim();
      const athleteUid = String(row?.athleteUid || row?.bergmanAthleteId || row?.bergmanAthleteUid || '').trim();
      if (bib) liveByBib.set(bib, row);
      if (providerUuid) liveByProviderUuid.set(providerUuid, row);
      if (athleteUid) liveByAthleteUid.set(athleteUid, row);
    }

    const sourceRows = indexRows.length > 0 ? indexRows : liveAthletes;

    const participants = sourceRows
      .map((row: any) => indexRows.length > 0 ? normalizeAthleteFromIndex(row) : { ...(row || {}) })
      .map((row: any) => {
        const bib = String(row?.bib || '').trim();
        const providerUuid = String(row?.provider?.providerUuid || row?.participantUuid || row?.participant_uuid || '').trim();
        const athleteUid = String(row?.bergmanAthleteId || row?.athleteUid || '').trim();
        const liveMatch = (providerUuid && liveByProviderUuid.get(providerUuid)) || (bib && liveByBib.get(bib)) || (athleteUid && liveByAthleteUid.get(athleteUid)) || null;
        const merged = { ...(row || {}), ...(liveMatch || {}) };
        const privacy = getParticipantLiveTrackingPrivacy(merged);
        if (liveMatch) {
          merged.provider = {
            ...(row?.provider || {}),
            ...(liveMatch?.provider || {}),
            mapped: true,
            providerUuid: liveMatch?.provider?.providerUuid || liveMatch?.providerUuid || providerUuid || null,
            contestUuid: liveMatch?.contestUuid || liveMatch?.contest_uuid || row?.contestUuid || row?.contest_uuid || null,
          };
          merged.contestUuid = merged.contestUuid || liveMatch?.contestUuid || liveMatch?.contest_uuid || null;
          merged.contest_uuid = merged.contest_uuid || merged.contestUuid || null;
          merged.publicEligible = true;
        }
        for (const key of ['category', 'contestName', 'contestUuid', 'registrationStatus', 'bib', 'email', 'athleteUid', 'participantUuid', 'participant_uuid', 'country', 'countryCode', 'country_code', 'countryName', 'countryAtRace', 'nationality']) {
          const current = merged?.[key];
          const fallback = row?.[key];
          if ((current === null || current === undefined || current === '') && fallback !== null && fallback !== undefined && fallback !== '') {
            merged[key] = fallback;
          }
        }
        if (!merged.name && merged.fullName) merged.name = merged.fullName;
        if (!merged.fullName && merged.name) merged.fullName = merged.name;
        merged.privacy = privacy;
        merged.liveTrackingPrivacy = privacy;
        merged.searchVisible = privacy !== 'PRIVATE' || canAccessPrivateLiveTracking(merged, access);
        merged.mapVisible = merged.searchVisible;
        merged.modalVisible = merged.searchVisible;

        const normalized = normalizeTrackingAthlete(merged);
        if (!normalized) return null;

        if (privacy === 'PRIVATE' && !canAccessPrivateLiveTracking(merged, access)) {
          return null;
        }

        if (privacy === 'ANONYMOUS' && access.isPublic) {
          return maskAnonymousAthlete({ ...normalized, mapVisible: true, searchVisible: false, modalVisible: true });
        }

        return normalized;
      })
      .filter((row: any) => Boolean(row));

    const dedupedParticipants = new Map<string, any>();
    for (const row of participants) {
      const key = getTrackingAthleteDedupKey(row);
      if (!key) continue;
      if (!dedupedParticipants.has(key)) {
        dedupedParticipants.set(key, row);
        continue;
      }
      dedupedParticipants.set(key, { ...dedupedParticipants.get(key), ...row });
    }

    const finalParticipants = Array.from(dedupedParticipants.values());
    const source = finalParticipants.length > 0 ? (indexRows.length > 0 ? 'eligible_master_index' : 'live_kv_fallback') : 'empty';

    return NextResponse.json({
      success: true,
      eventId,
      participants: finalParticipants,
      count: finalParticipants.length,
      source,
      updatedAt: monitoring?.lastSync || new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load tracking' }, { status: 500 });
  }
}
