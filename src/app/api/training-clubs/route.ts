import { NextRequest } from 'next/server';
import { searchClubsFromKV } from '@/lib/chatMemory';
import { deleteKV } from '@/lib/cloudflare/kv';
import { _syncAllClubsToKV } from '@/lib/actions/clubActions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRAINING_CLUBS_CACHE_KEY = 'training:clubs:ranked:v2';

export async function GET(request: NextRequest) {
  try {
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const city = request.nextUrl.searchParams.get('city') || undefined;

    if (refresh) {
      console.log('[Training Clubs API] refresh=1 — busting aggregate cache and rebuilding from Firestore');
      try {
        await deleteKV(TRAINING_CLUBS_CACHE_KEY, 'training-clubs:refresh');
      } catch (e: any) {
        console.warn('[Training Clubs API] Failed to bust aggregate cache:', e?.message);
      }
      // Rebuild per-club KV entries from Firestore so anything new is included.
      try {
        const syncRes = await _syncAllClubsToKV();
        console.log(`[Training Clubs API] Refresh sync result: ${syncRes.message}`);
      } catch (e: any) {
        console.warn('[Training Clubs API] Forced sync failed:', e?.message);
      }
    }

    let clubs = await searchClubsFromKV(city);

    // Self-heal: if KV returned nothing (likely because clubs were never synced
    // or the namespace was wiped), rebuild from Firestore once and retry.
    if (!clubs.length && !refresh) {
      console.warn('[Training Clubs API] No clubs in KV — auto-syncing from Firestore...');
      try {
        const syncRes = await _syncAllClubsToKV();
        console.log(`[Training Clubs API] Auto-sync result: ${syncRes.message}`);
        try { await deleteKV(TRAINING_CLUBS_CACHE_KEY, 'training-clubs:auto-heal'); } catch {}
        clubs = await searchClubsFromKV(city);
      } catch (e: any) {
        console.error('[Training Clubs API] Auto-sync failed:', e?.message);
      }
    }

    const clubsWithLogos = clubs.filter((c) => c.logoUrl);
    console.log(
      `[Training Clubs API] Returning ${clubs.length} clubs, ${clubsWithLogos.length} with logos${refresh ? ' (refreshed)' : ''}`
    );

    return Response.json(clubs, {
      headers: {
        // No CDN caching — Cloudflare KV already serves as the cache layer.
        // s-maxage was causing stale city/state to be served for up to 6 min
        // even after admin updates flushed the KV.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[Training Clubs API] Error:', error);
    return Response.json(
      { error: 'Failed to fetch clubs', message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
