// src/components/volunteer/FinishLineVolunteerTab.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { LiveAthlete, EventCalendarEntry } from '@/lib/types';
import type { BroadcastCamera } from '@/lib/types/broadcast';
import { useToast } from '@/hooks/use-toast';
import { getLiveTimingDataAction } from '@/lib/actions';
import { formatSecondsToHMS } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Award, Search as SearchIcon, RefreshCw, Camera, Monitor, Radio } from 'lucide-react';
import { getEventDetailsWithTicketsAction } from '@/lib/actions';
import { Input } from '@/components/ui/input';
import { normalizeStatus, isFinalRaceStatus } from '@/lib/utils';
import { db } from '@/lib/firebase';
import CloudflareHlsPlayer from '@/components/broadcast/CloudflareHlsPlayer';
import { getPlaybackUrl } from '@/lib/cloudflare/stream';

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cameraSlug(camera: BroadcastCamera) {
  return slugify(camera.name || camera.cameraType || camera.cameraId);
}

function isFinishLineCamera(camera: BroadcastCamera) {
  const label = String(camera.assignedLocation || camera.courseLocationName || camera.name || camera.cameraType || '').toLowerCase();
  return camera.cameraType === 'finish' || label.includes('finish');
}

interface FinishLineVolunteerTabProps {
  eventId: string;
}

