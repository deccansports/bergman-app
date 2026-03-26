
// src/app/tracking/layout.tsx
"use client";

import type { ReactNode } from 'react';
import React from 'react';
import FaqChatbot from '@/components/FaqChatbot';

// This is a public layout for the tracking pages.
export default function RaceTrackingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <main className="flex-1">
        {children}
      </main>
      <FaqChatbot />
    </div>
  );
}
