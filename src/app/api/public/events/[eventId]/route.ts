// src/app/api/public/events/[eventId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getEventDetailsWithTicketsAction } from '@/lib/actions/eventActions';
import { validateApiKey } from '@/lib/apiAuth';
import { isTicketHidden } from '@/lib/utils';

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const authResult = await validateApiKey(request, { required: false });
  if (!authResult.success) {
    return NextResponse.json({ success: false, message: authResult.message }, { status: authResult.status });
  }

  const { eventId } = params;
  if (!eventId) {
    return NextResponse.json({ success: false, message: 'Event ID is required.' }, { status: 400 });
  }

  const result = await getEventDetailsWithTicketsAction(eventId);
  if (result.success && result.event) {
    // Filter out hidden tickets from public API response
    const publicEvent = {
      ...result.event,
      ticketDefinitions: (result.event.ticketDefinitions || []).filter(ticket => !isTicketHidden(ticket)),
    };
    return NextResponse.json({ success: true, event: publicEvent });
  } else {
    return NextResponse.json({ success: false, message: result.message }, { status: 404 });
  }
}
