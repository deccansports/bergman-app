'use client';

import { useSearchParams } from 'next/navigation';
import { SplitMappingPanel } from '@/components/admin/SplitMappingPanel';

export const dynamic = 'force-dynamic';

export default function AdminLiveTrackingSplitMappingPage() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get('eventId') || '';

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur p-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-black tracking-tight">Split Mapping</h1>
          <p className="text-sm text-muted-foreground">
            Map imported provider splits to Bergman course structure so the athlete modal, leaderboard, progress, and live map all use the same configured hierarchy.
          </p>
        </div>
      </div>

      {eventId ? (
        <SplitMappingPanel eventId={eventId} />
      ) : (
        <div className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur p-5">
          <div className="text-muted-foreground">
            Please select a Bergman event first from the <a href="/admin/live-tracking" className="underline font-medium">Live Tracking Hub</a>.
          </div>
        </div>
      )}
    </div>
  );
}
