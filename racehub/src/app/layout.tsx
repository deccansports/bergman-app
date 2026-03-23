// src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/context/AuthContext';
import React from 'react';
import Link from 'next/link';
import Script from 'next/script'; // Import the Script component

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

// Metadata must be exported from a Server Component, so "use client" is removed from here.
export const metadata: Metadata = {
  title: 'Bergman Athlete Hub',
  description: 'Track your race performance, view rankings, and manage your athletic journey with Bergman Athlete Hub.',
  icons: {
    icon: '/bm favicon.png',
    shortcut: '/bm favicon.png',
    apple: '/bm favicon.png',
    other: {
      rel: 'apple-touch-icon-precomposed',
      url: '/bm favicon.png',
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Razorpay script is now loaded on pages that need it, like event-form and dashboard */}
      </head>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen flex flex-col">
        {/* AuthProvider is a Client Component, but it can wrap children in a Server Component layout */}
        <AuthProvider>
            <div className="flex flex-col min-h-screen">
              <main className="flex-grow">
                {children}
              </main>
              <footer className="py-8 text-center text-sm text-muted-foreground border-t bg-muted/30">
                <div className="container mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs px-4">
                  <Link href="/terms-and-conditions" className="hover:text-primary hover:underline">Terms & Conditions</Link>
                  <Link href="/privacy-policy" className="hover:text-primary hover:underline">Privacy Policy</Link>
                  <Link href="/refund-policy" className="hover:text-primary hover:underline">Return, Refund & Cancellation Policy</Link>
                  <Link href="/shipping-policy" className="hover:text-primary hover:underline">Shipping Policy</Link>
                </div>
                <p className="mt-6">Copyright © 2025 BERGMAN. All rights reserved.</p>
              </footer>
            </div>
            <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
