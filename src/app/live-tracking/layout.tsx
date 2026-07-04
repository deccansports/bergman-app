// src/app/live-tracking/layout.tsx
import type { ReactNode } from 'react';
import React from 'react';
import FaqChatbot from '@/components/FaqChatbot';

// This is a public layout for the tracking pages.
export default function RaceTrackingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="flex-1">
        {children}
      </main>
      <FaqChatbot />
    </div>
  );
}
