// src/app/videos/page.tsx
import { listLibraryVideos } from '@/lib/actions/videoLibraryActions';
import type { LibraryVideo } from '@/lib/types/videoLibrary';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Star, Calendar } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export const metadata = {
  title: 'Videos | Bergman Triathlon',
  description: 'Race highlights, training tips and live streams from Bergman Triathlon.',
};

function VideoCard({ video }: { video: LibraryVideo }) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
  return (
    <Link
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {video.thumbnailUrl ? (
          <Image
            src={video.thumbnailUrl}
            alt={video.title}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition group-hover:scale-105"
            unoptimized
          />
        ) : null}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
          <div className="rounded-full bg-white/90 p-3 opacity-0 shadow-lg transition group-hover:opacity-100">
            <Play className="h-5 w-5 text-red-600" />
          </div>
        </div>
        {video.isFeatured && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-yellow-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black shadow">
            <Star className="h-3 w-3" /> Featured
          </span>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {video.category}
        </span>
      </div>
      <div className="space-y-1 p-4">
        <h3 className="line-clamp-2 text-sm font-bold text-slate-900 group-hover:text-primary dark:text-slate-100">
          {video.title}
        </h3>
        {video.description && (
          <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{video.description}</p>
        )}
        {video.scheduledFor && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
            <Calendar className="h-3 w-3" />
            {new Date(video.scheduledFor).toLocaleString()}
          </p>
        )}
      </div>
    </Link>
  );
}

export default async function VideosPage() {
  const videos = await listLibraryVideos();
  const featured = videos.filter((v) => v.isFeatured);
  const others = videos.filter((v) => !v.isFeatured);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 py-12 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            🎬 Videos & Live Streams
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-300">
            Race highlights, training, and live coverage from Bergman Triathlon
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link
              href="/live"
              className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-red-700"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Watch Live
            </Link>
          </div>
        </div>

        {videos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="text-slate-500 dark:text-slate-400">No videos in the library yet. Check back soon!</p>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
                  <Star className="h-5 w-5 text-yellow-500" /> Featured
                </h2>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((v) => (
                    <VideoCard key={v.id} video={v} />
                  ))}
                </div>
              </section>
            )}

            {others.length > 0 && (
              <section>
                <h2 className="mb-4 text-xl font-bold text-slate-900 dark:text-white">All Videos</h2>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {others.map((v) => (
                    <VideoCard key={v.id} video={v} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
