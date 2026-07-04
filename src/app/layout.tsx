
// src/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import React from 'react';
import Script from 'next/script';
import { ClientProviders } from './client-providers';
import { getCalendarEventsAction, getPagesAction } from '@/lib/actions';
import FaqChatbot from '@/components/FaqChatbot';
import { isEventHidden } from '@/lib/utils';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Bergman Triathlon | Official Triathlon Events in India',
  description:
    'Bergman Triathlon is India’s premier triathlon event organizer, delivering certified race courses, official results, athlete rankings, and professionally managed endurance events.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png" },
    ],
    apple: "/favicon.png",
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};


export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    "name": "Bergman Triathlon",
    "alternateName": "Deccan Sports Club",
    "url": "https://bergmantri.com",
    "logo": "https://bergmantri.com/logo.png",
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "customer support",
      "url": "https://bergmantri.com/contact-us"
    },
    "founder": [
      {
        "@type": "Person",
        "name": "Vaibhav Belgaonkar",
        "jobTitle": "CEO",
        "sameAs": [
          "https://www.linkedin.com/in/vaibhav-belgaonkar-04b725a3"
        ]
      },
      {
        "@type": "Person",
        "name": "Uday Patil",
        "jobTitle": "Co-Founder",
        "sameAs": [
          "https://bergmantri.com/about"
        ]
      }
    ],
    "knowsAbout": ["Triathlon", "Endurance Sports", "Ironman Training"]
  };

  const eventsResult = await getCalendarEventsAction();
  const pagesResult = await getPagesAction();
  
  const initialNavEvents: any[] = (eventsResult.events || []).filter((event: any) => !isEventHidden(event));
  const initialNavPages: any[] = pagesResult.pages || [];

  return (
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning>
      <head>
        <Script
          id="razorpay-checkout-js"
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="beforeInteractive"
        />
        <Script
          id="bergman-sports-organization-schema"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
      </head>
      <body>
        <ClientProviders initialNavEvents={initialNavEvents} initialNavPages={initialNavPages}>
            {children}
            <FaqChatbot />
        </ClientProviders>
      </body>
    </html>
  );
}
