import { NextResponse } from 'next/server';
import { getFeaturedLibraryVideo } from '@/lib/actions/videoLibraryActions';

export const dynamic = 'force-dynamic';

export async function GET() {
  const video = await getFeaturedLibraryVideo();
  return NextResponse.json({
    success: true,
    data: {
      video,
    },
  });
}
