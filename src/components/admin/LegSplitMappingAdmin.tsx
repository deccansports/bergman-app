'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Map as MapIcon,
  PanelRightOpen,
  Play,
  RefreshCw,
  Route,
  Save,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type LegMapping = {
  leg_index: number;
  leg_name: string;
  display_order: number;
  enabled: boolean;
  km_marking?: number | null;
  cutoff_type?: 'cumulative' | 'overall' | 'none' | null;
  cutoff_value?: number | null;
  metadata?: Record<string, any>;
};

type SplitMapping = {
  split_index: number;
  split_name: string;
  custom_display_name?: string;
  contest_uuid?: string;
  timing_point_id: string;
  timing_point_name: string;
  leg_index: number;
  assigned_leg?: string;
  display_order: number;
  distance?: number | null;
  split_type?: string | null;
  visibility?: 'visible' | 'hidden';
  km_marking?: number | null;
  cutoff_type?: 'cumulative' | 'overall' | 'none' | null;
  cutoff_value?: number | null;
  metadata?: Record<string, any>;
};

type Contest = { id: string; name: string };
type PreviewSplitState = 'completed' | 'current' | 'upcoming';

const UNASSIGNED_VALUE = '__unassigned__';

function normalize(value: unknown): string {
  return String(value ?? '').trim();
}

function formatDistance(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value);
  return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)} km`;
}

function normalizeOptionalNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCutoffTime(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const totalSeconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseCutoffTimeInput(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(':').map((part) => part.trim());
  if (parts.some((part) => part === '' || !/^\d+$/.test(part))) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number);
    return (minutes * 60) + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number);
    return (hours * 3600) + (minutes * 60) + seconds;
  }
  return null;
}

function getSplitKmMarking(split: SplitMapping) {
  return normalizeOptionalNumber(split.km_marking ?? split.distance ?? split.metadata?.km_marking ?? split.metadata?.distance ?? null);
}

function getSplitDistanceLabel(split: SplitMapping) {
  const km = getSplitKmMarking(split);
  if (km === null) return '—';
  return formatDistance(km);
}

function getSplitCutoffLabel(split: SplitMapping) {
  const cutoffType = normalize(split.cutoff_type ?? split.metadata?.cutoff_type ?? '');
  const cutoffValue = normalizeOptionalNumber(split.cutoff_value ?? split.metadata?.cutoff_value ?? null);
  if (!cutoffType || cutoffType === 'none') return '—';
  const typeLabel = cutoffType === 'cumulative' ? 'Cumulative cutoff' : 'Overall finish cutoff';
  return cutoffValue !== null ? `${typeLabel} • ${formatCutoffTime(cutoffValue)}` : typeLabel;
}

function getLegKmMarking(leg: LegMapping) {
  return normalizeOptionalNumber(leg.km_marking ?? leg.metadata?.km_marking ?? null);
}

function getLegCutoffLabel(leg: LegMapping) {
  const cutoffType = normalize(leg.cutoff_type ?? leg.metadata?.cutoff_type ?? '');
  const cutoffValue = normalizeOptionalNumber(leg.cutoff_value ?? leg.metadata?.cutoff_value ?? null);
  if (!cutoffType || cutoffType === 'none') return '—';
  const typeLabel = cutoffType === 'cumulative' ? 'Cumulative cutoff' : 'Overall finish cutoff';
  return cutoffValue !== null ? `${typeLabel} • ${formatCutoffTime(cutoffValue)}` : typeLabel;
}

function getImportedSplitName(split: SplitMapping) {
  return normalize(split.metadata?.imported_split_name || split.timing_point_name || split.split_name || `Split ${split.split_index}`);
}

function getSplitDisplayName(split: SplitMapping) {
  return normalize(split.custom_display_name || split.split_name || split.timing_point_name || `Split ${split.split_index}`);
}

function getLegThemeBadge(leg: LegMapping) {
  const token = normalize(leg.leg_name).toLowerCase();
  if (token.includes('swim')) return 'border-blue-500/40 bg-blue-500/10 text-blue-300';
  if (token.includes('bike')) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (token.includes('run')) return 'border-red-500/40 bg-red-500/10 text-red-300';
  return 'border-border bg-background text-foreground';
}

function getAssignedLegLabel(split: SplitMapping, legsByIndex: Record<number, LegMapping>) {
  return normalize(legsByIndex[split.leg_index]?.leg_name || split.assigned_leg || split.split_type || 'Unassigned');
}

function sortSplits(list: SplitMapping[]) {
  return [...list].sort((a, b) => a.display_order - b.display_order || a.split_index - b.split_index);
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function PreviewSplitRow({ split, state, onClick, legLabel }: { split: SplitMapping; state: PreviewSplitState; onClick: () => void; legLabel: string; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
        state === 'current'
          ? 'border-sky-500/40 bg-sky-500/10'
          : state === 'completed'
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : 'border-border bg-background hover:bg-muted/50'
      }`}
    >
      <div className="shrink-0">
        {state === 'completed' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : state === 'current' ? <Play className="h-4 w-4 text-sky-500" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{getSplitDisplayName(split)}</div>
        <div className="truncate text-xs text-muted-foreground">
          Imported: {getImportedSplitName(split)}{getSplitDistanceLabel(split) !== '—' ? ` • ${getSplitDistanceLabel(split)}` : ''}
        </div>
      </div>
      <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">{legLabel}</div>
      <Badge variant={state === 'current' ? 'default' : 'outline'} className="shrink-0">#{split.split_index}</Badge>
    </button>
  );
}

