/**
 * Contest Mapping API Endpoint (Phase 3)
 * 
 * POST   /api/feibot/contests/map - Create mapping
 * GET    /api/feibot/contests/map?eventId=xxx - List mappings
 * PUT    /api/feibot/contests/map/{mappingId} - Update mapping
 * DELETE /api/feibot/contests/map/{mappingId} - Delete mapping
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createContestMapping,
  getContestMapping,
  listContestMappings,
  updateContestMapping,
  deleteContestMapping,
  getContestMappingSummary,
  listContestMappingsByConnection,
  validateContestMapping,
} from '@/lib/feibot-integration/contest-mapping';
import type { ContestMappingRequest } from '@/lib/feibot-integration/contest-mapping-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const expectedToken = process.env.FEIBOT_API_TOKEN || process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true; // Allow if not configured
  return token === expectedToken;
}

// POST - Create or batch update mappings
export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { eventId, connectionId, mappings } = body;

    if (!eventId || !connectionId) {
      return NextResponse.json(
        { success: false, error: 'eventId and connectionId are required' },
        { status: 400 }
      );
    }

    if (Array.isArray(mappings)) {
      // Batch update
      const results = await Promise.all(
        mappings.map(async (mapping: ContestMappingRequest) => {
          try {
            const created = await createContestMapping(eventId, connectionId, mapping, 'system');
            return { success: true, mapping: created };
          } catch (error) {
            return { success: false, error: String(error) };
          }
        })
      );

      const summary = await getContestMappingSummary(eventId);

      return NextResponse.json({
        success: true,
        count: results.filter((r) => r.success).length,
        results,
        summary,
      });
    } else {
      // Single mapping
      const mapping = body as ContestMappingRequest;
      const validation = await validateContestMapping(eventId, {
        mappingId: `${mapping.feibotContestUuid}`,
        eventId,
        connectionId,
        feibotContestUuid: mapping.feibotContestUuid,
        feibotContestName: mapping.feibotContestName,
        feibotProvider: 'feibot',
        mappingType: mapping.mappingType,
        bergmanEventId: mapping.bergmanEventId,
        bergmanTicketId: mapping.bergmanTicketId,
        bergmanSubCategoryId: mapping.bergmanSubCategoryId,
        status: 'active',
        matchConfidence: mapping.matchConfidence || 100,
        matchMethod: 'manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'system',
        notes: mapping.notes,
        validated: false,
        validationErrors: [],
      } as any);

      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: 'Validation failed', errors: validation.errors },
          { status: 400 }
        );
      }

      const created = await createContestMapping(eventId, connectionId, mapping, 'system');
      return NextResponse.json({ success: true, mapping: created });
    }
  } catch (error) {
    console.error('[contest-mapping] POST error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

// GET - List mappings or get summary
export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const eventId = req.nextUrl.searchParams.get('eventId');
    const connectionId = req.nextUrl.searchParams.get('connectionId');
    const summaryOnly = req.nextUrl.searchParams.get('summary') === '1';

    if (!eventId) {
      return NextResponse.json(
        { success: false, error: 'eventId is required' },
        { status: 400 }
      );
    }

    if (summaryOnly) {
      const summary = await getContestMappingSummary(eventId);
      return NextResponse.json({ success: true, summary });
    }

    let mappings;
    if (connectionId) {
      mappings = await listContestMappingsByConnection(eventId, connectionId);
    } else {
      mappings = await listContestMappings(eventId);
    }

    const summary = await getContestMappingSummary(eventId);

    return NextResponse.json({
      success: true,
      mappings,
      summary,
      count: mappings.length,
    });
  } catch (error) {
    console.error('[contest-mapping] GET error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

// PUT - Update mapping
export async function PUT(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { eventId, mappingId, updates } = body;

    if (!eventId || !mappingId) {
      return NextResponse.json(
        { success: false, error: 'eventId and mappingId are required' },
        { status: 400 }
      );
    }

    const updated = await updateContestMapping(eventId, mappingId, updates);
    return NextResponse.json({ success: true, mapping: updated });
  } catch (error) {
    console.error('[contest-mapping] PUT error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

// DELETE - Delete mapping
export async function DELETE(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { eventId, mappingId } = body;

    if (!eventId || !mappingId) {
      return NextResponse.json(
        { success: false, error: 'eventId and mappingId are required' },
        { status: 400 }
      );
    }

    await deleteContestMapping(eventId, mappingId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[contest-mapping] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
