// src/components/layout/AnnouncementTicker.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { getActiveAnnouncementsAction } from '@/lib/actions/announcementActions';
import type { Announcement, AnnouncementType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { X, ArrowRight, Info, ShieldAlert, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '../ui/dialog';
import { useRouter } from 'next/navigation';

export function AnnouncementTicker() {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const role: AnnouncementType | 'admin' = currentUser?.isAdmin
      ? 'admin'
      : currentUser?.ownedClubId
        ? 'club'
        : 'athlete';
    const cacheKey = `adminAnnouncementTicker:${role}`;
    let hasCache = false;

    try {
      const cached = typeof window !== 'undefined' ? sessionStorage.getItem(cacheKey) : null;
      if (cached) {
        const parsed = JSON.parse(cached) as Announcement[];
        if (Array.isArray(parsed)) {
          setAnnouncements(parsed.filter(a => a?.isTicker));
          setIsLoaded(true);
          hasCache = true;
        }
      }
    } catch {
      // ignore cache parse errors
    }

    const fetchAnnouncements = async () => {
        try {
            const res = await getActiveAnnouncementsAction({ role });
            if (res.success && res.announcements && Array.isArray(res.announcements)) {
                const tickerAnnouncements = res.announcements.filter(a => a.isTicker);
                setAnnouncements(tickerAnnouncements);
                if (typeof window !== 'undefined') {
                  sessionStorage.setItem(cacheKey, JSON.stringify(tickerAnnouncements));
                }
            }
        } catch (error) {
            console.error("Failed to load announcements:", error);
        } finally {
            if (!hasCache) setIsLoaded(true);
        }
    };

    fetchAnnouncements();
  }, [currentUser, authLoading]);

  useEffect(() => {
    if (announcements.length === 0) return;
    setCurrentIndex((prev) => (prev >= announcements.length ? 0 : prev));
  }, [announcements]);

  const handleTickerClick = (announcement: Announcement) => {
    if (!announcement) return;

    if (announcement.linkUrl) {
        const url = announcement.linkUrl.trim();
        if (url.startsWith('http')) {
            window.open(url, '_blank');
        } else {
            router.push(url);
        }
    } else if (announcement.isModal) {
        setSelectedAnnouncement(announcement);
    }
  };

  const nextAnnouncement = () => {
    setCurrentIndex((prev) => (prev + 1) % announcements.length);
  };

  if (isDismissed || !isLoaded || announcements.length === 0) return null;

  const active = announcements[currentIndex];
  if (!active) return null;

  const bgClass = {
    high: 'bg-destructive text-destructive-foreground font-black',
    medium: 'bg-orange-600 text-white font-bold',
    low: 'bg-slate-900 text-slate-200 font-medium',
  }[active.priority || 'low'];

  return (
    <>
      <div className={cn("relative w-full h-9 flex items-center overflow-hidden z-[100] border-b border-white/5", bgClass)}>
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 overflow-hidden">
            <div className="flex items-center gap-1.5 shrink-0 bg-black/20 px-2 py-0.5 rounded-md">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Live</span>
            </div>

            <div className="relative flex-1 h-9 overflow-hidden">
              <motion.div
                key={active.id}
                initial={{ x: '0%' }}
                animate={{ x: '-105%' }}
                transition={{
                  duration: Math.max(3.2, active.title.length * 0.085),
                  ease: 'linear',
                }}
                onAnimationComplete={nextAnnouncement}
                className="absolute whitespace-nowrap flex items-center h-full cursor-pointer"
                onClick={() => handleTickerClick(active)}
              >
                <span className="text-xs sm:text-sm font-bold uppercase tracking-tight flex items-center gap-4 px-2">
                  {active.title}
                  {active.linkUrl ? (
                    <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase font-black tracking-widest flex items-center gap-1">
                      Link <ArrowRight className="h-2 w-2"/>
                    </span>
                  ) : active.isModal ? (
                    <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase font-black tracking-widest">Details &rarr;</span>
                  ) : null}
                </span>
              </motion.div>
            </div>
          </div>

          <button 
            onClick={() => setIsDismissed(true)} 
            className="ml-4 hover:bg-white/10 p-1 rounded-full transition-colors shrink-0"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Dialog open={!!selectedAnnouncement} onOpenChange={() => setSelectedAnnouncement(null)}>
        <DialogContent className="sm:max-w-md text-left">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2 text-left">
                {selectedAnnouncement?.priority === 'high' ? <ShieldAlert className="text-destructive h-6 w-6"/> : <Info className="text-primary h-6 w-6"/>}
                <DialogTitle className="text-left text-xl font-black uppercase italic tracking-tight">{selectedAnnouncement?.title}</DialogTitle>
            </div>
            <DialogDescription className="text-base whitespace-pre-line pt-2 text-foreground text-left leading-relaxed">
              {selectedAnnouncement?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex flex-col sm:flex-row gap-3">
            {selectedAnnouncement?.linkUrl && (
                <Button className="w-full sm:flex-1 bg-orange-600 hover:bg-orange-50 font-bold uppercase text-xs tracking-widest" onClick={() => {
                    const url = selectedAnnouncement.linkUrl!.trim();
                    if (url.startsWith('http')) window.open(url, '_blank');
                    else router.push(url);
                    setSelectedAnnouncement(null);
                }}>
                    Visit Page <ExternalLink className="ml-2 h-4 w-4"/>
                </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="outline" className="w-full sm:w-auto font-bold uppercase text-xs tracking-widest">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}