export default function FinishLineVolunteerTab({ eventId }: FinishLineVolunteerTabProps) {
  const { toast } = useToast();
  const [liveData, setLiveData] = useState<LiveAthlete[]>([]);
  const [eventDetails, setEventDetails] = useState<EventCalendarEntry | null>(null);
  const [finishLineCameras, setFinishLineCameras] = useState<BroadcastCamera[]>([]);
  const [leaderboardRows, setLeaderboardRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!eventId) return;

    const camerasQuery = query(collection(db, 'broadcastCameras'), where('eventId', '==', eventId));
    const unsubscribe = onSnapshot(camerasQuery, (snapshot) => {
      const next = snapshot.docs
        .map((doc) => ({ cameraId: doc.id, ...(doc.data() || {}) } as BroadcastCamera))
        .filter((camera) => isFinishLineCamera(camera))
        .sort((a, b) => {
          const aScore = (a.status === 'live' || a.status === 'recording') ? 0 : 1;
          const bScore = (b.status === 'live' || b.status === 'recording') ? 0 : 1;
          if (aScore !== bScore) return aScore - bScore;
          return Number(a.priority || 0) - Number(b.priority || 0);
        });
      setFinishLineCameras(next);
    });

    return () => unsubscribe();
  }, [eventId]);

  const fetchLeaderboard = useCallback(async () => {
    if (!eventId) return;
    setIsLoadingLeaderboard(true);
    try {
      const res = await fetch(`/api/live/leaderboard/${encodeURIComponent(eventId)}?limit=10`, { cache: 'no-store' });
      const payload = await res.json().catch(() => null);
      if (res.ok && payload?.success && Array.isArray(payload.athletes)) {
        setLeaderboardRows(payload.athletes);
      }
    } catch (error: unknown) {
      console.error('[FinishLineVolunteerTab] leaderboard fetch failed:', error);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  }, [eventId]);

  const fetchLiveAndEventData = useCallback(async (isManualRefresh = false) => {
    if(!isManualRefresh) setIsLoading(true);
    try {
      const [liveResult, eventResult] = await Promise.all([
        getLiveTimingDataAction(eventId, 'live'),
        getEventDetailsWithTicketsAction(eventId)
      ]);

      if (liveResult.success && liveResult.participants) {
        setLiveData(liveResult.participants);
      }
      if (eventResult.success && eventResult.event) {
        setEventDetails(eventResult.event);
      }
      if(isManualRefresh) {
        toast({ title: "Data Refreshed", description: "The latest race data has been loaded." });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      toast({ variant: 'destructive', title: 'Error', description: `Failed to fetch data: ${errMsg}` });
    }
    setIsLoading(false);
  }, [eventId, toast]);

  useEffect(() => {
    fetchLiveAndEventData();
    void fetchLeaderboard();
    const interval = setInterval(fetchLiveAndEventData, 30000); // Keep auto-refresh for finish line
    const leaderboardInterval = setInterval(() => { void fetchLeaderboard(); }, 5000);
    return () => {
      clearInterval(interval);
      clearInterval(leaderboardInterval);
    };
  }, [fetchLiveAndEventData, fetchLeaderboard]);

  const { totalParticipants, onCourseCount, finishedCount, dnfCount, approachingAthletes } = useMemo(() => {
    const total = liveData.length;
    const onCourse = liveData.filter(p => normalizeStatus(p.status) === 'On Course').length;
    const finished = liveData.filter(p => normalizeStatus(p.status) === 'Finished').length;
    const dnf = liveData.filter(p => isFinalRaceStatus(p.status) && normalizeStatus(p.status) !== 'Finished').length;
    const approaching = liveData
        .filter(p => normalizeStatus(p.status) === 'On Course' && p.etaFinishUTC)
        .sort((a, b) => (a.etaFinishUTC || Infinity) - (b.etaFinishUTC || Infinity))
        .slice(0, 10);
    return { totalParticipants: total, onCourseCount: onCourse, finishedCount: finished, dnfCount: dnf, approachingAthletes: approaching };
  }, [liveData]);

  const activeFinishLineCamera = useMemo(() => {
    return finishLineCameras.find((camera) => camera.status === 'live' || camera.status === 'recording') || finishLineCameras[0] || null;
  }, [finishLineCameras]);

  const activeFinishLineStreamUrl = useMemo(() => {
    const uid = activeFinishLineCamera?.cloudflare?.playbackUid || activeFinishLineCamera?.cloudflare?.liveInputUid || null;
    return uid ? getPlaybackUrl(uid) : '';
  }, [activeFinishLineCamera]);

  const activeFinishLineViewerCount = Number(activeFinishLineCamera?.viewerCount || 0) || null;

  const eventSlug = eventDetails?.customSlug || eventId;
  const finishLineCameraUrl = activeFinishLineCamera ? `/live/${encodeURIComponent(eventSlug)}/${encodeURIComponent(cameraSlug(activeFinishLineCamera))}` : '';
  
  const filteredApproachingAthletes = useMemo(() => {
      if (!searchTerm) return approachingAthletes;
      return approachingAthletes.filter(athlete =>
        athlete.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        athlete.bib.toLowerCase().includes(searchTerm.toLowerCase()) ||
        normalizeStatus(athlete.status).toLowerCase().includes(searchTerm.toLowerCase())
      );
  }, [approachingAthletes, searchTerm]);

  return (
    <>
    <Card>
      <CardHeader>
         <div className="flex justify-between items-start">
          <div>
            <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-primary"/>Finish Line Volunteer Dashboard</CardTitle>
            <CardDescription>Watch the finish camera, call approaching athletes, and confirm finishes in real time.</CardDescription>
          </div>
          <Button onClick={() => fetchLiveAndEventData(true)} disabled={isLoading} variant="outline" size="sm">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
         </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Camera className="h-4 w-4" /> Finish Line Camera</div>
                <p className="text-sm text-muted-foreground">Mapped to the finish line volunteer so you can watch the last split and call out incoming athletes.</p>
              </div>
              <Badge variant={activeFinishLineCamera ? 'default' : 'secondary'}>{activeFinishLineCamera ? 'Mapped' : 'Not mapped'}</Badge>
            </div>
            {activeFinishLineCamera ? (
              <>
                <div className="overflow-hidden rounded-xl border bg-black">
                  <div className="relative aspect-video">
                    {activeFinishLineStreamUrl ? (
                      <CloudflareHlsPlayer
                        src={activeFinishLineStreamUrl}
                        title={activeFinishLineCamera.name || 'Finish Line Camera'}
                        className="h-full w-full object-contain bg-black"
                        showControls
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-300">Camera is mapped, but stream is not live yet.</div>
                    )}
                  </div>
                </div>
                <div className="grid gap-2 text-sm md:grid-cols-4">
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Camera</div><div className="font-semibold">{activeFinishLineCamera.name}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Location</div><div className="font-semibold">{activeFinishLineCamera.assignedLocation || activeFinishLineCamera.courseLocationName || activeFinishLineCamera.cameraType}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Status</div><div className="font-semibold capitalize">{activeFinishLineCamera.status.replace(/_/g, ' ')}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Viewers</div><div className="font-semibold">{activeFinishLineViewerCount ?? '—'}</div></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {finishLineCameraUrl ? <Button asChild variant="outline" size="sm"><Link href={finishLineCameraUrl} target="_blank" rel="noreferrer"><Monitor className="mr-2 h-4 w-4" />Open camera view</Link></Button> : null}
                  {eventDetails?.customSlug ? <Button asChild variant="ghost" size="sm"><Link href={`/live/${encodeURIComponent(eventDetails.customSlug)}`} target="_blank" rel="noreferrer"><Radio className="mr-2 h-4 w-4" />Open public broadcast</Link></Button> : null}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No finish line camera is assigned for this event yet.</div>
            )}
          </div>

          <div className="rounded-2xl border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-muted-foreground">Feibot Leaderboard</div>
                <p className="text-sm text-muted-foreground">Live ranking updates from the latest Feibot leaderboard feed.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void fetchLeaderboard()} disabled={isLoadingLeaderboard}>
                {isLoadingLeaderboard ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            <div className="space-y-2 max-h-[30rem] overflow-auto pr-1">
              {leaderboardRows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No leaderboard data available yet.</div>
              ) : leaderboardRows.map((row, index) => (
                <div key={`${row?.bib || row?.athleteId || index}`} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">#{row?.rank || index + 1}</Badge>
                      <span className="font-semibold">{row?.name || 'Unknown Athlete'}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Bib {row?.bib || '—'} • {row?.contest || 'Contest unavailable'} • {row?.currentLeg || '—'}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{row?.eta || 'ETA pending'}</div>
                    <div>{row?.gap || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          The approach list is sorted by estimated finish time from the latest official timing data so the finish line volunteer can call athletes in order.
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : totalParticipants}</CardTitle><CardDescription className="text-xs">Total</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-blue-600">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : onCourseCount}</CardTitle><CardDescription className="text-xs">On Course</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-green-600">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : finishedCount}</CardTitle><CardDescription className="text-xs">Finished</CardDescription></CardHeader></Card>
            <Card><CardHeader className="p-2 pb-1"><CardTitle className="text-xl text-red-600">{isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> : dnfCount}</CardTitle><CardDescription className="text-xs">DNF</CardDescription></CardHeader></Card>
        </div>
        <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search approaching athletes..."
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                className="pl-9"
            />
        </div>
         <div className="rounded-md border overflow-auto max-h-[70vh]">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>BIB</TableHead>
                        <TableHead>Athlete</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Predicted Finish Time</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? <TableRow><TableCell colSpan={5} className="text-center"><Loader2 className="animate-spin my-4 mx-auto"/></TableCell></TableRow>
                    : filteredApproachingAthletes.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No athletes currently approaching the finish line.</TableCell></TableRow>
                    : filteredApproachingAthletes.map(athlete => (
                        <TableRow key={athlete.id} className="text-lg">
                            <TableCell className="font-mono font-bold text-primary">{athlete.bib}</TableCell>
                            <TableCell className="font-semibold">{athlete.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{athlete.category}</TableCell>
                            <TableCell className="font-mono">
                                {athlete.etaFinishUTC && athlete.startTime ? formatSecondsToHMS(Math.max(0, new Date(athlete.etaFinishUTC * 1000).getTime()/1000 - athlete.startTime)) : 'N/A'}
                            </TableCell>
                            <TableCell>
                              <Badge className={normalizeStatus(athlete.status) === 'Finished' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white animate-pulse'}>
                                {normalizeStatus(athlete.status) === 'Finished' ? 'Finished' : 'Approaching'}
                              </Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
         </div>
      </CardContent>
    </Card>
    </>
  );
}
