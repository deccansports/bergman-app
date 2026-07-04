
// src/app/results/layout.tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import FaqChatbot from '@/components/FaqChatbot';
import { getPagesAction } from '@/lib/actions/pageActions';

export async function generateMetadata(): Promise<Metadata> {
  const pagesResult = await getPagesAction();
  const page = pagesResult.pages?.find((p) => p.slug === 'results' || p.url === '/results');

  const title = page?.title ? `${page.title} | Bergman Triathlon` : 'Official Race Results | Bergman Triathlon';
  const description =
    page?.blocks?.[0]?.html?.replace(/<[^>]*>?/gm, '').trim().slice(0, 160) ||
    'Search official Bergman race results, check finish times and splits, and download your finisher certificate.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: 'https://bergmantri.com/results',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

// This is a public layout for the results pages.
export default function ResultsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <main className="flex-1">
        {children}
      </main>
      <FaqChatbot />
    </div>
  );
}
