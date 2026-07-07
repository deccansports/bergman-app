// src/app/client-providers.tsx
"use client";

import { AuthProvider } from '@/context/AuthContext';
import { CartProvider } from '@/context/StoreCartContext';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/toaster';
import { Instagram, Facebook, Twitter, Youtube, Link as LinkIcon } from 'lucide-react';
import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { getFooterConfigAction } from '@/lib/actions/pageActions';
import type { FooterConfig, EventCalendarEntry, Page } from '@/lib/types';
import { AppHeader } from '@/components/layout/AppHeader';
import { HeaderScrollEffect } from '@/components/layout/HeaderScrollEffect';
import AthleteHubLoader from '@/components/AthleteHubLoader';
import ClientAuthManager from '@/context/ClientAuthManager';
import { AnnouncementTicker } from '@/components/layout/AnnouncementTicker';


const SocialLink = ({ href, children }: { href?: string | null; children: React.ReactNode }) => {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
      {children}
    </a>
  );
};

const FOOTER_CATEGORY_ORDER = ['Information', 'Explore', 'Races', 'News', 'Community', 'Support'] as const;

function resolveFooterHref(page: Page): string {
  const title = page.title.trim().toLowerCase();
  const slug = String(page.slug || '').trim().toLowerCase();
  const url = String(page.url || '').trim();

  if (title === 'work with team bergman' || slug === 'workwithbergman' || url.includes('workwithbergman')) {
    return '/work-with-bergman';
  }

  if (url.startsWith('/')) return url;
  if (url.startsWith('http')) return url;
  if (slug) return `/content/${slug}`;
  return '/';
}


