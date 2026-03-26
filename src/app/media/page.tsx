
// src/app/media/page.tsx
import { getPagesAction, getHomepageSliderItemsAction } from '@/lib/actions';
import { notFound, redirect } from 'next/navigation';
import Image from 'next/image';

export default async function MediaPage() {
  const pagesResult = await getPagesAction();
  // The page for this route will have the slug 'media'
  const page = pagesResult.pages?.find(p => p.slug === 'media');

  // If the page doesn't exist in the CMS or is not published, show a default message.
  // This is better than a 404 for a core page like 'media'.
  if (!page || !page.published) {
    return (
      <main>
        <div className="container mx-auto py-12 px-4">
          <h1 className="text-4xl font-bold mb-4">Media</h1>
          <p className="text-lg text-muted-foreground">
            This page is under construction. Content can be managed from the Admin Dashboard in the &apos;Pages&apos; tab.
          </p>
        </div>
      </main>
    );
  }

  // Handle redirects if configured for this page in the CMS.
  // This allows an admin to point the 'media' link to an external site if they wish.
  if (page.url && page.url !== '/media') {
      redirect(page.url);
  }

  // Fetch slider items to see if there's a specific hero image/video for this page.
  const sliderItemsResult = await getHomepageSliderItemsAction();
  const pageSliderItem = sliderItemsResult.items?.find(item => item.pageSlug === 'media' && item.showOnHomepage === false);

  return (
    <main>
      <article>
        {pageSliderItem && (
          <section className="relative w-full h-[40vh] md:h-[50vh] bg-slate-900 text-white">
              <div className="absolute inset-0">
                {pageSliderItem.type === 'video' ? (
                  <video
                    src={pageSliderItem.src}
                    autoPlay loop muted playsInline
                    className="absolute inset-0 w-full h-full object-cover"
                    key={pageSliderItem.src}
                  />
                ) : (
                  <Image
                    src={pageSliderItem.src}
                    alt={pageSliderItem.alt}
                    fill
                    sizes="100vw"
                    className="object-cover"
                    priority
                  />
                )}
              </div>
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4 md:p-8">
                <div className="container mx-auto">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter text-foreground">{page.title}</h1>
                </div>
            </div>
          </section>
        )}
        <div className={`container mx-auto py-12 px-4 ${pageSliderItem ? '-mt-16 relative z-10' : ''}`}>
            <div>
              {!pageSliderItem && <h1 className="text-4xl font-bold mb-4">{page.title}</h1>}
              {/* This is the key part: rendering the HTML content from the CMS */}
              <div className="prose dark:prose-invert max-w-none prose-h1:text-foreground prose-p:text-muted-foreground">
                  {page.blocks && page.blocks.length > 0 ? page.blocks.map(block => (
                      <div key={block.id} dangerouslySetInnerHTML={{ __html: block.html }} />
                  )) : (
                     <p>This page is empty. Add content from the Admin Dashboard &gt; Pages.</p>
                  )}
              </div>
            </div>
        </div>
      </article>
    </main>
  );
}
