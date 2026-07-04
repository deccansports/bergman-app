// src/app/api/race-photos/events/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SPLITSECOND_EVENT_SEARCH_URL = 'https://new.splitsecondpix.com/api/search/event';
const SPLITSECOND_EVENT_DETAIL_URL = 'https://new.splitsecondpix.com/api/get-event';
const DEFAULT_QUERY = 'bergman';

type RawEvent = {
  id?: string | number;
  name?: string;
  slug?: string;
  [key: string]: unknown;
};

type RawDetail = {
  search_by_bib?: number;
  search_by_face?: number;
  slug?: string;
  [key: string]: unknown;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() || DEFAULT_QUERY;

  try {
    const upstream = await fetch(SPLITSECOND_EVENT_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: q }),
      next: { revalidate: 3600 },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Upstream error ${upstream.status}`, detail: text },
        { status: upstream.status }
      );
    }

    const data = await upstream.json();
    const events: RawEvent[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

    const enriched = await Promise.all(
      events.map(async (event) => {
        const eventId = String(event?.id ?? '').trim();
        if (!eventId) return null;

        let detail: RawDetail | null = null;
        try {
          const detailRes = await fetch(SPLITSECOND_EVENT_DETAIL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ event_id: eventId }),
            next: { revalidate: 3600 },
          });
          if (detailRes.ok) {
            const detailJson = await detailRes.json();
            detail = Array.isArray(detailJson) ? detailJson[0] ?? null : null;
          }
        } catch {
          detail = null;
        }

        const slug = String(detail?.slug || event?.slug || '').trim();

        return {
          id: eventId,
          name: String(event?.name || '').trim() || `Event ${eventId}`,
          slug,
          searchByBib: detail?.search_by_bib === 1,
          searchByFace: detail?.search_by_face === 1,
          eventUrl: slug ? `https://new.splitsecondpix.com/events/${slug}` : null,
        };
      })
    );

    return NextResponse.json(
      { events: enriched.filter(Boolean) },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=300' } }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to fetch events' }, { status: 500 });
  }
}