export function ClientProviders({ children, initialNavEvents, initialNavPages }: { children: React.ReactNode; initialNavEvents: EventCalendarEntry[]; initialNavPages: Page[] }) {
  const pathname = usePathname();
  const [footerConfig, setFooterConfig] = useState<FooterConfig | null>(null);

  const footerPageGroups = React.useMemo(() => {
    const pages = (initialNavPages || [])
      .filter((page) => page.published && page.showInFooter !== false)
      .filter((page) => page.title.trim().toLowerCase() !== 'home');

    return FOOTER_CATEGORY_ORDER.map((category) => ({
      category,
      pages: pages.filter((page) => (page.footerCategory || 'Explore') === category),
    })).filter((group) => group.pages.length > 0);
  }, [initialNavPages]);

  const isLedCleanRoute =
    pathname?.startsWith('/athlete-journey') ||
    pathname?.startsWith('/athlete-journey/race') ||
    pathname?.startsWith('/athlete-journey/result');
  const isPublicLiveTrackingRoute = pathname?.startsWith('/live-tracking');

  useEffect(() => {
    getFooterConfigAction().then(result => {
        if(result && result.success && result.config) {
            setFooterConfig(result.config);
        }
    }).catch(err => {
        console.warn("Failed to fetch footer config:", err);
    });
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <CartProvider>
          <Suspense fallback={<AthleteHubLoader />}>
            {isPublicLiveTrackingRoute ? (
              <>
                <div className="flex flex-col min-h-screen">
                  {!isLedCleanRoute ? (
                    <div className="sticky top-0 z-50 w-full flex flex-col">
                        <AnnouncementTicker />
                        <AppHeader initialNavEvents={initialNavEvents} initialNavPages={initialNavPages} />
                    </div>
                  ) : null}

                  <HeaderScrollEffect />
                  <main className="flex-grow">
                    {children}
                  </main>
                  {!isLedCleanRoute ? (
                    <footer className="border-t border-white/10 bg-[#191919] text-white">
                      <div className="container mx-auto px-6 py-14 md:px-10 lg:px-12">
                        <div className="grid gap-y-12 gap-x-10 lg:grid-cols-[minmax(260px,1.4fr)_repeat(6,minmax(120px,1fr))] lg:items-start">
                          <div className="space-y-5 lg:max-w-[280px]">
                            <Link href="/" className="inline-flex items-center">
                              <Image
                                src="/Bmlogowhite.png"
                                alt="Bergman logo"
                                width={260}
                                height={72}
                                className="h-auto w-[220px] md:w-[260px]"
                                style={{ width: 'auto', height: 'auto' }}
                                priority
                              />
                            </Link>
                          </div>
                        </div>
                      </div>
                    </footer>
                  ) : null}
                </div>
                <Toaster />
              </>
            ) : (
            <ClientAuthManager>
              <div className="flex flex-col min-h-screen">
                {!isLedCleanRoute ? (
                  <div className="sticky top-0 z-50 w-full flex flex-col">
                      <AnnouncementTicker />
                      <AppHeader initialNavEvents={initialNavEvents} initialNavPages={initialNavPages} />
                  </div>
                ) : null}
                
                <HeaderScrollEffect />
                <main className="flex-grow">
                  {children}
                </main>
                {!isLedCleanRoute ? (
                  <footer className="border-t border-white/10 bg-[#191919] text-white">
                    <div className="container mx-auto px-6 py-14 md:px-10 lg:px-12">
                      <div className="grid gap-y-12 gap-x-10 lg:grid-cols-[minmax(260px,1.4fr)_repeat(6,minmax(120px,1fr))] lg:items-start">
                        <div className="space-y-5 lg:max-w-[280px]">
                          <Link href="/" className="inline-flex items-center">
                            <Image
                              src="/Bmlogowhite.png"
                              alt="Bergman logo"
                              width={260}
                              height={72}
                              className="h-auto w-[220px] md:w-[260px]"
                              style={{ width: 'auto', height: 'auto' }}
                              priority
                            />
                          </Link>

                          <div className="text-[11px] font-semibold uppercase tracking-[0.35em] text-white/35">
                            Triathlon • Community • Racing
                          </div>

                          <p className="max-w-sm text-sm leading-7 text-white/60">
                            Promoting sports and a healthy lifestyle through events.
                          </p>

                          {footerConfig ? (
                            <div className="flex flex-wrap gap-3 pt-2">
                              <SocialLink href={footerConfig.socials.instagram}>
                                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white">
                                  <Instagram className="h-5 w-5" />
                                </span>
                              </SocialLink>
                              <SocialLink href={footerConfig.socials.facebook}>
                                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white">
                                  <Facebook className="h-5 w-5" />
                                </span>
                              </SocialLink>
                              <SocialLink href={footerConfig.socials.x}>
                                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white">
                                  <Twitter className="h-5 w-5" />
                                </span>
                              </SocialLink>
                              <SocialLink href={footerConfig.socials.youtube}>
                                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white">
                                  <Youtube className="h-5 w-5" />
                                </span>
                              </SocialLink>
                              <SocialLink href={footerConfig.socials.threads}>
                                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white">
                                  <LinkIcon className="h-5 w-5" />
                                </span>
                              </SocialLink>
                            </div>
                          ) : null}
                        </div>

                        {footerPageGroups.map((group) => (
                          <div key={group.category} className="space-y-4 lg:min-w-0">
                            <h4 className="text-[11px] font-black uppercase tracking-[0.35em] text-blue-500 whitespace-nowrap">{group.category}</h4>
                            <div className="space-y-4 text-sm font-semibold text-white/65">
                              {group.pages.length > 0 ? group.pages.map((page) => {
                                const href = resolveFooterHref(page);
                                return (
                                  <Link key={page.id} href={href} className="block transition hover:text-white whitespace-nowrap">
                                    {page.title}
                                  </Link>
                                );
                              }) : (
                                <span className="block text-white/25">&nbsp;</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-12 border-t border-white/10 pt-8">
                        <div className="flex flex-col gap-4 text-sm text-white/50 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex flex-wrap gap-x-6 gap-y-3">
                            <Link href="/privacy-policy" className="transition hover:text-white hover:underline">Privacy Policy</Link>
                            <Link href="/terms-and-conditions" className="transition hover:text-white hover:underline">Terms of Use</Link>
                            <Link href="/refund-policy" className="transition hover:text-white hover:underline">Refund Policy</Link>
                            <Link href="/shipping-policy" className="transition hover:text-white hover:underline">Shipping Policy</Link>
                          </div>
                          <p className="whitespace-nowrap">© 2026 Bergman Triathlon. All rights reserved.</p>
                        </div>
                      </div>
                    </div>
                  </footer>
                ) : null}
              </div>
              <Toaster />
            </ClientAuthManager>
            )}
          </Suspense>
        </CartProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
