
// src/app/results/layout.tsx
"use client";

import type { ReactNode } from 'react';
import React from 'react';
import FaqChatbot from '@/components/FaqChatbot';

// This is a public layout for the results pages.
export default function ResultsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <main className="flex-1">
        {children}
      </main>
      <FaqChatbot />
    </div>
  );
}
