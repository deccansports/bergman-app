// src/app/api/public/events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { validateApiKey } from '@/lib/apiAuth';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.success) {
    return NextResponse.json({ success: false, message: authResult.message }, { status: authResult.status });
  }

  const result = await getCalendarEventsAction();
  if (result.success) {
    return NextResponse.json({ success: true, events: result.events });
  } else {
    return NextResponse.json({ success: false, message: result.message }, { status: 500 });
  }
}
