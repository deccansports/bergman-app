// src/components/admin/ZohoSyncTab.tsx
"use client";

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, CreditCard, RefreshCw, AlertCircle, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ZohoSyncTab() {
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
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Request failed");
        setResult(data);
      } else {
        setResult(data);
        if (data.message && data.message.includes("No payment found")) {
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
    <div className="space-y-6 max-w-3xl mx-auto text-left">
      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary/5 border-b text-left">
          <CardTitle className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tighter text-left">
            <CreditCard className="h-5 w-5 text-primary" />
            Zoho Books Payment Lookup
          </CardTitle>
          <CardDescription className="text-left font-medium">
            Search and verify payment status in Zoho Books by Reference Number or Booking ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-8 space-y-6 text-left">
          <div className="flex flex-col sm:flex-row gap-3 text-left">
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
            <Button onClick={handleSync} disabled={loading || !reference.trim()} className="h-11 rounded-xl px-8 font-black uppercase tracking-widest shadow-lg shadow-primary/20">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync & Verify
            </Button>
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-start gap-3 animate-in slide-in-from-top-2">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="text-left">
                <p className="font-black uppercase text-[10px] tracking-widest">Query Error</p>
                <p className="text-sm font-medium mt-1">{error}</p>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 text-left">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left px-1">Raw API Data Breakdown</h4>
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
    </div>
  );
}
