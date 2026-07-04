import { NextResponse } from 'next/server';
import { _syncAllClubsToKV } from '@/lib/actions/clubActions';

export const maxDuration = 60;

/**
 * POST /api/admin/sync-clubs-to-kv
 * Manually trigger sync of all clubs from Firestore to Cloudflare KV
 * This ensures all club data (logos, details, rankings) are available in KV
 */
export async function POST() {
    try {
        console.log('[sync-clubs-to-kv] Starting club sync to KV...');
        const result = await _syncAllClubsToKV();
        
        return NextResponse.json(
            {
                success: result.success,
                count: result.count,
                message: result.message,
                timestamp: new Date().toISOString()
            },
            { status: result.success ? 200 : 500 }
        );
    } catch (error) {
        console.error('[sync-clubs-to-kv] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
            },
            { status: 500 }
        );
    }
}
