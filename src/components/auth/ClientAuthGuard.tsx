// src/components/auth/ClientAuthGuard.tsx
"use client";

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import AthleteHubLoader from '@/components/AthleteHubLoader';
import { ShieldAlert } from 'lucide-react';
import MaintenanceScreen from '../shared/MaintenanceScreen';

interface ClientAuthGuardProps {
  children: ReactNode;
  requiredRole: 'admin' | 'clubOwner' | 'volunteer' | 'user';
  redirectPath: string;
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
}

export default function ClientAuthGuard({ 
    children, 
    requiredRole, 
    redirectPath, 
    maintenanceMode, 
    maintenanceMessage 
}: ClientAuthGuardProps) {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (authLoading) return;

    if (!currentUser) {
      toast({
        variant: 'destructive',
        title: 'Authentication Required',
        description: `Please log in to access the ${requiredRole} dashboard.`,
      });
      router.replace(redirectPath);
      return;
    }

    let hasAccess = false;
    let denialMessage = 'You do not have the required privileges for this section.';

    switch (requiredRole) {
      case 'admin':
        hasAccess = !!currentUser.isAdmin;
        break;
      case 'clubOwner':
        hasAccess = !!currentUser.ownedClubId;
        denialMessage = 'You are not registered as a club owner.';
        break;
      case 'volunteer':
        hasAccess = !!currentUser.isVolunteer;
        denialMessage = 'You are not registered as a volunteer.';
        break;
      case 'user':
        hasAccess = true; // Any logged-in user
        break;
    }

    if (!hasAccess) {
      toast({
        variant: 'destructive',
        title: 'Access Denied',
        description: `${denialMessage} Redirecting...`,
      });
      router.replace('/dashboard');
    }
  }, [currentUser, authLoading, router, toast, requiredRole, redirectPath]);
  
  if (authLoading || !currentUser) {
    return <AthleteHubLoader />;
  }

  // --- MAINTENANCE MODE CHECK (Admin Bypass) ---
  if (maintenanceMode && !currentUser.isAdmin) {
      return <MaintenanceScreen message={maintenanceMessage} />;
  }

  // Check access one last time before rendering children to prevent content flash
  let hasAccess = false;
  if (currentUser) {
      switch (requiredRole) {
          case 'admin': hasAccess = !!currentUser.isAdmin; break;
          case 'clubOwner': hasAccess = !!currentUser.ownedClubId; break;
          case 'volunteer': hasAccess = !!currentUser.isVolunteer; break;
          case 'user': hasAccess = true; break;
      }
  }

  if (!hasAccess) {
    return (
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] text-destructive p-4 text-center">
            <ShieldAlert className="h-16 w-16 mb-4" />
            <h1 className="text-2xl font-bold">Access Denied</h1>
            <p className="mt-2 text-muted-foreground">You do not have privileges for this page. Redirecting...</p>
          </div>
        </main>
    );
  }

  return <>{children}</>;
}
