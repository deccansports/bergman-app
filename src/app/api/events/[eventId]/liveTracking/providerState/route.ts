import { NextRequest, NextResponse } from 'next/server';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { mergeProviderState, type LiveTrackingProviderState } from '@/lib/live-tracking/providerState';

export const dynamic = 'force-dynamic';

const PROVIDER_STATE_CACHE_TTL_MS = 60_000;
const providerStateCache = new Map<string, { expiresAt: number; payload: any }>();

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

function normalizeHub(value: any) {
  const hub = value && typeof value === 'object' ? value : {};
  return {
    ...hub,
    provider: String(hub?.provider || 'feibot').trim().toLowerCase() || 'feibot',
    trackingConfig: hub?.trackingConfig || {},
    feibotConfig: hub?.feibotConfig || {},
  };
}

async function loadProviderHubFromKv(eventId: string) {
  const [liveConfig, eventConfig] = await Promise.all([
    getKV<Record<string, any>>(`live:event:${eventId}:provider-config`, 'api-provider-state'),
    getKV<Record<string, any>>(`event:${eventId}:provider-config`, 'api-provider-state'),
  ]);
  return normalizeHub(liveConfig || eventConfig || {});
}

async function loadProviderParticipantsSummaryFromKv(eventId: string) {
  return (
    (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants:index`, 'api-provider-state')) ||
    (await getKV<Record<string, any>>(`event:${eventId}:providerParticipants:index`, 'api-provider-state')) ||
    (await getKV<Record<string, any>>(`event:${eventId}:providerParticipants`, 'api-provider-state')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-provider-state')) ||
    null
  );
}

function normalizeProviderState(value: any, hub: any): LiveTrackingProviderState {
  const current = value && typeof value === 'object' ? value : {};
  return mergeProviderState(current, {
    provider: current.provider || hub?.provider || 'feibot',
    configurationSource: 'cloud_api',
    replayEnabled: typeof current.replayEnabled === 'boolean' ? current.replayEnabled : !!hub?.trackingConfig?.enableReplayMode,
    updatedAt: current.updatedAt || new Date().toISOString(),
  }, hub);
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    const cached = providerStateCache.get(eventId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        },
      });
    }

    const hub = await loadProviderHubFromKv(eventId);
    const providerParticipants = await loadProviderParticipantsSummaryFromKv(eventId);
    const kvState = (await getKV<Record<string, any>>(`event:${eventId}:providerState`, 'api-provider-state')) ||
      (await getKV<Record<string, any>>(`live:event:${eventId}:providerState`, 'api-provider-state')) ||
      null;

    if (!kvState) {
      const payload = {
        success: true,
        eventId,
        providerState: null,
      };
      providerStateCache.set(eventId, { expiresAt: Date.now() + PROVIDER_STATE_CACHE_TTL_MS, payload });
      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        },
      });
    }

    const participantCount = Array.isArray(providerParticipants?.participants)
      ? providerParticipants.participants.length
      : Number(providerParticipants?.importedCount || 0);
    const providerState = normalizeProviderState({
      ...kvState,
      participantsImported: participantCount > 0 || Boolean(kvState?.participantsImported),
      lastSuccessfulParticipantImport: participantCount > 0 ? (providerParticipants?.importTime || kvState?.lastSuccessfulParticipantImport || null) : kvState?.lastSuccessfulParticipantImport || null,
    }, hub);

    const payload = {
      success: true,
      eventId,
      providerState,
    };

    providerStateCache.set(eventId, { expiresAt: Date.now() + PROVIDER_STATE_CACHE_TTL_MS, payload });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load provider state' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const providerStateInput = body?.providerState && typeof body.providerState === 'object' ? body.providerState : body;
    if (!providerStateInput || typeof providerStateInput !== 'object') {
      return NextResponse.json({ success: false, message: 'providerState object is required' }, { status: 400 });
    }

    const hub = await loadProviderHubFromKv(eventId);
    const currentState =
      (await getKV<Record<string, any>>(`event:${eventId}:providerState`, 'api-provider-state')) ||
      (await getKV<Record<string, any>>(`live:event:${eventId}:providerState`, 'api-provider-state')) ||
      {};
    const providerParticipants = await loadProviderParticipantsSummaryFromKv(eventId);
    const participantCount = Array.isArray(providerParticipants?.participants)
      ? providerParticipants.participants.length
      : Number(providerParticipants?.importedCount || 0);
    const nextState = mergeProviderState(currentState, {
      ...providerStateInput,
      participantsImported: participantCount > 0 || Boolean(providerStateInput?.participantsImported),
      lastSuccessfulParticipantImport: participantCount > 0 ? (providerParticipants?.importTime || providerStateInput?.lastSuccessfulParticipantImport || null) : providerStateInput?.lastSuccessfulParticipantImport || null,
    }, hub);

    await putKV(`event:${eventId}:providerState`, nextState, 'api-provider-state');
    await putKV(`live:event:${eventId}:providerState`, nextState, 'api-provider-state');
    providerStateCache.delete(eventId);

    return NextResponse.json({ success: true, eventId, providerState: nextState, message: 'Provider state saved' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to save provider state' }, { status: 500 });
  }
}
