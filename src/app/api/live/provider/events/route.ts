import { NextRequest, NextResponse } from 'next/server';
import { loadFeibotIntegration } from '@/lib/feibot-integration/integration-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const eventId = String(req.nextUrl.searchParams.get('eventId') || '').trim();
  if (!eventId) {
    return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
  }

  const integration = await loadFeibotIntegration(eventId);
  if (!integration) {
    return NextResponse.json({
      success: false,
      message: 'No Feibot Event UUID configured. Authenticate and discover events first.',
      eventId,
      events: [],
      eventsCount: 0,
    }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    eventId,
    authenticated: Boolean(integration.authenticated),
    credentialsValid: Boolean(integration.credentialsValid),
    eventUuid: integration.eventUuid || null,
    selectedEvent: integration.selectedEvent || null,
    events: Array.isArray(integration.events) ? integration.events : [],
    eventsCount: Number(integration.eventsCount || 0) || 0,
    status: integration.status || (integration.authenticated ? 'ready' : 'pending'),
    updatedAt: integration.updatedAt || null,
    integration,
  });
}
