import { NextRequest, NextResponse } from 'next/server';
import { loadParticipantIndex as loadParticipantIndexStore } from '@/lib/liveTrackingParticipantStore';
import { getKV } from '@/lib/cloudflare/kv';
import { resolveLiveTrackingAccess } from '@/lib/liveTrackingAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/live/participants/[eventId]
 * 
 * Returns the participant index for the athlete search component.
 * This endpoint loads the participant data from KV and returns it as an array
 * for use in the client-side search engine.
 * 
 * Query params:
 * - kvOnly: (optional) if set, only return KV-loaded data, skip Firestore
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const eventId = params.eventId || '';
  const kvOnly = request.nextUrl.searchParams.get('kvOnly') === '1';

  if (!eventId) {
    return NextResponse.json(
      { error: 'Event ID is required' },
      { status: 400 }
    );
  }

  try {
    // Check access permissions
    const access = await resolveLiveTrackingAccess(request);
    if (!access) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Load participant index from KV
    const liveParticipantIndex = await loadParticipantIndexStore(eventId);
    
    // Convert to array format if needed
    let participants: any[] = [];
    
    if (liveParticipantIndex && typeof liveParticipantIndex === 'object') {
      if (Array.isArray((liveParticipantIndex as any)?.participants)) {
        // Already in array format
        participants = (liveParticipantIndex as any).participants;
      } else if ((liveParticipantIndex as any)?.byBib) {
        // Convert from object format to array
        participants = Object.values((liveParticipantIndex as any).byBib).flat();
      }
    }

    // If KV-only requested and nothing found, try legacy athletes KV
    if (participants.length === 0 && !kvOnly) {
      const liveAthletes = await getKV<any[]>(`live:event:${eventId}:athletes`, 'api-live-participant-search');
      if (Array.isArray(liveAthletes) && liveAthletes.length > 0) {
        participants = liveAthletes;
      }
    }

    // Return standardized response
    return NextResponse.json({
      success: true,
      eventId,
      participants,
      count: participants.length,
      source: 'kv',
    });
  } catch (error) {
    console.error(`[participants/${eventId}] Error:`, error);
    return NextResponse.json(
      {
        error: 'Failed to load participants',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

