
// src/app/page.tsx
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import HomePageClient from '@/components/layout/HomePageClient';
import FaqChatbot from '@/components/FaqChatbot';
import { _computeCalendarEvents } from '@/lib/actions/eventActions';
import { getHomepageSliderItemsAction, getAthleteRankingData, getClubRankingData, getLegacyAthletesAction, getStoreProductsAction, listWaitlistFormsAction } from '@/lib/actions';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import type { RankedAthlete } from '@/lib/types';
import { isEventHidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function HomePage() {
  // Use fresh compute for homepage so hide/unhide changes reflect immediately.
  // Cached snapshot can lag if sync jobs are delayed.
  const eventsResult = await _computeCalendarEvents();
  const allEvents = eventsResult.success ? eventsResult.events || [] : [];
  
  const now = new Date();
  const getEffectiveEventDate = (event: any): string | null => {
    const fromSchedule = event?.disciplineSchedule?.[0]?.date;
    if (fromSchedule && String(fromSchedule).trim().toUpperCase() !== 'TBD') return String(fromSchedule);

    const fromEvent = event?.eventDate;
    if (fromEvent && String(fromEvent).trim().toUpperCase() !== 'TBD') return String(fromEvent);

    return null;
  };

  const upcomingEvents = allEvents.filter(event => {
    if (isEventHidden(event)) return false;

    const effectiveEventDate = getEffectiveEventDate(event);
    if (!effectiveEventDate) return true; // Keep TBD/no-date events

    try {
      // Use end of day to include events happening today
      return !isBefore(parseISO(effectiveEventDate), startOfDay(now));
    } catch {
      return false;
    }
  });

  const sliderItemsResult = await getHomepageSliderItemsAction();
  const allSliderItems = sliderItemsResult.success ? sliderItemsResult.items || [] : [];
  
  // Filter out items that are specifically for the login page or internal redirects
  const sliderItems = allSliderItems.filter(item => 
    item.pageSlug !== 'login' && 
    item.showOnHomepage !== false
  );
  
  const year = new Date().getFullYear();
  const athleteRankingResult = await getAthleteRankingData({ year });
  const clubRankingResult = await getClubRankingData({ year });
  const legacyAthletesResult = await getLegacyAthletesAction();
  const storeProductsResult = await getStoreProductsAction();
  const waitlistFormsResult = await listWaitlistFormsAction();
  const activeWaitlistEventIds = (waitlistFormsResult.success && waitlistFormsResult.forms)
    ? waitlistFormsResult.forms.filter((form) => form.isActive).map((form) => form.eventId)
    : [];

  const topAthletes: { male: RankedAthlete[]; female: RankedAthlete[] } = {
    male: athleteRankingResult.success && athleteRankingResult.rankings ? athleteRankingResult.rankings.filter(a => a.gender === 'Male').slice(0, 3) : [],
    female: athleteRankingResult.success && athleteRankingResult.rankings ? athleteRankingResult.rankings.filter(a => a.gender === 'Female').slice(0, 3) : [],
  };
  
  const topClubs = clubRankingResult.success ? clubRankingResult.rankings?.filter(c => c.overallRank).slice(0, 3) : [];
  const legacyAthletes = legacyAthletesResult.success ? legacyAthletesResult.legacyAthletes?.slice(0, 6) : []; 
  const products = storeProductsResult.success ? storeProductsResult.products?.filter(p => p.isActive).slice(0, 12) : [];

  return (
    <>
      <Suspense fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      }>
        <HomePageClient 
          initialEvents={upcomingEvents} 
          initialSliderItems={sliderItems} 
          initialTopAthletes={topAthletes}
          initialTopClubs={topClubs || []}
          legacyAthletes={legacyAthletes || []}
          initialProducts={products || []}
          activeWaitlistEventIds={activeWaitlistEventIds}
        />
      </Suspense>
      <FaqChatbot />
    </>
  );
}
