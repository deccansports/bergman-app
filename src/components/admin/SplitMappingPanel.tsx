'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, RefreshCw, SlidersHorizontal, AlertCircle, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type SplitRow = {
  splitUuid: string;
  name: string;
  distanceKm?: number | null;
  leg?: string | null;
  order?: number;
  enabled: boolean;
};

type ContestRow = {
  contestUuid: string;
  contestName: string;
  configured: boolean;
  splitCount: number;
  enabledCount: number;
  splits: SplitRow[];
};

function formatDistance(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const rounded = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} km` : `${rounded.toFixed(2).replace(/0$/, '').replace(/\.$/, '')} km`;
}

export function SplitMappingPanel({ eventId }: { eventId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contests, setContests] = useState<ContestRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadView = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/live/split-mapping/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load split mapping');
      }
      setContests(Array.isArray(data.contests) ? data.contests : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load split mapping');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  const toggleExpanded = useCallback((contestUuid: string) => {
    setExpanded((current) => ({ ...current, [contestUuid]: !current[contestUuid] }));
  }, []);

  const toggleSplit = useCallback((contestUuid: string, splitUuid: string, enabled: boolean) => {
    setContests((current) => current.map((contest) => {
      if (contest.contestUuid !== contestUuid) return contest;
      const splits = contest.splits.map((split) => (split.splitUuid === splitUuid ? { ...split, enabled } : split));
      return { ...contest, splits, enabledCount: splits.filter((split) => split.enabled).length, configured: true };
    }));
  }, []);

  const setAllForContest = useCallback((contestUuid: string, enabled: boolean) => {
    setContests((current) => current.map((contest) => {
      if (contest.contestUuid !== contestUuid) return contest;
      const splits = contest.splits.map((split) => ({ ...split, enabled }));
      return { ...contest, splits, enabledCount: enabled ? splits.length : 0, configured: true };
    }));
  }, []);

  const totals = useMemo(() => ({
    contests: contests.length,
    mapped: contests.filter((contest) => contest.enabledCount > 0).length,
    enabledSplits: contests.reduce((sum, contest) => sum + contest.enabledCount, 0),
    totalSplits: contests.reduce((sum, contest) => sum + contest.splitCount, 0),
  }), [contests]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        updatedBy: 'admin-ui',
        contests: contests.map((contest) => ({
          contestUuid: contest.contestUuid,
          enabledSplitUuids: contest.splits.filter((split) => split.enabled).map((split) => split.splitUuid),
        })),
      };
      const response = await fetch(`/api/live/split-mapping/${encodeURIComponent(eventId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to save split mapping');
      }
      toast({ title: 'Saved', description: `Stored dashboard split visibility for ${String(data.count || 0)} contests.` });
      await loadView();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save split mapping';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [contests, eventId, loadView, toast]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5" />
          Split Mapping
        </CardTitle>
        <CardDescription>
          Choose which splits are visible on the athlete dashboard modal. Splits stay hidden until you enable them here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadView()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Mapping
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border p-3 text-sm">Contests: {totals.contests}</div>
          <div className="rounded border p-3 text-sm">With dashboard splits: {totals.mapped}</div>
          <div className="rounded border p-3 text-sm">Enabled splits: {totals.enabledSplits}</div>
          <div className="rounded border p-3 text-sm">Total splits: {totals.totalSplits}</div>
        </div>

        {contests.length === 0 ? (
          <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
            No contests with splits found yet. Import the Feibot event database and build the course index first.
          </div>
        ) : (
          <div className="space-y-2">
            {contests.map((contest) => {
              const isExpanded = Boolean(expanded[contest.contestUuid]);
              const allEnabled = contest.splitCount > 0 && contest.enabledCount === contest.splitCount;
              return (
                <div key={contest.contestUuid} className="rounded border">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => toggleExpanded(contest.contestUuid)}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 flex-none" /> : <ChevronRight className="h-4 w-4 flex-none" />}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{contest.contestName}</div>
                        <div className="text-xs text-muted-foreground">{contest.splitCount} splits</div>
                      </div>
                    </button>
                    <div className="flex flex-none items-center gap-2">
                      {contest.enabledCount > 0 ? (
                        <Badge className="bg-emerald-600"><Eye className="mr-1 h-3 w-3" />{contest.enabledCount} shown</Badge>
                      ) : (
                        <Badge variant="secondary"><EyeOff className="mr-1 h-3 w-3" />Hidden</Badge>
                      )}
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="border-t px-4 py-3">
                      {contest.splits.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No splits available for this contest.</div>
                      ) : (
                        <>
                          <div className="mb-3 flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setAllForContest(contest.contestUuid, true)} disabled={allEnabled}>
                              Show all
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setAllForContest(contest.contestUuid, false)} disabled={contest.enabledCount === 0}>
                              Hide all
                            </Button>
                          </div>
                          <div className="space-y-1">
                            {contest.splits.map((split) => (
                              <label
                                key={split.splitUuid}
                                className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-muted/40"
                              >
                                <Checkbox
                                  checked={split.enabled}
                                  onCheckedChange={(checked) => toggleSplit(contest.contestUuid, split.splitUuid, checked === true)}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm">{split.name}</span>
                                {split.leg ? <span className="text-xs uppercase tracking-wide text-muted-foreground">{split.leg}</span> : null}
                                <span className="w-20 text-right font-mono text-xs text-muted-foreground">{formatDistance(split.distanceKm)}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SplitMappingPanel;
