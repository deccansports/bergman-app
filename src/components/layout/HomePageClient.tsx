
// src/components/layout/HomePageClient.tsx
"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import type { EventCalendarEntry, HomepageSliderItem, RankedAthlete, ClubRankingEntry, LegacyAthlete, StoreProduct } from '@/lib/types';
import { Loader2, Ticket, ExternalLink, Info, MapPin, Calendar, Waves, Bike, Footprints, LogIn, ShieldCheck, Zap } from 'lucide-react';
import { AnimatedCountdown } from '../AnimatedCountdown';
import { motion, AnimatePresence } from 'framer-motion';
import { isValidImageUrl, cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { Badge } from '../ui/badge';
import { Separator } from '@/components/ui/separator';

import UpcomingEventsSection from './UpcomingEventsSection';
import SpotlightSection from './SpotlightSection';
import RewardsSection from './RewardsSection';
import MerchandiseSection from './MerchandiseSection';

const DisciplineIcon = ({ type }: { type: string }) => {
  const t = type.toUpperCase();
  if (t.includes('SWIM')) return <Waves className="h-3 w-3 text-sky-400" />;
  if (t.includes('TRIATHLON')) {
    return (
      <div className="flex items-center gap-1 shrink-0 text-left">
        <Waves className="h-3 w-3 text-sky-400" />
        <Bike className="h-3 w-3 text-orange-400" />
        <Footprints className="h-3 w-3 text-emerald-400" />
      </div>
    );
  }
  if (t.includes('DUATHLON')) {
    return (
      <div className="flex items-center gap-1 shrink-0 text-left">
        <Footprints className="h-3 w-3 text-orange-400" />
        <Bike className="h-3 w-3 text-orange-400" />
        <Footprints className="h-3 w-3 text-emerald-400" />
      </div>
    );
  }
  return <div className="h-3 w-3 rounded-full bg-slate-400" />;
};

const HeroSlider = ({ events, sliderItems }: { events: EventCalendarEntry[]; sliderItems: HomepageSliderItem[]; }) => {
  const [index, setIndex] = useState(0);
  
  const mediaItems = sliderItems;

  useEffect(() => {
    if (mediaItems.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % mediaItems.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [mediaItems.length]);

  const currentItem = mediaItems.length > 0 ? mediaItems[index] : null;
  const linkedEvent = currentItem ? events.find(e => e.id === currentItem.eventId) : null;

  const computedSchedule = useMemo(() => {
    if (!linkedEvent) return [];
    if (linkedEvent.disciplineSchedule && linkedEvent.disciplineSchedule.length > 0) return linkedEvent.disciplineSchedule;
    
    const scheduleMap = new Map<string, Set<string>>();
    linkedEvent.ticketDefinitions?.forEach(t => {
      const dateToUse = t.eventDate || linkedEvent.eventDate;
      if (dateToUse && dateToUse !== 'TBD') {
        const dateStr = dateToUse.split('T')[0];
        if (!scheduleMap.has(dateStr)) scheduleMap.set(dateStr, new Set());
        scheduleMap.get(dateStr)!.add(t.ticketName);
      }
    });
    
    return Array.from(scheduleMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, disciplines]) => ({ date, disciplines: Array.from(disciplines) }));
  }, [linkedEvent]);

  if (mediaItems.length === 0 || !currentItem) {
    return (
        <section className="relative w-full h-[60vh] md:h-[80vh] overflow-hidden bg-slate-900 flex items-center justify-center">
            <p className="text-white text-left">No slider items configured.</p>
        </section>
    );
  }
  
  const getRegisterLink = (e: EventCalendarEntry) => {
    if (e.customSlug) return `/event-form/${e.customSlug}`;
    if (e.registrationUrl) return e.registrationUrl;
    return '#';
  };
  const isExternalLink = (e: EventCalendarEntry) => !!e.registrationUrl && !e.customSlug;

  const orangeBtnClass = "bg-orange-600 hover:bg-orange-50 text-white font-black uppercase tracking-widest shadow-xl shadow-orange-600/30 border-none transition-all";

  return (
    <section className="relative w-full h-[65vh] md:h-[85vh] overflow-hidden bg-slate-900">
      <AnimatePresence initial={false}>
        <motion.div
          key={currentItem.src}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          {currentItem.type === 'video' ? (
            <video
              src={currentItem.src}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            >
              <source src={currentItem.src} type="video/mp4" />
            </video>
          ) : (
            <Image
              src={currentItem.src}
              alt={currentItem.alt}
              fill
              sizes="100vw"
              className="object-cover"
              priority
              data-ai-hint={currentItem.dataAiHint}
            />
          )}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-8 lg:p-12 text-white text-left">
        <div className="container px-4 md:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={linkedEvent ? linkedEvent.id : 'default'}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
            >
              {linkedEvent ? (
                <div className="max-w-4xl text-left">
                  <div className="flex flex-wrap items-center justify-start gap-3 mb-4 text-left">
                    {linkedEvent.isRaceWeekend && (
                        <Badge className="bg-primary text-orange-500 font-black uppercase tracking-[0.2em] px-4 py-1 border-none shadow-xl text-left">
                            Race Weekend
                        </Badge>
                    )}
                  </div>

                  <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-shadow-lg text-left uppercase italic leading-none">
                    {linkedEvent.eventName}
                  </h1>
                  
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-left">
                      <a 
                        href={linkedEvent.googleMapsUrl || '#'} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className={cn(
                            "flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors text-left",
                            linkedEvent.googleMapsUrl ? "text-orange-500 hover:text-orange-400" : "text-slate-400")
                        }
                      >
                          <MapPin className="h-4 w-4" />
                          {linkedEvent.venueName || 'Venue TBD'}
                      </a>
                      
                      <div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-300 text-left">
                        <Calendar className="h-4 w-4 text-orange-500" />
                        {computedSchedule && computedSchedule.length > 0
                          ? computedSchedule.map((day: any, idx: number) => (
                              <span key={day.date} className="flex items-center gap-1">
                                {format(parseISO(day.date), 'dd MMM yyyy')}
                                {idx < (computedSchedule.length || 0) - 1 && <span className="text-orange-400 mx-1">•</span>}
                              </span>
                            ))
                          : linkedEvent.eventDate && linkedEvent.eventDate !== 'TBD'
                          ? format(parseISO(linkedEvent.eventDate), 'dd MMM yyyy')
                          : 'Date TBD'
                        }
                      </div>
                  </div>

                  <div className="mt-6 py-4 px-6 bg-black/10 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl w-fit text-left overflow-hidden relative min-h-[64px]">
                      <div className="flex flex-wrap gap-y-4 gap-x-8 items-start text-left">
                          {computedSchedule && computedSchedule.length > 0 ? (
                              computedSchedule.map((day: any, idx: number) => (
                                  <div key={idx} className="flex items-start gap-3 text-left">
                                      <div className="text-left">
                                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 leading-none text-left">{format(parseISO(day.date), 'dd MMM')}</p>
                                          <div className="flex flex-col mt-1 text-left gap-1 text-left">
                                              {day.disciplines.map((d: string) => (
                                                  <div key={d} className="flex items-center gap-1.5 text-left">
                                                      <DisciplineIcon type={d} />
                                                      <span className="text-[10px] font-black text-white uppercase whitespace-nowrap tracking-tight text-left">{d}</span>
                                                  </div>
                                              ))}
                                          </div>
                                      </div>
                                      {idx < (computedSchedule.length || 0) - 1 && (
                                          <Separator orientation="vertical" className="h-8 bg-white/10 hidden sm:block ml-4" />
                                      )}
                                  </div>
                              ))
                          ) : (
                              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 italic text-left">Schedule finalized at registration</p>
                          )}
                      </div>
                  </div>

                  <div className="flex flex-col gap-4 mt-8 text-left">
                    <div className="flex justify-start text-left">
                        <AnimatedCountdown date={linkedEvent.eventDate && linkedEvent.eventDate !== 'TBD' ? linkedEvent.eventDate : undefined} />
                    </div>
                    <div className="flex flex-col gap-3 min-[400px]:flex-row justify-start text-left">
                        {linkedEvent.isSoldOut ? (
                        <Button size="lg" disabled className="h-12 md:h-14 px-6 md:px-10 rounded-xl bg-slate-800 text-slate-400 font-black uppercase tracking-widest border-none text-left text-xs md:text-sm">
                            <Info className="mr-2 h-4 w-4 md:h-5 md:w-5" /> Sold Out
                        </Button>
                        ) : (
                        <Button asChild size="lg" className={cn(orangeBtnClass, "h-12 md:h-14 px-4 md:px-6 text-xs md:text-sm")}>
                            <Link href={getRegisterLink(linkedEvent)} target={isExternalLink(linkedEvent) ? "_blank" : "_self"}>
                            <Ticket className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Register Now
                            {isExternalLink(linkedEvent) && <ExternalLink className="ml-1 h-3 w-3" />}
                            </Link>
                        </Button>
                        )}
                        <Button asChild size="lg" className="h-12 md:h-14 px-4 md:px-6 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-black uppercase tracking-widest shadow-xl border-none transition-all text-left text-xs md:text-sm">
                        <Link href={linkedEvent.customSlug ? `/races/${linkedEvent.customSlug}` : `/races/${linkedEvent.id}`}>
                            <Info className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Details
                        </Link>
                        </Button>
                    </div>
                </div>
              </div>
              ) : (
                <div className="text-left max-w-2xl">
                  <h1 className="text-4xl sm:text-7xl font-black tracking-tighter text-shadow-lg text-left uppercase italic leading-none">
                    Own Your <br/> <span className="text-orange-500">Finish Line.</span>
                  </h1>
                  <p className="text-base md:text-xl mt-6 text-slate-200 text-shadow leading-relaxed font-medium text-left">
                    The ultimate platform for India&apos;s endurance community. Track your progression, join a club, and conquer the most iconic courses.
                  </p>
                  <div className="flex flex-col gap-3 min-[400px]:flex-row mt-10 justify-start text-left">
                    <Button asChild size="lg" className="h-12 md:h-14 px-6 md:px-10 rounded-xl bg-orange-600 hover:bg-orange-50 font-black uppercase tracking-widest shadow-xl shadow-orange-600/20 text-left text-xs md:text-sm">
                      <Link href="/login">
                        <LogIn className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Athlete Login
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg" className="h-12 md:h-14 px-6 md:px-10 rounded-xl border-2 border-white/20 hover:bg-white/10 font-black uppercase tracking-widest !text-black text-left text-xs md:text-sm">
                       <Link href="/club-login">
                        <ShieldCheck className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Club Portal
                       </Link>
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 z-30">
        {mediaItems.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={cn(
                "h-1.5 transition-all duration-500 rounded-full bg-white",
                index === i ? "w-12" : "w-3 opacity-40 hover:opacity-100"
            )}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </section>
  );
};

interface HomePageClientProps {
  initialEvents: EventCalendarEntry[];
  initialSliderItems: HomepageSliderItem[];
  initialTopAthletes: { male: RankedAthlete[]; female: RankedAthlete[] };
  initialTopClubs: ClubRankingEntry[];
  legacyAthletes: LegacyAthlete[];
  initialProducts: StoreProduct[];
}


export default function HomePageClient({ 
  initialEvents, 
  initialSliderItems, 
  initialTopAthletes, 
  initialTopClubs, 
  legacyAthletes,
  initialProducts 
}: HomePageClientProps) {
  const [isLoading, setIsLoading] = useState(true);

  const filteredSliderItems = useMemo(() => 
    initialSliderItems.filter(item => item.showOnHomepage !== false), 
  [initialSliderItems]);

  useEffect(() => {
    if(initialEvents) {
      setIsLoading(false);
    }
  }, [initialEvents]);

  return (
    <>
      <HeroSlider events={initialEvents} sliderItems={filteredSliderItems} />
      
      <UpcomingEventsSection events={initialEvents} isLoading={isLoading} />
      
      <SpotlightSection 
        initialTopAthletes={initialTopAthletes}
        initialTopClubs={initialTopClubs}
        legacyAthletes={legacyAthletes}
      />

      <RewardsSection />

      <MerchandiseSection products={initialProducts} />
    </>
  );
}
