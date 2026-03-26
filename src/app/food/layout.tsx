// src/app/food/layout.tsx
import type { ReactNode } from 'react';
import React from 'react';

// This is a public layout. It does NOT use the AuthProvider.
// It ensures that pages within the /food directory are accessible to everyone.
export default function FoodPageLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
