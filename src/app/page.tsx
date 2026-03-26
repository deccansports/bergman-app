
// src/app/page.tsx
import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import HomePageClient from '@/components/layout/HomePageClient';
import FaqChatbot from '@/components/FaqChatbot';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { getHomepageSliderItemsAction, getAthleteRankingData, getClubRankingData, getLegacyAthletesAction, getStoreProductsAction } from '@/lib/actions';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import type { RankedAthlete } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const eventsResult = await getCalendarEventsAction();
  const allEvents = eventsResult.success ? eventsResult.events || [] : [];
  
  const now = new Date();
  const upcomingEvents = allEvents.filter(event => {
    if (event.isHidden) return false;
    if (!event.eventDate) return true; // Keep TBD events
    try {
      // Use end of day to include events happening today
      return !isBefore(parseISO(event.eventDate), startOfDay(now));
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
        />
      </Suspense>
      <FaqChatbot />
    </>
  );
}
