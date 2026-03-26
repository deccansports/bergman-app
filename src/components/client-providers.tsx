// src/app/client-providers.tsx
"use client";

import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/toaster';
import { Loader2, Instagram, Facebook, Twitter, Youtube, Link as LinkIcon } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getFooterConfigAction } from '@/lib/actions/pageActions';
import type { FooterConfig, EventCalendarEntry, Page } from '@/lib/types';
import { AppHeader } from '@/components/layout/AppHeader';

const SocialLink = ({ href, children }: { href?: string | null; children: React.ReactNode }) => {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
      {children}
    </a>
  );
};


export function ClientProviders({ children, initialNavEvents, initialNavPages }: { children: React.ReactNode; initialNavEvents: EventCalendarEntry[]; initialNavPages: Page[] }) {
  const [footerConfig, setFooterConfig] = useState<FooterConfig | null>(null);

  useEffect(() => {
    getFooterConfigAction().then(result => {
        if(result.success && result.config) {
            setFooterConfig(result.config);
        }
    });
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AuthProvider>
          <div className="flex flex-col min-h-screen">
            <AppHeader initialNavEvents={initialNavEvents} initialNavPages={initialNavPages} />
            <div className="flex-grow">
              {children}
            </div>
            <footer className="py-8 text-sm text-muted-foreground border-t bg-muted/30">
              <div className="container mx-auto space-y-6 text-center">
                
                {footerConfig && (
                    <div className="text-center">
                        <h4 className="font-semibold text-foreground">Follow Us on Social Media</h4>
                        <p className="text-xs">{footerConfig.tagline}</p>
                        <div className="flex justify-center gap-4 mt-2">
                           <SocialLink href={footerConfig.socials.instagram}><Instagram /></SocialLink>
                           <SocialLink href={footerConfig.socials.facebook}><Facebook /></SocialLink>
                           <SocialLink href={footerConfig.socials.x}><Twitter /></SocialLink>
                           <SocialLink href={footerConfig.socials.threads}><LinkIcon /></SocialLink>
                           <SocialLink href={footerConfig.socials.youtube}><Youtube /></SocialLink>
                        </div>
                    </div>
                )}
                
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs text-center">
                  <Link href="/terms-and-conditions" className="hover:text-primary hover:underline">Terms & Conditions</Link>
                  <Link href="/privacy-policy" className="hover:text-primary hover:underline">Privacy Policy</Link>
                  <Link href="/refund-policy" className="hover:text-primary hover:underline">Return, Refund & Cancellation Policy</Link>
                  <Link href="/shipping-policy" className="hover:text-primary hover:underline">Shipping Policy</Link>
                </div>
                <div>
                  <p className="mt-6">Copyright © 2026 BERGMAN. All rights reserved.</p>
                </div>
              </div>
            </footer>
          </div>
          <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}
