import { NextRequest, NextResponse } from 'next/server';
import { getCalendarEventsAction } from '@/lib/actions/eventActions';
import { isEventHidden } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const result = await getCalendarEventsAction();
    if (result.success) {
      const events = (result.events || []).filter(event => !isEventHidden(event));
      return NextResponse.json({ success: true, events });
    }

    return NextResponse.json({ success: false, message: result.message }, { status: 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Failed to load mobile events' }, { status: 500 });
  }
}
