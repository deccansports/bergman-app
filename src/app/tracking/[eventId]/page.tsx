import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface LiveTrackingPageProps {
  params: { eventId: string };
}

export default function TrackingEventPage({ params }: LiveTrackingPageProps) {
  redirect(`/live-tracking/${encodeURIComponent(params.eventId)}`);
}
