// src/components/events/RacePageClient.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getHomepageSliderItemsAction } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { format, parseISO, startOfDay, isBefore, isValid } from 'date-fns';
import Image from 'next/image';
import { 
  Loader2, Ticket, BookOpen, ExternalLink, Waves, Bike as BikeIcon, 
  Footprints, Plane, MapPin, Map as MapIcon, Route, FileText, Download, 
  TrendingUp, Mountain, Minus, Hourglass, Info, CalendarDays, Flag, 
  CheckCircle2, XCircle, Clock, Ban 
} from 'lucide-react';
import Link from 'next/link';
import type { EventCalendarEntry, HomepageSliderItem, TicketDefinition, Sponsor, PricingTier, SwimDistanceCategory } from '@/lib/types';
import CourseMapDialog from '@/components/events/CourseMapDialog';
import { isDuathlonEvent, formatSecondsToHMS, hmsToSeconds, getCountryFlagEmoji, getInitials, cn, isValidImageUrl } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

const formatCurrencyLocal = (paisa: number | null | undefined) => {
  if (paisa === null || paisa === undefined) return '₹0.00';
  return `₹${(paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const PricingTiersList = ({ tiers, basePrice, participantsCount = 0 }: { tiers?: PricingTier[], basePrice: number | null | undefined, participantsCount?: number }) => {
  if (!tiers || tiers.length === 0) {
    return (
      <div className="space-y-2 text-left">
        <p className="text-3xl font-black text-primary text-left">
          {formatCurrencyLocal(basePrice)}
        </p>
      </div>
    );
  }

  const now = startOfDay(new Date());
  let activeTier: PricingTier | null = null;

  for (const tier of tiers) {
    const expiredDate = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
    const expiredSlots = tier.slotLimit ? participantsCount >= tier.slotLimit : false;
    if (!expiredDate && !expiredSlots) {
      activeTier = tier;
      break;
    }
  }

  return (
    <div className="space-y-4 text-left">
      <div className="border rounded-xl p-4 bg-primary/5 text-center">
        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-left">
          Current Active Price
        </p>
        <p className="text-3xl font-black text-primary my-1 text-left">
          {formatCurrencyLocal(activeTier?.pricePaisa ?? basePrice)}
        </p>
        <p className="text-[10px] font-bold uppercase tracking-tighter text-left text-orange-600">
          {activeTier ? `${activeTier.name} ACTIVE` : "Standard Pricing"}
        </p>
      </div>

      <div className="space-y-2 text-left">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
          Pricing Progress
        </p>
        {tiers.map((tier, idx) => {
          const expiredDate = tier.endDate ? isBefore(parseISO(tier.endDate), now) : false;
          const expiredSlots = tier.slotLimit ? participantsCount >= tier.slotLimit : false;
          const isClosed = expiredDate || expiredSlots;
          const isActive = activeTier?.name === tier.name;
          
          const slotsRemaining = tier.slotLimit ? tier.slotLimit - participantsCount : Infinity;
          const isFillingFast = isActive && slotsRemaining > 0 && slotsRemaining <= 5;

          return (
            <div
              key={idx}
              className={cn(
                "flex justify-between items-center p-3 rounded-xl border font-bold transition-all duration-300 text-sm text-left",
                isActive ? "bg-primary/10 border-primary text-primary scale-[1.02] shadow-sm" : "bg-background border-transparent text-muted-foreground",
                isClosed && "opacity-40 line-through grayscale bg-muted/10"
              )}
            >
              <div className="text-left">
                <div className="flex items-center gap-2 font-bold text-left">
                  {isClosed ? <XCircle className="h-3.5 w-3.5 text-destructive"/> : isActive ? <CheckCircle2 className="h-3.5 w-3.5 text-primary animate-pulse"/> : <Clock className="h-3.5 w-3.5 text-slate-400"/>}
                  <span>{tier.name}</span>
                </div>
                <p className="text-[10px] uppercase mt-0.5 tracking-tighter text-left">
                  {isClosed ? "Closed" : isActive ? (isFillingFast ? "OPEN - FILLING FAST!" : "Active — Join Now") : "Opening Soon"}
                </p>
              </div>
              <span className="text-sm font-black italic ml-auto">
                {formatCurrencyLocal(tier.pricePaisa)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const rulesAndRegulationsText = `
**General Rules**
The Organisers reserve the right to limit or refuse entries at their discretion.
Participants may be removed from the race if deemed physically incapable of continuing the race.
The Organisers may modify rules and regulations without prior notice.
The race route may be changed with advance notice to participants.
It is the participant’s responsibility to be familiar with all rules and avoid any violations.
Race entry and bib numbers are strictly non-transferable and non-refundable.
The Organisers reserve the right to cancel any offline registration without notice. In such cases, the paid amount will be refunded.

**Cancellation Policy**
6+ Months before event: 70% refund (excluding GST and processing charges).
4 months before the event: 50% refund (excluding GST).
3 months before the event: 20% refund (excluding GST).
2 months or less before the event: No refund.
Post-registration confirmation or within 6 months of the event: Only 70% refund (excluding GST).

**Deferral, Transfer & Category Change Policy**
All deferral, transfer, or category change requests must be made at least 60 days prior to the event via the official form.
Deferral to the next year’s event will require paying the entry fee difference if applicable.
Once approved, no further deferral or transfer requests will be accepted.
Deferral is valid for 1 year from the original event date.
Charges:
- Deferral / Name Transfer / Category Change: ₹2,499
- Category change (lower to higher): ₹2,499 + fee difference + GST
- Category change (higher to lower): ₹2,499 (No refund of fee difference)

**Weather Disclaimer**
In case of bad weather, the Organisers may:
- Delay the race start
- Shorten or modify the course
- Cancel the event entirely (No refund applicable)
If swimming conditions are unsafe, the swim leg may be replaced with a run.
Use of banned substances is prohibited. Random doping tests may be conducted.
Outside support, including hydration/nutrition refills outside aid stations, is not allowed.
Respect for volunteers, spectators, and staff is mandatory.
Littering outside of designated bins is strictly prohibited.
Athletes are responsible for their own progress and must not assist others unless pre-approved by the Event Director. Violators will be disqualified.
No nudity outside changing areas; headphones are not permitted at any point during the race.
Participants must be familiar with the course and follow the marked route at all times.

---

**Terms and Conditions – Bergman Triathlon**
1. Registration
By registering for Bergman Triathlon, you agree to abide by all event rules, regulations, and decisions made by the organizers.
Registrations are accepted on a first-come, first-served basis and are only confirmed upon successful payment.
You must be 18 years of age or older on race day to participate.
All information submitted during registration must be accurate and truthful.
Bib number and registration are non-transferable and non-refundable, except as per the deferral/cancellation policies outlined below.
2. Code of Conduct
Participants must follow race instructions, maintain sportsmanship, and treat volunteers, officials, and fellow athletes with respect.
Use of banned substances or outside assistance during the race will result in disqualification.
3. Rights Reserved
The organizers reserve the right to:
- Modify or cancel the event due to unforeseen circumstances (weather, safety, force majeure).
- Amend rules and policies at any time without prior notice.
- Disqualify participants for non-compliance with the rules or for misconduct.
`;

const CourseProfileIcon = ({ type, characteristic }: { type: 'swim' | 'bike' | 'run', characteristic?: string | null }) => {
    let Icon: React.ElementType = Waves;
    let iconColor = 'text-sky-500';
    let bgColor = 'bg-sky-500/10';

    if (type === 'bike') {
      Icon = BikeIcon;
      iconColor = 'text-green-500';
      bgColor = 'bg-green-500/10';
    } else if (type === 'run') {
      Icon = Footprints;
      iconColor = 'text-orange-500';
      bgColor = 'bg-orange-500/10';
    }
    
    let TerrainIcon: React.ElementType | null = null;
    if (characteristic) {
        const lowerChar = characteristic.toLowerCase();
        if (lowerChar.includes('rolling')) TerrainIcon = TrendingUp;
        else if (lowerChar.includes('hilly')) TerrainIcon = Mountain;
        else if (lowerChar.includes('flat')) TerrainIcon = Minus;
    }

    return (
        <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${bgColor} text-left`}>
            <Icon className={`h-6 w-6 ${iconColor} text-left`} />
            {TerrainIcon && type !== 'swim' && (
                 <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background border text-left">
                    <TerrainIcon className={`h-3.5 w-3.5 ${iconColor} text-left`} />
                 </div>
            )}
        </div>
    );
  };

