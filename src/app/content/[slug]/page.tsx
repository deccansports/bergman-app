import { getPagesAction, getHomepageSliderItemsAction } from '@/lib/actions';
import { notFound, redirect } from 'next/navigation';
import Image from 'next/image';
import type { Metadata } from 'next';
import ClientSideContent from '@/components/shared/ClientSideContent';

type Props = {
  params: { slug: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = params;
  const pagesResult = await getPagesAction();
  const page = pagesResult.pages?.find(p => p.slug === slug);

  if (!page || !page.published) {
    return {
      title: 'Page Not Found',
    }
  }

  const description = page.blocks?.[0]?.html.replace(/<[^>]*>?/gm, '').substring(0, 160) || `Learn more about ${page.title} at Bergman Triathlon.`;

  return {
    title: `${page.title} | Bergman Triathlon`,
    description,
  }
}

export default async function DynamicContentPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const pagesResult = await getPagesAction();
  const page = pagesResult.pages?.find(p => p.slug === slug);

  if (!page || !page.published) {
    notFound();
  }

  // Handle redirects if configured for this page in the CMS.
  if (page.url && !page.url.includes(slug)) {
      redirect(page.url);
  }

  // Fetch slider items to see if there's a specific hero image/video for this page.
  const sliderItemsResult = await getHomepageSliderItemsAction();
  const pageSliderItem = sliderItemsResult.items?.find(item => item.pageSlug === slug && item.showOnHomepage === false);

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
              {!pageSliderItem && <h1 className="text-4xl md:text-5xl font-extrabold mb-8 tracking-tight text-primary">{page.title}</h1>}
              <ClientSideContent>
                <div className="prose dark:prose-invert max-w-none prose-h1:text-foreground prose-p:text-muted-foreground prose-img:rounded-lg prose-img:shadow-md">
                    {page.blocks && page.blocks.length > 0 ? page.blocks.map(block => (
                        <div key={block.id} dangerouslySetInnerHTML={{ __html: block.html }} />
                    )) : (
                       <p>This page is empty. Content can be managed from the Admin Dashboard &gt; Pages.</p>
                    )}
                </div>
              </ClientSideContent>
            </div>
        </div>
      </article>
    </main>
  );
}
