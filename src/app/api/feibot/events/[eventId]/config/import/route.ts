/**
 * Import Event Configuration Endpoint
 * 
 * POST /api/feibot/events/{eventId}/config/import
 * Fetches and imports complete event configuration from Feibot
 * Archives raw response to KV, processes and stores parsed config
 */

import { NextRequest, NextResponse } from 'next/server';
import { importEventConfiguration, extractConfigSummary } from '@/lib/feibot-integration/event-config';
import type { APIResponse } from '@/lib/feibot-integration/types';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  
  const token =
    req.headers.get('x-bergman-internal-token') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  
  return token === expectedToken;
}

/**
 * POST - Import event configuration from Feibot
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } }
): Promise<NextResponse> {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const eventId = String(params.eventId || '').trim();
    
    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'Event ID is required' },
        { status: 400 }
      );
    }
    
    const body = await req.json().catch(() => ({}));
    const { eventUuid, connectionId } = body;
    
    if (!eventUuid || !connectionId) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields: eventUuid, connectionId' },
        { status: 400 }
      );
    }
    
    // Import configuration
    const importResult = await importEventConfiguration(eventId, eventUuid, connectionId);
    
    if (!importResult.success) {
      const statusCode = Number(importResult.statusCode || 400);
      return NextResponse.json(
        {
          success: false,
          message: importResult.message,
          error: importResult.error,
        },
        { status: statusCode }
      );
    }
    
    // Extract summary for display
    const summary = importResult.config
      ? extractConfigSummary(importResult.config)
      : undefined;
    
    return NextResponse.json({
      success: true,
      message: importResult.message,
      data: {
        eventId,
        eventUuid: importResult.eventUuid,
        importStats: importResult.summary,
        summary,
      },
    } as APIResponse<any>);
  } catch (error) {
    console.error('Error importing event configuration:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to import event configuration',
      },
      { status: 500 }
    );
  }
}
