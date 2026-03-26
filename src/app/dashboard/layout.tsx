// src/app/dashboard/layout.tsx
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import AthleteHubLoader from '@/components/AthleteHubLoader';
import FaqChatbot from '@/components/FaqChatbot';
import ClientAuthGuard from '@/components/auth/ClientAuthGuard';
import { getSystemControlAction } from '@/lib/actions/systemActions';

export default async function AuthenticatedLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const sysRes = await getSystemControlAction();
  const isMaintenance = sysRes.success && sysRes.settings?.athleteDashboardMaintenance;
  const message = sysRes.settings?.maintenanceMessage;

  return (
    <Suspense fallback={<AthleteHubLoader />}>
        <ClientAuthGuard 
            requiredRole="user" 
            redirectPath="/login" 
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
