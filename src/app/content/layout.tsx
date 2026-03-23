// src/app/content/layout.tsx
import type { ReactNode } from 'react';
import React from 'react';

export default function ContentLayout({ children }: { children: ReactNode }) {
  // This layout simply passes its children through, allowing the root layout
  // to correctly apply the main app structure (header, footer, main tag).
  return (
    <>
      {children}
    </>
  );
}
