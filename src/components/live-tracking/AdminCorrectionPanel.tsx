// src/components/live-tracking/AdminCorrectionPanel.tsx
// Admin Timing Correction Panel — submit split times for any athlete
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Clock, CheckCircle2, AlertCircle, Loader2, Pencil,
  Timer, User, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { LiveAthlete, TicketDefinition } from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────

type SplitPoint = string;
type SplitSegment = 'SWIM' | 'BIKE' | 'RUN' | 'RUN1' | 'RUN2' | 'T1' | 'T2' | 'START' | 'FINISH';

interface SplitOption {
  value: string;
  label: string;
  color: string;
  segment?: SplitSegment;
  distanceKm?: number;
  isCustom?: boolean;
}

interface CorrectionLog {
  id: string;
  bib: string;
  athleteName?: string;
  splitPoint: SplitPoint;
  timestamp: string;
  elapsedDisplay?: string;
  submittedAt: string;
  status: 'pending' | 'success' | 'error';
}

interface AdminCorrectionPanelProps {
  eventId: string;
  athletes: LiveAthlete[];
  ticketDefinitions?: TicketDefinition[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizeId = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCorrectionPanel({ eventId, athletes, ticketDefinitions = [] }: AdminCorrectionPanelProps) {
  const { toast } = useToast();

  const [bib, setBib] = useState('');
  const [splitPoint, setSplitPoint] = useState<SplitPoint | ''>('');
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [timeMode, setTimeMode] = useState<'now' | 'elapsed' | 'datetime'>('now');
  const [elapsedStr, setElapsedStr] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [log, setLog] = useState<CorrectionLog[]>([]);

  // Resolve athlete name from bib
  const matchedAthlete = athletes.find(
    a => a.bib?.toLowerCase() === bib.trim().toLowerCase()
  );

  useEffect(() => {
    if (matchedAthlete?.ticketId) {
      setSelectedTicketId(matchedAthlete.ticketId);
    }
  }, [matchedAthlete?.ticketId]);

  const selectedTicket = useMemo(() => {
    if (!ticketDefinitions?.length) return undefined;
    const byMatchedAthlete = matchedAthlete?.ticketId
      ? ticketDefinitions.find(t => t.id === matchedAthlete.ticketId)
      : undefined;
    if (byMatchedAthlete) return byMatchedAthlete;
    if (selectedTicketId) return ticketDefinitions.find(t => t.id === selectedTicketId);
    return ticketDefinitions[0];
  }, [ticketDefinitions, matchedAthlete?.ticketId, selectedTicketId]);

  const availableSplitPoints = useMemo<SplitOption[]>(() => {
    const category = selectedTicket?.ticketCategory;
    const isDua = category === 'Duathlon';
    const isTri = category === 'Triathlon';
    const isSwim = category === 'Swimming';
    const cm: any = selectedTicket?.courseMaps || {};

    const options: SplitOption[] = [
      { value: 'START', label: 'Start (Gun)', color: 'text-white', segment: 'START' },
    ];

    if (isTri || isSwim) {
      options.push({ value: 'SWIM_EXIT', label: 'Swim Exit / T1 In', color: 'text-sky-400', segment: 'SWIM' });
    }
    if (isTri || isDua) {
      options.push({ value: 'BIKE_START', label: 'Bike Start / T1 Out', color: 'text-green-300', segment: 'T1' });
      options.push({ value: 'BIKE_END', label: 'Bike End / T2 In', color: 'text-green-300', segment: 'BIKE' });
      options.push({ value: 'RUN_START', label: 'Run Start / T2 Out', color: 'text-orange-300', segment: 'T2' });
    }

    if (isDua) {
      (cm.run1Splits || []).forEach((sp: any) => {
        const id = normalizeId(sp?.id || sp?.name || `RUN1_${sp?.distance || 0}`);
        options.push({ value: id, label: `Run 1 · ${sp?.name || id} (${sp?.distance ?? '-'} km)`, color: 'text-orange-400', segment: 'RUN1', distanceKm: Number(sp?.distance || 0), isCustom: true });
      });
      (cm.bikeSplits || []).forEach((sp: any) => {
        const id = normalizeId(sp?.id || sp?.name || `BIKE_${sp?.distance || 0}`);
        options.push({ value: id, label: `Bike · ${sp?.name || id} (${sp?.distance ?? '-'} km)`, color: 'text-green-400', segment: 'BIKE', distanceKm: Number(sp?.distance || 0), isCustom: true });
      });
      (cm.run2Splits || cm.runSplits || []).forEach((sp: any) => {
        const id = normalizeId(sp?.id || sp?.name || `RUN2_${sp?.distance || 0}`);
        options.push({ value: id, label: `Run 2 · ${sp?.name || id} (${sp?.distance ?? '-'} km)`, color: 'text-orange-400', segment: 'RUN2', distanceKm: Number(sp?.distance || 0), isCustom: true });
      });
    } else {
      (cm.swimSplits || []).forEach((sp: any) => {
        const id = normalizeId(sp?.id || sp?.name || `SWIM_${sp?.distance || 0}`);
        options.push({ value: id, label: `Swim · ${sp?.name || id} (${sp?.distance ?? '-'} km)`, color: 'text-sky-400', segment: 'SWIM', distanceKm: Number(sp?.distance || 0), isCustom: true });
      });
      (cm.bikeSplits || []).forEach((sp: any) => {
        const id = normalizeId(sp?.id || sp?.name || `BIKE_${sp?.distance || 0}`);
        options.push({ value: id, label: `Bike · ${sp?.name || id} (${sp?.distance ?? '-'} km)`, color: 'text-green-400', segment: 'BIKE', distanceKm: Number(sp?.distance || 0), isCustom: true });
      });
      (cm.runSplits || []).forEach((sp: any) => {
        const id = normalizeId(sp?.id || sp?.name || `RUN_${sp?.distance || 0}`);
        options.push({ value: id, label: `Run · ${sp?.name || id} (${sp?.distance ?? '-'} km)`, color: 'text-orange-400', segment: 'RUN', distanceKm: Number(sp?.distance || 0), isCustom: true });
      });
    }

    options.push({ value: 'FINISH', label: 'Finish Line', color: 'text-yellow-400', segment: 'FINISH' });
    return options;
  }, [selectedTicket]);

  const selectedSplit = useMemo(
    () => availableSplitPoints.find(s => s.value === splitPoint),
    [availableSplitPoints, splitPoint]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bib.trim() || !splitPoint) {
      toast({ variant: 'destructive', title: 'Missing Fields', description: 'BIB and split point are required.' });
      return;
    }

    let timestamp: string = new Date().toISOString();
    let elapsedSeconds: number | undefined;

    if (timeMode === 'elapsed') {
      const raw = elapsedStr.trim();
      if (!raw) {
        toast({ variant: 'destructive', title: 'Invalid Time', description: 'Enter elapsed time as HH:MM:SS from race gun.' });
        return;
      }
      const parts = raw.split(':').map(n => parseInt(n, 10) || 0);
      elapsedSeconds = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parseInt(raw, 10) || 0;
    } else if (timeMode === 'datetime') {
      if (!manualTime) {
        toast({ variant: 'destructive', title: 'Invalid Time', description: 'Please enter a valid date/time.' });
        return;
      }
      timestamp = new Date(manualTime).toISOString();
    } else {
      // 'now' — also compute elapsed from athlete startTime if available
      if (matchedAthlete?.startTime && matchedAthlete.startTime > 0) {
        elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - matchedAthlete.startTime);
      }
    }

    const elapsedDisplay = elapsedSeconds !== undefined
      ? `${Math.floor(elapsedSeconds / 3600)}:${String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`
      : undefined;

    const logId = `${Date.now()}`;
    const logEntry: CorrectionLog = {
      id: logId,
      bib: bib.trim(),
      athleteName: matchedAthlete?.name,
      splitPoint: splitPoint as SplitPoint,
      timestamp,
      elapsedDisplay,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    };

    setLog(prev => [logEntry, ...prev].slice(0, 50));
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/live/admin/timing-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          bib: bib.trim(),
          splitPoint,
          timestamp,
          elapsedSeconds,
          adminKey,
          splitMeta: selectedSplit
            ? {
                label: selectedSplit.label,
                segment: selectedSplit.segment,
                distanceKm: selectedSplit.distanceKm,
                isCustom: !!selectedSplit.isCustom,
                ticketId: selectedTicket?.id,
              }
            : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Submission failed');
      }

