// src/components/events/EventDisplayCard.tsx
"use client";

import type { EventCalendarEntry, TicketDefinition } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent as CardContentComponent, CardFooter, CardHeader as CardHeaderComponent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { 
    CalendarDays, Ticket, Info, Ban, MapPin, Map, ExternalLink, 
    Waves, Bike, Footprints, Plane, TrendingUp, Mountain, Minus, 
    Flag as FlagIconLucide, Calendar, List, Star, Zap
} from 'lucide-react';
import Image from 'next/image';
import React, { useState, useEffect } from 'react';
import CourseMapDialog from './CourseMapDialog';
import { cn, getCountryFlagEmoji, isValidImageUrl } from '@/lib/utils';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Badge } from '../ui/badge';
import { useAuth } from '@/context/AuthContext';
import { getPerformanceRewardAction } from '@/lib/actions/userActions';

interface EventDisplayCardProps {
  event: EventCalendarEntry;
  layout?: 'vertical' | 'horizontal';
}

const DisciplineBadge = ({ type }: { type: string }) => {
    const config: Record<string, { label: string, color: string, icon: React.ElementType }> = {
        'Swimming': { label: 'Swimathon', color: 'bg-sky-500', icon: Waves },
        'Triathlon': { label: 'Triathlon', color: 'bg-orange-500', icon: Bike },
        'Duathlon': { label: 'Duathlon', color: 'bg-emerald-500', icon: Footprints },
        'Other': { label: 'Event', color: 'bg-slate-500', icon: Info }
    };
    
    const t = type.toUpperCase();
    let key = 'Other';
    if (t.includes('SWIM')) key = 'Swimming';
    else if (t.includes('TRIATHLON')) key = 'Triathlon';
    else if (t.includes('DUATHLON')) key = 'Duathlon';

    const { color, icon: Icon } = config[key] || config['Other'];
    return (
        <Badge className={cn("gap-1.5 font-black uppercase text-[9px] tracking-widest h-5 px-2 border-none shadow-sm", color)}>
            {key === 'Triathlon' ? (
                <div className="flex items-center gap-1">
                    <Waves className="h-3 w-3" />
                    <Bike className="h-3 w-3" />
                    <Footprints className="h-3 w-3" />
                </div>
            ) : key === 'Duathlon' ? (
                <div className="flex items-center gap-1">
                    <Footprints className="h-3 w-3" />
                    <Bike className="h-3 w-3" />
                    <Footprints className="h-3 w-3" />
                </div>
            ) : (
                <Icon className="h-3 w-3" />
            )}
            {type}
        </Badge>
    );
};

const CourseProfileIcon = ({ type, characteristic }: { type: 'swim' | 'bike' | 'run', characteristic?: string | null }) => {
    let Icon: React.ElementType = Waves;
    const iconColor = 'text-orange-500';
    
    if (type === 'bike') Icon = Bike;
    else if (type === 'run') Icon = Footprints;
    
    let TerrainIcon: React.ElementType | null = null;
    if (characteristic) {
        const lowerChar = characteristic.toLowerCase();
        if (lowerChar.includes('rolling')) TerrainIcon = TrendingUp;
        else if (lowerChar.includes('hilly')) TerrainIcon = Mountain;
        else if (lowerChar.includes('flat')) TerrainIcon = Minus;
    }

    return (
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
            <Icon className={`h-4 w-4 ${iconColor}`} />
            {TerrainIcon && type !== 'swim' && (
                 <div className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-background border border-orange-500/30">
                    <TerrainIcon className={`h-2 w-2 ${iconColor}`} />
                 </div>
            )}
        </div>
    );
};

