import nextDynamic from 'next/dynamic';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventCalendarEntry } from '@/lib/types';
import { serializeValue } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const BroadcastCenterTab = nextDynamic(() => import('@/components/admin/BroadcastCenterTab'), {
  ssr: false,
  loading: () => <div className="rounded-2xl border p-6 text-sm text-muted-foreground">Loading broadcast tools...</div>,
});

async function loadEvent(eventId: string): Promise<EventCalendarEntry | null> {
  const db = getFirestoreInstance();
  const [eventSnap, legacySnap] = await Promise.all([
    db.collection('events').doc(eventId).get(),
    db.collection('eventCalendar').doc(eventId).get(),
  ]);

  const snap = eventSnap.exists ? eventSnap : legacySnap;
  if (!snap.exists) return null;

  const data = serializeValue(snap.data() || {}) as Record<string, any>;
  return {
    id: snap.id,
    ...data,
    eventName: String(data?.eventName || data?.name || 'Untitled Event'),
    eventDate: data?.eventDate ? String(data.eventDate) : null,
  } as EventCalendarEntry;
}

export default async function EventBroadcastPage({ params }: { params: { eventId: string } }) {
  const eventId = String(params?.eventId || '').trim();
  const event = eventId ? await loadEvent(eventId) : null;

  return (
    <div className="container mx-auto py-6">
      <BroadcastCenterTab
        events={event ? [event] : []}
        isLoadingEvents={false}
        initialEventId={event?.id || eventId}
      />
    </div>
  );
}