      setLog(prev =>
        prev.map(l => l.id === logId ? { ...l, status: 'success' } : l)
      );
      toast({
        title: '✅ Correction Recorded',
        description: `${splitPoint} for BIB ${bib.trim()}${elapsedDisplay ? ` @ ${elapsedDisplay}` : ` at ${new Date(timestamp).toLocaleTimeString()}`}`,
      });

      // Reset BIB + split after success (keep time setting)
      setBib('');
      setSplitPoint('');
    } catch (err: any) {
      setLog(prev =>
        prev.map(l => l.id === logId ? { ...l, status: 'error' } : l)
      );
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
        <Shield className="h-6 w-6 text-amber-400 shrink-0" />
        <div>
          <p className="font-black text-sm uppercase tracking-widest text-amber-300">Timing Official Access</p>
          <p className="text-xs text-amber-200/60 mt-0.5">
            All corrections are logged and timestamped. Use responsibly.
          </p>
        </div>
      </div>

      {/* Form */}
      <Card className="bg-slate-800/60 border-slate-700/60">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-black uppercase tracking-widest text-white flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Submit Timing Correction
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Record a split time for any athlete by BIB number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* BIB + athlete lookup */}
            <div className="space-y-1.5">
              <Label htmlFor="bib" className="text-xs font-black uppercase tracking-widest text-slate-400">
                <User className="inline h-3 w-3 mr-1 -mt-px" />
                BIB Number
              </Label>
              <div className="flex gap-2">
                <Input
                  id="bib"
                  value={bib}
                  onChange={e => setBib(e.target.value)}
                  placeholder="e.g. 101"
                  className="bg-slate-900 border-slate-600 text-white font-mono h-11 flex-1"
                />
                {matchedAthlete && (
                  <div className="flex items-center px-3 rounded-lg bg-green-500/10 border border-green-500/30 min-w-0">
                    <span className="text-green-400 text-xs font-bold truncate max-w-[140px]">
                      ✓ {matchedAthlete.name}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Split Point */}
            {ticketDefinitions.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-black uppercase tracking-widest text-slate-400">Category</Label>
                <Select
                  value={selectedTicket?.id || selectedTicketId || ''}
                  onValueChange={(v) => setSelectedTicketId(v)}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-600 text-white h-11">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {ticketDefinitions.map(td => (
                      <SelectItem key={td.id} value={td.id}>{td.ticketName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-400">
                <Timer className="inline h-3 w-3 mr-1 -mt-px" />
                Split Point
              </Label>
              <Select value={splitPoint} onValueChange={v => setSplitPoint(v as SplitPoint)}>
                <SelectTrigger className="bg-slate-900 border-slate-600 text-white h-11">
                  <SelectValue placeholder="Select checkpoint…" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  {availableSplitPoints.map(sp => (
                    <SelectItem key={sp.value} value={sp.value} className="font-medium">
                      <span className={cn('font-bold', sp.color)}>{sp.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Timestamp */}
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase tracking-widest text-slate-400">
                <Clock className="inline h-3 w-3 mr-1 -mt-px" />
                  Time Entry
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                    variant={timeMode === 'now' ? 'default' : 'outline'}
                    onClick={() => setTimeMode('now')}
                  className={cn(
                    'h-10 flex-1 font-bold text-xs uppercase tracking-widest rounded-lg',
                      timeMode === 'now'
                      ? 'bg-primary text-white'
                      : 'border-slate-600 text-slate-300 bg-slate-900 hover:bg-slate-700'
                  )}
                >
                  ⚡ Record Now
                </Button>
                <Button
                  type="button"
                  size="sm"
                    variant={timeMode === 'elapsed' ? 'default' : 'outline'}
                    onClick={() => setTimeMode('elapsed')}
                  className={cn(
                    'h-10 flex-1 font-bold text-xs uppercase tracking-widest rounded-lg',
                      timeMode === 'elapsed'
                      ? 'bg-primary text-white'
                      : 'border-slate-600 text-slate-300 bg-slate-900 hover:bg-slate-700'
                  )}
                >
                    ⏱ Elapsed
                </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={timeMode === 'datetime' ? 'default' : 'outline'}
                    onClick={() => setTimeMode('datetime')}
                    className={cn(
                      'h-10 flex-1 font-bold text-xs uppercase tracking-widest rounded-lg',
                      timeMode === 'datetime'
                        ? 'bg-primary text-white'
                        : 'border-slate-600 text-slate-300 bg-slate-900 hover:bg-slate-700'
                    )}
                  >
                    📅 Clock
                  </Button>
              </div>
                {timeMode === 'elapsed' && (
                  <div className="space-y-1">
                    <Input
                      placeholder="HH:MM:SS from gun start"
                      value={elapsedStr}
                      onChange={e => setElapsedStr(e.target.value)}
                      className="bg-slate-900 border-slate-600 text-white h-11 font-mono"
                    />
                    <p className="text-[11px] text-slate-500">Elapsed from race gun · e.g. 01:23:45</p>
                  </div>
                )}
                {timeMode === 'datetime' && (
                <Input
                  type="datetime-local"
                  value={manualTime}
                  onChange={e => setManualTime(e.target.value)}
                  step="1"
                  className="bg-slate-900 border-slate-600 text-white h-11"
                />
              )}
            </div>

            {/* Admin Key */}
            <div className="space-y-1.5">
              <Label htmlFor="adminKey" className="text-xs font-black uppercase tracking-widest text-slate-400">
                <Shield className="inline h-3 w-3 mr-1 -mt-px" />
                Admin Key
              </Label>
              <Input
                id="adminKey"
                type="password"
                value={adminKey}
                onChange={e => setAdminKey(e.target.value)}
                placeholder="Enter admin key"
                className="bg-slate-900 border-slate-600 text-white h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !bib || !splitPoint}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-sm rounded-xl shadow-lg shadow-primary/20"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Submit Correction
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Audit Log */}
      {log.length > 0 && (
        <Card className="bg-slate-800/60 border-slate-700/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-300">
              Correction Log ({log.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-64 overflow-y-auto">
            {log.map(entry => (
              <div
                key={entry.id}
                className={cn(
                  'flex items-start gap-3 px-3 py-2 rounded-lg border text-xs',
                  entry.status === 'success' && 'bg-green-500/10 border-green-500/30',
                  entry.status === 'error'   && 'bg-red-500/10 border-red-500/30',
                  entry.status === 'pending' && 'bg-slate-700/40 border-slate-600/40'
                )}
              >
                {entry.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />}
                {entry.status === 'error'   && <AlertCircle  className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                {entry.status === 'pending' && <Loader2      className="h-4 w-4 text-slate-400 mt-0.5 shrink-0 animate-spin" />}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white">
                    BIB {entry.bib}{entry.athleteName ? ` · ${entry.athleteName}` : ''}
                  </p>
                  <p className="text-slate-400">
                    {entry.splitPoint} @ {entry.elapsedDisplay ?? new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9px] font-black uppercase shrink-0',
                    entry.status === 'success' && 'border-green-500/40 text-green-400',
                    entry.status === 'error'   && 'border-red-500/40 text-red-400',
                    entry.status === 'pending' && 'border-slate-500/40 text-slate-400'
                  )}
                >
                  {entry.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
