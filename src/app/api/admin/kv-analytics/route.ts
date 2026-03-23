// src/app/api/admin/kv-analytics/route.ts
import { NextResponse } from "next/server";
import { getKV } from "@/lib/cloudflare/kv";
import { subDays } from 'date-fns';

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

export const dynamic = 'force-dynamic';

export async function GET() {
  const KV_LOG_KEY = 'system:kv-analytics-log';
  try {
    const logs = await getKV<KVLog[]>(KV_LOG_KEY, 'admin:kv-analytics-tab-api');

    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      return NextResponse.json({ 
        logs: [], 
        summary: { reads24h: 0, writes24h: 0, cacheMisses24h: 0 },
        highReadSources: []
      });
    }

    // Calculate Stats
    const now = new Date();
    const twentyFourHoursAgo = subDays(now, 1);
    
    let reads24h = 0;
    let writes24h = 0;
    let cacheMisses24h = 0;

    logs.forEach(l => {
      if (l.timestamp && new Date(l.timestamp) >= twentyFourHoursAgo) {
        if (l.operation === 'READ') reads24h++;
        if (l.operation === 'WRITE') writes24h++;
        if (l.status === 'CACHE_MISS') cacheMisses24h++;
      }
    });

    const summary = { reads24h, writes24h, cacheMisses24h };
    
    const sourceStats: { [source: string]: { totalReads: number } } = {};
    logs.filter(l => l.operation === 'READ').forEach(log => {
      if (!sourceStats[log.source]) {
        sourceStats[log.source] = { totalReads: 0 };
      }
      sourceStats[log.source].totalReads += 1;
    });
    
    const highReadSources = Object.entries(sourceStats)
      .map(([source, stats]) => ({
        source,
        totalReads: stats.totalReads,
      }))
      .sort((a, b) => b.totalReads - a.totalReads)
      .slice(0, 10);

    return NextResponse.json({ 
      logs: logs, // Return the full log array
      summary,
      highReadSources 
    });

  } catch (e: any) {
    return NextResponse.json({ error: `Failed to fetch KV logs: ${e.message}` }, { status: 500 });
  }
}
