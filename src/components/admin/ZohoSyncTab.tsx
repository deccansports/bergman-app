// src/components/admin/ZohoSyncTab.tsx
"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, CreditCard, RefreshCw, AlertCircle, Search,
  ArrowRightLeft, CheckCircle2, XCircle, SkipForward,
  Calendar, ChevronDown, ChevronUp, History, Database, Wallet, ReceiptIndianRupee,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Payment Lookup ──────────────────────────────────────────────────────────

function PaymentLookupSection() {
  const { firebaseUserFromAuth } = useAuth();
  const { toast } = useToast();
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    const term = reference.trim();
    if (!term) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const res = await fetch(`/api/admin/zoho/payment?reference=${encodeURIComponent(term)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Request failed');
        setResult(data);
      } else {
        setResult(data);
        if (data.message?.includes('No payment found')) {
          toast({ variant: 'default', title: 'Not Found', description: data.message });
        } else {
          toast({ title: 'Payment Found', description: `Record for ${data.customer_name} retrieved.` });
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-none shadow-xl">
      <CardHeader className="bg-primary/5 border-b">
        <CardTitle className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tighter">
          <CreditCard className="h-5 w-5 text-primary" />
          Zoho Books Payment Lookup
        </CardTitle>
        <CardDescription className="font-medium">
          Search and verify payment status in Zoho Books by Reference Number or Booking ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-8 space-y-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Enter Reference Number (e.g. BMIN...)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSync()}
              className="h-11 rounded-xl pl-10 bg-muted/20 border-none font-bold placeholder:font-normal"
            />
          </div>
          <Button
            onClick={handleSync}
            disabled={loading || !reference.trim()}
            className="h-11 rounded-xl px-8 font-black uppercase tracking-widest shadow-lg shadow-primary/20"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync & Verify
          </Button>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-black uppercase text-[10px] tracking-widest">Query Error</p>
              <p className="text-sm font-medium mt-1">{error}</p>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Raw API Data Breakdown</h4>
            <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800 shadow-2xl overflow-hidden relative group">
              <div className="absolute top-2 right-4 text-[8px] font-black text-slate-700 uppercase tracking-[0.3em] group-hover:text-slate-500 transition-colors">Zoho Output</div>
              <pre className="text-[11px] font-mono text-green-500 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Settlement Sync ─────────────────────────────────────────────────────────

interface SyncResult {
  success: boolean;
  message: string;
  synced: number;
  merged: number;
  skipped: number;
  failed: number;
  errors: Array<{ settlementId: string; error: string }>;
  transfers: Array<{ settlementId: string; amount: number; date: string; zohoTransferId?: string }>;
}

interface HistoryEntry {
  settlementId: string;
  amount: number;
  date: string;
  zohoTransferId: string;
  syncedAt: string;
}

interface DashboardStats {
  totalSettlements: number;
  totalRevenue: number;
  totalFees: number;
  totalTax: number;
  net: number;
  matched: number;
  mismatched: number;
  unreconciled: number;
  recentErrors: Array<{ settlementId: string; error: string; phase: string; time: string }>;
}

function SettlementSyncSection() {
  const { firebaseUserFromAuth } = useAuth();
  const { toast } = useToast();

  const [count, setCount] = useState('50');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncAllLoading, setSyncAllLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const res = await fetch('/api/admin/zoho-dashboard?logsLimit=15', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDashboard(data as DashboardStats);
      }
    } catch {
      // Non-blocking for sync UX
    } finally {
      setDashboardLoading(false);
    }
  }, [firebaseUserFromAuth]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const handleSync = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const body: Record<string, any> = { count: parseInt(count) || 50 };
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;

      const res = await fetch('/api/admin/razorpay-sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data: SyncResult = await res.json();
      setResult(data);
      toast({
        title: data.success ? '✅ Sync Complete' : '⚠️ Sync Finished with Errors',
        description: data.message,
        variant: data.success ? 'default' : 'destructive',
      });
      loadDashboard();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncAllLoading(true);
    setResult(null);
    setError(null);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const body: Record<string, any> = { syncAll: true };
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;

      const res = await fetch('/api/admin/razorpay-sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data: SyncResult = await res.json();
      setResult(data);
      toast({
        title: data.success ? '✅ All Historical Sync Complete' : '⚠️ Sync Finished with Errors',
        description: data.message,
        variant: data.success ? 'default' : 'destructive',
      });
      loadDashboard();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncAllLoading(false);
    }
  };

  const handleCleanMerge = async () => {
    setMergeLoading(true);
    setResult(null);
    setError(null);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const body: Record<string, any> = { syncAll: true, mergeOnly: true };
      if (fromDate) body.fromDate = fromDate;
      if (toDate) body.toDate = toDate;

      const res = await fetch('/api/admin/razorpay-sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data: SyncResult = await res.json();
      setResult(data);
      toast({
        title: data.success ? '♻️ Clean/Merge Complete' : '⚠️ Merge Finished with Errors',
        description: data.message,
        variant: data.success ? 'default' : 'destructive',
      });
      loadDashboard();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMergeLoading(false);
    }
  };

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const token = await firebaseUserFromAuth?.getIdToken();
      const res = await fetch('/api/admin/razorpay-sync?limit=50', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      setHistory(data.history ?? []);
      setShowHistory(true);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setHistoryLoading(false);
    }
  }, [firebaseUserFromAuth, toast]);

  return (
    <Card className="border-none shadow-xl">
      <CardHeader className="bg-orange-500/5 border-b">
        <CardTitle className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tighter">
          <ArrowRightLeft className="h-5 w-5 text-orange-500" />
          Razorpay → Zoho Settlement Sync
        </CardTitle>
        <CardDescription className="font-medium">
          Sync processed Razorpay settlements as bank transfers in Zoho Books.
          Already-synced settlements are skipped automatically (Firestore dedup).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-8 space-y-6">

        {/* Dashboard snapshot */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Finance Snapshot</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadDashboard}
              disabled={dashboardLoading}
              className="h-7 px-2 text-[10px] font-black uppercase tracking-widest"
            >
              {dashboardLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Settlements</p>
              <p className="text-xl font-black text-blue-600 mt-1">{dashboard?.totalSettlements ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Revenue</p>
              <p className="text-xl font-black text-emerald-600 mt-1">₹{(dashboard?.totalRevenue ?? 0).toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Fees + Tax</p>
              <p className="text-xl font-black text-amber-600 mt-1">₹{((dashboard?.totalFees ?? 0) + (dashboard?.totalTax ?? 0)).toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-2xl bg-purple-500/10 border border-purple-500/20 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1"><ReceiptIndianRupee className="h-3 w-3" /> Net</p>
              <p className="text-xl font-black text-purple-600 mt-1">₹{(dashboard?.net ?? 0).toLocaleString('en-IN')}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-2 text-center">
              <p className="text-lg font-black text-green-600">{dashboard?.matched ?? 0}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Matched</p>
            </div>
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-2 text-center">
              <p className="text-lg font-black text-destructive">{dashboard?.mismatched ?? 0}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Mismatch</p>
            </div>
            <div className="rounded-xl bg-slate-500/10 border border-slate-500/20 p-2 text-center">
              <p className="text-lg font-black text-slate-700">{dashboard?.unreconciled ?? 0}</p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Unreconciled</p>
            </div>
          </div>

          {dashboard?.recentErrors?.length ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 overflow-hidden">
              <div className="px-3 py-2 border-b border-destructive/15 text-[10px] font-black uppercase tracking-widest text-destructive">Recent Sync Errors</div>
              <div className="max-h-48 overflow-y-auto divide-y divide-destructive/10">
                {dashboard.recentErrors.map((e, i) => (
                  <div key={`${e.settlementId}-${i}`} className="px-3 py-2">
                    <p className="font-mono text-[11px] font-bold text-destructive">{e.settlementId}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{e.error}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">{e.phase} • {e.time ? new Date(e.time).toLocaleString('en-IN') : '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Count</label>
            <Input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="h-11 rounded-xl bg-muted/20 border-none font-bold"
              placeholder="50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> From Date
            </label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-11 rounded-xl bg-muted/20 border-none font-bold"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> To Date
            </label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-11 rounded-xl bg-muted/20 border-none font-bold"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <Button
            onClick={handleSync}
            disabled={loading || syncAllLoading || mergeLoading}
            className="h-11 flex-1 min-w-[160px] rounded-xl font-black uppercase tracking-widest shadow-lg shadow-orange-500/20 bg-orange-500 hover:bg-orange-600 text-white"
          >
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Syncing…</>
              : <><ArrowRightLeft className="h-4 w-4 mr-2" />Run Settlement Sync</>
            }
          </Button>
          <Button
            onClick={handleSyncAll}
            disabled={loading || syncAllLoading || mergeLoading}
            title="Fetches ALL historical Razorpay settlements in batches of 100. Already-synced entries are automatically skipped."
            className="h-11 flex-1 min-w-[160px] rounded-xl font-black uppercase tracking-widest shadow-lg shadow-purple-500/20 bg-purple-600 hover:bg-purple-700 text-white"
          >
            {syncAllLoading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Syncing All…</>
              : <><Database className="h-4 w-4 mr-2" />Sync All Historical</>
            }
          </Button>
          <Button
            onClick={handleCleanMerge}
            disabled={loading || syncAllLoading || mergeLoading}
            title="Clean/Merge mode: scans historical settlements and links existing Zoho bank transactions by reference number (no new transfers created)."
            className="h-11 flex-1 min-w-[160px] rounded-xl font-black uppercase tracking-widest shadow-lg shadow-teal-500/20 bg-teal-600 hover:bg-teal-700 text-white"
          >
            {mergeLoading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Merging…</>
              : <><RefreshCw className="h-4 w-4 mr-2" />Clean / Merge</>
            }
          </Button>
          <Button
            variant="outline"
            onClick={showHistory ? () => setShowHistory(false) : loadHistory}
            disabled={historyLoading}
            className="h-11 rounded-xl font-black uppercase tracking-widest"
          >
            {historyLoading
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : <History className="h-4 w-4 mr-2" />
            }
            {showHistory ? 'Hide History' : 'View History'}
            {showHistory ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-black uppercase text-[10px] tracking-widest">Error</p>
              <p className="text-sm font-medium mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-2xl bg-green-500/10 border border-green-500/20 p-4 text-center">
                <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-1" />
                <p className="text-2xl font-black text-green-500">{result.synced}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Synced</p>
              </div>
              <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/20 p-4 text-center">
                <RefreshCw className="h-5 w-5 text-cyan-500 mx-auto mb-1" />
                <p className="text-2xl font-black text-cyan-600">{result.merged ?? 0}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Merged</p>
              </div>
              <div className="rounded-2xl bg-yellow-500/10 border border-yellow-500/20 p-4 text-center">
                <SkipForward className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
                <p className="text-2xl font-black text-yellow-500">{result.skipped}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Skipped</p>
              </div>
              <div className="rounded-2xl bg-destructive/10 border border-destructive/20 p-4 text-center">
                <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
                <p className="text-2xl font-black text-destructive">{result.failed}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Failed</p>
              </div>
            </div>

            {/* Transfers created */}
            {result.transfers.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">Transfers Created</p>
                <div className="rounded-2xl border bg-muted/20 overflow-hidden divide-y">
                  {result.transfers.map((t) => (
                    <div key={t.settlementId} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="font-bold font-mono text-xs">{t.settlementId}</p>
                        <p className="text-[10px] text-muted-foreground">{t.date} · Zoho: {t.zohoTransferId}</p>
                      </div>
                      <Badge variant="outline" className="font-black text-green-600 border-green-300 bg-green-50">
                        ₹{t.amount.toLocaleString('en-IN')}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-destructive px-1">Failures</p>
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 overflow-hidden divide-y divide-destructive/10">
                  {result.errors.map((e) => (
                    <div key={e.settlementId} className="px-4 py-3 text-sm">
                      <p className="font-bold font-mono text-xs text-destructive">{e.settlementId}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{e.error}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History */}
        {showHistory && history && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-1">
              Sync History ({history.length} records)
            </p>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground px-1">No settlements synced yet.</p>
            ) : (
              <div className="rounded-2xl border bg-muted/20 overflow-hidden divide-y max-h-80 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.settlementId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-bold font-mono text-xs">{h.settlementId}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {h.date} · Zoho: {h.zohoTransferId}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60">
                        Synced {new Date(h.syncedAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                    <Badge variant="outline" className="font-black text-green-600 border-green-300 bg-green-50 shrink-0">
                      ₹{h.amount.toLocaleString('en-IN')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

export default function ZohoSyncTab() {
  return (
    <div className="space-y-8 max-w-3xl mx-auto text-left">
      <SettlementSyncSection />
      <PaymentLookupSection />
    </div>
  );
}
