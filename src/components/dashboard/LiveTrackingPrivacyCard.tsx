"use client";

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, ShieldOff, Shield, Eye, EyeOff, UserRoundX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { updateLiveTrackingPrivacyAction } from '@/lib/actions/userActions';
import { useToast } from '@/hooks/use-toast';
import type { LiveAthlete } from '@/lib/types';

type PrivacyValue = 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE';

interface LiveTrackingPrivacyCardProps {
  athlete?: LiveAthlete | null;
  onPrivacyChange?: (nextPrivacy: PrivacyValue) => Promise<void> | void;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

function maskBib(bib: string | null | undefined) {
  const raw = String(bib || '').trim();
  if (!raw) return '****';
  const suffix = raw.replace(/\D/g, '').slice(-4) || raw.slice(-4);
  return suffix ? `****${suffix}` : '****';
}

export default function LiveTrackingPrivacyCard({ athlete, onPrivacyChange, collapsible = false, defaultOpen = true }: LiveTrackingPrivacyCardProps) {
  const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const privacy = useMemo<PrivacyValue>(() => {
    const raw = String(currentUser?.liveTrackingPrivacy || currentUser?.trackingVisibility || 'PUBLIC').trim().toUpperCase();
    if (raw === 'PRIVATE' || raw === 'OFFICIALS_ONLY' || raw === 'OFFICIALS ONLY') return 'PRIVATE';
    if (raw === 'ANONYMOUS' || raw === 'ANON') return 'ANONYMOUS';
    return 'PUBLIC';
  }, [currentUser?.liveTrackingPrivacy, currentUser?.trackingVisibility]);
  const isPrivate = privacy === 'PRIVATE';
  const isAnonymous = privacy === 'ANONYMOUS';
  const privacyLabel = isPrivate ? 'Officials Only' : isAnonymous ? 'Anonymous' : 'Public';

  const previewName = String(athlete?.name || currentUser?.name || 'Vaibhav Belgaonkar').trim();
  const previewBib = String(athlete?.bib || athlete?.bibNumber || currentUser?.upcomingEvents?.[0]?.bibNumber || '').trim();
  const previewClub = String(athlete?.clubName || currentUser?.clubName || 'Deccan Sports Club').trim();
  const previewCity = String((currentUser as any)?.city || athlete?.country || '').trim();
  const buttonBase = 'gap-2 border font-semibold shadow-sm transition-colors';
  const publicButtonClass = privacy === 'PUBLIC'
    ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
    : 'bg-slate-900/80 text-slate-100 border-slate-600 hover:bg-slate-800';
  const anonymousButtonClass = privacy === 'ANONYMOUS'
    ? 'bg-sky-900 text-white border-sky-700 hover:bg-sky-800'
    : 'bg-slate-900/80 text-slate-100 border-slate-600 hover:bg-slate-800';
  const privateButtonClass = privacy === 'PRIVATE'
    ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
    : 'bg-slate-900/80 text-slate-100 border-slate-600 hover:bg-slate-800';

  const preview = useMemo(() => {
    if (privacy === 'PRIVATE') {
      return {
        title: 'Officials Only',
        lines: ['This athlete has chosen to keep their live tracking private.'],
      };
    }

    if (privacy === 'ANONYMOUS') {
      return {
        title: 'Anonymous View',
        lines: [
          '👤 Anonymous Athlete',
          `Bib: ${maskBib(previewBib)}`,
          'Club: Hidden',
          previewCity ? 'City: Hidden' : null,
        ].filter(Boolean) as string[],
      };
    }

    return {
      title: 'Public View',
      lines: [
        `👤 ${previewName}`,
        `Bib: ${previewBib || '—'}`,
        `Club: ${previewClub || '—'}`,
      ],
    };
  }, [privacy, previewBib, previewCity, previewClub, previewName]);

  const handleToggle = async (nextPrivacy: 'PUBLIC' | 'ANONYMOUS' | 'PRIVATE') => {
    if (!currentUser?.uid || isSaving) return;
    setIsSaving(true);
    try {
      if (onPrivacyChange) {
        await onPrivacyChange(nextPrivacy);
        return;
      }
      const result = await updateLiveTrackingPrivacyAction(currentUser.uid, nextPrivacy);
      if (!result.success) {
        toast({ variant: 'destructive', title: 'Unable to save privacy', description: result.message });
        return;
      }
      toast({ title: 'Live tracking updated', description: result.message });
      if (firebaseUserFromAuth && fetchUserProfile) {
        await fetchUserProfile(firebaseUserFromAuth);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-slate-200/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white shadow-xl">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-left text-xl font-black">
              {isPrivate ? <ShieldOff className="h-5 w-5 text-rose-300" /> : isAnonymous ? <UserRoundX className="h-5 w-5 text-amber-300" /> : <Shield className="h-5 w-5 text-emerald-300" />}
              Live Tracking Visibility
            </CardTitle>
            <CardDescription className="text-left text-slate-300">
              Control how your live tracking information is displayed to spectators during this event.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={isPrivate ? 'bg-rose-500/20 text-rose-200 border-rose-400/30' : isAnonymous ? 'bg-amber-500/20 text-amber-100 border-amber-400/30' : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'}>
              {privacyLabel}
            </Badge>
            {collapsible ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsOpen((prev) => !prev)}
                className="h-8 gap-2 border-white/10 bg-slate-900/50 text-slate-100 hover:bg-slate-800"
              >
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {isOpen ? 'Collapse' : 'Expand'}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {isOpen ? (
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-4 text-sm text-slate-200">
          <p className="font-semibold text-white">Choose how spectators see your live timing</p>
          <p className="mt-1 text-slate-300">Changes take effect immediately across public live tracking, search, maps, leaderboards, athlete modal, replay, and results.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant={privacy === 'PUBLIC' ? 'default' : 'outline'}
              onClick={() => void handleToggle('PUBLIC')}
              disabled={isSaving}
              className={`${buttonBase} ${publicButtonClass}`}
            >
              {isSaving && privacy === 'PUBLIC' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Public
            </Button>
            <Button
              type="button"
              variant={privacy === 'ANONYMOUS' ? 'default' : 'outline'}
              onClick={() => void handleToggle('ANONYMOUS')}
              disabled={isSaving}
              className={`${buttonBase} ${anonymousButtonClass}`}
            >
              {isSaving && privacy === 'ANONYMOUS' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundX className="h-4 w-4" />}
              Anonymous
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Status Message</div>
            <div className="mt-2 text-sm font-semibold text-white">
              {privacy === 'PUBLIC' ? '🟢 Your live tracking is currently PUBLIC.' : privacy === 'ANONYMOUS' ? '🟡 Your live tracking is currently ANONYMOUS.' : '🔴 Your live tracking is currently visible ONLY to race officials.'}
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {privacy === 'PUBLIC' ? 'Everyone can search for you, follow your race, and view your profile.' : privacy === 'ANONYMOUS' ? 'Spectators can follow your race progress, but your identity is hidden.' : 'You will not appear in public search, athlete pages, maps, or leaderboards.'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Current Status</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className={isPrivate ? 'bg-rose-500/20 text-rose-200 border-rose-400/30' : isAnonymous ? 'bg-amber-500/20 text-amber-100 border-amber-400/30' : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'}>
                {privacyLabel}
              </Badge>
              <Badge variant="outline" className="border-white/10 text-slate-200">Live Preview</Badge>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Live Preview</div>
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-200">
            <div className="font-semibold text-white">{preview.title}</div>
            <div className="mt-2 space-y-1 text-slate-300">
              {preview.lines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <div className="font-semibold text-white">PUBLIC</div>
            <p className="mt-1">Spectators can search and view your live race.</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <div className="font-semibold text-white">ANONYMOUS</div>
            <p className="mt-1">Leaderboard/map stay visible, but identity is masked as Anonymous Athlete.</p>
          </div>
        </div>
      </CardContent>
      ) : null}
    </Card>
  );
}
