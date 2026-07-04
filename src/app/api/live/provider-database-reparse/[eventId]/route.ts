import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { eventId: string } }) {
  const eventId = decodeURIComponent(params.eventId || '').trim();
  return NextResponse.json(
    {
      success: false,
      eventId,
      message: 'Legacy database reparse is disabled. Cloud API is the only source of truth.',
    },
    { status: 410 },
  );
}
