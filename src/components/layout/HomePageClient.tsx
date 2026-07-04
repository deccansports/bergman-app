
// src/components/layout/HomePageClient.tsx
"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import type { EventCalendarEntry, HomepageSliderItem, RankedAthlete, ClubRankingEntry, LegacyAthlete, StoreProduct } from '@/lib/types';
import { Loader2, Ticket, ExternalLink, Info, Calendar, LogIn, ShieldCheck, Zap } from 'lucide-react';
import { AnimatedCountdown } from '../AnimatedCountdown';
import { motion, AnimatePresence } from 'framer-motion';
import { isValidImageUrl, cn, getEventRegistrationButtonState, isTicketHidden } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { Badge } from '../ui/badge';
import { useTheme } from 'next-themes';

import UpcomingEventsSection from './UpcomingEventsSection';
import SpotlightSection from './SpotlightSection';
import EliteLeagueSection from './EliteLeagueSection';
import MerchandiseSection from './MerchandiseSection';
import RaceCardGeneratorSection from './RaceCardGeneratorSection';

type QuickNavItem = {
  id: string;
  label: string;
};

const HeroSlider = ({ events, sliderItems, activeWaitlistEventIds }: { events: EventCalendarEntry[]; sliderItems: HomepageSliderItem[]; activeWaitlistEventIds: string[]; }) => {
  const [index, setIndex] = useState(0);
  
  const mediaItems = sliderItems;

  useEffect(() => {
    if (mediaItems.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % mediaItems.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [mediaItems.length]);

  const getRegisterLink = (e: EventCalendarEntry) => {
    if (e.customSlug) return `/event-form/${e.customSlug}`;
    if (e.registrationUrl) return e.registrationUrl;
    return '#';
  };

  const currentItem = mediaItems.length > 0 ? mediaItems[index] : null;
  const linkedEvent = currentItem ? events.find(e => e.id === currentItem.eventId) : null;
  const slideTitle = (currentItem?.header || linkedEvent?.eventName || currentItem?.alt || '').trim();
  const slideDescription = (currentItem?.description || linkedEvent?.description || '').trim();
  const slideLink = (currentItem?.customUrl || (linkedEvent ? getRegisterLink(linkedEvent) : '') || '').trim();
  const slideLinkText = (currentItem?.customLinkText || (linkedEvent ? 'Register Now' : 'Learn More') || '').trim();
  const hasSlideLink = !!slideLink && slideLink !== '#';
  const hasSlideContent = !!(currentItem?.header || currentItem?.description || currentItem?.customUrl || currentItem?.customLinkText);
  const isCustomUrlSlide = !!currentItem?.customUrl && !linkedEvent;
  const isTbdEvent = linkedEvent?.eventDate === 'TBD';
  const desktopFocusX = currentItem?.desktopFocusX ?? 50;
  const desktopFocusY = currentItem?.desktopFocusY ?? 50;
  const desktopZoom = currentItem?.desktopZoom ?? 1;
  const mobileFocusX = currentItem?.mobileFocusX ?? desktopFocusX;
  const mobileFocusY = currentItem?.mobileFocusY ?? desktopFocusY;
  const mobileZoom = currentItem?.mobileZoom ?? 1;

  const computedSchedule = useMemo(() => {
    if (!linkedEvent) return [];
    const publicVisibleTickets = (linkedEvent.ticketDefinitions || []).filter((ticket) => {
      const maybeDeleted = (ticket as any)?.isDeleted || !!(ticket as any)?.deletedAt;
      return !isTicketHidden(ticket) && !maybeDeleted;
    });

    const visibleTicketNames = new Set(
      publicVisibleTickets
        .map((ticket) => (ticket.ticketName || '').trim())
        .filter(Boolean)
    );

    if (linkedEvent.disciplineSchedule && linkedEvent.disciplineSchedule.length > 0) {
      return linkedEvent.disciplineSchedule
        .map((day) => ({
          ...day,
          disciplines: (day.disciplines || []).filter((discipline) => {
            const label = (discipline || '').trim();
            if (!label) return false;
            if (visibleTicketNames.size === 0) return true;
            return visibleTicketNames.has(label);
          }),
        }))
        .filter((day) => day.disciplines.length > 0);
    }
    
    const scheduleMap = new Map<string, Set<string>>();
    publicVisibleTickets.forEach(t => {
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
  
  const isExternalLink = (e: EventCalendarEntry) => !!e.registrationUrl && !e.customSlug;

  const toSlug = (value: string) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const getWaitlistLink = (e: EventCalendarEntry) => {
    const slug = e.customSlug || toSlug(e.eventName || '');
    return slug ? `/waitlist/${slug}` : '/waitlist';
  };

  const hasSoldOutTickets = (e: EventCalendarEntry) =>
    (e.ticketDefinitions || []).some((ticket: any) => {
      const maybeDeleted = (ticket as any)?.isDeleted || !!(ticket as any)?.deletedAt;
      return !maybeDeleted && !isTicketHidden(ticket) && ticket.isSoldOut === true;
    });

  const renderSlideCopy = (mode: 'event' | 'fallback') => (
    <div className={cn(
      "mt-5 rounded-2xl border border-white/15 bg-black/60 backdrop-blur-xl shadow-2xl text-left overflow-y-auto overscroll-contain",
      mode === 'event' ? 'max-h-[28vh] md:max-h-none' : 'max-h-[34vh] md:max-h-none'
    )}>
      <div className="p-4 sm:p-6 space-y-4">
        {slideTitle && (mode === 'fallback' || slideTitle !== linkedEvent?.eventName) && (
          <h2 className={cn(
            "font-black uppercase italic tracking-tight text-left leading-tight",
            mode === 'event' ? "text-xl sm:text-3xl text-white" : "text-3xl sm:text-6xl text-white"
          )}>
            {slideTitle}
          </h2>
        )}
        {slideDescription && (
          <p className="max-w-3xl text-sm sm:text-base leading-relaxed text-white/90 text-left">
            {slideDescription}
          </p>
        )}
        {hasSlideLink && (
          <div className="flex flex-wrap gap-3 text-left">
            <Button asChild size="lg" className="h-11 sm:h-12 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-black uppercase tracking-widest shadow-lg border-none text-left text-xs sm:text-sm">
              <Link href={slideLink} target={slideLink.startsWith('http') ? '_blank' : '_self'} rel={slideLink.startsWith('http') ? 'noopener noreferrer' : undefined}>
                <ExternalLink className="mr-2 h-4 w-4" /> {slideLinkText}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const orangeBtnClass = "bg-orange-600 hover:bg-orange-700 text-white hover:text-white font-black uppercase tracking-widest shadow-xl shadow-orange-600/30 border-none transition-all";
  const waitlistBtnClass = "h-12 md:h-14 px-4 md:px-6 rounded-xl bg-sky-400 text-slate-950 hover:bg-sky-300 font-black uppercase tracking-widest shadow-xl shadow-sky-500/30 border border-white/20 transition-all text-xs md:text-sm";

  return (
    <section className="relative w-full h-[64vh] md:h-[78vh] overflow-hidden bg-slate-900">
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
            <>
              <Image
                src={currentItem.src}
                alt={currentItem.alt}
                fill
                sizes="100vw"
                className="hidden object-cover md:block"
                priority
                data-ai-hint={currentItem.dataAiHint}
                style={{ objectPosition: `${desktopFocusX}% ${desktopFocusY}%`, transform: `scale(${desktopZoom})` }}
              />
              <Image
                src={currentItem.mobileSrc || currentItem.src}
                alt={currentItem.alt}
                fill
                sizes="100vw"
                className="object-cover md:hidden"
                priority
                data-ai-hint={currentItem.mobileDataAiHint || currentItem.dataAiHint}
                style={{ objectPosition: `${mobileFocusX}% ${mobileFocusY}%`, transform: `scale(${mobileZoom})` }}
              />
            </>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/75 to-black/25" />
      <div className="absolute inset-0 flex items-end px-3 pb-4 pt-12 text-white text-left sm:px-4 md:px-8 md:pb-8 md:pt-28 lg:px-12 lg:pb-12">
        <div className="container w-full max-w-7xl px-0 sm:px-2 md:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={linkedEvent ? linkedEvent.id : 'default'}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
            >
              {isCustomUrlSlide ? (
                <div className="max-w-4xl text-left space-y-4 sm:space-y-5">
                  <div className="space-y-3 sm:space-y-4 max-w-4xl rounded-2xl border border-white/15 bg-black/55 backdrop-blur-xl shadow-2xl text-left overflow-y-auto overscroll-contain max-h-[34vh] md:max-h-none py-4 px-4 sm:px-6">
                    <h1 className="max-w-4xl text-sm sm:text-xl lg:text-3xl font-black tracking-tighter text-shadow-lg text-left uppercase italic leading-tight sm:leading-none text-white">
                      {slideTitle || 'Work With Team BERGMAN!!!'}
                    </h1>
                    <p className="max-w-3xl text-sm sm:text-lg leading-relaxed text-white/90 text-left">
                      {slideDescription || 'We are building a network of skilled triathletes, endurance athletes, and event professionals who can support our events across India on a freelance, paid basis.'}
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row justify-start text-left">
                      <Button asChild size="lg" className="h-12 md:h-14 w-full sm:w-auto justify-center px-4 md:px-6 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-black uppercase tracking-widest shadow-xl border-none transition-all text-left text-xs md:text-sm">
                        <Link href={slideLink} target={slideLink.startsWith('http') ? '_blank' : '_self'} rel={slideLink.startsWith('http') ? 'noopener noreferrer' : undefined}>
                          <ExternalLink className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> {slideLinkText || 'Enroll Now'}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : linkedEvent ? (
                <div className="max-w-4xl text-left space-y-4 sm:space-y-5">
                  <div className="space-y-2 sm:space-y-0">
                    <h1 className="hidden sm:block max-w-4xl text-sm sm:text-xl lg:text-3xl font-black tracking-tighter text-shadow-lg text-left uppercase italic leading-tight sm:leading-none">
                      {linkedEvent.eventName}
                    </h1>
                    <h1 className="block sm:hidden max-w-4xl text-base font-black tracking-tighter text-shadow-lg text-left uppercase italic leading-[0.95] text-white">
                      {linkedEvent.eventName}
                    </h1>
                  </div>
                  
                  <div className={cn(
                        "flex flex-wrap items-center gap-2 text-xs sm:text-sm font-bold uppercase tracking-widest text-slate-300 text-left"
                  )}>
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

                    {hasSlideContent && (
                      <div className="mt-4 border-t border-white/10 pt-4 text-left max-w-4xl">
                        {renderSlideCopy('event')}
                      </div>
                    )}

                  {/* Sold-out ticket badges */}
                  {(linkedEvent.ticketDefinitions || []).some((t: any) => !t?.isDeleted && !t?.deletedAt && !isTicketHidden(t) && t.isSoldOut === true) && (
                    <div className="mt-3 hidden sm:flex flex-wrap gap-2">
                      {(linkedEvent.ticketDefinitions || [])
                        .filter((t: any) => !t?.isDeleted && !t?.deletedAt && !isTicketHidden(t))
                        .map((t: any) => (
                          <span
                            key={t.id}
                            className={cn(
                              "text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border",
                              t.isSoldOut
                                ? "bg-red-900/60 border-red-500/50 text-red-300"
                                : "bg-green-900/40 border-green-500/40 text-green-300"
                            )}
                          >
                            {t.ticketName}{t.isSoldOut ? " · SOLD OUT" : " · OPEN"}
                          </span>
                        ))
                      }
                    </div>
                  )}

                  <div className="mt-5 sm:mt-6 flex flex-col gap-4 text-left">
                    <AnimatedCountdown date={linkedEvent.eventDate && linkedEvent.eventDate !== 'TBD' ? linkedEvent.eventDate : undefined} />
                    <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-row justify-start text-left">
                        {getEventRegistrationButtonState(linkedEvent) === 'sold_out' ? (
                        <Button size="lg" disabled className="h-12 md:h-14 w-full sm:w-auto justify-center px-6 md:px-10 rounded-xl bg-slate-800 text-slate-400 font-black uppercase tracking-widest border-none text-left text-xs md:text-sm">
                            <Info className="mr-2 h-4 w-4 md:h-5 md:w-5" /> Sold Out
                        </Button>
                        ) : getEventRegistrationButtonState(linkedEvent) === 'show' ? (
                        <Button asChild size="lg" className={cn(orangeBtnClass, "h-12 md:h-14 w-full sm:w-auto justify-center px-4 md:px-6 text-xs md:text-sm")}>
                            <Link href={getRegisterLink(linkedEvent)} target={isExternalLink(linkedEvent) ? "_blank" : "_self"}>
                            <Ticket className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Register Now
                            {isExternalLink(linkedEvent) && <ExternalLink className="ml-1 h-3 w-3" />}
                            </Link>
                        </Button>
                        ) : null}

                        {activeWaitlistEventIds.includes(linkedEvent.id) && (currentItem?.showWaitlistButton || getEventRegistrationButtonState(linkedEvent) === 'sold_out' || hasSoldOutTickets(linkedEvent)) && (
                          <Button asChild size="lg" className={cn(waitlistBtnClass, "w-full sm:w-auto justify-center")}>
                            <Link href={getWaitlistLink(linkedEvent)}>
                              <Zap className="mr-2 h-4 w-4 md:mr-3 md:h-5 md:w-5" /> Join Waitlist
                            </Link>
                          </Button>
                        )}

                        <Button asChild size="lg" className="h-12 md:h-14 w-full sm:w-auto justify-center px-4 md:px-6 rounded-xl bg-white text-slate-900 hover:bg-slate-100 font-black uppercase tracking-widest shadow-xl border-none transition-all text-left text-xs md:text-sm">
                        <Link href={linkedEvent.customSlug ? `/races/${linkedEvent.customSlug}` : `/races/${linkedEvent.id}`}>
                            <Info className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Details
                        </Link>
                        </Button>
                    </div>
                </div>
              </div>
              ) : (
                <div className="text-left max-w-2xl w-full space-y-4 sm:space-y-5">
                  <div className="space-y-3 sm:space-y-4">
                    <h2 className="text-2xl sm:text-4xl lg:text-6xl font-black tracking-tighter text-white uppercase italic leading-tight sm:leading-none text-left text-shadow-lg">
                      Own Your
                      <br />
                      Finish Line.
                    </h2>
                    <p className="max-w-2xl text-sm sm:text-lg leading-relaxed text-white/80 text-left">
                      The ultimate platform for India&apos;s endurance community. Track your progression, join a club, and conquer the most iconic courses.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-row justify-start text-left">
                    <Button asChild size="lg" className="h-12 md:h-14 w-full sm:w-auto justify-center px-6 md:px-10 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest shadow-xl shadow-orange-600/20 text-left text-xs md:text-sm">
                      <Link href="/login">
                        <LogIn className="mr-2 h-4 w-4 md:mr-3 md:h-6 md:w-6" /> Athlete Login
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg" className="h-12 md:h-14 w-full sm:w-auto justify-center px-6 md:px-10 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-black uppercase tracking-widest text-left text-xs md:text-sm border-none shadow-xl">
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
  activeWaitlistEventIds: string[];
}


export default function HomePageClient({ 
  initialEvents, 
  initialSliderItems, 
  initialTopAthletes, 
  initialTopClubs, 
  legacyAthletes,
  initialProducts,
  activeWaitlistEventIds 
}: HomePageClientProps) {
  const [isLoading, setIsLoading] = useState(true);
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  const quickNavItems: QuickNavItem[] = [
    { id: 'upcoming-events', label: 'Upcoming Events' },
    { id: 'community-spotlight', label: 'Community Spotlight' },
    { id: 'bel', label: 'BEL' },
    { id: 'shop', label: 'Shop' },
    { id: 'event-image-generator', label: 'Event Image Generator' },
  ];

  const filteredSliderItems = useMemo(() => 
    initialSliderItems.filter(item => item.showOnHomepage !== false), 
  [initialSliderItems]);

  useEffect(() => {
    if(initialEvents) {
      setIsLoading(false);
    }
  }, [initialEvents]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{
        backgroundColor: isDarkMode ? '#020617' : '#FFFFFF',
        backgroundImage: isDarkMode
          ? 'linear-gradient(180deg, rgba(2,6,23,1) 0%, rgba(15,23,42,1) 100%)'
          : "url('/patterns/bergman-abstract-grid.svg')",
        backgroundRepeat: isDarkMode ? 'no-repeat' : 'repeat',
        backgroundSize: isDarkMode ? 'cover' : '480px 480px',
        backgroundAttachment: 'scroll',
      }}
    >
      <HeroSlider events={initialEvents} sliderItems={filteredSliderItems} activeWaitlistEventIds={activeWaitlistEventIds} />

      <section className="container mx-auto px-4 pt-4 pb-2 md:pt-5 md:pb-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {quickNavItems.map((item) => (
            <Button
              key={item.id}
              type="button"
              onClick={() => scrollToSection(item.id)}
              className="rounded-full px-5 py-2 text-xs md:text-sm font-black uppercase tracking-wider shadow-lg transition-all bg-slate-900 hover:bg-slate-800 text-white border border-slate-700"
            >
              {item.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] md:text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Scroll Shortcuts: Upcoming Events • Community Spotlight • BEL • Shop • Event Image Generator
        </p>
      </section>
      
      <div id="upcoming-events">
        <UpcomingEventsSection events={initialEvents} isLoading={isLoading} activeWaitlistEventIds={activeWaitlistEventIds} />
      </div>
      
      <div id="community-spotlight">
        <SpotlightSection 
          initialTopAthletes={initialTopAthletes}
          initialTopClubs={initialTopClubs}
          legacyAthletes={legacyAthletes}
        />
      </div>

      <div id="bel">
        <EliteLeagueSection />
      </div>

      <div id="shop">
        <MerchandiseSection products={initialProducts} />
      </div>

      <div id="event-image-generator">
        <RaceCardGeneratorSection events={initialEvents} />
      </div>
    </div>
  );
}
