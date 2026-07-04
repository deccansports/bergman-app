// src/components/admin/KvAnalyticsTab.tsx
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, Database, Search, RefreshCw, BarChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, parseISO } from 'date-fns';

type KVLog = {
  id: string;
  timestamp: string;
  operation: 'READ' | 'WRITE';
  key: string;
  source: string;
  status: 'SUCCESS' | 'FAILURE' | 'CACHE_MISS';
};

type KVSummary = {
  reads24h: number;
  writes24h: number;
  cacheMisses24h: number;
};

type HighReadSource = {
  source: string;
  totalReads: number;
};

const statusVariantMap: { [key in KVLog['status']]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
    SUCCESS: 'default',
    FAILURE: 'destructive',
    CACHE_MISS: 'secondary'
};

export default function KvAnalyticsTab() {
  const [logs, setLogs] = useState<KVLog[]>([]);
  const [summary, setSummary] = useState<KVSummary | null>(null);
  const [highReadSources, setHighReadSources] = useState<HighReadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [liveMode, setLiveMode] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [totalLogs, setTotalLogs] = useState(0);
  const [returnedLogs, setReturnedLogs] = useState(0);
  const [newOpsSinceLastFetch, setNewOpsSinceLastFetch] = useState(0);
  const [prevNewestTs, setPrevNewestTs] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kv-analytics?limit=1000", { cache: 'no-store' });
      if (!res.ok) {
        throw new Error("Failed to fetch KV analytics from API.");
      }
      const data = await res.json();
      if (data.error) {
          throw new Error(data.error);
      }
      const nextLogs: KVLog[] = data.logs || [];
      setLogs(nextLogs);
      setSummary(data.summary || null);
      setHighReadSources(data.highReadSources || []);
      setLastUpdatedAt(data.generatedAt || new Date().toISOString());
      setTotalLogs(Number(data.totalLogs || 0));
      setReturnedLogs(Number(data.returnedLogs || (nextLogs?.length || 0)));

      const newestTs = nextLogs?.[0]?.timestamp || null;
      if (prevNewestTs && newestTs) {
        const prev = new Date(prevNewestTs).getTime() || 0;
        const newCount = nextLogs.filter((l) => (new Date(l.timestamp || 0).getTime() || 0) > prev).length;
        setNewOpsSinceLastFetch(newCount);
      } else {
        setNewOpsSinceLastFetch(0);
      }
      setPrevNewestTs(newestTs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [prevNewestTs]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!liveMode) return;
    const id = setInterval(() => {
      fetchLogs();
    }, 10000);
    return () => clearInterval(id);
  }, [liveMode, fetchLogs]);

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const lowerTerm = searchTerm.toLowerCase();
    return logs.filter(r => 
        r.source.toLowerCase().includes(lowerTerm) ||
        r.key.toLowerCase().includes(lowerTerm)
    );
  }, [logs, searchTerm]);

    const live1mStats = useMemo(() => {
    const oneMinAgo = Date.now() - 60 * 1000;
    let reads1m = 0;
    let writes1m = 0;
    let misses1m = 0;
    for (const l of logs) {
      const ts = new Date(l.timestamp || 0).getTime() || 0;
      if (ts < oneMinAgo) continue;
      if (l.operation === 'READ') reads1m++;
      if (l.operation === 'WRITE') writes1m++;
      if (l.status === 'CACHE_MISS') misses1m++;
    }
    return { reads1m, writes1m, misses1m };
    }, [logs]);

    const recentUpdatedKeys = useMemo(() => {
    const latestByKey = new Map<string, KVLog>();
    for (const l of logs) {
      if (l.operation !== 'WRITE') continue;
      const existing = latestByKey.get(l.key);
      const currentTs = new Date(l.timestamp || 0).getTime() || 0;
      const existingTs = existing ? (new Date(existing.timestamp || 0).getTime() || 0) : 0;
      if (!existing || currentTs > existingTs) {
      latestByKey.set(l.key, l);
      }
    }
    return Array.from(latestByKey.values())
      .sort((a, b) => (new Date(b.timestamp || 0).getTime() || 0) - (new Date(a.timestamp || 0).getTime() || 0))
      .slice(0, 20);
    }, [logs]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><BarChart className="h-5 w-5 text-primary" /> Live KV Monitoring</CardTitle>
              <CardDescription>
                Live reads/writes and latest updated keys from KV analytics stream.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={liveMode ? 'default' : 'outline'} size="sm" onClick={() => setLiveMode(v => !v)}>
                {liveMode ? 'Live: ON (10s)' : 'Live: OFF'}
              </Button>
              <Badge variant="outline">New Ops: {newOpsSinceLastFetch}</Badge>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Last Updated: {lastUpdatedAt ? format(parseISO(lastUpdatedAt), 'MMM dd, yyyy, p') : 'N/A'} · Showing {returnedLogs} / {totalLogs} logs
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Reads (1m)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{live1mStats.reads1m.toLocaleString()}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Writes (1m)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{live1mStats.writes1m.toLocaleString()}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Cache Misses (1m)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{live1mStats.misses1m.toLocaleString()}</div></CardContent></Card>
          </div>
        </CardContent>
      </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Reads (24h)</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? <Loader2 className="animate-spin"/> : <div className="text-2xl font-bold">{summary?.reads24h.toLocaleString() ?? 'N/A'}</div>}
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Writes (24h)</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? <Loader2 className="animate-spin"/> : <div className="text-2xl font-bold">{summary?.writes24h.toLocaleString() ?? 'N/A'}</div>}
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Cache Misses (24h)</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? <Loader2 className="animate-spin"/> : <div className="text-2xl font-bold">{summary?.cacheMisses24h.toLocaleString() ?? 'N/A'}</div>}
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader><CardTitle>High-Read Sources (All Time)</CardTitle><CardDescription>Functions generating the most read operations.</CardDescription></CardHeader>
            <CardContent>
            <div className="overflow-auto rounded border">
                <Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead className="text-right">Total Reads</TableHead></TableRow></TableHeader>
                <TableBody>
                    {loading ? <TableRow><TableCell colSpan={2} className="text-center p-8"><Loader2 className="animate-spin"/></TableCell></TableRow>
                    : highReadSources.map((source, i) => (
                        <TableRow key={i}>
                            <TableCell className="font-medium">{source.source}</TableCell>
                            <TableCell className="text-right">{source.totalReads.toLocaleString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
                </Table>
            </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
              <CardTitle>Recently Updated KV Keys</CardTitle>
              <CardDescription>Latest write operation per key (live).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded border max-h-[30vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Updated At</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={4} className="text-center p-6"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                    ) : recentUpdatedKeys.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No recent updates.</TableCell></TableRow>
                    ) : recentUpdatedKeys.map((r) => (
                      <TableRow key={`updated-${r.id}`}>
                        <TableCell className="font-mono text-xs">{r.timestamp ? format(parseISO(r.timestamp), 'MMM dd, pp, ss.SSS') : 'N/A'}</TableCell>
                        <TableCell className="font-mono text-xs text-primary">{r.key}</TableCell>
                        <TableCell className="font-mono text-xs">{r.source}</TableCell>
                        <TableCell className="text-right"><Badge variant={statusVariantMap[r.status] || 'secondary'}>{r.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
        </Card>

        <Card>
          <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-primary" />
                        Detailed KV Operation Log
                    </CardTitle>
                    <CardDescription>
                      Log of recent read and write operations on the Cloudflare KV store.
                    </CardDescription>
                </div>
                <Button onClick={fetchLogs} disabled={loading} size="sm" variant="outline">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-2 hidden sm:inline">Refresh</span>
                </Button>
              </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Search source or key..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                />
            </div>
            {error ? (
              <p className="text-destructive text-center p-4">Error: {error}</p>
            ) : (
              <div className="overflow-auto rounded border max-h-[70vh]">
                <Table className="w-full text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Time</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Reads</TableHead>
                      <TableHead className="text-right">Writes</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={6} className="text-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" /></TableCell></TableRow>
                    ) : filteredLogs.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{searchTerm ? 'No logs match your search.' : 'No KV operations logged.'}</TableCell></TableRow>
                    ) : filteredLogs.map((r) => (
                      <TableRow key={r.id} className="hover:bg-muted/50">
                        <TableCell className="p-2 font-mono text-xs">{r.timestamp ? format(parseISO(r.timestamp), 'MMM dd, pp, ss.SSS') : 'N/A'}</TableCell>
                        <TableCell className="p-2 font-mono text-xs text-primary">{r.key}</TableCell>
                        <TableCell className="p-2 font-mono text-xs">{r.source}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.operation === 'READ' ? 1 : 0}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.operation === 'WRITE' ? 1 : 0}</TableCell>
                        <TableCell className="p-2 text-right">
                           <Badge variant={statusVariantMap[r.status] || 'secondary'}>{r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
