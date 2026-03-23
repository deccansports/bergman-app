// src/context/ClientAuthManager.tsx
"use client";

import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const PUBLIC_AUTH_ROUTES = [
  '/login',
  '/club-login',
  '/signup',
  '/club-registration',
  '/forgot-password',
  '/update-password',
  '/verify-email',
  '/__/auth/action',
];

const PUBLIC_VIEW_ROUTES = [
    '/races',
    '/event-form',
    '/food',
    '/results',
    '/club-rankings',
    '/athlete-rankings',
    '/rewards',
    '/tracking',
    '/content',
    '/privacy-policy',
    '/refund-policy',
    '/shipping-policy',
    '/terms-and-conditions',
    '/contact-us',
    '/triathlon-india'
];


export default function ClientAuthManager({ children }: { children: React.ReactNode }) {
  const { currentUser, loading, isAuthenticating } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Track if we are currently performing a redirect to avoid loops
  const isRedirecting = useRef(false);

  useEffect(() => {
    // 1. Wait for auth to settle
    if (loading || isAuthenticating) return;

    const isRoot = pathname === '/';
    const isPublicAuthRoute = PUBLIC_AUTH_ROUTES.some(route => pathname.startsWith(route));
    const isPublicViewRoute = isRoot || PUBLIC_VIEW_ROUTES.some(route => pathname.startsWith(route));
    const isApiRoute = pathname.startsWith('/api/') || pathname.startsWith('/__/');

    let targetPath: string | null = null;

    if (currentUser) {
      // PROFILES ARE CONSIDERED INCOMPLETE IF NO MOBILE IS SET
      const isProfileIncomplete = !currentUser.mobile;

      // 2. Redirect away from login/auth pages ONLY if profile is complete
      if (!isProfileIncomplete && isPublicAuthRoute && pathname !== '/__/auth/action') {
        const redirectQuery = searchParams.get('redirect');
        if (redirectQuery && redirectQuery !== pathname) {
            targetPath = redirectQuery;
        } else {
            // Pick default dashboard based on role for fresh logins
            if (currentUser.isAdmin) targetPath = '/admin/dashboard';
            else if (currentUser.ownedClubId) targetPath = '/club-dashboard';
            else if (currentUser.isVolunteer) targetPath = '/volunteer/dashboard';
            else targetPath = '/dashboard';
        }
      }
      
      // 3. Force profile completion if logged in but missing mobile
      if (isProfileIncomplete && !isPublicAuthRoute && !isPublicViewRoute && !isApiRoute && pathname !== '/complete-profile') {
          targetPath = '/complete-profile';
      }

    } else {
      // 4. Redirect to login if on a protected route
      const isProtectedRoute = !isPublicAuthRoute && !isPublicViewRoute && !isApiRoute;
      if (isProtectedRoute) {
        const redirectQueryParam = encodeURIComponent(pathname + (searchParams.toString() ? `?${searchParams.toString()}` : ''));
        targetPath = `/login?redirect=${redirectQueryParam}`;
      }
    }

    // Execute redirect if necessary
    if (targetPath && targetPath !== pathname && !isRedirecting.current) {
        isRedirecting.current = true;
        console.log(`[AuthManager] Redirecting from ${pathname} to ${targetPath}`);
        router.replace(targetPath);
        
        // Reset flag after a short delay
        setTimeout(() => {
            isRedirecting.current = false;
        }, 1000);
    }

  }, [currentUser, loading, isAuthenticating, pathname, searchParams, router]);

  return <>{children}</>;
}
