import { redirect } from 'next/navigation';

export default async function CameraRedirectPage({ params, searchParams }: { params: { eventSlug: string; cameraSlug: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  const bib = typeof searchParams?.bib === 'string' ? searchParams.bib : '';
  if (bib) query.set('bib', bib);
  redirect(`/live/${encodeURIComponent(params.eventSlug)}?camera=${encodeURIComponent(params.cameraSlug)}${bib ? `&bib=${encodeURIComponent(bib)}` : ''}`);
}
