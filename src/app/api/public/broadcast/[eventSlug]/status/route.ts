import { NextResponse } from 'next/server';
import { loadPublicBroadcastData } from '@/lib/broadcast/public';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { eventSlug: string } }) {
  const data = await loadPublicBroadcastData(params?.eventSlug || '');
  if (!data) {
    return NextResponse.json({ success: false, error: { code: 'not_found', message: 'Broadcast event not found' } }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      event: data.event,
      live: data.summary.liveCameras > 0,
      summary: data.summary,
    },
  });
}
