// src/app/about/page.tsx
import { getPagesAction } from '@/lib/actions/pageActions';
import { notFound } from 'next/navigation';
import ClientSideContent from '@/components/shared/ClientSideContent';

export const dynamic = 'force-dynamic';

export default async function AboutUsPage() {
  const pagesResult = await getPagesAction();
  const page = pagesResult.pages?.find(p => p.slug === 'about');

  if (!page || !page.published) {
    notFound();
  }

  return (
    <main className="w-full py-12 px-0">
      <div className="w-full px-4 text-left mb-8">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-primary">
          {page.title}
          </h1>
      </div>
      <ClientSideContent>
        <div className="prose dark:prose-invert max-w-none prose-h1:text-foreground prose-p:text-muted-foreground prose-img:rounded-lg prose-img:shadow-md w-full text-left px-4">
          {page.blocks && page.blocks.length > 0 ? page.blocks.map(block => (
            <div key={block.id} dangerouslySetInnerHTML={{ __html: block.html }} />
          )) : (
            <p>This page is empty. Content can be managed from the Admin Dashboard &gt; Pages.</p>
          )}
        </div>
      </ClientSideContent>
    </main>
  );
}