export default function RacePageClient({ initialEvent }: { initialEvent: EventCalendarEntry }) {
  const router = useRouter();
  const { toast } = useToast();
  
  const [event] = useState<EventCalendarEntry>(initialEvent);
  const [heroMedia, setHeroMedia] = useState<HomepageSliderItem | null>(null);
  const [isLoadingMedia, setIsLoadingMedia] = useState(true);
  
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isCutoffModalOpen, setIsCutoffModalOpen] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  
  const [selectedTicketIdForMap, setSelectedTicketIdForMap] = useState<string | null>(null);

  useEffect(() => {
    getHomepageSliderItemsAction().then(sliderResult => {
        if (sliderResult.success && sliderResult.items) {
            const linkedItem = sliderResult.items.find(item => item.eventId === event.id);
            setHeroMedia(linkedItem || null);
        }
    }).finally(() => setIsLoadingMedia(false));
  }, [event.id]);

  useEffect(() => {
    document.title = `${event.eventName} | BERGMAN Triathlon`;
  }, [event]);
  
  const openCourseMapModalWithTicket = (ticketId: string) => {
    setSelectedTicketIdForMap(ticketId);
    setIsMapModalOpen(true);
  }
  
  const hasTicketsDefined = event.ticketDefinitions && event.ticketDefinitions.length > 0;
  const hasValidExternalRegUrl = typeof event.registrationUrl === 'string' && event.registrationUrl.trim() !== '' && event.registrationUrl.startsWith('http');
  const canUseInternalForm = event.customSlug && (hasTicketsDefined || !hasValidExternalRegUrl);

  const registrationLink = canUseInternalForm ? `/event-form/${event.customSlug}` : (hasValidExternalRegUrl ? event.registrationUrl : '#');
  const isExternalLink = !canUseInternalForm && hasValidExternalRegUrl;
  const canRegister = registrationLink !== '#';
  
  const hasCourseMaps = event.ticketDefinitions?.some(td => 
    td.courseMaps?.swimGpxUrl || 
    td.courseMaps?.bikeGpxUrl || 
    td.courseMaps?.runGpxUrl ||
    td.courseMaps?.run1GpxUrl ||
    td.courseMaps?.run2GpxUrl
  );

  const hasCutoffs = event.ticketDefinitions?.some(td => {
      const basicCutoff = td.cutoffs && (td.cutoffs.overall || td.cutoffs.swim || td.cutoffs.bike || td.cutoffs.run || td.cutoffs.run1 || td.cutoffs.run2);
      const subCategoryCutoff = td.subCategories?.some(s => !!s.cutoff);
      return basicCutoff || subCategoryCutoff;
  });
  
  const rulesToDisplay = event.customRules || rulesAndRegulationsText;
  const hasCustomRules = !!event.customRules;

  const htmlToRender = hasCustomRules
    ? rulesToDisplay
    : rulesToDisplay
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.*$)/gm, '<li class="list-disc ml-6">$1</li>');

  const orangeBtnClass = "bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest min-w-[160px] h-14 text-left shadow-lg shadow-orange-600/20 transition-all";
  const secondaryBtnClass = "font-bold uppercase text-xs tracking-widest min-w-[160px] h-14 border-2 border-primary/20 hover:border-primary hover:bg-primary/5 text-foreground transition-all";

  let registrationButton;
  if (event.isSoldOut) {
    registrationButton = <Button className="w-full h-12 bg-red-600/20 text-red-500 border-red-500/50" disabled><Ban className="mr-2 h-4 w-4" /> Sold Out</Button>;
  } else if (canRegister) {
    registrationButton = (
      <Button asChild size="lg" className={orangeBtnClass}>
        <Link href={registrationLink || '#'} target={isExternalLink ? "_blank" : "_self"} className="text-left">
          <span className="relative z-10 flex items-center justify-center">
            <Ticket className="mr-2 h-5 w-5 text-left"/> Register Now
            {isExternalLink && <ExternalLink className="ml-1 h-3 w-3 text-left"/>}
          </span>
        </Link>
      </Button>
    );
  } else {
    registrationButton = <Button className="w-full h-12" disabled><Info className="mr-2 h-4 w-4" /> Unavailable</Button>;
  }

  const validPhotoUrl = isValidImageUrl(event.photoUrl) ? event.photoUrl : 'https://picsum.photos/seed/default/1200/800';

  return (
    <>
        <header className="relative w-full h-[40vh] md:h-[50vh] bg-slate-900 text-white text-left">
            <div className="absolute inset-0">
            {isLoadingMedia ? <div className="w-full h-full bg-slate-800 animate-pulse text-left" /> :
             heroMedia?.type === 'video' ? (
                <video src={heroMedia.src} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" key={heroMedia.src} />
            ) : (
                <Image src={heroMedia?.src || event.photoUrl || 'https://picsum.photos/seed/default/1920/1080'} alt={heroMedia?.alt || event.eventName} fill sizes="100vw" className="object-cover" priority />
            )}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent" />
             <div className="absolute inset-0 flex items-center text-left">
              <div className="container px-4 md:px-6 text-center md:text-left text-left">
                <div className="max-w-3xl mx-auto md:mx-0 text-left">
                  <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl text-left uppercase italic leading-none">
                    {event.eventName}
                  </h1>
                  <p className="mt-2 text-lg font-medium text-white/90 text-left">
                    {event.eventDate ? format(parseISO(event.eventDate), 'PPP') : 'Date TBD'}
                  </p>
                </div>
              </div>
            </div>
        </header>

        <div className="container mx-auto py-12 px-4 text-left">
          <div className="space-y-12 text-left">
              <div className="space-y-4 text-left">
                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-left">Join The Race</h2>
                <p className="mt-2 text-muted-foreground md:text-lg text-left">{event.description}</p>
              </div>
            
             <div className="pt-8 mt-8 border-t flex justify-center text-left">
              <div className="flex flex-wrap gap-3 justify-center max-w-4xl text-left">
                  {registrationButton}
                  <Button variant="outline" size="lg" className={secondaryBtnClass} onClick={() => setIsRulesModalOpen(true)}><BookOpen className="mr-2 h-4 w-4 text-left"/> Rules</Button>
                  {event.athleteGuideBookUrl ? (
                      <Button variant="outline" size="lg" className={secondaryBtnClass} onClick={() => setIsGuideModalOpen(true)}>
                          <FileText className="mr-2 h-5 w-5 text-left"/> Athlete Guide
                      </Button>
                  ) : null}
                  {hasCourseMaps && (
                      <Button variant="outline" size="lg" className={secondaryBtnClass} onClick={() => openCourseMapModalWithTicket(event.ticketDefinitions?.[0].id ?? '')}>
                      <MapIcon className="mr-2 h-5 w-5 text-left"/> Course Maps
                      </Button>
                  )}
                  {hasCutoffs && (
                      <Button variant="outline" size="lg" className={secondaryBtnClass} onClick={() => setIsCutoffModalOpen(true)}>
                      <Hourglass className="mr-2 h-5 w-5 text-left"/> Cut-off Times
                      </Button>
                  )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 mt-8 border-t text-left">
              <Card className="shadow-xl border bg-card text-card-foreground text-left">
                <CardHeader className="text-left">
                  <CardTitle className="flex items-center gap-2 font-black uppercase italic tracking-tighter text-left">
                    <Route className="h-6 w-6 text-primary text-left"/>
                    Course Profile
                  </CardTitle>
                </CardHeader>
                 <CardContent className="space-y-6 text-left">
                    {event.courseDetails?.swim && (
                        <div className="flex items-center gap-4 text-left">
                            <CourseProfileIcon type="swim" characteristic={event.courseDetails.swim} />
                            <div className="flex flex-col justify-center text-left">
                                <h4 className="font-black uppercase text-xs text-muted-foreground leading-none text-left">Swim</h4>
                                <p className="font-bold text-lg mt-1 text-left">{event.courseDetails.swim}</p>
                            </div>
                        </div>
                    )}
                    {event.courseDetails?.bike && (
                       <div className="flex items-center gap-4 text-left">
                            <CourseProfileIcon type="bike" characteristic={event.courseDetails.bike} />
                            <div className="flex flex-col justify-center text-left">
                                <h4 className="font-black uppercase text-xs text-muted-foreground leading-none text-left">Bike</h4>
                                <p className="font-bold text-lg mt-1 text-left">{event.courseDetails.bike}</p>
                            </div>
                        </div>
                    )}
                    {event.courseDetails?.run && (
                        <div className="flex items-center gap-4 text-left">
                            <CourseProfileIcon type="run" characteristic={event.courseDetails.run} />
                            <div className="flex flex-col justify-center text-left">
                                <h4 className="font-black uppercase text-xs text-muted-foreground leading-none text-left">Run</h4>
                                <p className="font-bold text-lg mt-1 text-left">{event.courseDetails.run}</p>
                            </div>
                        </div>
                    )}
                </CardContent>
              </Card>
              
              <Card className="shadow-xl border bg-card text-card-foreground text-left">
                 <CardHeader className="text-left">
                  <CardTitle className="flex items-center gap-2 font-black uppercase italic tracking-tighter text-left">
                    <MapPin className="h-6 w-6 text-primary text-left"/>
                    Venue &amp; Travel
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 text-left">
                    <div className="space-y-2 text-left">
                      <a href={event.googleMapsUrl || '#'} target="_blank" rel="noopener noreferrer" className={cn("block text-left", event.googleMapsUrl && 'hover:text-primary transition-colors')}>
                        <h5 className="font-black uppercase text-2xl leading-snug text-foreground text-left"> {event.venueName || 'Venue Location'}</h5>
                        <p className="font-medium text-lg text-muted-foreground text-left">{event.address}</p>
                      </a>
                      {event.googleMapsUrl && <Button asChild variant="ghost" className="p-0 h-auto font-black uppercase text-[10px] tracking-widest text-primary text-left"><a href={event.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-left">Open Google Maps →</a></Button>}
                    </div>

                    {event.nearestAirport?.name && (
                    <div className="pt-6 border-t border-border space-y-2 text-left">
                        <h5 className="font-black uppercase text-[10px] text-muted-foreground tracking-widest flex items-center gap-2 text-left">
                            <Plane className="h-4 w-4 text-left" /> Nearest Airport
                        </h5>
                        <p className="font-black text-2xl text-primary italic uppercase tracking-tighter text-left">{event.nearestAirport.name}</p>
                        {event.nearestAirport.url && <Button asChild variant="ghost" className="p-0 h-auto font-black uppercase text-[10px] tracking-widest text-primary text-left"><a href={event.nearestAirport.url} target="_blank" rel="noopener noreferrer" className="text-left">View on Map →</a></Button>}
                    </div>
                    )}
                </CardContent>
              </Card>
            </div>
            
            <div className="space-y-6 pt-12 mt-12 border-t text-left">
                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-center mb-8 text-foreground text-left">Categories at Bergman</h2>
                {hasTicketsDefined && (
                    <div className="grid grid-cols-1 gap-6 text-left">
                        {event.ticketDefinitions?.map(ticket => {
                            const isDua = isDuathlonEvent(ticket.ticketName);
                            const isSwim = ticket.ticketCategory === 'Swimming';
                            const ticketDate = ticket.eventDate || event.eventDate;
                            const ticketParticipantsCount = (event.participants || []).filter((p: any) => p.ticketId === ticket.id).length;
                            const ageGroups = Array.isArray(ticket.applicableAgeGroups) 
                              ? ticket.applicableAgeGroups 
                              : (typeof ticket.applicableAgeGroups === 'string' ? ticket.applicableAgeGroups.split(',').map(s => s.trim()) : (event.ageCategories || []));

                            return (
                            <Card key={ticket.id} className="bg-card shadow-lg rounded-2xl border-2 hover:border-primary/30 transition-all text-left">
                                <CardHeader className="flex flex-row justify-between items-center p-6 bg-muted/30 text-left">
                                    <div className="text-left">
                                        <CardTitle className="text-2xl font-black uppercase tracking-tight text-primary text-left">{ticket.ticketName}</CardTitle>
                                        {ticketDate && (
                                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1 flex items-center gap-1 text-left">
                                                <CalendarDays className="h-3 text-left" /> {format(parseISO(ticketDate), 'PPP')}
                                            </p>
                                        )}
                                    </div>
                                    <Badge variant="secondary" className="font-black uppercase tracking-widest px-3 h-6 text-[10px] text-left">
                                        {ticket.ticketCategory}
                                    </Badge>
                                </CardHeader>
                                <CardContent className="p-6 text-left">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm text-left">
                                        <div className="space-y-6 text-left">
                                            {isSwim ? (
                                                <div className="space-y-6 text-left">
                                                    <h4 className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2 text-left">
                                                        <Waves className="h-4 w-4 text-sky-500 text-left" /> Available Distances
                                                    </h4>
                                                    <div className="grid grid-cols-1 gap-4 text-left">
                                                        {ticket.subCategories?.map(sub => {
                                                            return (
                                                                <div key={sub.id} className="p-4 border rounded-xl bg-sky-50/50 border-sky-100 text-left">
                                                                    <p className="font-black text-lg text-sky-800 uppercase tracking-tight text-left">{sub.name}</p>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="space-y-6 text-left">
                                                    <div className="text-left">
                                                        <h4 className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground mb-3 text-left">Course Metrics</h4>
                                                        <div className="space-y-2 text-left">
                                                            {isDua ? (
                                                                <>
                                                                    <div className="flex items-center gap-3 font-medium text-base text-left"><Footprints className="h-5 w-5 text-orange-500 text-left" /> Run 1: <span className="font-black text-left">{ticket.courseMaps?.run1Distance || '—'} km</span></div>
                                                                    <div className="flex items-center gap-3 font-medium text-base text-left"><BikeIcon className="h-5 w-5 text-green-500 text-left" /> Bike: <span className="font-black text-left">{ticket.courseMaps?.bikeDistance || '—'} km</span></div>
                                                                    <div className="flex items-center gap-3 font-medium text-base text-left"><Footprints className="h-5 w-5 text-orange-500 text-left" /> Run 2: <span className="font-black text-left">{ticket.courseMaps?.run2Distance || '—'} km</span></div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="flex items-center gap-3 font-medium text-base text-left"><Waves className="h-5 w-5 text-sky-500 text-left" /> Swim: <span className="font-black text-left">{ticket.courseMaps?.swimDistance || '—'} km</span></div>
                                                                    <div className="flex items-center gap-3 font-medium text-base text-left"><BikeIcon className="h-5 w-5 text-green-500 text-left" /> Bike: <span className="font-black text-left">{ticket.courseMaps?.bikeDistance || '—'} km</span></div>
                                                                    <div className="flex items-center gap-3 font-medium text-base text-left"><Footprints className="h-5 w-5 text-orange-500 text-left" /> Run: <span className="font-black text-left">{ticket.courseMaps?.runDistance || '—'} km</span></div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <Separator className="bg-border/50 text-left" />
                                                    <PricingTiersList tiers={ticket.tiers || []} basePrice={ticket.price} participantsCount={ticketParticipantsCount} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-4 text-left">
                                            <h4 className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground text-left">Eligibility & Age Groups</h4>
                                            <div className="flex flex-wrap gap-1.5 text-left">
                                                {ageGroups.map((ag: string) => (
                                                    <Badge key={ag} variant="outline" className="text-xs font-bold text-left">{ag}</Badge>
                                                ))}
                                            </div>
                                            {ticket.description && (
                                                <div className="pt-4 border-t border-dashed text-left">
                                                    <p className="text-xs text-muted-foreground italic leading-relaxed text-left">{ticket.description}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )})}
                    </div>
                )}
            </div>
            
            {event.blocks && event.blocks.length > 0 && (
                <div className="pt-8 mt-8 text-left">
                    {event.blocks.map(block => (
                        <div key={block.id} dangerouslySetInnerHTML={{ __html: block.html }} className="text-left" />
                    ))}
                </div>
            )}

            {event.sponsors && event.sponsors.length > 0 && (
              <section className="w-full pt-12 mt-12 border-t text-left">
                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-center mb-12 text-foreground text-left">Our Partners</h2>
                <div className="flex flex-wrap items-center justify-center gap-12 md:gap-20 text-left">
                  {event.sponsors.map(sponsor => (
                    <div key={sponsor.id} className="flex flex-col items-center gap-3 text-center grayscale hover:grayscale-0 transition-all duration-500 text-left">
                      <a 
                        href={sponsor.website || undefined} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        aria-label={sponsor.name}
                        className="relative h-20 w-40 block text-left"
                      >
                        <Image
                          src={sponsor.logoUrl}
                          alt={sponsor.name}
                          fill
                          sizes="160px"
                          className="object-contain"
                        />
                      </a>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground text-left">{sponsor.type || 'Sponsor'}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

          </div>
        </div>
      
      <Dialog open={isGuideModalOpen} onOpenChange={setIsGuideModalOpen}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 text-left overflow-hidden">
          <DialogHeader className="p-6 pb-2 text-left flex-shrink-0">
            <DialogTitle className="text-2xl text-left">Athlete Guide Book: {event.eventName}</DialogTitle>
          </DialogHeader>
          <div className="flex-grow py-2 px-6 text-left">
            {event.athleteGuideBookUrl ? (
              <iframe src={event.athleteGuideBookUrl} className="w-full h-full border rounded-md" title="Athlete Guide Book" />
            ) : (
              <p className="text-center text-muted-foreground py-20 text-left">The guide book is not available for this event.</p>
            )}
          </div>
          <DialogFooter className="p-4 pt-4 border-t flex-shrink-0 flex justify-between w-full text-left">
            <Button variant="outline" asChild className="rounded-xl font-bold uppercase text-[10px] tracking-widest text-left">
              <a href={event.athleteGuideBookUrl!} download className="text-left">
                <Download className="mr-2 h-4 w-4 text-left" /> Download PDF
              </a>
            </Button>
            <Button onClick={() => setIsGuideModalOpen(false)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest text-left">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isRulesModalOpen} onOpenChange={setIsRulesModalOpen}>
          <DialogContent className="max-w-4xl flex flex-col h-[90vh] text-left overflow-hidden p-0">
              <DialogHeader className="p-6 pb-4 text-left border-b flex-shrink-0">
                  <DialogTitle className="text-2xl text-left font-black uppercase tracking-tighter italic">Bergman Race Rules &amp; Regulations</DialogTitle>
              </DialogHeader>
              <ScrollArea className="flex-1 px-6 overflow-y-auto text-left">
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none py-4 text-left"
                    dangerouslySetInnerHTML={{ __html: htmlToRender }}
                  />
              </ScrollArea>
              <DialogFooter className="p-4 border-t flex-shrink-0 text-left">
                  <DialogClose asChild><Button className="rounded-xl font-bold uppercase text-[10px] tracking-widest text-left">Close Rules</Button></DialogClose>
              </DialogFooter>
          </DialogContent>
      </Dialog>

      {hasCourseMaps && (
        <CourseMapDialog 
            event={event} 
            isOpen={isMapModalOpen} 
            onClose={() => setIsMapModalOpen(false)} 
            ticketId={selectedTicketIdForMap}
        />
      )}
      
      {hasCutoffs && (
        <Dialog open={isCutoffModalOpen} onOpenChange={setIsCutoffModalOpen}>
            <DialogContent className="sm:max-w-xl text-center flex flex-col h-[90vh] p-0 overflow-hidden text-left">
               <DialogHeader className="p-6 pb-2 text-center flex-shrink-0 text-left">
                  <DialogTitle className="text-2xl md:text-3xl text-center text-foreground font-black uppercase italic tracking-tighter text-left">BERGMAN RACE CUT-OFF TIMING</DialogTitle>
                   <DialogDescription className="pt-2 text-center mx-auto max-w-sm text-left">
                    Note: Cut-off times are based on your individual start time.
                  </DialogDescription>
               </DialogHeader>
                
                <ScrollArea className="flex-1 px-6 overflow-y-auto text-left">
                    <div className="space-y-3 pb-6 text-left">
                        {event.ticketDefinitions?.map(ticket => {
                            const isSwim = ticket.ticketCategory === 'Swimming';
                            if (!ticket.cutoffs && !ticket.subCategories) return null;

                            return (
                                <Card key={ticket.id} className="w-full text-left shadow-sm border-2">
                                  <CardHeader className="p-3 pb-1 bg-muted/20 text-left">
                                    <CardTitle className="text-sm font-black uppercase tracking-tight text-primary text-left">{ticket.ticketName}</CardTitle>
                                  </CardHeader>
                                  <CardContent className="p-3 pt-2 text-left">
                                    <ul className="space-y-1.5 text-xs text-left">
                                        {isSwim ? (
                                            ticket.subCategories?.map(sub => (
                                                sub.cutoff ? (
                                                    <li key={sub.id} className="flex justify-between items-center border-b border-dashed pb-1 last:border-0 text-left">
                                                        <span className="font-bold text-left">{sub.name}</span>
                                                        <Badge variant="outline" className="font-mono text-base h-8 rounded-full px-4 text-left">{sub.cutoff}</Badge>
                                                    </li>
                                                ) : null
                                            ))
                                        ) : (
                                            <>
                                              {ticket.cutoffs?.mode === 'overall' && ticket.cutoffs.overall && (
                                                  <li className="flex justify-between items-center font-bold text-primary bg-primary/5 p-2 rounded-lg border border-primary/20 text-left">
                                                      <span className="flex items-center gap-1.5 text-left text-sm"><Flag className="h-3 w-3 text-left" /> Overall Race Finish</span>
                                                      <Badge className="font-mono text-base h-8 bg-primary px-4 rounded-full text-left">{ticket.cutoffs.overall}</Badge>
                                                  </li>
                                              )}
                                              {ticket.cutoffs?.mode === 'segment' && (
                                                  <div className="space-y-1.5 text-left">
                                                      {isDuathlonEvent(ticket.ticketName) ? (
                                                          <>
                                                              <li className="flex justify-between items-center border-b border-dashed pb-1 text-left">
                                                                  <span className="font-medium text-muted-foreground text-left">Run 1 Finish</span>
                                                                  <span className="font-mono font-bold text-base text-left">{ticket.cutoffs.run1}</span>
                                                              </li>
                                                              <li className="flex justify-between items-center border-b border-dashed pb-1 text-left">
                                                                  <span className="font-medium text-muted-foreground text-left">Bike Finish (cum.)</span>
                                                                  <span className="font-mono font-bold text-base text-left">{ticket.cutoffs.bike}</span>
                                                              </li>
                                                              <li className="flex justify-between items-center font-bold text-primary bg-primary/5 p-2 rounded-lg border border-primary/20 text-left">
                                                                  <span className="flex items-center gap-1.5 text-left text-sm"><Flag className="h-3 w-3 text-left" /> Overall Finish</span>
                                                                  <Badge className="font-mono text-base h-8 bg-primary px-4 rounded-full text-left">{ticket.cutoffs.run2}</Badge>
                                                              </li>
                                                          </>
                                                      ) : (
                                                          <>
                                                              <li className="flex justify-between items-center border-b border-dashed pb-1 text-left">
                                                                  <span className="font-medium text-muted-foreground text-left">Swim Finish</span>
                                                                  <span className="font-mono font-bold text-base text-left">{ticket.cutoffs.swim}</span>
                                                              </li>
                                                              <li className="flex justify-between items-center border-b border-dashed pb-1 text-left">
                                                                  <span className="font-medium text-muted-foreground text-left">Bike Finish (cum.)</span>
                                                                  <span className="font-mono font-bold text-base text-left">{ticket.cutoffs.bike}</span>
                                                              </li>
                                                              <li className="flex justify-between items-center font-bold text-primary bg-primary/5 p-2 rounded-lg border border-primary/20 text-left">
                                                                  <span className="flex items-center gap-1.5 text-left text-sm"><Flag className="h-3 w-3 text-left" /> Overall Finish</span>
                                                                  <Badge className="font-mono text-base h-8 bg-primary px-4 rounded-full text-left">{ticket.cutoffs.run}</Badge>
                                                              </li>
                                                          </>
                                                      )}
                                                  </div>
                                              )}
                                            </>
                                        )}
                                    </ul>
                                  </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                </ScrollArea>

               <DialogFooter className="p-4 border-t flex-shrink-0 text-left">
                 <DialogClose asChild>
                   <Button className="w-full h-11 rounded-xl font-bold uppercase tracking-widest bg-primary hover:bg-primary/90 text-white border-none shadow-lg text-left">Close</Button>
                 </DialogClose>
               </DialogFooter>
            </DialogContent>
        </Dialog>
      )}
    </>
  );
}
