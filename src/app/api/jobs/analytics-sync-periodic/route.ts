import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/analytics-sync-periodic
 * 
 * Cloud Scheduler job: runs every 5 minutes
 * Triggers auto-sync of analytics metrics to KV for upcoming events
 * 
 * Protected by bearer secret in Authorization header
 */

export async function GET(request: NextRequest) {
  try {
    // Verify bearer token (Cloud Scheduler job)
    const secret = process.env.SYNC_SECRET;
    if (!secret) {
      console.warn('[analytics-sync-periodic] SYNC_SECRET not configured');
      return NextResponse.json({ success: false, message: 'Service misconfigured' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (bearerToken !== secret) {
      console.warn('[analytics-sync-periodic] Unauthorized request');
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    console.log('[analytics-sync-periodic] Job triggered');

    // Call the main admin analytics-sync endpoint with admin secret
    const syncUrl = new URL(request.url);
    syncUrl.pathname = '/api/admin/analytics-sync';
    syncUrl.searchParams.set('type', 'all');

    // Build headers with auth
    const headers = new Headers({
      'Authorization': `Bearer ${secret}`,
      'Content-Type': 'application/json',
    });

    const syncResponse = await fetch(syncUrl.toString(), {
      method: 'POST',
      headers,
    });

    const syncData = await syncResponse.json();

    if (!syncResponse.ok) {
      console.error('[analytics-sync-periodic] Sync failed:', syncData);
      return NextResponse.json(
        { success: false, message: 'Analytics sync failed', details: syncData },
        { status: syncResponse.status }
      );
    }

    console.log('[analytics-sync-periodic] Sync completed successfully');
    return NextResponse.json({
      success: true,
      message: 'Analytics sync job completed',
      syncResult: syncData,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[analytics-sync-periodic] Job error:', err.message);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}
