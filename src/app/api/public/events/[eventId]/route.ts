// src/app/api/public/events/[eventId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getEventDetailsWithTicketsAction } from '@/lib/actions/eventActions';
import { validateApiKey } from '@/lib/apiAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const authResult = await validateApiKey(request);
  if (!authResult.success) {
    return NextResponse.json({ success: false, message: authResult.message }, { status: authResult.status });
  }

  const { eventId } = params;
  if (!eventId) {
    return NextResponse.json({ success: false, message: 'Event ID is required.' }, { status: 400 });
  }

  const result = await getEventDetailsWithTicketsAction(eventId);
  if (result.success) {
    return NextResponse.json({ success: true, event: result.event });
  } else {
    return NextResponse.json({ success: false, message: result.message }, { status: 404 });
  }
}
