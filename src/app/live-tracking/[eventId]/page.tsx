import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { parseISO, isPast, isToday } from 'date-fns';
import { getKV } from '@/lib/cloudflare/kv';
import { getLiveTimingDataAction } from '@/lib/actions';
import LiveTrackingClientPage from '@/components/live-tracking/LiveTrackingClientPage';
import type { EventCalendarEntry, LiveAthlete } from '@/lib/types';
import { loadParticipantIndex, getParticipantRowsFromIndex } from '@/lib/liveTrackingParticipantStore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getParticipantLiveTrackingPrivacy, maskPrivateAthlete } from '@/lib/liveTrackingPrivacy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props {
  params: { eventId: string };
}

async function loadEventFromKv(eventId: string) {
  const fromKv = (
    (await getKV<Record<string, any>>(`event:${eventId}:data`, 'live-tracking-page'))
    || (await getKV<Record<string, any>>(`live:event:${eventId}:data`, 'live-tracking-page'))
    || null
  );
  let fromFirestore: Record<string, any> | null = null;
  try {
    const eventSnap = await getFirestoreInstance().collection('events').doc(eventId).get();
    if (eventSnap.exists) {
      const event = eventSnap.data() || {};
      fromFirestore = {
        eventId,
        eventName: String((event as any).eventName || (event as any).name || 'Live Event'),
        eventDate: String((event as any).eventDate || (event as any).date || (event as any).startDate || 'TBD'),
        liveDataSource: String((event as any).liveDataSource || 'timing_partner'),
        source: 'firestore-master',
      } as Record<string, any>;
    }
  } catch {
    fromFirestore = null;
  }

  if (!fromKv && !fromFirestore) return null;

  return {
    ...fromKv,
    ...fromFirestore,
    eventId,
    eventName: String(fromFirestore?.eventName || fromKv?.eventName || fromKv?.name || 'Live Event').trim() || 'Live Event',
    eventDate: String(fromFirestore?.eventDate || fromKv?.eventDate || fromKv?.date || 'TBD').trim() || 'TBD',
    liveDataSource: String(fromFirestore?.liveDataSource || fromKv?.liveDataSource || 'timing_partner'),
  } as Record<string, any>;
}

function toEventCalendarEntry(eventId: string, event: Record<string, any>): EventCalendarEntry {
  return {
    id: String(event?.id || eventId),
    eventName: String(event?.eventName || event?.name || 'Live Event').trim() || 'Live Event',
    eventDate: String(event?.eventDate || event?.date || '').trim() || null,
    ...event,
  } as EventCalendarEntry;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await loadEventFromKv(params.eventId);
  return {
    title: event ? `${event.eventName || 'Live Tracking'} — Live Tracking` : 'Live Tracking',
    description: event ? `Real-time athlete tracking for ${event.eventName || 'this event'}` : 'Follow athletes live on course.',
  };
}

export default async function LiveTrackingPage({ params }: Props) {
  const { eventId } = params;
  const eventRaw = await loadEventFromKv(eventId);
  if (!eventRaw) notFound();
  const event = toEventCalendarEntry(eventId, eventRaw);

  const eventDate = String(event.eventDate || '').trim();
  const isPastEvent = !!(eventDate && eventDate !== 'TBD' && isPast(parseISO(eventDate)) && !isToday(parseISO(eventDate)));

  const liveResult = (event.liveDataSource === 'timing_partner' || event.liveDataSource === 'participants' || event.liveDataSource === 'racemap')
    ? await getLiveTimingDataAction(eventId, isPastEvent ? 'history' : 'live')
    : { success: false, message: 'Live data source not enabled', participants: [] as LiveAthlete[] };

  const participantIndex = await loadParticipantIndex(eventId);
  const indexRows = getParticipantRowsFromIndex(participantIndex);
  const byBib = new Map<string, any>();
  const byProvider = new Map<string, any>();
  const byUid = new Map<string, any>();
  for (const row of indexRows as any[]) {
    const bib = String(row?.bib || row?.bibNumber || '').trim();
    const providerUuid = String(row?.providerParticipantUuid || row?.participantUuid || row?.participant_uuid || row?.provider?.providerUuid || '').trim();
    const athleteUid = String(row?.bergmanAthleteId || row?.athleteUid || '').trim();
    if (bib) byBib.set(bib, row);
    if (providerUuid) byProvider.set(providerUuid, row);
    if (athleteUid) byUid.set(athleteUid, row);
  }

  const applyPrivacy = (row: any) => {
    const bib = String(row?.bib || row?.bibNumber || '').trim();
    const providerUuid = String(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.id || '').trim();
    const athleteUid = String(row?.athleteUid || row?.bergmanAthleteId || row?.bergmanAthleteUid || '').trim();
    const source = (providerUuid && byProvider.get(providerUuid)) || (bib && byBib.get(bib)) || (athleteUid && byUid.get(athleteUid)) || null;
    const privacy = getParticipantLiveTrackingPrivacy(source || row);
    const merged = { ...row, ...(source || {}), privacy, liveTrackingPrivacy: privacy };
    return privacy === 'PRIVATE' ? maskPrivateAthlete(merged) : merged;
  };

  const initialLiveData = liveResult.success && liveResult.participants ? liveResult.participants.map((row: any) => applyPrivacy(row)) : [];

  return (
    <LiveTrackingClientPage
      initialEventDetails={event}
      isPastEvent={isPastEvent}
      initialLiveData={initialLiveData}
    />
  );
}
