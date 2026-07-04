
// src/app/api/proxy-gpx/route.ts
import { NextRequest, NextResponse } from 'next/server';

function normalizeGpxUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return raw;

  // GitHub UI blob URL -> raw URL
  // https://github.com/{owner}/{repo}/blob/{branch}/{path}
  const blobMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
  if (blobMatch) {
    const [, owner, repo, branch, filePath] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  // raw.githubusercontent refs/heads URL -> canonical raw URL
  // https://raw.githubusercontent.com/{owner}/{repo}/refs/heads/{branch}/{path}
  const refsHeadsMatch = raw.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/refs\/heads\/([^/]+)\/(.+)$/i);
  if (refsHeadsMatch) {
    const [, owner, repo, branch, filePath] = refsHeadsMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }

  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gpxUrl = normalizeGpxUrl(searchParams.get('url') || '');

  if (!gpxUrl) {
    return NextResponse.json({ error: 'GPX URL is required' }, { status: 400 });
  }

  try {
    const response = await fetch(gpxUrl, {
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Bergman-LiveTracking-GPX-Proxy',
        Accept: 'application/gpx+xml,application/xml,text/xml,text/plain,*/*',
      },
    });

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
