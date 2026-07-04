// src/app/api/race-photos/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SPLITSECOND_BASE = 'https://new.splitsecondpix.com/api/partners/get-images';
const TOKEN = process.env.SPLITSECOND_PARTNER_TOKEN;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bibNumber = searchParams.get('bib_number');
  const eventId = searchParams.get('event_id'); // optional
  const eventSlug = searchParams.get('event_slug'); // optional fallback
  const directGalleryUrl = eventSlug && bibNumber
    ? `https://new.splitsecondpix.com/events/${encodeURIComponent(eventSlug)}/${encodeURIComponent(bibNumber)}#search-result`
    : null;

  if (!bibNumber) {
    return NextResponse.json({ error: 'bib_number is required' }, { status: 400 });
  }

  if (!TOKEN) {
    return NextResponse.json({ error: 'Partner token not configured' }, { status: 500 });
  }

  try {
    const requestCandidates = [
      eventId ? `bib_number=${encodeURIComponent(bibNumber)}&event_id=${encodeURIComponent(eventId)}` : null,
      eventSlug ? `bib_number=${encodeURIComponent(bibNumber)}&event_id=${encodeURIComponent(eventSlug)}` : null,
      `bib_number=${encodeURIComponent(bibNumber)}`,
    ].filter(Boolean) as string[];

    let upstream: Response | null = null;
    let data: any = null;
    let finalStatus = 500;
    let finalErrorText = 'Unknown upstream error';
    let usedFallback = false;

    for (let index = 0; index < requestCandidates.length; index += 1) {
      const qs = requestCandidates[index];
      const attempt = await fetch(`${SPLITSECOND_BASE}?${qs}`, {
        headers: { 'X-Partner-Token': TOKEN },
        next: { revalidate: 300 }, // cache 5 min
      });

      if (attempt.ok) {
        upstream = attempt;
        data = await attempt.json();
        usedFallback = index > 0;
        break;
      }

      finalStatus = attempt.status;
      finalErrorText = await attempt.text();

      const shouldRetry = attempt.status === 403 || attempt.status === 404;
      if (!shouldRetry) {
        break;
      }
    }

    if (!upstream || !data) {
      if (directGalleryUrl && (finalStatus === 403 || finalStatus === 404)) {
        return NextResponse.json({
          status: finalStatus,
          redirectUrl: null,
          galleryUrl: directGalleryUrl,
          usedFallback: true,
          images: [],
          warning: `Preview API blocked with ${finalStatus}. Falling back to direct gallery URL.`,
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
        });
      }

      return NextResponse.json(
        { error: `Upstream error ${finalStatus}`, detail: finalErrorText },
        { status: finalStatus }
      );
    }

    const rawResults = Array.isArray(data?.data?.results) ? data.data.results : [];
    const images = rawResults.map((item: any, index: number) => ({
      id: item?.id || index,
      url: item?.imageUrl || item?.url || '',
      thumbnail_url: item?.thumbnailUrl || item?.thumbnail_url || item?.imageUrl || item?.url || '',
      download_url: item?.downloadUrl || item?.download_url || null,
    })).filter((item: any) => item.url);

    return NextResponse.json({
      status: data?.status || upstream.status,
      productType: data?.data?.productType || null,
      productPrice: data?.data?.product_price || null,
      redirectUrl: data?.data?.redirect_url || null,
      galleryUrl: directGalleryUrl,
      usedFallback,
      images,
      raw: data,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to fetch photos' }, { status: 500 });
  }
}
