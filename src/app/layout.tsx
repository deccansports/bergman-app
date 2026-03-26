
// src/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import React from 'react';
import Script from 'next/script';
import { ClientProviders } from './client-providers';
import { getCalendarEventsAction, getPagesAction } from '@/lib/actions';

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
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
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
  const eventsResult = await getCalendarEventsAction();
  const pagesResult = await getPagesAction();
  
  const initialNavEvents: any[] = eventsResult.events || [];
  const initialNavPages: any[] = pagesResult.pages || [];

  return (
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning>
      <head>
        <Script
          id="razorpay-checkout-js"
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="beforeInteractive"
        />
      </head>
      <body>
        <ClientProviders initialNavEvents={initialNavEvents} initialNavPages={initialNavPages}>
            {children}
        </ClientProviders>
      </body>
    </html>
  );
}
