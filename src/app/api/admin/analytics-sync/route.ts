import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { isBefore, parseISO, startOfDay } from 'date-fns';
import { 
  computeCountryRegistrationMetricsAction,
  computeEventRegistrationMetricsAction,
  _computeAdminAthleteAnalytics,
  _computeGlobalParticipantStats,
  _computeRetentionStats
} from '@/lib/actions/analyticsActions';
import { _computeAllEventTicketStats } from '@/lib/actions/ticketActions';
import { putKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/analytics-sync
 * Auto-sync all analytics metrics to KV
 * 
 * Query params:
 * - type: 'country' | 'event' | 'all' (default: 'all')
 * - country: 'IN' | 'US' (only if type='country')
 * - eventId: specific event id (only if type='event')
 * - secret: bearer token for protection
 */

async function verifySecret(request: NextRequest): Promise<boolean> {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    console.warn('[analytics-sync] SYNC_SECRET not configured in Firebase App Hosting');
    return false;
  }

  const auth = (request.headers.get('Authorization') || '').trim();
  const headerSecret = (request.headers.get('x-sync-secret') || '').trim();
  const querySecret = (new URL(request.url).searchParams.get('secret') || '').trim();

  let token = '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    token = auth.slice(7).trim();
  } else if (auth.length > 0 && !auth.includes(' ')) {
    token = auth;
  }

  const providedSecret = token || headerSecret || querySecret;
  const isValid = providedSecret.length > 0 && providedSecret === secret;
  
  if (!isValid) {
    console.warn('[analytics-sync] Authorization failed', {
      provided: auth.substring(0, 30) + '...',
      tokenLength: providedSecret.length,
      expectedLength: secret.length,
    });
  }
  
  return isValid;
}

export async function POST(request: NextRequest) {
  try {
    const isAuthed = await verifySecret(request);
    if (!isAuthed) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const syncType = searchParams.get('type') || 'all';
    const country = (searchParams.get('country') || '') as 'IN' | 'US';
    const eventId = searchParams.get('eventId') as string;

    const results: Record<string, any> = {};
    const errors: Array<{ item: string; error: string }> = [];

    console.log(`[Analytics Sync] Starting sync type=${syncType}...`);

    try {
      // Sync athlete analytics
      if (syncType === 'all') {
        console.log('[Analytics Sync] Computing admin athlete analytics...');
        const athleteResult = await _computeAdminAthleteAnalytics();
        results.athlete = athleteResult;
        if (!athleteResult.success) {
          errors.push({ item: 'athlete', error: athleteResult.message });
        }
      }

      // Sync global participant stats
      if (syncType === 'all') {
        console.log('[Analytics Sync] Computing global participant stats...');
        const globalResult = await _computeGlobalParticipantStats();
        results.global = globalResult;
        if (!globalResult.success) {
          errors.push({ item: 'global', error: globalResult.message });
        }
      }

      // Sync ticket sales stats used by Overview -> Ticket Sales & Stats card
      if (syncType === 'all') {
        console.log('[Analytics Sync] Computing ticket stats...');
        const ticketStats = await _computeAllEventTicketStats();
        results.ticketStats = ticketStats;
        if (ticketStats.success) {
          await putKV('analytics:ticket_stats', ticketStats.eventTicketStats || [], 'analytics-sync');
        } else {
          errors.push({ item: 'ticketStats', error: ticketStats.message });
        }
      }

      // Sync retention stats for current year
      if (syncType === 'all') {
        const currentYear = new Date().getFullYear();
        console.log(`[Analytics Sync] Computing retention stats for ${currentYear}...`);
        const retentionResult = await _computeRetentionStats(currentYear);
        results.retention = retentionResult;
        if (!retentionResult.success) {
          errors.push({ item: `retention:${currentYear}`, error: retentionResult.message });
        }
      }

      // Sync country metrics
      if (syncType === 'all' || syncType === 'country') {
        const countries = country ? [country] : ['IN', 'US'];
        for (const c of countries) {
          console.log(`[Analytics Sync] Computing country metrics for ${c}...`);
          const countryResult = await computeCountryRegistrationMetricsAction(c as 'IN' | 'US');
          results[`country:${c}`] = countryResult;
          if (!countryResult.success) {
            errors.push({ item: `country:${c}`, error: countryResult.message });
          }
        }
      }

      // Sync event metrics
      if (syncType === 'all' || syncType === 'event') {
        const db = getFirestoreInstance();
        let eventIds: string[] = [];

        const parseEventDateSafe = (value: any): Date | null => {
          if (!value) return null;
          if (value instanceof Date) return value;
          if (typeof value?.toDate === 'function') return value.toDate();
          if (typeof value === 'string') {
            const parsed = parseISO(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
          }
          return null;
        };

        if (eventId) {
          eventIds = [eventId];
        } else if (syncType === 'event') {
          // Sync only upcoming events (supports string/Timestamp eventDate)
          const today = startOfDay(new Date());
          const eventsSnap = await db.collection('events').select('eventDate').get();
          eventIds = eventsSnap.docs
            .filter((d) => {
              const eventDate = parseEventDateSafe((d.data() as any)?.eventDate);
              return !!eventDate && !isBefore(startOfDay(eventDate), today);
            })
            .map(d => d.id);
        } else {
          // syncType === 'all' - sync only upcoming events
          const today = startOfDay(new Date());
          const eventsSnap = await db.collection('events').select('eventDate').get();
          eventIds = eventsSnap.docs
            .filter((d) => {
              const eventDate = parseEventDateSafe((d.data() as any)?.eventDate);
              return !!eventDate && !isBefore(startOfDay(eventDate), today);
            })
            .map(d => d.id);
        }

        console.log(`[Analytics Sync] Syncing metrics for ${eventIds.length} event(s)...`);
        for (const eid of eventIds) {
          try {
            const eventResult = await computeEventRegistrationMetricsAction(eid);
            results[`event:${eid}`] = eventResult;
            if (!eventResult.success) {
              errors.push({ item: `event:${eid}`, error: eventResult.message });
            }
          } catch (e: any) {
            errors.push({ item: `event:${eid}`, error: e.message });
          }
        }
      }
    } catch (e: any) {
      console.error('[Analytics Sync] Sync failed:', e.message);
      return NextResponse.json(
        {
          success: false,
          message: `Sync failed: ${e.message}`,
          results,
          errors,
        },
        { status: 500 }
      );
    }

    const success = errors.length === 0;
    console.log(`[Analytics Sync] Complete. Success: ${success}, Errors: ${errors.length}`);

    return NextResponse.json(
      {
        success,
        message: success
          ? `Analytics synced successfully (${Object.keys(results).length} items)`
          : `Analytics sync completed with ${errors.length} error(s)`,
        results,
        errors,
        timestamp: new Date().toISOString(),
      },
      { status: success ? 200 : 207 }
    );
  } catch (err: any) {
    console.error('[API /analytics-sync] Unexpected error:', err.message);
    return NextResponse.json(
      { success: false, message: err.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/analytics-sync?type=status
 * Check sync status and KV cache keys
 */
export async function GET(request: NextRequest) {
  try {
    const isAuthed = await verifySecret(request);
    if (!isAuthed) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';

    if (action === 'status') {
      return NextResponse.json({
        success: true,
        message: 'Analytics sync service is running',
        endpoints: {
          post: 'POST /api/admin/analytics-sync?type=all|country|event&country=IN|US&eventId=xxx',
          description: 'Sync all analytics metrics to KV Cache',
        },
      });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
