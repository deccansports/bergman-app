// src/app/race-card/page.tsx
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Metadata } from 'next';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { isEventHidden } from '@/lib/utils';
import RaceCardGeneratorSection from '@/components/layout/RaceCardGeneratorSection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Race Card Generator | Bergman Triathlon',
  description: 'Create and share your Bergman Racing or Finisher card instantly. Generate a custom Instagram-ready race card.',
  openGraph: {
    title: 'Bergman Race Card Generator',
    description: 'Create your custom Bergman Racing or Finisher card.',
    images: ['/brand/bm-logo.png'],
  },
};

export default async function RaceCardPage() {
  const eventsResult = await getCalendarEventsAction();
  const allEvents = eventsResult.success ? eventsResult.events || [] : [];

  const now = new Date();
  const upcomingEvents = allEvents.filter((event) => {
    if (isEventHidden(event)) return false;
    if (!event.eventDate) return false;
    try {
      return !isBefore(parseISO(event.eventDate), startOfDay(now));
    } catch {
      return false;
    }
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 text-center">
          <p className="text-sm text-muted-foreground">
            Share this page:{' '}
            <span className="font-mono text-primary select-all">bergmantriathlon.com/race-card</span>
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex h-64 w-full items-center justify-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          }
        >
          <RaceCardGeneratorSection events={upcomingEvents} defaultExpanded={true} />
        </Suspense>
      </div>
    </main>
  );
}
