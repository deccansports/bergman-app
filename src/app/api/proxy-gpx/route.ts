
// src/app/api/proxy-gpx/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gpxUrl = searchParams.get('url');

  if (!gpxUrl) {
    return NextResponse.json({ error: 'GPX URL is required' }, { status: 400 });
  }

  try {
    const response = await fetch(gpxUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch GPX file: ${response.statusText}`);
    }

    const gpxText = await response.text();

    return new NextResponse(gpxText, {
      status: 200,
      headers: {
        'Content-Type': 'application/gpx+xml',
      },
    });
  } catch (error: any) {
    console.error(`[API /proxy-gpx] Error fetching GPX from ${gpxUrl}:`, error);
    return NextResponse.json({ error: `Failed to retrieve GPX file: ${error.message}` }, { status: 500 });
  }
}