export function LegSplitMappingAdmin({ eventId: initialEventId }: { eventId?: string }) {
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [eventId, setEventId] = useState(initialEventId?.trim() || '');
  const [eventName, setEventName] = useState('');
  const [contestId, setContestId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contests, setContests] = useState<Contest[]>([]);
  const [legs, setLegs] = useState<LegMapping[]>([]);
  const [splits, setSplits] = useState<SplitMapping[]>([]);
  const [expandedLegIndex, setExpandedLegIndex] = useState<number | null>(null);
  const [selectedSplitIndex, setSelectedSplitIndex] = useState<number | null>(null);
  const [previewSplitIndex, setPreviewSplitIndex] = useState<number | null>(null);
  const [draggedSplitIndex, setDraggedSplitIndex] = useState<number | null>(null);
  const [dragOverSplitIndex, setDragOverSplitIndex] = useState<number | null>(null);

  useEffect(() => {
    const loadEventData = async () => {
      if (!eventId.trim()) {
        setEventName('');
        setContests([]);
        setContestId('');
        return;
      }

      setLoadingEvent(true);
      try {
        const response = await fetch(`/api/admin/live-tracking/leg-split-mapping?eventId=${encodeURIComponent(eventId.trim())}`);
        const data = await response.json();

        if (data?.success) {
          setEventName(data.event_name || eventId.trim());
          const nextContests = (data.contests || []).filter((row: Contest) => row?.id && row?.name);
          setContests(nextContests);
          setContestId((prev) => {
            if (prev && nextContests.some((row: Contest) => row.id === prev)) return prev;
            return nextContests[0]?.id || '';
          });
        } else {
          setEventName(eventId.trim());
          setContests([]);
          setContestId('');
        }
      } catch (err) {
        console.error('Failed to load event data:', err);
        setEventName(eventId.trim());
        setContests([]);
        setContestId('');
      } finally {
        setLoadingEvent(false);
      }
    };

    void loadEventData();
  }, [eventId]);

  const loadData = useCallback(async () => {
    if (!eventId.trim() || !contestId.trim()) {
      setLegs([]);
      setSplits([]);
      setExpandedLegIndex(null);
      setSelectedSplitIndex(null);
      setPreviewSplitIndex(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('eventId', eventId.trim());
      params.set('contestId', contestId.trim());

      const response = await fetch(`/api/admin/live-tracking/leg-split-mapping?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load mapping data');
      }

      const nextLegs = (data.legs || []).sort((a: LegMapping, b: LegMapping) => a.display_order - b.display_order);
      const nextSplits = (data.splits || []).sort((a: SplitMapping, b: SplitMapping) => a.split_index - b.split_index);
      setLegs(nextLegs);
      setSplits(nextSplits);

      const firstLegWithSplits = nextLegs.find((leg: LegMapping) => nextSplits.some((split: SplitMapping) => split.leg_index === leg.leg_index));
      setExpandedLegIndex(firstLegWithSplits?.leg_index ?? nextLegs[0]?.leg_index ?? null);
      setSelectedSplitIndex(nextSplits[0]?.split_index ?? null);
      setPreviewSplitIndex(nextSplits.find((split: SplitMapping) => split.visibility !== 'hidden')?.split_index ?? nextSplits[0]?.split_index ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load mapping';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [eventId, contestId, toast]);

  useEffect(() => {
    if (eventId.trim() && contestId.trim()) {
      void loadData();
    }
  }, [eventId, contestId, loadData]);

  const orderedLegs = useMemo(() => [...legs].sort((a, b) => a.display_order - b.display_order), [legs]);
  const orderedSplits = useMemo(() => [...splits].sort((a, b) => a.split_index - b.split_index), [splits]);
  const previewSplits = useMemo(() => [...splits].filter((split) => split.visibility !== 'hidden').sort((a, b) => a.display_order - b.display_order || a.split_index - b.split_index), [splits]);
  const previewFlowSplits = useMemo(() => {
    const visibleSplits = orderedSplits.filter((split) => split.visibility !== 'hidden');
    const legIndexSet = new Set(orderedLegs.map((leg) => leg.leg_index));
    const groups = new Map<number, SplitMapping[]>();

    for (const leg of orderedLegs) {
      groups.set(leg.leg_index, []);
    }

    for (const split of visibleSplits) {
      const bucket = groups.get(split.leg_index) || [];
      bucket.push(split);
      groups.set(split.leg_index, bucket);
    }

    const flow: SplitMapping[] = [];
    for (const leg of orderedLegs) {
      const legSplits = groups.get(leg.leg_index) || [];
      flow.push(
        ...legSplits.sort((a, b) => a.display_order - b.display_order || a.split_index - b.split_index)
      );
    }

    const orphans = visibleSplits.filter((split) => !legIndexSet.has(split.leg_index));
    flow.push(...orphans.sort((a, b) => a.display_order - b.display_order || a.split_index - b.split_index));
    return flow;
  }, [orderedLegs, orderedSplits]);

  const legsByIndex = useMemo<Record<number, LegMapping>>(() => orderedLegs.reduce<Record<number, LegMapping>>((acc, leg) => { acc[leg.leg_index] = leg; return acc; }, {}), [orderedLegs]);

  const groupsByLeg = useMemo(() => {
    const groups = new Map<number, SplitMapping[]>();
    for (const leg of orderedLegs) groups.set(leg.leg_index, []);
    for (const split of orderedSplits) {
      const bucket = groups.get(split.leg_index) || [];
      bucket.push(split);
      groups.set(split.leg_index, bucket);
    }
    for (const [key, rows] of groups.entries()) {
      groups.set(key, [...rows].sort((a, b) => a.display_order - b.display_order || a.split_index - b.split_index));
    }
    return groups;
  }, [orderedLegs, orderedSplits]);

  const unassignedSplits = useMemo(() => orderedSplits.filter((split) => !legsByIndex[split.leg_index]), [legsByIndex, orderedSplits]);

  const selectedSplit = useMemo(() => {
    if (!selectedSplitIndex) return orderedSplits[0] || null;
    return orderedSplits.find((split) => split.split_index === selectedSplitIndex) || orderedSplits[0] || null;
  }, [orderedSplits, selectedSplitIndex]);

  const previewCurrentSplit = useMemo(() => {
    if (previewSplitIndex) {
      const candidate = previewFlowSplits.find((split) => split.split_index === previewSplitIndex);
      if (candidate) return candidate;
    }
    return previewFlowSplits[0] || null;
  }, [previewFlowSplits, previewSplitIndex]);

  const previewRows = useMemo(() => {
    const currentIndex = previewCurrentSplit ? previewFlowSplits.findIndex((split) => split.split_index === previewCurrentSplit.split_index) : -1;
    return previewFlowSplits.map((split, index) => ({
      split,
      state:
        currentIndex === -1
          ? ('upcoming' as const)
          : index < currentIndex
            ? ('completed' as const)
            : index === currentIndex
              ? ('current' as const)
              : ('upcoming' as const),
    }));
  }, [previewCurrentSplit, previewFlowSplits]);

  const rebalanceSplits = useCallback(
    (nextSplits: SplitMapping[]) => {
      const byLeg = new Map<number, SplitMapping[]>();

      for (const split of nextSplits) {
        const key = split.leg_index || 0;
        const bucket = byLeg.get(key) || [];
        bucket.push(split);
        byLeg.set(key, bucket);
      }

      const rebuilt: SplitMapping[] = [];
      for (const leg of orderedLegs) {
        const legSplits = byLeg.get(leg.leg_index) || [];
        legSplits.forEach((split, index) => {
          rebuilt.push({
            ...split,
            leg_index: leg.leg_index,
            assigned_leg: leg.leg_name,
            display_order: index + 1,
          });
        });
      }

      const orphanSplits = byLeg.get(0) || [];
      orphanSplits.forEach((split, index) => {
        rebuilt.push({
          ...split,
          leg_index: 0,
          display_order: index + 1,
        });
      });

      return rebuilt;
    },
    [orderedLegs]
  );

  const moveSplit = useCallback(
    (sourceSplitIndex: number, targetLegIndex: number, targetSplitIndex?: number | null) => {
      setSplits((prev) => {
        const source = prev.find((split) => split.split_index === sourceSplitIndex);
        if (!source) return prev;

        const remaining = prev.filter((split) => split.split_index !== sourceSplitIndex);
        const targetLegSplits = remaining
          .filter((split) => split.leg_index === targetLegIndex)
          .sort((a, b) => a.display_order - b.display_order || a.split_index - b.split_index);

        const insertAt =
          targetSplitIndex !== undefined && targetSplitIndex !== null
            ? Math.max(0, targetLegSplits.findIndex((split) => split.split_index === targetSplitIndex))
            : targetLegSplits.length;

        const nextTargetLegSplits = [...targetLegSplits];
        nextTargetLegSplits.splice(insertAt < 0 ? nextTargetLegSplits.length : insertAt, 0, {
          ...source,
          leg_index: targetLegIndex,
          assigned_leg: legsByIndex[targetLegIndex]?.leg_name || source.assigned_leg || source.split_type || '',
        });

        const otherSplits = remaining.filter((split) => split.leg_index !== targetLegIndex);
        const next = [...otherSplits, ...nextTargetLegSplits];
        const rebalance = rebalanceSplits(next);
        setSelectedSplitIndex(sourceSplitIndex);
        setPreviewSplitIndex(sourceSplitIndex);
        setExpandedLegIndex(targetLegIndex || expandedLegIndex);
        return rebalance;
      });
    },
    [expandedLegIndex, legsByIndex, rebalanceSplits]
  );

  const handleSplitDragStart = (splitIndex: number) => {
    setDraggedSplitIndex(splitIndex);
  };

  const handleSplitDragEnd = () => {
    setDraggedSplitIndex(null);
    setDragOverSplitIndex(null);
  };

  const handleDropSplitOnLeg = (legIndex: number) => {
    if (draggedSplitIndex === null) return;
    moveSplit(draggedSplitIndex, legIndex, null);
    handleSplitDragEnd();
  };

  const handleDropOnSplit = (split: SplitMapping) => {
    if (draggedSplitIndex === null) return;
    moveSplit(draggedSplitIndex, split.leg_index, split.split_index);
    handleSplitDragEnd();
  };

  const handleSelectSplit = useCallback((split: SplitMapping) => {
    setSelectedSplitIndex(split.split_index);
    setPreviewSplitIndex(split.split_index);
    setExpandedLegIndex(split.leg_index || expandedLegIndex);
  }, [expandedLegIndex]);

  const updateSelectedSplit = useCallback((updater: (split: SplitMapping) => SplitMapping) => {
    if (!selectedSplitIndex) return;
    setSplits((prev) => prev.map((split) => (split.split_index === selectedSplitIndex ? updater(split) : split)));
  }, [selectedSplitIndex]);

  const handleUpdateSplitName = (value: string) => updateSelectedSplit((split) => ({ ...split, split_name: value, custom_display_name: value }));
  const handleUpdateSplitKmMarking = (value: number | null) => updateSelectedSplit((split) => ({
    ...split,
    km_marking: value,
    distance: value,
    metadata: { ...(split.metadata || {}), km_marking: value, distance: value },
  }));
  const handleUpdateSplitCutoffType = (value: 'cumulative' | 'overall' | 'none') => updateSelectedSplit((split) => ({
    ...split,
    cutoff_type: value,
    metadata: { ...(split.metadata || {}), cutoff_type: value, cutoff_mode: 'race_elapsed_time_including_transitions' },
  }));
  const handleUpdateSplitCutoffValue = (value: number | null) => updateSelectedSplit((split) => ({
    ...split,
    cutoff_value: value,
    metadata: { ...(split.metadata || {}), cutoff_value: value, cutoff_mode: 'race_elapsed_time_including_transitions' },
  }));
  const handleUpdateSplitDisplayOrder = (value: number) => updateSelectedSplit((split) => ({ ...split, display_order: Number.isFinite(value) ? value : split.display_order }));
  const handleUpdateSplitVisibility = () => updateSelectedSplit((split) => ({ ...split, visibility: split.visibility === 'hidden' ? 'visible' : 'hidden' }));
  const handleUpdateSplitLeg = (value: string) => {
    const nextLegIndex = value === UNASSIGNED_VALUE ? 0 : Number(value);
    const nextLegLabel = nextLegIndex > 0 ? legsByIndex[nextLegIndex]?.leg_name || '' : '';
    updateSelectedSplit((split) => ({
      ...split,
      leg_index: nextLegIndex,
      assigned_leg: nextLegLabel || split.assigned_leg || split.split_type || '',
      split_type: nextLegLabel || split.split_type || '',
    }));
    setExpandedLegIndex(nextLegIndex || expandedLegIndex);
  };

  const handleUpdateLegKmMarking = (legIndex: number, value: number | null) => {
    setLegs((prev) => prev.map((leg) => (
      leg.leg_index === legIndex
        ? { ...leg, km_marking: value, metadata: { ...(leg.metadata || {}), km_marking: value } }
        : leg
    )));
  };

  const handleUpdateLegCutoffType = (legIndex: number, value: 'cumulative' | 'overall' | 'none') => {
    setLegs((prev) => prev.map((leg) => (
      leg.leg_index === legIndex
        ? { ...leg, cutoff_type: value, metadata: { ...(leg.metadata || {}), cutoff_type: value, cutoff_mode: 'race_elapsed_time_including_transitions' } }
        : leg
    )));
  };

  const handleUpdateLegCutoffValue = (legIndex: number, value: number | null) => {
    setLegs((prev) => prev.map((leg) => (
      leg.leg_index === legIndex
        ? { ...leg, cutoff_value: value, metadata: { ...(leg.metadata || {}), cutoff_value: value, cutoff_mode: 'race_elapsed_time_including_transitions' } }
        : leg
    )));
  };

  const handleSaveMapping = async () => {
    if (!eventId.trim() || !contestId.trim()) {
      setError('Event and Contest must be selected');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/live-tracking/leg-split-mapping', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId.trim(),
          contest_id: contestId.trim(),
          contest_uuid: contestId.trim(),
          contest_name: contests.find((c) => c.id === contestId.trim())?.name || '',
          legs: [...orderedLegs].sort((a, b) => a.display_order - b.display_order),
          splits: [...splits].sort((a, b) => a.split_index - b.split_index),
          updated_by: 'admin-ui',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.message || 'Failed to save mapping');

      toast({ title: 'Saved', description: 'Race flow saved successfully.' });
      void loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save mapping';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetMapping = () => {
    if (confirm('Reset to imported mapping? This will discard unsaved changes.')) void loadData();
  };

  const scrollToPreview = () => {
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading && !orderedLegs.length) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin" /></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-2xl">Race Flow Builder</CardTitle>
                  <CardDescription>Import splits in Feibot split_index order, then customize presentation for athletes.</CardDescription>
                </div>
                <Button variant="outline" onClick={scrollToPreview} disabled={previewSplits.length === 0}><PanelRightOpen className="mr-2 h-4 w-4" />Preview Athlete Timeline</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

              <div className="grid gap-4 md:grid-cols-3">
                <Card className="border-dashed">
                  <CardHeader className="pb-3"><CardTitle className="text-base">Step 1 - Select Event</CardTitle><CardDescription>Choose Event</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    <Input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="Enter event ID" />
                    <div className="rounded-lg border bg-muted/50 p-3"><div className="text-xs text-muted-foreground">Selected Event</div><div className="truncate text-sm font-medium">{loadingEvent ? 'Loading...' : eventName || '—'}</div></div>
                  </CardContent>
                </Card>
                <Card className="border-dashed md:col-span-2">
                  <CardHeader className="pb-3"><CardTitle className="text-base">Step 2 - Select Contest</CardTitle><CardDescription>Choose Contest. Imported legs and splits load automatically.</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    <Select value={contestId} onValueChange={setContestId}><SelectTrigger><SelectValue placeholder="Select a contest" /></SelectTrigger><SelectContent>{contests.length === 0 ? <div className="px-2 py-2 text-xs text-muted-foreground">No contests found</div> : contests.map((contest) => <SelectItem key={contest.id} value={contest.id}>{contest.name}</SelectItem>)}</SelectContent></Select>
                    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Imported Legs</div><div className="mt-1 text-lg font-semibold">{orderedLegs.length}</div></div><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Imported Splits</div><div className="mt-1 text-lg font-semibold">{orderedSplits.length}</div></div><div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Visible Preview Splits</div><div className="mt-1 text-lg font-semibold">{previewSplits.length}</div></div></div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">Step 3 - Race Flow Builder</CardTitle><CardDescription>Expand one leg at a time. Click any split to edit it in the side panel. Splits are shown in imported split_index order.</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {orderedLegs.length === 0 ? <div className="text-sm text-muted-foreground">No legs loaded. Select a contest to load imported legs and splits.</div> : orderedLegs.map((leg) => {
                    const isExpanded = expandedLegIndex === leg.leg_index;
                    const legSplits = groupsByLeg.get(leg.leg_index) || [];
                    return (
                        <div key={leg.leg_index} className={`overflow-hidden rounded-2xl border bg-background ${draggedSplitIndex !== null ? 'ring-1 ring-sky-400/30' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={() => handleDropSplitOnLeg(leg.leg_index)}>
                        <button type="button" onClick={() => setExpandedLegIndex(isExpanded ? null : leg.leg_index)} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-muted/40">
                          <div className="flex items-center gap-3">
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className={`font-semibold ${getLegThemeBadge(leg)}`}>{leg.leg_name}</div>
                                {!leg.enabled && <Badge variant="outline">Hidden</Badge>}
                                <Badge variant="outline">Leg {leg.leg_index}</Badge>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{legSplits.length} split{legSplits.length === 1 ? '' : 's'}</span>
                                <span>• KM {getLegKmMarking(leg) !== null ? `${getLegKmMarking(leg)} km` : '—'}</span>
                                <span>• Cutoff Time {getLegCutoffLabel(leg)}</span>
                              </div>
                            </div>
                          </div>
                          <Badge variant="outline">{legSplits.length}</Badge>
                        </button>
                        {isExpanded && (
                          <div className="border-t bg-muted/20 p-4">
                            <div className="mb-3 grid gap-3 sm:grid-cols-3">
                              <div>
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Leg KM</div>
                                <Input
                                  className="mt-1"
                                  type="number"
                                  step="0.1"
                                  value={getLegKmMarking(leg) ?? ''}
                                  onChange={(e) => handleUpdateLegKmMarking(leg.leg_index, e.target.value === '' ? null : Number(e.target.value))}
                                  placeholder="Enter km"
                                />
                              </div>
                              <div>
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Leg Cutoff Type</div>
                                <Select value={leg.cutoff_type || (leg.metadata?.cutoff_type as string) || 'none'} onValueChange={(value) => handleUpdateLegCutoffType(leg.leg_index, value as 'cumulative' | 'overall' | 'none')}>
                                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select cutoff type" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No cutoff</SelectItem>
                                    <SelectItem value="cumulative">Cumulative cutoff</SelectItem>
                                    <SelectItem value="overall">Overall cutoff</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Leg Cutoff Time</div>
                                <Input
                                  key={`leg-cutoff-${leg.leg_index}`}
                                  className="mt-1"
                                  type="text"
                                  inputMode="numeric"
                                  defaultValue={formatCutoffTime(leg.cutoff_value)}
                                  onBlur={(e) => handleUpdateLegCutoffValue(leg.leg_index, parseCutoffTimeInput(e.target.value))}
                                  placeholder="HH:MM:SS"
                                />
                                <div className="mt-1 text-[11px] text-muted-foreground">This is cumulative elapsed race time from official start, including transitions.</div>
                              </div>
                            </div>
                            <div className="grid gap-3 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid-cols-[1.6fr_1.2fr_0.9fr_1fr]">
                              <div>Imported Split</div>
                              <div>Custom Name</div>
                              <div>KM / Cutoff Time</div>
                              <div>Status</div>
                            </div>
                            <div className="mt-2 space-y-2">
                              {legSplits.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No splits in this leg</div>
                              ) : (
                                legSplits.map((split) => {
                                  const isActive = selectedSplitIndex === split.split_index;
                                  const isDropTarget = dragOverSplitIndex === split.split_index;
                                  return (
                                    <div
                                      key={split.split_index}
                                      draggable
                                      onDragStart={(e) => {
                                        e.dataTransfer.effectAllowed = 'move';
                                        handleSplitDragStart(split.split_index);
                                      }}
                                      onDragEnd={handleSplitDragEnd}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        setDragOverSplitIndex(split.split_index);
                                      }}
                                      onDragLeave={() => {
                                        if (dragOverSplitIndex === split.split_index) setDragOverSplitIndex(null);
                                      }}
                                      onDrop={() => handleDropOnSplit(split)}
                                      className={`grid w-full gap-3 rounded-xl border px-3 py-3 text-left transition-colors sm:grid-cols-[1.6fr_1.2fr_0.9fr_1fr] ${isActive ? 'border-sky-500/50 bg-sky-500/10' : 'hover:bg-muted/50'} ${isDropTarget ? 'border-dashed border-sky-400 bg-sky-500/5' : ''}`}
                                    >
                                      <div className="flex min-w-0 items-start gap-2">
                                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => handleSelectSplit(split)}>
                                          <div className="truncate text-sm font-medium">{getImportedSplitName(split)}</div>
                                          <div className="mt-1 text-xs text-muted-foreground">
                                            Split Index {split.split_index} • {split.timing_point_name || '—'}
                                            {split.distance !== null && split.distance !== undefined ? ` • ${formatDistance(split.distance)}` : ''}
                                          </div>
                                        </button>
                                      </div>
                                      <button type="button" className="min-w-0 text-left text-sm text-foreground/90" onClick={() => handleSelectSplit(split)}>
                                        {getSplitDisplayName(split)}
                                      </button>
                                      <button type="button" className="min-w-0 text-left text-sm text-foreground/90" onClick={() => handleSelectSplit(split)}>
                                        <div className="font-mono text-xs font-semibold">{getSplitKmMarking(split) !== null ? `${getSplitKmMarking(split)} km` : '—'}</div>
                                        <div className="mt-1 truncate text-xs text-muted-foreground">Cutoff Time: {getSplitCutoffLabel(split)}</div>
                                      </button>
                                      <div className="flex items-center justify-between gap-2">
                                        <Badge variant={split.visibility === 'hidden' ? 'outline' : 'secondary'}>{split.visibility === 'hidden' ? 'Hidden' : 'Visible'}</Badge>
                                        <Badge variant="outline">{getAssignedLegLabel(split, legsByIndex)}</Badge>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {unassignedSplits.length > 0 && (
                    <div className="rounded-2xl border border-dashed p-4">
                      <div className="mb-2 text-sm font-semibold">Unassigned Splits</div>
                      <div className="space-y-2">
                        {unassignedSplits.map((split) => (
                          <div
                            key={split.split_index}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              handleSplitDragStart(split.split_index);
                            }}
                            onDragEnd={handleSplitDragEnd}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDropSplitOnLeg(0)}
                            className="flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left hover:bg-muted/50"
                          >
                            <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => handleSelectSplit(split)}>
                              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{getImportedSplitName(split)}</div>
                                <div className="text-xs text-muted-foreground">Split Index {split.split_index}</div>
                              </div>
                            </button>
                            <Badge variant="outline">Unassigned</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </div>

        <Card className="xl:sticky xl:top-6 h-fit">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><PanelRightOpen className="h-4 w-4" /> Split Editor</CardTitle><CardDescription>Click a split to edit its presentation and leg assignment.</CardDescription></CardHeader>
          <CardContent>
            {!selectedSplit ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Select a split from the flow builder to edit it here.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Imported Split</div>
                  <div className="mt-1 text-sm font-semibold">{getImportedSplitName(selectedSplit)}</div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div>Split Index: {selectedSplit.split_index}</div>
                    <div>Timing Point: {selectedSplit.timing_point_name || '—'}</div>
                    {selectedSplit.distance !== null && selectedSplit.distance !== undefined && <div>Distance: {formatDistance(selectedSplit.distance)}</div>}
                    <div>KM Marking: {getSplitKmMarking(selectedSplit) !== null ? formatDistance(getSplitKmMarking(selectedSplit)) : '—'}</div>
                    <div>Cutoff Time: {getSplitCutoffLabel(selectedSplit)}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">Assign to Leg</div>
                    <Select value={String(selectedSplit.leg_index || UNASSIGNED_VALUE)} onValueChange={handleUpdateSplitLeg}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Assign to leg" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
                        {orderedLegs.map((leg) => <SelectItem key={leg.leg_index} value={String(leg.leg_index)}>{leg.leg_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <div className="text-sm font-medium">Custom Display Name</div>
                    <Input className="mt-1" value={getSplitDisplayName(selectedSplit)} onChange={(e) => handleUpdateSplitName(e.target.value)} placeholder="Enter display name" />
                    <div className="mt-1 text-xs text-muted-foreground">Imported Feibot split name remains unchanged.</div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-sm font-medium">Display Order</div>
                      <Input className="mt-1" type="number" value={selectedSplit.display_order} onChange={(e) => handleUpdateSplitDisplayOrder(Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Visibility</div>
                      <Button variant="outline" className="mt-1 w-full justify-between" onClick={handleUpdateSplitVisibility}>
                        <span>{selectedSplit.visibility === 'hidden' ? 'Hidden' : 'Visible'}</span>
                        {selectedSplit.visibility === 'hidden' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-sm font-medium">KM Marking</div>
                      <Input
                        className="mt-1"
                        type="number"
                        step="0.1"
                        value={getSplitKmMarking(selectedSplit) ?? ''}
                        onChange={(e) => handleUpdateSplitKmMarking(e.target.value === '' ? null : Number(e.target.value))}
                        placeholder="Enter km marking"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Cutoff Type</div>
                      <Select
                        value={selectedSplit.cutoff_type || (selectedSplit.metadata?.cutoff_type as string) || 'none'}
                        onValueChange={(value) => handleUpdateSplitCutoffType(value as 'cumulative' | 'overall' | 'none')}
                      >
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select cutoff type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No cutoff</SelectItem>
                          <SelectItem value="cumulative">Cumulative cutoff</SelectItem>
                          <SelectItem value="overall">Overall cutoff</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium">Cutoff Time</div>
                    <Input
                      key={`split-cutoff-${selectedSplit.split_index}`}
                      className="mt-1 font-mono"
                      type="text"
                      inputMode="numeric"
                      defaultValue={formatCutoffTime(selectedSplit.cutoff_value)}
                      onBlur={(e) => handleUpdateSplitCutoffValue(parseCutoffTimeInput(e.target.value))}
                      placeholder="HH:MM:SS"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">This is cumulative elapsed race time from official start, including transitions.</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => void handleSaveMapping()} disabled={saving || !eventId.trim() || !contestId.trim()} className="flex-1">
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Split
                  </Button>
                  <Button onClick={handleResetMapping} variant="outline" disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Reset</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div ref={previewRef} className="space-y-6">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Route className="h-4 w-4" /> Athlete Timeline Preview</CardTitle><CardDescription>Updates instantly as you change leg assignment, display order, or custom names.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-3"><PreviewMetric label="Current Leg" value={legsByIndex[previewCurrentSplit?.leg_index || 0]?.leg_name || '—'} /><PreviewMetric label="Current Split" value={previewCurrentSplit ? getSplitDisplayName(previewCurrentSplit) : '—'} /><PreviewMetric label="Upcoming Splits" value={String(previewRows.filter((row) => row.state === 'upcoming').length)} /></div><div className="mt-4 rounded-2xl border bg-background p-4"><div className="space-y-2">{previewRows.map(({ split, state }) => <PreviewSplitRow key={split.split_index} split={split} state={state} legLabel={getAssignedLegLabel(split, legsByIndex)} onClick={() => setPreviewSplitIndex(split.split_index)} />)}</div></div></CardContent></Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Athlete Modal Preview</CardTitle><CardDescription>Preview of the public athlete modal using the current draft race flow.</CardDescription></CardHeader><CardContent><div className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900 p-5 text-white shadow-lg"><div className="flex items-start justify-between gap-4"><div><div className="text-xl font-bold">John Smith</div><div className="mt-1 text-sm text-slate-300">Bib 102</div></div><Badge className="bg-sky-500/15 text-sky-200 hover:bg-sky-500/20">{legsByIndex[previewCurrentSplit?.leg_index || 0]?.leg_name || '—'}</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><PreviewMetric label="Current Leg" value={legsByIndex[previewCurrentSplit?.leg_index || 0]?.leg_name || '—'} /><PreviewMetric label="Current Split" value={previewCurrentSplit ? getSplitDisplayName(previewCurrentSplit) : '—'} /></div><div className="mt-5 space-y-4"><div><div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Completed</div><div className="space-y-2">{previewRows.filter((row) => row.state === 'completed').length === 0 ? <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-400">No completed splits yet</div> : previewRows.filter((row) => row.state === 'completed').map((row) => <div key={row.split.split_index} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-white">{getSplitDisplayName(row.split)}</div><div className="truncate text-xs text-slate-400">{getAssignedLegLabel(row.split, legsByIndex)} • {getSplitDistanceLabel(row.split)}</div></div></div>)}</div></div><div><div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Current</div>{previewCurrentSplit ? <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-3"><div className="flex items-center gap-3"><Play className="h-4 w-4 text-sky-400" /><div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{getSplitDisplayName(previewCurrentSplit)}</div><div className="truncate text-xs text-sky-100/70">{legsByIndex[previewCurrentSplit.leg_index || 0]?.leg_name || '—'} • {getSplitDistanceLabel(previewCurrentSplit)}</div></div></div></div> : <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-400">No current split selected</div>}</div><div><div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Upcoming</div><div className="space-y-2">{previewRows.filter((row) => row.state === 'upcoming').length === 0 ? <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-400">No upcoming splits</div> : previewRows.filter((row) => row.state === 'upcoming').map((row) => <div key={row.split.split_index} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"><Circle className="h-4 w-4 text-slate-400" /><div className="min-w-0 flex-1"><div className="truncate font-medium">{getSplitDisplayName(row.split)}</div><div className="truncate text-xs text-slate-400">{getAssignedLegLabel(row.split, legsByIndex)} • {getSplitDistanceLabel(row.split)}</div></div></div>)}</div></div></div></div></CardContent></Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Race Flow Timeline Preview</CardTitle>
              <CardDescription>Visual timeline that mirrors the public split summary flow.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 rounded-3xl border bg-muted/20 p-4">
                {orderedLegs.map((leg) => {
                  const legSplits = previewSplits.filter((split) => split.leg_index === leg.leg_index);

                  return (
                    <div
                      key={leg.leg_index}
                      className="space-y-2 rounded-2xl border bg-background p-3 transition-colors border-border"
                    >
                      <div className="flex items-center gap-2">
                        <MapIcon className="h-4 w-4 text-muted-foreground" />
                        <div className="font-semibold">{leg.leg_name}</div>
                        <Badge variant="outline">{legSplits.length} splits</Badge>
                      </div>

                      <div className="space-y-2 border-l-2 border-dashed border-muted pl-4">
                        {legSplits.length === 0 ? (
                          <div className="text-xs italic text-muted-foreground">No splits in this leg</div>
                        ) : (
                          legSplits.map((split) => (
                            <div key={split.split_index} className="rounded-lg border bg-background px-3 py-2 text-sm">
                              <div className="font-medium">{getSplitDisplayName(split)}</div>
                              <div className="text-xs text-muted-foreground">
                                Imported: {getImportedSplitName(split)} • Order {split.display_order} • {split.visibility === 'hidden' ? 'Hidden' : 'Visible'}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card><CardContent className="flex flex-wrap gap-3 pt-6"><Button onClick={() => void handleSaveMapping()} disabled={saving || !eventId.trim() || !contestId.trim()} className="flex-1">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{saving ? 'Saving…' : 'Save Race Flow'}</Button><Button onClick={handleResetMapping} variant="outline" disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Reset</Button><Button onClick={scrollToPreview} variant="outline" disabled={previewSplits.length === 0}><PanelRightOpen className="mr-2 h-4 w-4" />Preview Athlete Timeline</Button></CardContent></Card>
    </div>
  );
}

/*

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, RefreshCw, Eye, EyeOff, GripVertical, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type LegMapping = {
  leg_index: number;
  leg_name: string;
  display_order: number;
  enabled: boolean;
  metadata?: Record<string, any>;
};

type SplitMapping = {
  split_index: number;
  split_name: string;
  custom_display_name?: string;
  contest_uuid?: string;
  timing_point_id: string;
  timing_point_name: string;
  leg_index: number;
  assigned_leg?: string;
  display_order: number;
  distance?: number | null;
  split_type?: string | null;
  visibility?: 'visible' | 'hidden';
  metadata?: Record<string, any>;
};

type Contest = { id: string; name: string };

export function LegSplitMappingAdmin({ eventId: initialEventId }: { eventId?: string }) {
  const { toast } = useToast();
  const [eventId, setEventId] = useState(initialEventId?.trim() || '');
  const [eventName, setEventName] = useState('');
  const [contestId, setContestId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contests, setContests] = useState<Contest[]>([]);
  const [legs, setLegs] = useState<LegMapping[]>([]);
  const [splits, setSplits] = useState<SplitMapping[]>([]);
  const [editingLegName, setEditingLegName] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Load event name and contests when eventId changes
  useEffect(() => {
    const loadEventData = async () => {
      if (!eventId.trim()) {
        setEventName('');
        setContests([]);
        setContestId('');
        return;
      }

      setLoadingEvent(true);
      try {
        const response = await fetch(`/api/admin/live-tracking/leg-split-mapping?eventId=${encodeURIComponent(eventId.trim())}`);
        const data = await response.json();

        if (data?.success) {
          setEventName(data.event_name || eventId.trim());
          const nextContests = (data.contests || []).filter((row: Contest) => row?.id && row?.name);
          setContests(nextContests);
          setContestId((prev) => (prev && nextContests.some((row: Contest) => row.id === prev) ? prev : ''));
        } else {
          setEventName(eventId.trim());
          setContests([]);
          setContestId('');
        }
      } catch (err) {
        console.error('Failed to load event data:', err);
        setEventName(eventId.trim());
        setContests([]);
        setContestId('');
      } finally {
        setLoadingEvent(false);
      }
    };

    void loadEventData();
  }, [eventId]);

  const loadData = useCallback(async () => {
    if (!eventId.trim() || !contestId.trim()) {
      setLegs([]);
      setSplits([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('eventId', eventId.trim());
      params.set('contestId', contestId.trim());

      const response = await fetch(`/api/admin/live-tracking/leg-split-mapping?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load mapping data');
      }

      setLegs((data.legs || []).sort((a: LegMapping, b: LegMapping) => a.display_order - b.display_order));
      setSplits((data.splits || []).sort((a: SplitMapping, b: SplitMapping) => a.split_index - b.split_index));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load mapping';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [eventId, contestId, toast]);

  // Auto-load data when contest is selected
  useEffect(() => {
    if (eventId.trim() && contestId.trim()) {
      void loadData();
    }
  }, [eventId, contestId, loadData]);

  const splitsByLeg = useMemo(() => {
    const groups = new Map<number, SplitMapping[]>();
    for (const leg of legs) {
      groups.set(leg.leg_index, []);
    }
    for (const split of splits) {
      const legGroup = groups.get(split.leg_index) || [];
      legGroup.push(split);
      groups.set(split.leg_index, legGroup);
    }
    for (const [key, rows] of groups.entries()) {
      groups.set(key, [...rows].sort((a, b) => a.split_index - b.split_index));
    }
    return groups;
  }, [legs, splits]);

  const unassignedSplits = useMemo(() => {
    const legIds = new Set(legs.map((leg) => leg.leg_index));
    return splits.filter((split) => !legIds.has(split.leg_index)).sort((a, b) => a.split_index - b.split_index);
  }, [legs, splits]);

  const previewLegs = useMemo(() => [...legs].sort((a, b) => a.display_order - b.display_order), [legs]);
  const previewSplits = useMemo(() => [...splits].sort((a, b) => a.split_index - b.split_index), [splits]);
  const previewSections = useMemo(() => {
    const sections = previewLegs.map((leg) => ({
      leg,
      splits: previewSplits.filter((split) => split.leg_index === leg.leg_index),
    }));
    return sections;
  }, [previewLegs, previewSplits]);

  const handleUpdateLegName = (legIndex: number, newName: string) => {
    setLegs(legs.map(leg =>
      leg.leg_index === legIndex ? { ...leg, leg_name: newName } : leg
    ));
  };

  const handleToggleLegEnabled = (legIndex: number) => {
    setLegs(legs.map(leg =>
      leg.leg_index === legIndex ? { ...leg, enabled: !leg.enabled } : leg
    ));
  };

  const handleUpdateLegDisplayOrder = (legIndex: number, displayOrder: number) => {
    setLegs(legs.map(leg =>
      leg.leg_index === legIndex ? { ...leg, display_order: Number.isFinite(displayOrder) ? displayOrder : leg.display_order } : leg
    ));
  };

  const handleUpdateLegKmMarking = (legIndex: number, value: number | null) => {
    setLegs(legs.map(leg =>
      leg.leg_index === legIndex
        ? { ...leg, km_marking: value, metadata: { ...(leg.metadata || {}), km_marking: value } }
        : leg
    ));
  };

  const handleUpdateLegCutoffType = (legIndex: number, value: 'cumulative' | 'overall' | 'none') => {
    setLegs(legs.map(leg =>
      leg.leg_index === legIndex
        ? { ...leg, cutoff_type: value, metadata: { ...(leg.metadata || {}), cutoff_type: value } }
        : leg
    ));
  };

  const handleUpdateLegCutoffValue = (legIndex: number, value: number | null) => {
    setLegs(legs.map(leg =>
      leg.leg_index === legIndex
        ? { ...leg, cutoff_value: value, metadata: { ...(leg.metadata || {}), cutoff_value: value } }
        : leg
    ));
  };

  const handleMoveSplit = (splitIndex: number, newLegIndex: number) => {
    setSplits(splits.map(split =>
      split.split_index === splitIndex ? { ...split, leg_index: newLegIndex, assigned_leg: legs.find((leg) => leg.leg_index === newLegIndex)?.leg_name || split.assigned_leg || split.split_type || '' } : split
    ));
      const [previewSplitIndex, setPreviewSplitIndex] = useState<number | null>(null);
  };

  const handleUpdateSplitName = (splitIndex: number, value: string) => {
    setSplits(splits.map(split =>
      split.split_index === splitIndex ? { ...split, split_name: value, custom_display_name: value } : split
    ));
  };

  const handleUpdateSplitDisplayOrder = (splitIndex: number, displayOrder: number) => {
    setSplits(splits.map(split =>
      split.split_index === splitIndex ? { ...split, display_order: Number.isFinite(displayOrder) ? displayOrder : split.display_order } : split
    ));
  };

  const handleToggleSplitVisibility = (splitIndex: number) => {
    setSplits(splits.map(split =>
      split.split_index === splitIndex
        ? { ...split, visibility: split.visibility === 'hidden' ? 'visible' : 'hidden' }
        : split
    ));
  };

  const handleSaveMapping = async () => {
    if (!eventId.trim() || !contestId.trim()) {
      setError('Event and Contest must be selected');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/live-tracking/leg-split-mapping', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId.trim(),
          contest_id: contestId.trim(),
          contest_name: contests.find(c => c.id === contestId.trim())?.name || '',
          legs: [...legs].sort((a, b) => a.display_order - b.display_order),
          splits: [...splits].sort((a, b) => a.split_index - b.split_index),
          updated_by: 'admin-ui',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to save mapping');
      }

      toast({ title: 'Saved', description: 'Leg and split mapping saved successfully.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save mapping';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetMapping = () => {
    if (confirm('Reset to imported mapping? This will discard unsaved changes.')) {
      void loadData();
    }
  };

  if (loading && !legs.length) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selection Panel * /}
      <Card>
        <CardHeader>
          <CardTitle>Event & Contest Selection</CardTitle>
          <CardDescription>Select an event and contest to configure leg and split mapping.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Event ID</label>
              <Input
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="Enter event ID"
                className="mt-1"
              />
              {eventName && (
                <div className="mt-2 rounded-lg border bg-muted/50 p-2">
                  <div className="text-xs text-muted-foreground">Event Name</div>
                  <div className="text-sm font-medium truncate">{loadingEvent ? 'Loading...' : eventName}</div>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Contest</label>
              <Select value={contestId} onValueChange={setContestId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a contest" />
                </SelectTrigger>
                <SelectContent>
                  {contests.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">No contests found</div>
                  ) : (
                    contests.map(contest => (
                      <SelectItem key={contest.id} value={contest.id}>
                        {contest.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          {loading && (
            <div className="flex items-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Loading leg & split mapping…
            </div>
          )}

          {contests.length === 0 && eventName && !loadingEvent && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800">
                  No contests found for this event. Make sure Feibot data has been imported.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {/* Legs Panel * /}
      <Card>
        <CardHeader>
          <CardTitle>Race Legs</CardTitle>
          <CardDescription>Configure race legs and their display order.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {legs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No legs loaded. Select a contest to load imported legs.</div>
          ) : (
            [...legs].sort((a, b) => a.display_order - b.display_order).map(leg => (
              <div key={leg.leg_index} className="flex items-center gap-3 rounded-lg border p-3">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={leg.leg_name}
                  onChange={(e) => handleUpdateLegName(leg.leg_index, e.target.value)}
                  className="flex-1"
                  disabled={editingLegName !== leg.leg_index}
                  onDoubleClick={() => setEditingLegName(leg.leg_index)}
                  onBlur={() => setEditingLegName(null)}
                />
                <Badge variant="outline">{`Leg ${leg.leg_index}`}</Badge>
                <div className="w-24">
                  <Input
                    type="number"
                    value={leg.display_order}
                    onChange={(e) => handleUpdateLegDisplayOrder(leg.leg_index, Number(e.target.value))}
                    className="h-8"
                    aria-label="Leg display order"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleLegEnabled(leg.leg_index)}
                >
                  {leg.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Splits Panel * /}
      <Card>
        <CardHeader>
          <CardTitle>Split Mapping</CardTitle>
          <CardDescription>Map splits to race legs. Drag to reorder within a leg.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {splits.length === 0 ? (
            <div className="text-sm text-muted-foreground">No splits loaded. Select a contest to load imported splits.</div>
          ) : (
            [...legs].sort((a, b) => a.display_order - b.display_order).map(leg => (
              <div key={leg.leg_index} className="space-y-2">
                <h4 className="font-semibold text-sm">{leg.leg_name}</h4>
                <div className="space-y-2 border-l-2 border-muted pl-4">
                  {(splitsByLeg.get(leg.leg_index) || []).map(split => (
                    <div
                      key={split.split_index}
                      className="rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
                    >
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="md:col-span-2 min-w-0">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Imported Split</div>
                          <div className="font-medium truncate">{split.metadata?.imported_split_name || split.split_name}</div>
                          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                            <div>Feibot split_index: {split.split_index}</div>
                            <div>Timing Point: {split.timing_point_name || '—'}</div>
                            {split.distance !== null && <div>Distance: {split.distance} km</div>}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Custom Display Name</div>
                          <Input
                            value={split.split_name}
                            onChange={(e) => handleUpdateSplitName(split.split_index, e.target.value)}
                            placeholder="Enter display name"
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-2">
                          <Select
                            value={String(split.leg_index)}
                            onValueChange={(val) => handleMoveSplit(split.split_index, Number(val))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Leg" />
                            </SelectTrigger>
                            <SelectContent>
                              {legs.map(legOption => (
                                <SelectItem key={legOption.leg_index} value={String(legOption.leg_index)}>
                                  {legOption.leg_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            value={split.display_order}
                            onChange={(e) => handleUpdateSplitDisplayOrder(split.split_index, Number(e.target.value))}
                            className="h-8"
                            aria-label="Split display order"
                          />
                        </div>
                        <div className="flex items-start justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleSplitVisibility(split.split_index)}
                          >
                            {split.visibility === 'hidden' ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(splitsByLeg.get(leg.leg_index) || []).length === 0 && (
                    <div className="text-xs text-muted-foreground italic">No splits in this leg</div>
                  )}
                </div>
              </div>
            ))
          )}
          {splits.length > 0 && legs.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Imported splits were loaded, but no legs are available for this contest yet.
            </div>
          )}
          {unassignedSplits.length > 0 && legs.length > 0 && (
            <div className="space-y-2 rounded-lg border border-dashed p-4">
              <div className="text-sm font-medium">Unassigned Splits</div>
              <div className="space-y-2">
                {unassignedSplits.map((split) => (
                  <div key={split.split_index} className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="font-medium truncate">{split.metadata?.imported_split_name || split.split_name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Feibot split_index: {split.split_index}
                      {split.timing_point_name ? ` • Timing Point: ${split.timing_point_name}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Controls * /}
      <Card>
        <CardContent className="pt-6 flex gap-3">
          <Button onClick={() => void handleSaveMapping()} disabled={saving || !eventId.trim() || !contestId.trim()} className="flex-1">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {saving ? 'Saving…' : 'Save Mapping'}
          </Button>
          <Button onClick={handleResetMapping} variant="outline" disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button onClick={() => setShowPreview((value) => !value)} variant="outline" disabled={!eventId.trim() || !contestId.trim() || splits.length === 0}>
            <Eye className="mr-2 h-4 w-4" />
            Preview Athlete Timeline
          </Button>
        </CardContent>
      </Card>

      {showPreview && (
        <Card>
          <CardHeader>
            <CardTitle>Preview Athlete Timeline</CardTitle>
            <CardDescription>Live preview of how the Athlete Modal will use the saved mapping.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Leg</div>
                <div className="mt-1 text-sm font-medium">{previewSections.find((section) => section.splits.length > 0)?.leg.leg_name || 'Not Started'}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Split</div>
                <div className="mt-1 text-sm font-medium">{previewSplits[0]?.metadata?.imported_split_name || previewSplits[0]?.split_name || '—'}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Completed Splits</div>
                <div className="mt-1 text-sm font-medium">0</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Upcoming Splits</div>
                <div className="mt-1 text-sm font-medium">{previewSplits.length}</div>
              </div>
            </div>

            <div className="space-y-4">
              {previewSections.map(({ leg, splits: legSplits }) => (
                <div key={leg.leg_index} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{leg.leg_name}</div>
                      <div className="text-xs text-muted-foreground">Leg {leg.leg_index}</div>
                    </div>
                    <Badge variant="outline">{legSplits.length} splits</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {legSplits.length === 0 ? (
                      <div className="text-xs italic text-muted-foreground">No splits in this leg</div>
                    ) : (
                      legSplits.map((split) => (
                        <div key={split.split_index} className="rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{split.custom_display_name || split.split_name}</div>
                              <div className="truncate text-xs text-muted-foreground">Imported: {split.metadata?.imported_split_name || '—'}</div>
                            </div>
                            <Badge variant="secondary">#{split.split_index}</Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Timing Point: {split.timing_point_name || '—'} · Visibility: {split.visibility || 'visible'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

*/
