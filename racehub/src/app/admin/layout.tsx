
// src/app/admin/layout.tsx
"use client";

import type { ReactNode } from 'react';
import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import FaqChatbot from "@/components/FaqChatbot";

export default function AdminLayout({ children }: { children: ReactNode }): JSX.Element {
  const { currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading) {
      if (!currentUser) {
        toast({ variant: 'destructive', title: 'Authentication Required', description: 'Please log in to access admin features.' });
        router.replace('/login?redirect=/admin/dashboard');
      } else if (!currentUser.isAdmin) {
        toast({ variant: 'destructive', title: 'Admin Access Denied', description: 'You do not have administrative privileges. Redirecting to athlete dashboard.' });
        router.replace('/dashboard');
      }
    }
  }, [currentUser, authLoading, router, toast]);

  const renderContent = () => {
    if (authLoading) {
      return (
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Verifying administrator status...</p>
          </div>
        </main>
      );
    }
    
    if (!currentUser || !currentUser.isAdmin) {
      return (
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] text-destructive p-4 text-center">
            <ShieldAlert className="h-16 w-16 mb-4" />
            <h1 className="text-2xl font-bold">Admin Access Denied</h1>
            <p className="mt-2 text-muted-foreground">You must be a logged-in administrator to access this page.</p>
            <Button onClick={() => router.push('/login')} className="mt-6">
              Go to Login
            </Button>
          </div>
        </main>
      );
    }

    return (
      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8">
        <div className="container mx-auto">
          {children}
        </div>
      </main>
    );
  };
  
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted/30">
      <AppHeader />
      {renderContent()}
      <FaqChatbot />
    </div>
  );
}

