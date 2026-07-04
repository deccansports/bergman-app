import type { Metadata } from 'next';
import nextDynamic from 'next/dynamic';
import { loadPublicBroadcastData } from '@/lib/broadcast/public';

const PublicBroadcastPortal = nextDynamic(() => import('@/components/broadcast/PublicBroadcastPortal'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-black p-10 text-white">Loading broadcast…</div>,
});

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params, searchParams }: { params: { eventSlug: string }; searchParams?: Record<string, string | string[] | undefined> }): Promise<Metadata> {
  const data = await loadPublicBroadcastData(params?.eventSlug || '');
  const title = data?.event?.eventName ? `${data.event.eventName} Live Broadcast` : 'Live Broadcast';
  const description = data?.event?.description || 'Watch the Bergman public broadcast live.';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: data?.event?.photoUrl ? [data.event.photoUrl] : undefined,
      type: 'website',
    },
  };
}

export default async function PublicLiveBroadcastPage({ params, searchParams }: { params: { eventSlug: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const data = await loadPublicBroadcastData(params?.eventSlug || '');
  if (!data) {
    return <div className="min-h-screen bg-black p-10 text-white">Broadcast not found.</div>;
  }

  const initialCameraSlug = typeof searchParams?.camera === 'string' ? searchParams.camera : null;

  return <PublicBroadcastPortal event={data.event} cameras={data.cameras} sponsors={data.sponsors} featuredVideo={data.featuredVideo} initialCameraSlug={initialCameraSlug} />;
}
