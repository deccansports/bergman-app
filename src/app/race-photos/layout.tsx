// src/app/race-photos/layout.tsx
import type { ReactNode } from 'react';

export default function RacePhotosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/30">
      <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
