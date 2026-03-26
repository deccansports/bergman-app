
// src/app/races/[slug]/page.tsx
import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import RacePageClient from '@/components/events/RacePageClient';
import { getEventBySlugAction } from '@/lib/actions';
import { notFound } from 'next/navigation';
import type { EventCalendarEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DynamicRacePage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const eventResult = await getEventBySlugAction(slug);
  
  if (!eventResult.success || !eventResult.event) {
    notFound();
  }
  
  return (
    <Suspense fallback={
        <div className="flex h-screen items-center justify-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    }>
      <RacePageClient initialEvent={eventResult.event as EventCalendarEntry} />
    </Suspense>
  );
}
