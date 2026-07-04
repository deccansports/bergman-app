import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = new Set([
  'score.feibot.com',
  'bergmantri.com',
  'www.bergmantri.com',
  'api.bergmantri.com',
]);

export async function GET(req: NextRequest) {
  try {
    const target = String(req.nextUrl.searchParams.get('url') || '').trim();
    if (!target) {
      return NextResponse.json({ success: false, message: 'url is required' }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return NextResponse.json({ success: false, message: 'Invalid URL' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ success: false, message: 'Only http/https URLs are allowed' }, { status: 400 });
    }

    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return NextResponse.json({ success: false, message: 'Host not allowed' }, { status: 403 });
    }

    const startedAt = Date.now();
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'BERGMAN-Live-Tracking-Hub/1.0',
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    return NextResponse.json(
      {
        success: true,
        url: parsed.toString(),
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || '',
        responseTimeMs: Date.now() - startedAt,
      },
      {
        headers: {
          'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to validate URL',
      },
      { status: 500 },
    );
  }
}
