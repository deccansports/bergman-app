// src/app/api/public/events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { validateApiKey } from '@/lib/apiAuth';
import { isEventHidden } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const authResult = await validateApiKey(request);
  if (!authResult.success) {
    return NextResponse.json({ success: false, message: authResult.message }, { status: authResult.status });
  }

  const result = await getCalendarEventsAction();
  if (result.success) {
    const events = (result.events || []).filter(event => !isEventHidden(event));
    return NextResponse.json({ success: true, events });
  } else {
    return NextResponse.json({ success: false, message: result.message }, { status: 500 });
  }
}
