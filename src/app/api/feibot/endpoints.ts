/**
 * API Routes for Feibot Live Tracking
 * 
 * Server-side endpoints that provide secure access to Feibot data
 * with authentication, rate limiting, and caching.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDecryptedCredentials } from '@/lib/feibot-integration/credentials';
import { resolveLiveTrackingAccess } from '@/lib/liveTrackingAccess';
import type { FeibotAPIConfig } from '@/lib/feibot-integration/types';
import {
  fetchLeaderboardQuery,
  fetchProcessQuery,
  fetchFinishResultQuery,
  fetchResultDataGetAll,
} from '@/lib/feibot-integration/endpoints';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Authorize internal request
 */
function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  
  const token =
    req.headers.get('x-bergman-internal-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  
  return token === expectedToken;
}

/**
 * Resolve Feibot config from event
 */
async function resolveFeibotConfig(eventId: string): Promise<FeibotAPIConfig | null> {
  try {
    const credentials = await getDecryptedCredentials(eventId);
    if (!credentials) return null;

    return {
      accountId: credentials.accountId,
      accessKey: credentials.accessKey,
      secretKey: credentials.secretKey,
      apiBaseUrl: credentials.apiBaseUrl || 'https://apicn.feibot.com',
      credentialMeta: {
        credentialType: credentials.credentialMeta?.credentialType as 'event' | 'account' | undefined,
        boundEventUuid: credentials.credentialMeta?.boundEventUuid,
      },
    };
  } catch (error) {
    console.error('[Feibot] Error resolving config:', error);
    return null;
  }
}
/**
 * Handle API errors consistently
 */
function handleError(error: unknown, context: string) {
  console.error(`[Feibot] ${context}:`, error);

  if (error instanceof Error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        context,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: 'Unknown error',
      context,
    },
    { status: 500 }
  );
}

// ============================================================================
// LEADERBOARD ENDPOINT
// ============================================================================

/**
 * GET /api/feibot/leaderboard/[eventId]
 * 
 * Fetch leaderboard data from Feibot
 * Query params:
 *   - contest: filter by contest
 *   - ageGroup: filter by age group
 *   - gender: filter by gender (Male/Female/All)
 */
export async function GET_Leaderboard(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const { eventId } = context.params;

    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get Feibot config
    const config = await resolveFeibotConfig(eventId);
    if (!config) {
      return NextResponse.json(
        { ok: false, error: 'Feibot not configured' },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const eventUuid = config.credentialMeta?.boundEventUuid;

    if (!eventUuid) {
      return NextResponse.json(
        { ok: false, error: 'Event UUID not found' },
        { status: 400 }
      );
    }

    // Fetch leaderboard
    const leaderboard = await fetchLeaderboardQuery(config, eventUuid);

    // Apply filters if provided
    let result = leaderboard;
    const contestFilter = searchParams.get('contest');
    const ageGroupFilter = searchParams.get('ageGroup');
    const genderFilter = searchParams.get('gender') || 'All';

    if (leaderboard.contest && contestFilter) {
      result = {
        ...leaderboard,
        contest: {
          [contestFilter]: leaderboard.contest[contestFilter],
        },
      };
    }

    return NextResponse.json({
      ok: true,
      data: result,
      filters: { contest: contestFilter, ageGroup: ageGroupFilter, gender: genderFilter },
    });
  } catch (error) {
    return handleError(error, 'GET_Leaderboard');
  }
}

// ============================================================================
// PROCESS DATA ENDPOINT
// ============================================================================

/**
 * GET /api/feibot/process/[eventId]
 * 
 * Fetch race process data from Feibot
 */
export async function GET_ProcessData(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const { eventId } = context.params;

    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get Feibot config
    const config = await resolveFeibotConfig(eventId);
    if (!config) {
      return NextResponse.json(
        { ok: false, error: 'Feibot not configured' },
        { status: 400 }
      );
    }

    const eventUuid = config.credentialMeta?.boundEventUuid;
    if (!eventUuid) {
      return NextResponse.json(
        { ok: false, error: 'Event UUID not found' },
        { status: 400 }
      );
    }

    // Fetch process data
    const process = await fetchProcessQuery(config, eventUuid);

    return NextResponse.json({
      ok: true,
      data: process,
    });
  } catch (error) {
    return handleError(error, 'GET_ProcessData');
  }
}

// ============================================================================
// FINISH RESULT ENDPOINT
// ============================================================================

/**
 * GET /api/feibot/finish-result/[eventId]
 * 
 * Fetch finish result for participant
 * Query params:
 *   - bib: comma-separated bibs
 *   - chip_code: chip code
 *   - name: participant name
 *   - id_code: ID document number
 */
export async function GET_FinishResult(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const { eventId } = context.params;

    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get Feibot config
    const config = await resolveFeibotConfig(eventId);
    if (!config) {
      return NextResponse.json(
        { ok: false, error: 'Feibot not configured' },
        { status: 400 }
      );
    }

    const eventUuid = config.credentialMeta?.boundEventUuid;
    if (!eventUuid) {
      return NextResponse.json(
        { ok: false, error: 'Event UUID not found' },
        { status: 400 }
      );
    }

    // Get query filters
    const searchParams = request.nextUrl.searchParams;
    const filters: any = {};

    if (searchParams.has('bib')) filters.bib = searchParams.get('bib');
    if (searchParams.has('chip_code')) filters.chip_code = searchParams.get('chip_code');
    if (searchParams.has('name')) filters.name = searchParams.get('name');
    if (searchParams.has('id_code')) filters.id_code = searchParams.get('id_code');

    if (!Object.keys(filters).length) {
      return NextResponse.json(
        { ok: false, error: 'At least one filter required (bib, chip_code, name, id_code)' },
        { status: 400 }
      );
    }

    // Fetch result
    const result = await fetchFinishResultQuery(config, eventUuid, filters);

    return NextResponse.json({
      ok: true,
      data: result.data,
      code: result.code,
      msg: result.msg,
    });
  } catch (error) {
    return handleError(error, 'GET_FinishResult');
  }
}

// ============================================================================
// ALL RESULTS ENDPOINT
// ============================================================================

/**
 * GET /api/feibot/all-results/[eventId]
 * 
 * Fetch all results for event
 * Note: This can be a large request. Consider pagination or streaming in production.
 */
export async function GET_AllResults(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const { eventId } = context.params;

    // Check authorization
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get Feibot config
    const config = await resolveFeibotConfig(eventId);
    if (!config) {
      return NextResponse.json(
        { ok: false, error: 'Feibot not configured' },
        { status: 400 }
      );
    }

    const eventUuid = config.credentialMeta?.boundEventUuid;
    if (!eventUuid) {
      return NextResponse.json(
        { ok: false, error: 'Event UUID not found' },
        { status: 400 }
      );
    }

    // Fetch all results
    const response = await fetchResultDataGetAll(config, eventUuid);

    return NextResponse.json({
      ok: true,
      code: response.code,
      msg: response.msg,
      data: response.data || [],
      count: (response.data || []).length,
    });
  } catch (error) {
    return handleError(error, 'GET_AllResults');
  }
}
