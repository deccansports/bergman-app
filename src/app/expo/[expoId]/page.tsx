"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileImage, FileText, Loader2, Search, Sparkles, Store } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const statusColor: Record<string, string> = {
  available: 'bg-emerald-600',
  reserved: 'bg-blue-600',
  pending_payment: 'bg-orange-500',
  booked: 'bg-red-600',
  blocked: 'bg-slate-600',
  cancelled: 'bg-zinc-600',
  refunded: 'bg-purple-600',
};

export default function ExpoPublicPage() {
  const params = useParams<{ expoId: string }>();
  const expoId = String(params?.expoId || '').trim();
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [expo, setExpo] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [stallTypes, setStallTypes] = useState<any[]>([]);
  const [stalls, setStalls] = useState<any[]>([]);
  const [bookedExhibitors, setBookedExhibitors] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [stallTypeFilter, setStallTypeFilter] = useState('all');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const formatRemainingTime = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!expoId) return;
    let isMounted = true;
    const load = async () => {
      try {
        if (!hasLoadedOnce.current) setLoading(true);
        const response = await fetch(`/api/expo/public/${encodeURIComponent(expoId)}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) throw new Error(payload?.message || 'Failed to load expo');
        if (!isMounted) return;
        setExpo(payload.expo || null);
        setEvent(payload.event || null);
        setStallTypes(Array.isArray(payload.stallTypes) ? payload.stallTypes : []);
        setStalls(Array.isArray(payload.stalls) ? payload.stalls : []);
        setBookedExhibitors(Array.isArray(payload.bookedExhibitors) ? payload.bookedExhibitors : []);
        setMetrics(payload.metrics || null);
        hasLoadedOnce.current = true;
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Expo unavailable',
          description: error instanceof Error ? error.message : 'Unable to load expo page',
        });
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void load();
    return () => { isMounted = false; };
  }, [expoId, toast]);

  const filteredStalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stalls
      .filter((stall) => {
        if (stallTypeFilter !== 'all' && String(stall?.stallTypeId || '') !== stallTypeFilter) return false;
        if (!q) return true;
        const typeLabel = String(
          stallTypes.find((t) => String(t?.id || '') === String(stall?.stallTypeId || ''))?.name || '',
        ).toLowerCase();
        return (
          String(stall?.stallNumber || '').toLowerCase().includes(q) ||
          String(stall?.sizeLabel || '').toLowerCase().includes(q) ||
          typeLabel.includes(q)
        );
      })
      .sort((a, b) => Number(a?.price || 0) - Number(b?.price || 0));
  }, [stalls, search, stallTypeFilter, stallTypes]);

  const soldOutPct = useMemo(() => {
    const total = Number(metrics?.totalStalls || 0);
    const sold =
      Number(metrics?.bookedStalls || 0) +
      Number(metrics?.reservedStalls || 0) +
      Number(metrics?.pendingPayments || 0);
    if (!total) return 0;
    return Math.min(100, Math.round((sold / total) * 100));
  }, [metrics]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Sticky nav */}
      <div className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-black tracking-wider text-primary">
            <Sparkles className="h-4 w-4" /> BERGMAN EXPO
          </div>
          <div className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="/" className="hover:text-primary">Home</a>
            <a href="/races" className="hover:text-primary">Events</a>
            <a href="/results" className="hover:text-primary">Results</a>
            <a href="/volunteer" className="hover:text-primary">Volunteers</a>
            <a href="/contact-us" className="hover:text-primary">Contact</a>
          </div>
          <Button
            size="sm"
            onClick={() => document.getElementById('stalls')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            Book a Stall
          </Button>
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden border-b bg-gradient-to-br from-blue-700 via-primary to-purple-700 text-white">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #fff 0, transparent 40%), radial-gradient(circle at 80% 10%, #fff 0, transparent 40%)',
          }}
        />
        <div className="container relative mx-auto grid gap-8 px-4 py-16 lg:grid-cols-2 lg:py-20">
          <div className="space-y-4">
            <Badge className="bg-white/20 text-white">India&apos;s Premier Endurance Sports Expo</Badge>
            <h1 className="text-4xl font-black leading-tight md:text-5xl">Showcase Your Brand at Bergman Expo</h1>
            <p className="max-w-2xl text-white/90">
              Join hundreds of exhibitors and thousands of athletes. Reserve your stall online, launch innovations, and connect with the endurance sports community.
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <div><p className="text-white/70">Event</p><p className="font-semibold">{event?.eventName || 'Bergman Expo Event'}</p></div>
              <div><p className="text-white/70">Venue</p><p className="font-semibold">{expo?.venue || 'Venue TBD'}</p></div>
              <div><p className="text-white/70">Expo Dates</p><p className="font-semibold">{expo?.expoStartDate || 'TBD'}{expo?.expoEndDate ? ` → ${expo.expoEndDate}` : ''}</p></div>
              <div><p className="text-white/70">Opening Hours</p><p className="font-semibold">10:00 AM – 8:00 PM</p></div>
              <div><p className="text-white/70">Number of Stalls</p><p className="font-semibold">{metrics?.totalStalls ?? 0}</p></div>
              <div><p className="text-white/70">Expected Visitors</p><p className="font-semibold">20,000+</p></div>
            </div>
            <div className="pt-2">
              <Button
                type="button"
                className="bg-white text-primary hover:bg-white/90"
                onClick={() => document.getElementById('stalls')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Book Your Stall
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stalls Section */}
      {/* Availability Stats */}
      <section className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="rounded-2xl border bg-white shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Stalls</p>
              <p className="mt-1 text-3xl font-black">{metrics?.totalStalls ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Available</p>
              <p className="mt-1 text-3xl font-black text-emerald-700">{metrics?.availableStalls ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border border-blue-200 bg-blue-50 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Reserved</p>
              <p className="mt-1 text-3xl font-black text-blue-700">{metrics?.reservedStalls ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border border-red-200 bg-red-50 shadow-sm">
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-700">Booked</p>
              <p className="mt-1 text-3xl font-black text-red-700">{metrics?.bookedStalls ?? 0}</p>
            </CardContent>
          </Card>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>{soldOutPct}% Sold Out</span>
            <span>{Math.max(0, 100 - soldOutPct)}% Remaining</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${soldOutPct}%` }} />
          </div>
        </div>
      </section>

      {expo?.layout?.fileUrl ? (
        <section className="container mx-auto px-4 pb-6">
          <Card className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50/80">
              <CardTitle>Stall Location / Expo Layout</CardTitle>
              <CardDescription>Open the image or PDF to view the stall map, hall placement, and location details before booking.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 p-5 md:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border bg-gradient-to-br from-primary/5 via-white to-purple-500/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layout file</p>
                <p className="mt-2 text-lg font-black">{expo.layout.fileName || 'Expo Layout'}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {String(expo.layout.fileType || '').toLowerCase() === 'pdf'
                    ? 'PDF layout for stall positions and venue plan.'
                    : 'Image layout for quick stall location viewing.'}
                </p>
                <Button className="mt-4 w-full" onClick={() => window.open(String(expo.layout.fileUrl || ''), '_blank', 'noopener,noreferrer')}>
                  Open {String(expo.layout.fileType || '').toLowerCase() === 'pdf' ? 'PDF' : 'Layout'}
                </Button>
              </div>
              <div className="overflow-hidden rounded-2xl border bg-slate-50">
                {String(expo.layout.fileType || '').toLowerCase() === 'pdf' ? (
                  <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center text-muted-foreground">
                    <FileText className="mb-3 h-10 w-10 text-primary" />
                    <p className="font-semibold">PDF layout preview</p>
                    <p className="text-sm">Open the file to inspect the full stall map.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between border-b bg-white px-4 py-3 text-sm">
                      <span className="font-semibold text-slate-900">Preview</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        <FileImage className="h-3.5 w-3.5" /> Image
                      </span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={expo.layout.fileUrl} alt={`${expo.expoName || 'Expo'} layout`} className="h-[22rem] w-full object-cover" />
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* Stalls Section */}
      <section className="container mx-auto px-4 pb-12" id="stalls">
        <div className="mb-6 space-y-1 border-b pb-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Stalls Available At</p>
          <h2 className="text-2xl font-black">{event?.eventName || 'Bergman Expo Event'}</h2>
          <p className="text-sm text-muted-foreground">
            {expo?.venue}{expo?.expoStartDate ? ` · ${expo.expoStartDate}` : ''}{expo?.expoEndDate ? ` to ${expo.expoEndDate}` : ''}
          </p>
        </div>
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search stall number or type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={stallTypeFilter} onValueChange={setStallTypeFilter}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder="All Stall Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stall Types</SelectItem>
              {stallTypes.map((type) => (
                <SelectItem key={type.id} value={String(type.id)}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filteredStalls.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-16 text-center text-muted-foreground">
            <Store className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No stalls found</p>
            <p className="text-sm">Try adjusting your search or filter</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredStalls.map((stall) => {
              const status = String(stall?.status || '').toLowerCase();
              const type = stallTypes.find((t) => String(t?.id || '') === String(stall?.stallTypeId || ''));
              const isAvailable = status === 'available';
              const isTimedReservation = status === 'reserved' || status === 'pending_payment';
              const expiresAtMs = Number(stall?.reservation?.expiresAtMs || 0);
              const remainingMs = isTimedReservation && expiresAtMs > 0 ? Math.max(0, expiresAtMs - nowMs) : 0;
              return (
                <Card key={stall.id} className="rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-black">Stall {stall.stallNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {type?.name || 'General'} · {stall.sizeLabel || `${stall.width}×${stall.height}`}
                        </p>
                      </div>
                      <Badge className={`${statusColor[status] || 'bg-slate-500'} shrink-0 capitalize`}>
                        {status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xl font-black text-primary">
                        {stall.currency} {Number(stall?.price || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Hall: {stall?.hallName || stall?.hall || 'Main Hall'}
                      </p>
                    </div>
                    {type?.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{type.description}</p>
                    ) : null}
                    {isTimedReservation && expiresAtMs > 0 ? (
                      <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2 text-xs font-semibold text-orange-700">
                        Reservation time left: {formatRemainingTime(remainingMs)}
                      </div>
                    ) : null}
                    <Button
                      className="w-full"
                      disabled={!isAvailable}
                      onClick={() => { if (isAvailable) router.push(`/expo/${expoId}/book/${stall.id}`); }}
                    >
                      {isAvailable ? 'Book Now' : status === 'booked' ? 'Sold Out' : 'Unavailable'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {bookedExhibitors.length > 0 ? (
        <section className="container mx-auto px-4 pb-12">
          <Card className="rounded-2xl border bg-white shadow-sm">
            <CardHeader className="border-b bg-slate-50/80">
              <CardTitle>Booked Stalls at Bergman Expo</CardTitle>
              <CardDescription>Visible only for stalls that are already booked. Each card shows the company or brand name with the logo provided by the exhibitor.</CardDescription>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {bookedExhibitors.map((exhibitor) => {
                  const initials = String(exhibitor?.displayName || 'E')
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase() || '')
                    .join('') || 'E';
                  return (
                    <div key={exhibitor.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border bg-slate-100 text-sm font-black text-slate-700">
                          {exhibitor.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={exhibitor.logoUrl} alt={exhibitor.displayName} className="h-full w-full object-cover" />
                          ) : (
                            initials
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black">{exhibitor.displayName}</p>
                          {exhibitor.brandName && exhibitor.brandName !== exhibitor.companyName ? (
                            <p className="truncate text-xs text-muted-foreground">Company: {exhibitor.companyName}</p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">Stall {exhibitor.stallNumber || '—'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

    </div>
  );
}
