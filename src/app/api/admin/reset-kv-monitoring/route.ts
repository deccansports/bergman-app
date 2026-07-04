import { NextRequest, NextResponse } from 'next/server';
import { putKV, deleteKV, getKV } from '@/lib/cloudflare/kv';

export async function POST(req: NextRequest) {
  try {
    const actionName = 'resetKvMonitoring';
    
    // Reset KV monitoring/analytics keys
    const keysToReset = [
      'kv:analytics:reads_1m',
      'kv:analytics:writes_1m',
      'kv:analytics:misses_1m',
      'kv:analytics:reads_24h',
      'kv:analytics:writes_24h',
      'kv:analytics:misses_24h',
      'kv:analytics:operations_log',
      'kv:analytics:high_read_sources',
      'kv:analytics:recently_updated_keys',
      'kv:monitoring:stream',
      'kv:monitoring:last_sync'
    ];

    const results = {
      deleted: [] as string[],
      reset: [] as string[],
      errors: [] as string[]
    };

    // Delete old monitoring keys
    for (const key of keysToReset) {
      try {
        await deleteKV(key, actionName);
        results.deleted.push(key);
      } catch (error) {
        // Key might not exist, that's fine
        results.deleted.push(`${key} (not found)`);
      }
    }

    // Initialize fresh monitoring keys with current timestamp
    const now = new Date().toISOString();
    const freshMonitoring = {
      lastSync: now,
      readsPerMinute: 0,
      writesPerMinute: 0,
      cacheMissesPerMinute: 0,
      reads24h: 0,
      writes24h: 0,
      cacheMisses24h: 0,
      operationsLog: [],
      highReadSources: {},
      recentlyUpdatedKeys: [],
      status: 'LIVE'
    };

    await putKV('kv:monitoring:stream', freshMonitoring, actionName);
    results.reset.push('kv:monitoring:stream initialized with fresh data');

    // Reset operation counters
    await putKV('kv:ops:1m:reads', { count: 0, timestamp: now }, actionName);
    await putKV('kv:ops:1m:writes', { count: 0, timestamp: now }, actionName);
    await putKV('kv:ops:24h:reads', { count: 0, timestamp: now }, actionName);
    await putKV('kv:ops:24h:writes', { count: 0, timestamp: now }, actionName);
    
    results.reset.push('Operation counters reset to 0');
    results.reset.push(`Monitoring started at: ${now}`);

    return NextResponse.json({
      success: true,
      message: 'KV monitoring reset successfully',
      timestamp: now,
      deleted: results.deleted.length,
      reset: results.reset.length,
      results
    });
  } catch (error) {
    console.error('Error resetting KV monitoring:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error resetting KV monitoring: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}
