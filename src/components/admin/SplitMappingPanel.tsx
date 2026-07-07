'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export type BergmanSplit = {
  id: string;
  name: string;
  distance: number;
  leg: 'swim' | 'bike' | 'run' | 'run1' | 'run2';
};

export type SplitMappingRow = {
  feibotSplitUuid: string;
  feibotSplitName: string;
  feibotContestUuid: string;
  feibotContestName: string;
  distance?: string | null;
  categoryType?: string | null;
  mappedToBergmanSplitId?: string | null;
  mappedToBergmanSplitName?: string | null;
  mappedToBergmanLeg?: 'swim' | 'bike' | 'run' | 'run1' | 'run2' | null;
  status?: 'mapped' | 'unmapped';
  isMapped?: boolean;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

const LEG_LABELS: Record<'swim' | 'bike' | 'run' | 'run1' | 'run2', string> = {
  swim: 'Swim',
  bike: 'Bike',
  run: 'Run',
  run1: 'Run 1',
  run2: 'Run 2',
};

export function SplitMappingPanel({ eventId }: { eventId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<SplitMappingRow[]>([]);
  const [bergmanSplits, setBergmanSplits] = useState<BergmanSplit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedMapping, setSelectedMapping] = useState<Record<string, { bergmanSplitId: string; bergmanSplitName: string; bergmanLeg: string }>>({});

  const splitsByLeg = useMemo(() => {
    const byLeg = new Map<string, BergmanSplit[]>();
    for (const split of bergmanSplits) {
      if (!byLeg.has(split.leg)) {
        byLeg.set(split.leg, []);
      }
      byLeg.get(split.leg)!.push(split);
    }
    return byLeg;
  }, [bergmanSplits]);

  const loadView = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/live/split-mapping-view/${encodeURIComponent(eventId)}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load split mapping view');
      }
      const incomingRows: SplitMappingRow[] = Array.isArray(data.importedSplits) ? data.importedSplits : [];
      setRows(incomingRows);
      setBergmanSplits(Array.isArray(data.bergmanSplits) ? data.bergmanSplits : []);

      // Initialize selected mapping from rows
      const initialMapping: Record<string, { bergmanSplitId: string; bergmanSplitName: string; bergmanLeg: string }> = {};
      for (const row of incomingRows) {
        if (row.mappedToBergmanSplitId && row.mappedToBergmanLeg) {
          initialMapping[row.feibotSplitUuid] = {
            bergmanSplitId: row.mappedToBergmanSplitId,
            bergmanSplitName: row.mappedToBergmanSplitName || '',
            bergmanLeg: row.mappedToBergmanLeg,
          };
        }
      }
      setSelectedMapping(initialMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load split mapping view');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  const handleMapSplit = useCallback(
    async (row: SplitMappingRow, bergmanSplitId: string | null) => {
      if (!bergmanSplitId) {
        // Unmapping
        const { [row.feibotSplitUuid]: _, ...rest } = selectedMapping;
        setSelectedMapping(rest);
        return;
      }

      const bergmanSplit = bergmanSplits.find((s) => s.id === bergmanSplitId);
      if (!bergmanSplit) return;

      setSaving(true);
      try {
        const response = await fetch(`/api/live/split-mapping-view/${encodeURIComponent(eventId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            feibotSplitUuid: row.feibotSplitUuid,
            feibotSplitName: row.feibotSplitName,
            feibotContestUuid: row.feibotContestUuid,
            feibotContestName: row.feibotContestName,
            mappedToBergmanSplitId: bergmanSplitId,
            mappedToBergmanSplitName: bergmanSplit.name,
            mappedToBergmanLeg: bergmanSplit.leg,
          }),
        });

        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || 'Failed to save split mapping');
        }

        setSelectedMapping((prev) => ({
          ...prev,
          [row.feibotSplitUuid]: {
            bergmanSplitId,
            bergmanSplitName: bergmanSplit.name,
            bergmanLeg: bergmanSplit.leg,
          },
        }));

        toast({
          title: 'Split mapping saved',
          description: `${row.feibotSplitName} → ${bergmanSplit.name}`,
        });
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to save split mapping',
          variant: 'destructive',
        });
      } finally {
        setSaving(false);
      }
    },
    [eventId, bergmanSplits, selectedMapping, toast]
  );

  const mappedCount = Object.keys(selectedMapping).length;
  const unmappedCount = rows.length - mappedCount;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading split mappings...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Split Mapping</CardTitle>
          <CardDescription>Map imported provider splits to Bergman course structure.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No splits imported from Feibot yet. Configure and import timing rules first.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Split Mapping</CardTitle>
          <CardDescription>
            Map imported provider splits to Bergman course structure so the athlete dashboard displays the correct
            splits.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Imported splits</div>
            <div className="mt-2 text-2xl font-bold">{rows.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Mapped</div>
            <div className="mt-2 text-2xl font-bold text-green-600">{mappedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Not mapped</div>
            <div className="mt-2 text-2xl font-bold text-amber-600">{unmappedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Map Splits</CardTitle>
          <CardDescription>Select which Bergman course split each Feibot split should map to.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Feibot Split</th>
                  <th className="text-left py-3 px-4 font-medium">Contest</th>
                  <th className="text-left py-3 px-4 font-medium">Bergman Split</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const currentMapping = selectedMapping[row.feibotSplitUuid];
                  const availableSplits = Array.from(splitsByLeg.values()).flat();

                  return (
                    <tr key={row.feibotSplitUuid} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div className="font-medium">{row.feibotSplitName}</div>
                        {row.distance ? <div className="text-xs text-muted-foreground">{row.distance}</div> : null}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm">{row.feibotContestName}</div>
                      </td>
                      <td className="py-3 px-4">
                        <Select
                          value={currentMapping?.bergmanSplitId || ''}
                          onValueChange={(value) => void handleMapSplit(row, value || null)}
                          disabled={saving}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Select a split..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Unmap split</SelectItem>
                            {availableSplits.map((split) => (
                              <SelectItem key={split.id} value={split.id}>
                                {LEG_LABELS[split.leg]} • {split.name} ({split.distance.toFixed(2)} km)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-3 px-4">
                        {currentMapping ? (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Mapped
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Unmapped</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {bergmanSplits.length === 0 ? (
            <Alert className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No Bergman splits found. Configure course maps and splits in your course setup first.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void loadView()} disabled={loading || saving}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Reload
        </Button>
      </div>
    </div>
  );
}
