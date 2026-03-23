// src/app/club-dashboard/layout.tsx
import type { ReactNode } from "react";
import React, { Suspense } from 'react';
import FaqChatbot from "@/components/FaqChatbot";
import ClientAuthGuard from '@/components/auth/ClientAuthGuard';
import AthleteHubLoader from '@/components/AthleteHubLoader';
import { getSystemControlAction } from '@/lib/actions/systemActions';

export default async function ClubLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const sysRes = await getSystemControlAction();
  const isMaintenance = sysRes.success && sysRes.settings?.clubDashboardMaintenance;
  const message = sysRes.settings?.maintenanceMessage;

  return (
    <Suspense fallback={<AthleteHubLoader />}>
      <ClientAuthGuard 
        requiredRole="clubOwner" 
        redirectPath="/club-login"
        maintenanceMode={isMaintenance}
        maintenanceMessage={message}
      >
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