export default function EventDisplayCard({ event, layout = 'vertical' }: EventDisplayCardProps) {
  const { currentUser } = useAuth();
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [userReward, setUserReward] = useState<{ discount: number; label: string } | null>(null);
  
  useEffect(() => {
    if (currentUser?.uid && event.eventDate && event.eventDate !== 'TBD') {
        const year = new Date(event.eventDate).getFullYear();
        getPerformanceRewardAction(currentUser.uid, year).then(res => {
            if (res.success && res.discountPercent > 0) {
                setUserReward({ discount: res.discountPercent, label: res.unlockedTier || 'Reward' });
            }
        });
    }
  }, [currentUser?.uid, event.eventDate]);

  const hasTicketsDefined = event.ticketDefinitions && event.ticketDefinitions.length > 0;
  const hasValidExternalRegUrl = typeof event.registrationUrl === 'string' && event.registrationUrl.trim() !== '' && event.registrationUrl.startsWith('http');
  const canUseInternalForm = event.customSlug && (hasTicketsDefined || !hasValidExternalRegUrl);

  const registrationLink = canUseInternalForm ? `/event-form/${event.customSlug}` : (hasValidExternalRegUrl ? event.registrationUrl : '#');
  const isExternalLink = !canUseInternalForm && hasValidExternalRegUrl;
  const canRegister = registrationLink !== '#';
  
  const detailLink = event.customSlug ? `/races/${event.customSlug}` : `/races/${event.id}`;

  const orangeBtnClass = "w-full bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-wider border-none shadow-lg transition-all duration-300 transform hover:-translate-y-0.5 relative overflow-hidden group/btn h-12";
  const secondaryBtnClass = "flex-1 h-12 text-[10px] sm:text-xs bg-orange-600 hover:bg-orange-700 text-white font-black uppercase tracking-widest border-none transition-all shadow-md shadow-orange-600/20 px-2";

  let registrationButton;
  if (event.isSoldOut) {
    registrationButton = <Button className="w-full h-12 bg-red-600/20 text-red-500 border-red-500/50" disabled><Ban className="mr-2 h-4 w-4" /> Sold Out</Button>;
  } else if (canRegister) {
    registrationButton = (
      <Button asChild className={orangeBtnClass}>
        <Link href={registrationLink || '#'} target={isExternalLink ? "_blank" : "_self"}>
          <span className="relative z-10 flex items-center justify-center">
            <Ticket className="mr-2 h-4 w-4" /> Register Now
            {isExternalLink && <ExternalLink className="ml-1 h-3 w-3" />}
          </span>
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-1000"></span>
        </Link>
      </Button>
    );
  } else {
    registrationButton = <Button className="w-full h-12" disabled><Info className="mr-2 h-4 w-4" /> Unavailable</Button>;
  }

  const hasCourseMaps = event.ticketDefinitions?.some(td => 
    td.courseMaps?.swimGpxUrl || 
    td.courseMaps?.bikeGpxUrl || 
    td.courseMaps?.runGpxUrl ||
    td.courseMaps?.run1GpxUrl ||
    td.courseMaps?.run2GpxUrl
  );
  
  const flagEmoji = getCountryFlagEmoji(event.country);

  const renderLocationAndTravel = () => (
    <div className="space-y-3 text-left">
        <div className="flex items-start gap-3 text-left">
            <MapPin className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-left">
                <a 
                  href={event.googleMapsUrl || '#'} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className={cn("block font-bold text-sm truncate text-left", event.googleMapsUrl ? "text-foreground hover:text-primary transition-colors" : "text-foreground")}
                >
                    {event.venueName || 'Venue TBD'}
                </a>
                {event.address && <p className="text-[10px] text-muted-foreground truncate text-left">{event.address}</p>}
            </div>
        </div>

        {event.nearestAirport?.name && (
            <div className="flex items-center gap-3 text-left">
                <Plane className="h-5 w-5 text-orange-500 shrink-0" />
                <a 
                  href={event.nearestAirport.url || '#'} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className={cn("text-muted-foreground font-bold text-xs truncate text-left", event.nearestAirport.url && "hover:text-primary transition-colors")}
                >
                    Airport: {event.nearestAirport.name}
                </a>
            </div>
        )}
    </div>
  );

  const renderCourseProfiles = () => (
    <div className="space-y-3 pt-4 border-t border-border text-left">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">Course Profile</p>
        <div className="flex flex-col gap-3 text-left">
            {event.courseDetails?.swim && (
                <div className="flex items-center gap-2 text-left">
                    <CourseProfileIcon type="swim" characteristic={event.courseDetails.swim} />
                    <span className="text-xs font-bold text-muted-foreground text-left">{event.courseDetails.swim}</span>
                </div>
            )}
            {event.courseDetails?.bike && (
                <div className="flex items-center gap-2 text-left">
                    <CourseProfileIcon type="bike" characteristic={event.courseDetails.bike} />
                    <span className="text-xs font-bold text-muted-foreground text-left">{event.courseDetails.bike}</span>
                </div>
            )}
            {event.courseDetails?.run && (
                <div className="flex items-center gap-2 text-left">
                    <CourseProfileIcon type="run" characteristic={event.courseDetails.run} />
                    <span className="text-xs font-bold text-muted-foreground text-left">{event.courseDetails.run}</span>
                </div>
            )}
        </div>
    </div>
  );

  const validPhotoUrl = isValidImageUrl(event.photoUrl) ? event.photoUrl : 'https://picsum.photos/seed/default/1200/800';

  if (layout === 'horizontal') {
    return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="w-full"
      >
        <Card className={cn(
          "w-full mx-auto overflow-hidden transition-all duration-500 rounded-2xl border flex flex-col group relative shadow-2xl bg-card text-card-foreground"
        )}>
          <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400 z-20 rounded-tr-2xl" />
          
          <div className="flex flex-col md:flex-row h-full">
              <div className="relative w-full md:w-[60%] flex-shrink-0 aspect-video md:aspect-auto overflow-hidden bg-muted border-r">
                <Image
                  src={validPhotoUrl}
                  alt={event.eventName || 'Event Image'}
                  fill
                  sizes="(max-width: 768px) 100vw, 60vw"
                  className="object-cover"
                  data-ai-hint="event banner"
                  loading="lazy"
                />
                
                <div className="absolute bottom-0 left-0 z-30 flex flex-col gap-1">
                    {userReward && (
                        <div className="bg-primary text-white text-[10px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-primary/50 flex items-center gap-1.5 text-left animate-in slide-in-from-left duration-500">
                            <Zap className="h-3 w-3 fill-white" /> {userReward.discount}% Loyalty Discount
                        </div>
                    )}
                    {event.isRaceWeekend && (
                        <div className="bg-primary text-orange-500 text-[10px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-primary/50 flex items-center gap-1.5 text-left">
                            Race Weekend
                        </div>
                    )}
                    {event.isSoldOut ? (
                        <div className="bg-red-600 text-white text-[10px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-red-500 text-left">
                            Sold Out
                        </div>
                    ) : canRegister ? (
                        <div className="bg-orange-600 text-white text-[10px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-orange-500 flex items-center gap-1.5 text-left">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            Registration Open
                        </div>
                    ) : null}
                </div>
              </div>

              <div className="flex flex-col flex-grow p-6 md:p-8 justify-center w-full md:w-[40%] text-left">
                  <CardHeaderComponent className="p-0 mb-4 text-left">
                    <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-tight leading-tight group-hover:text-primary transition-colors duration-300 flex items-center justify-start gap-2 text-left">
                      <span>{flagEmoji}</span>
                      <span className="line-clamp-2 text-left">{event.eventName}</span>
                    </CardTitle>
                    <CardDescription className="text-xs flex flex-wrap items-center gap-3 mt-3 text-muted-foreground font-medium text-left">
                      <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
                      {event.ticketDefinitions && event.ticketDefinitions.length > 0 ? (
                        event.ticketDefinitions.map((ticket) => (
                          <span key={ticket.id} className="flex items-center gap-1">
                            {ticket.ticketName}
                            <span className="text-orange-500">
                              {ticket.eventDate ? format(parseISO(ticket.eventDate), "dd MMM") : "(TBD)"}
                            </span>
                          </span>
                        ))
                      ) : (
                        <span>{event.displayDateRange || 'Date TBD'}</span>
                      )}
                    </CardDescription>
                  </CardHeaderComponent>

                  <CardContentComponent className="p-0 text-left space-y-6">
                    {renderLocationAndTravel()}
                    {renderCourseProfiles()}
                  </CardContentComponent>

                  <CardFooter className="p-0 pt-8 mt-auto flex flex-col gap-3 text-left">
                      <div className="w-full text-left">
                        {registrationButton}
                      </div>
                      <div className="flex w-full gap-2 text-left">
                          <Button asChild className={secondaryBtnClass}>
                              <Link href={detailLink} className="text-left"><Info className="mr-1.5 h-3.5 w-3.5" /> Details</Link>
                          </Button>
                          {hasCourseMaps && (
                              <Button className={secondaryBtnClass} onClick={() => setIsMapModalOpen(true)}>
                                <Map className="mr-1.5 h-3.5 w-3.5"/> Maps
                              </Button>
                          )}
                      </div>
                  </CardFooter>
              </div>
          </div>
        </Card>
      </motion.div>
      {hasCourseMaps && (
        <CourseMapDialog 
          event={event} 
          isOpen={isMapModalOpen} 
          onClose={() => setIsMapModalOpen(false)} 
        />
      )}
    </>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="w-full flex flex-col h-full text-left"
      >
        <Card className={cn(
          "w-full overflow-hidden transition-all duration-500 rounded-2xl border flex flex-col h-full group relative shadow-2xl bg-card text-card-foreground"
        )}>
          <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400 z-20 rounded-tr-2xl" />
          
          <div className="relative w-full aspect-[16/9] bg-muted overflow-hidden border-b">
            <Image
              src={validPhotoUrl}
              alt={event.eventName || 'Event Image'}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover"
              data-ai-hint="event banner"
              loading="lazy"
            />
            
            <div className="absolute bottom-0 left-0 z-30 flex flex-col gap-1">
                {userReward && (
                    <div className="bg-primary text-white text-[9px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-primary/50 flex items-center justify-start gap-1.5 text-left animate-in slide-in-from-left duration-500">
                        <Zap className="h-3 w-3 fill-white" /> {userReward.discount}% Loyalty Discount
                    </div>
                )}
                {event.isRaceWeekend && (
                    <div className="bg-primary text-orange-500 text-[9px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-primary/50 flex items-center justify-start text-left">
                        Race Weekend
                    </div>
                )}
                {event.isSoldOut ? (
                    <div className="bg-red-600 text-white text-[9px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-red-500 flex items-center justify-start text-left">
                        Sold Out
                    </div>
                ) : canRegister ? (
                    <div className="bg-orange-600 text-white text-[9px] font-black px-3 py-1.5 rounded-tr-2xl uppercase tracking-widest shadow-lg border-t border-r border-orange-500 flex items-center justify-start gap-1.5 text-left">
                        <span className="w-1 h-1 rounded-full bg-white animate-pulse" />
                        Registration Open
                    </div>
                ) : null}
            </div>
          </div>

          <div className="flex flex-col flex-grow p-6 text-left">
            <CardHeaderComponent className="p-0 mb-4 text-left">
              <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center justify-start gap-2 text-left">
                <span>{flagEmoji}</span>
                <span className="line-clamp-1 text-left">{event.eventName}</span>
              </CardTitle>
              <CardDescription className="text-xs flex flex-wrap items-center gap-3 mt-3 text-muted-foreground font-medium text-left">
                <CalendarDays className="h-3.5 w-3.5 text-orange-500" />
                {event.ticketDefinitions && event.ticketDefinitions.length > 0 ? (
                  event.ticketDefinitions.map((ticket) => (
                    <span key={ticket.id} className="flex items-center gap-1">
                      {ticket.ticketName}
                      <span className="text-orange-500">
                        {ticket.eventDate ? format(parseISO(ticket.eventDate), "dd MMM") : "(TBD)"}
                      </span>
                    </span>
                  ))
                ) : (
                  <span>{event.displayDateRange || 'Date TBD'}</span>
                )}
              </CardDescription>
            </CardHeaderComponent>

            <CardContentComponent className="flex-grow p-0 space-y-6 text-left">
              {renderLocationAndTravel()}
              {renderCourseProfiles()}
            </CardContentComponent>

            <CardFooter className="p-0 pt-8 mt-auto flex flex-col items-center gap-3 text-left">
              {registrationButton}
               <div className="flex w-full gap-2 text-left">
                <Button asChild className={secondaryBtnClass}>
                  <Link href={detailLink} className="text-left font-black uppercase tracking-widest"><Info className="mr-1.5 h-3.5 w-3.5" /> Details</Link>
                </Button>
                {hasCourseMaps && (
                  <Button className={secondaryBtnClass} onClick={() => setIsMapModalOpen(true)}>
                    <Map className="mr-1.5 h-3.5 w-3.5"/> Maps
                  </Button>
                )}
              </div>
            </CardFooter>
          </div>
        </Card>
      </motion.div>
      {hasCourseMaps && (
        <CourseMapDialog 
          event={event} 
          isOpen={isMapModalOpen} 
          onClose={() => setIsMapModalOpen(false)} 
        />
      )}
    </>
  );
}
