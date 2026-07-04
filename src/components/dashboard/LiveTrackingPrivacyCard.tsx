"use client";

import React, { useMemo, useState } from 'react';
import { Loader2, ShieldOff, Shield, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { updateLiveTrackingPrivacyAction } from '@/lib/actions/userActions';
import { useToast } from '@/hooks/use-toast';

export default function LiveTrackingPrivacyCard() {
  const { currentUser, firebaseUserFromAuth, fetchUserProfile } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const privacy = useMemo(() => String(currentUser?.liveTrackingPrivacy || 'PUBLIC').trim().toUpperCase() === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC', [currentUser?.liveTrackingPrivacy]);
  const isPrivate = privacy === 'PRIVATE';

  const handleToggle = async (nextPrivacy: 'PUBLIC' | 'PRIVATE') => {
    if (!currentUser?.uid || isSaving) return;
    setIsSaving(true);
    try {
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
              {isPrivate ? <ShieldOff className="h-5 w-5 text-rose-300" /> : <Shield className="h-5 w-5 text-emerald-300" />}
              Live Tracking Privacy
            </CardTitle>
            <CardDescription className="text-left text-slate-300">
              Control whether spectators can see your live race progress.
            </CardDescription>
          </div>
          <Badge className={isPrivate ? 'bg-rose-500/20 text-rose-200 border-rose-400/30' : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'}>
            {privacy}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-4 text-sm text-slate-200">
          <p className="font-semibold text-white">Show my live race to everyone</p>
          <p className="mt-1 text-slate-300">Default. Your live progress appears publicly on search, map, leaderboard, and split timeline.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant={isPrivate ? 'outline' : 'default'}
              onClick={() => void handleToggle('PUBLIC')}
              disabled={isSaving}
              className="gap-2"
            >
              {isSaving && !isPrivate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Public
            </Button>
            <Button
              type="button"
              variant={isPrivate ? 'default' : 'outline'}
              onClick={() => void handleToggle('PRIVATE')}
              disabled={isSaving}
              className="gap-2"
            >
              {isSaving && isPrivate ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
              Hide my live race
            </Button>
          </div>
        </div>

        <div className="grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <div className="font-semibold text-white">PUBLIC</div>
            <p className="mt-1">Spectators can search and view your live race.</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
            <div className="font-semibold text-white">PRIVATE</div>
            <p className="mt-1">Only you and event admins can see live timing. Officials still time you normally.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
