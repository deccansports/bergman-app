'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, Wand2, RefreshCw, MapPin, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
type BergmanOption = {
  bergmanContestId: string;
  bergmanContestName: string;
  ticketId: string;
  ticketName: string;
  subTicketId?: string | null;
  subTicketName?: string | null;
  categoryType?: string | null;
  distance?: string | null;
};

export type ContestMappingRow = {
  feibotContestUuid: string;
  feibotContestName: string;
  distance?: string | null;
  categoryType?: string | null;
  splitCount?: number;
  timingPointCount?: number;
  matchConfidence?: number;
  autoMapped?: boolean;
  selectedBergmanContestId?: string | null;
  selectedBergmanContestName?: string | null;
  ticketId?: string | null;
  subTicketId?: string | null;
  bergmanCategoryId?: string | null;
  bergmanCategoryName?: string | null;
  bergmanSubCategoryId?: string | null;
  bergmanSubCategoryName?: string | null;
  mappedAt?: string | null;
  mappedBy?: string | null;
  status?: 'mapped' | 'unmapped' | 'invalid';
  invalidReason?: string | null;
  bergmanContestId?: string | null;
  bergmanContestName?: string | null;
};

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function scoreSimilarity(a: string, b: string) {
  const aa = normalizeKey(a);
  const bb = normalizeKey(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 100;
  if (aa.includes(bb) || bb.includes(aa)) return 95;
  const tokensA = new Set(aa.match(/[a-z0-9]+/g) || []);
  const tokensB = new Set(bb.match(/[a-z0-9]+/g) || []);
  const overlap = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size || 1;
  return Math.round((overlap / union) * 100);
}

export function ContestMappingPanel({ eventId }: { eventId: string; connectionId?: string; availableContests?: Array<{ uuid: string; name: string }>; onRefresh?: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ContestMappingRow[]>([]);
  const [bergmanOptions, setBergmanOptions] = useState<BergmanOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [splitsEnabledForAthleteDashboard, setSplitsEnabledForAthleteDashboard] = useState<boolean | null>(null);

  const optionLookup = useMemo(() => new Map(bergmanOptions.map((option) => [option.bergmanContestId, option])), [bergmanOptions]);

  const getRowOptionId = useCallback((row: ContestMappingRow) => {
    const explicit = normalize(row.selectedBergmanContestId || row.bergmanContestId || '');
    if (explicit) return explicit;

    const ticketId = normalize(row.ticketId || row.bergmanCategoryId || '');
    const subTicketId = normalize(row.subTicketId || row.bergmanSubCategoryId || '');
    if (!ticketId) return '';

    const composite = subTicketId ? `${ticketId}:${subTicketId}` : ticketId;
    if (optionLookup.has(composite)) return composite;
    return optionLookup.has(ticketId) ? ticketId : composite;
  }, [optionLookup]);

  const getRegistrableKey = useCallback((row: ContestMappingRow) => {
    const optionId = getRowOptionId(row);
    const option = optionId ? optionLookup.get(optionId) : null;

    const ticketId = normalize(option?.ticketId || row.ticketId || row.bergmanCategoryId || '');
    const subTicketId = normalize(option?.subTicketId || row.subTicketId || row.bergmanSubCategoryId || '');
    if (!ticketId) return '';
    return `${ticketId}:${subTicketId}`;
  }, [getRowOptionId, optionLookup]);

  const duplicateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = getRegistrableKey(row);
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [rows, getRegistrableKey]);

  const invalidRowIds = useMemo(() => {
    const invalid = new Set<string>();
    for (const row of rows) {
      const selectedId = getRowOptionId(row);
      if (!selectedId) continue;
      const option = optionLookup.get(selectedId) || null;
      if (!option) {
        invalid.add(row.feibotContestUuid);
        continue;
      }
      const duplicateKey = getRegistrableKey(row);
      if (duplicateKey && (duplicateCounts[duplicateKey] || 0) > 1) {
        invalid.add(row.feibotContestUuid);
      }
    }
    return invalid;
  }, [rows, duplicateCounts, optionLookup, getRowOptionId, getRegistrableKey]);

  const loadView = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/live/contest-mapping-view/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load contest mapping view');
      }
      const incomingRows: ContestMappingRow[] = Array.isArray(data.importedContests) ? data.importedContests : [];
      setRows(incomingRows.map((row) => ({
        ...row,
        selectedBergmanContestId: normalize(row.selectedBergmanContestId || row.bergmanContestId || '' ) || null,
        selectedBergmanContestName: normalize(row.selectedBergmanContestName || row.bergmanContestName || '' ) || null,
      })));
      setBergmanOptions(Array.isArray(data.bergmanContestOptions) ? data.bergmanContestOptions : []);
      setSplitsEnabledForAthleteDashboard(typeof data.splitsEnabledForAthleteDashboard === 'boolean' ? data.splitsEnabledForAthleteDashboard : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contest mapping view');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadView();
  }, [loadView]);

  const resolveOption = useCallback((bergmanContestId: string | null | undefined) => {
    const key = normalize(bergmanContestId);
    return key ? optionLookup.get(key) || null : null;
  }, [optionLookup]);

  const updateRowSelection = useCallback((feibotContestUuid: string, bergmanContestId: string) => {
    setRows((current) => current.map((row) => {
      if (row.feibotContestUuid !== feibotContestUuid) return row;
      const option = resolveOption(bergmanContestId);
      if (!bergmanContestId) {
        return {
          ...row,
          selectedBergmanContestId: null,
          selectedBergmanContestName: null,
          bergmanContestId: null,
          bergmanContestName: null,
          ticketId: null,
          subTicketId: null,
          bergmanCategoryId: null,
          bergmanCategoryName: null,
          bergmanSubCategoryId: null,
          bergmanSubCategoryName: null,
          status: 'unmapped',
          invalidReason: null,
        };
      }
      if (!option) {
        return {
          ...row,
          selectedBergmanContestId: bergmanContestId,
          selectedBergmanContestName: null,
          bergmanContestId,
          bergmanContestName: null,
          ticketId: null,
          subTicketId: null,
          bergmanCategoryId: null,
          bergmanCategoryName: null,
          bergmanSubCategoryId: null,
          bergmanSubCategoryName: null,
          status: 'invalid',
          invalidReason: 'Selected Bergman category no longer exists',
        };
      }
      return {
        ...row,
        selectedBergmanContestId: option.bergmanContestId,
        selectedBergmanContestName: option.bergmanContestName,
        bergmanContestId: option.bergmanContestId,
        bergmanContestName: option.bergmanContestName,
        ticketId: option.ticketId,
        subTicketId: option.subTicketId || null,
        bergmanCategoryId: option.ticketId,
        bergmanCategoryName: option.ticketName,
        bergmanSubCategoryId: option.subTicketId || null,
        bergmanSubCategoryName: option.subTicketName || null,
        status: 'mapped',
        invalidReason: null,
      };
    }));
  }, [resolveOption]);

  const autoMap = useCallback(() => {
    setRows((current) => current.map((row) => {
      if (normalize(row.selectedBergmanContestId || row.ticketId || '')) return row;
      let bestOption: BergmanOption | null = null;
      let bestScore = 0;
      for (const option of bergmanOptions) {
        const score = scoreSimilarity(row.feibotContestName, option.bergmanContestName);
        if (score > bestScore) {
          bestScore = score;
          bestOption = option;
        }
      }
      if (!bestOption || bestScore < 85) return row;
      return {
        ...row,
        selectedBergmanContestId: bestOption.bergmanContestId,
        selectedBergmanContestName: bestOption.bergmanContestName,
        bergmanContestId: bestOption.bergmanContestId,
        bergmanContestName: bestOption.bergmanContestName,
        ticketId: bestOption.ticketId,
        subTicketId: bestOption.subTicketId || null,
        bergmanCategoryId: bestOption.ticketId,
        bergmanCategoryName: bestOption.ticketName,
        bergmanSubCategoryId: bestOption.subTicketId || null,
        bergmanSubCategoryName: bestOption.subTicketName || null,
        matchConfidence: bestScore,
        autoMapped: true,
        status: 'mapped',
        invalidReason: null,
      };
    }));
  }, [bergmanOptions]);

  const save = async () => {
    const invalidRows = rows.filter((row) => invalidRowIds.has(row.feibotContestUuid));
    if (invalidRows.length > 0) {
      const message = `Fix invalid or duplicate mappings before saving: ${invalidRows.map((row) => row.feibotContestName).join(', ')}`;
      setError(message);
      toast({ title: 'Invalid Mapping', description: message, variant: 'destructive' });
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/live/contest-mapping-view/${encodeURIComponent(eventId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mappings: rows, updatedBy: 'admin-ui' }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to save contest mappings');
      }
      toast({ title: 'Saved', description: `Stored ${String(data.count || 0)} contest mappings.` });
      if (typeof data.splitsEnabledForAthleteDashboard === 'boolean') {
        setSplitsEnabledForAthleteDashboard(data.splitsEnabledForAthleteDashboard);
      }
      await loadView();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save contest mappings';
      setError(message);
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };
    const counts = {
      mapped: rows.filter((row) => !!getRowOptionId(row) && !invalidRowIds.has(row.feibotContestUuid)).length,
      unmapped: rows.filter((row) => !getRowOptionId(row)).length,
      invalid: rows.filter((row) => invalidRowIds.has(row.feibotContestUuid)).length,
    };


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
          <MapPin className="h-5 w-5" />
          Contest Mapping
        </CardTitle>
        <CardDescription>Bergman ticket/sub-ticket IDs mapped to Feibot contests</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {splitsEnabledForAthleteDashboard === true ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Splits are <strong>enabled</strong> on the athlete dashboard. Athletes can see their split breakdowns in the live tracking modal.
            </AlertDescription>
          </Alert>
        ) : splitsEnabledForAthleteDashboard === false ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Splits are <strong>not yet enabled</strong> on the athlete dashboard. Map at least one contest and save to enable split visibility for athletes.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadView()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" onClick={autoMap}>
            <Wand2 className="mr-2 h-4 w-4" />
            Auto-map
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Mapping
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border p-3 text-sm">Imported contests: {rows.length}</div>
          <div className="rounded border p-3 text-sm">Mapped: {counts.mapped}</div>
          <div className="rounded border p-3 text-sm">Not Mapped: {counts.unmapped} · Invalid: {counts.invalid}</div>
        </div>
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-3">Feibot Contest</th>
                <th className="px-4 py-3">Bergman Registration Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Splits</th>
                <th className="px-4 py-3">Timing Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feibotContestUuid} className="border-t align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.feibotContestName}</div>
                    <div className="text-xs text-muted-foreground">{row.matchConfidence ? `${row.matchConfidence}% confidence` : 'No match confidence'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={getRowOptionId(row) || '__unmapped__'} onValueChange={(value) => updateRowSelection(row.feibotContestUuid, value === '__unmapped__' ? '' : value)}>
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="Not mapped" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unmapped__">Not mapped</SelectItem>
                        {bergmanOptions.map((option) => (
                          <SelectItem
                            key={option.bergmanContestId}
                            value={option.bergmanContestId}
                            disabled={(() => {
                              const rowKey = getRegistrableKey(row);
                              const optionKey = `${normalize(option.ticketId)}:${normalize(option.subTicketId || '')}`;
                              if (!optionKey) return false;
                              if (rowKey && rowKey === optionKey) return false;
                              return (duplicateCounts[optionKey] || 0) > 0;
                            })()}
                          >
                            {option.bergmanContestName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    {invalidRowIds.has(row.feibotContestUuid) ? (
                      <Badge variant="destructive">❌ Invalid Mapping</Badge>
                    ) : getRowOptionId(row) ? (
                      <Badge className="bg-emerald-600">✅ Mapped</Badge>
                    ) : (
                      <Badge variant="secondary">⚠️ Not Mapped</Badge>
                    )}
                    {row.autoMapped ? <div className="mt-1 text-xs text-muted-foreground">Auto-suggested</div> : null}
                    {row.invalidReason ? <div className="mt-1 text-xs text-red-600">{row.invalidReason}</div> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{String(row.splitCount || 0)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{String(row.timingPointCount || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">No contest mappings loaded yet.</div> : null}
      </CardContent>
    </Card>
  );
}
