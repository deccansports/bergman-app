// src/app/admin/layout.tsx
import type { ReactNode } from 'react';
import React, { Suspense } from 'react';
import FaqChatbot from "@/components/FaqChatbot";
import ClientAuthGuard from '@/components/auth/ClientAuthGuard';
import AthleteHubLoader from '@/components/AthleteHubLoader';

export default function AdminLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Suspense fallback={<AthleteHubLoader />}>
      <ClientAuthGuard requiredRole="admin" redirectPath="/login?redirect=/admin/dashboard">
        <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted/30">
          <div className="flex-1 py-8 px-4 sm:px-6 lg:px-8">
            <div className="container mx-auto">
              {children}
            </div>
          </div>
          <FaqChatbot />
        </div>
      </ClientAuthGuard>
    </Suspense>
  );
}
