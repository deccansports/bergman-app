import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'deprecated_endpoint',
        message: 'This endpoint is deprecated. Use /api/broadcast/playback instead.',
      },
    },
    { status: 410 }
  );
}
