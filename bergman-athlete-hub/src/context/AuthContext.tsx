
// src/context/AuthContext.tsx
"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { onAuthStateChanged, type User as FirebaseAuthUser } from 'firebase/auth';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { auth as firebaseAuthService, db as firestoreDb } from '@/lib/firebase';
import type { User, ActiveCancellationInfo } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { toDateStringSafe } from '@/lib/utils';

interface AuthContextType {
  currentUser: User | null;
  firebaseUserFromAuth: FirebaseAuthUser | null;
  loading: boolean;
  isAuthenticating: boolean;
  fetchUserProfile: (fbUser: FirebaseAuthUser) => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PUBLIC_AUTH_ROUTES = [
  '/login',
  '/club-login',
  '/signup',
  '/club-registration',
  '/forgot-password',
  '/update-password',
  '/club-rankings',
  '/athlete-rankings',
  '/results' // Added the results page to be public
];

function ClientAuthManager({ children }: { children: ReactNode }) {
  const { currentUser, loading, isAuthenticating } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [redirectPath, setRedirectPath] = useState<string | null>(null);

  useEffect(() => {
    const localPathnameForRedirect = typeof pathname === 'string' ? pathname : '';
    const currentPathIsPublicAuthRoute = PUBLIC_AUTH_ROUTES.includes(localPathnameForRedirect);
    
    if (loading || isAuthenticating) return;

    const redirectQuery = searchParams.get('redirect');
    if (currentUser && redirectQuery && pathname !== redirectQuery) {
      setRedirectPath(redirectQuery);
      return;
    }

    let targetDashboard: string | null = null;
    if (currentUser) {
      if (currentUser.isAdmin) targetDashboard = '/admin/dashboard';
      else if (currentUser.ownedClubId) targetDashboard = '/club-dashboard';
      else if (currentUser.isVolunteer) targetDashboard = '/volunteer/dashboard';
      else targetDashboard = '/dashboard';

      if ((currentPathIsPublicAuthRoute && !['/club-rankings', '/athlete-rankings', '/results'].includes(localPathnameForRedirect)) || localPathnameForRedirect === '/') {
        if (targetDashboard && localPathnameForRedirect !== targetDashboard) {
          if (pathname !== targetDashboard) setRedirectPath(targetDashboard);
        }
      }
    } else {
      const isProtectedRoute = !currentPathIsPublicAuthRoute && 
                               localPathnameForRedirect !== '/' && 
                               !localPathnameForRedirect.startsWith('/event-form') &&
                               !localPathnameForRedirect.startsWith('/food') &&
                               !localPathnameForRedirect.startsWith('/tracking');
      if (isProtectedRoute) {
        const redirectQueryParam = encodeURIComponent(localPathnameForRedirect + (searchParams.toString() ? `?${searchParams.toString()}` : ''));
        const loginUrl = `/login?redirect=${redirectQueryParam}`;
        if (pathname !== loginUrl) setRedirectPath(loginUrl);
      }
    }
  }, [currentUser, loading, isAuthenticating, pathname, searchParams, toast]);

  useEffect(() => {
    if (redirectPath && pathname !== redirectPath) {
      router.replace(redirectPath);
      setRedirectPath(null);
    } else if (redirectPath && pathname === redirectPath) {
      setRedirectPath(null);
    }
  }, [pathname, router, redirectPath]);

  return <>{children}</>;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [firebaseUserFromAuth, setFirebaseUserFromAuth] = useState<FirebaseAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const fetchUserProfile = useCallback(async (fbUser: FirebaseAuthUser): Promise<User | null> => {
    if (!firestoreDb) {
      toast({ variant: "destructive", title: "Database Error", description: "Profile service temporarily unavailable. Firestore client not ready." });
      return {
        uid: fbUser.uid, email: fbUser.email, emailVerified: fbUser.emailVerified,
        name: fbUser.displayName || null, photoURL: fbUser.photoURL || null,
        isAdmin: false, isVolunteer: false, activeDeferral: null, activeCancellation: null,
      } as User;
    }
    try {
      const userDocRef = doc(firestoreDb, "users", fbUser.uid);
      const userDocSnap = await getDoc(userDocRef);
      let appUserBase: Partial<User> = {
        uid: fbUser.uid, email: fbUser.email, emailVerified: fbUser.emailVerified,
        name: null, photoURL: fbUser.photoURL || null, country: null, state: null,
        ownedClubId: null, ownedClubName: null, ownedClubLogoUrl: null,
        ownedClubInstagramUrl: null, ownedClubFacebookUrl: null,
        clubId: null, clubName: null, clubAffiliationDate: null,
        firstAffiliatedClubId: null, firstAffiliationDate: null, isAdmin: false, isVolunteer: false,
        activeDeferral: null, activeCancellation: null,
        assignedEventId: null, assignedEventName: null, assignedEventDate: null, assignedCounter: null,
      };

      if (userDocSnap.exists()) {
        const firestoreData = userDocSnap.data();
        if (firestoreData) {
            appUserBase.name = firestoreData.name || fbUser.displayName || null;
            appUserBase.mobile = firestoreData.mobile || null;
            if (firestoreData.photoURL) appUserBase.photoURL = firestoreData.photoURL;
            appUserBase.country = firestoreData.country || null;
            appUserBase.state = firestoreData.state || null;
            appUserBase.isAdmin = firestoreData.isAdmin === true;
            appUserBase.isVolunteer = firestoreData.isVolunteer === true;
            appUserBase.assignedEventId = firestoreData.assignedEventId || null;
            appUserBase.assignedEventName = firestoreData.assignedEventName || null;
            appUserBase.assignedCounter = firestoreData.assignedCounter || null;
            
            if (firestoreData.activeDeferral) {
              const ad = firestoreData.activeDeferral;
              appUserBase.activeDeferral = {
                deferralId: ad.deferralId,
                participantName: ad.participantName || null,
                originalEventName: ad.originalEventName,
                originalEventDate: ad.originalEventDate,
                originalAmountPaidPaisa: ad.originalAmountPaidPaisa !== undefined ? ad.originalAmountPaidPaisa : null,
                estimatedOriginalBasePricePaisa: ad.estimatedOriginalBasePricePaisa !== undefined ? ad.estimatedOriginalBasePricePaisa : null,
                code: ad.code || null,
                status: ad.status,
                deferralDate: ad.deferralDate,
                expiryDate: ad.expiryDate,
                deferredToEventId: ad.deferredToEventId || null,
                deferredToEventName: ad.deferredToEventName || null,
                deferredToTicketId: ad.deferredToTicketId || null,
                deferredToTicketName: ad.deferredToTicketName || null,
                amountDueForUpgradePaisa: ad.amountDueForUpgradePaisa !== undefined ? ad.amountDueForUpgradePaisa : null,
                upgradePaymentOrderId: ad.upgradePaymentOrderId || null,
                originalTicketId: ad.originalTicketId || null,
              };
            } else {
              appUserBase.activeDeferral = null;
            }

            if (firestoreData.activeCancellation) {
              const ac = firestoreData.activeCancellation;
              appUserBase.activeCancellation = {
                cancellationId: ac.cancellationId,
                eventName: ac.eventName,
                requestedAt: ac.requestedAt,
                status: ac.status,
                expectedRefundAmountPaisa: ac.expectedRefundAmountPaisa,
                gstOriginallyPaid: ac.gstOriginallyPaid || null,
                refundInitiatedDate: ac.refundInitiatedDate || null,
                refundTransactionId: ac.refundTransactionId || null,
              };
            } else {
              appUserBase.activeCancellation = null;
            }
            appUserBase.ownedClubId = firestoreData.ownedClubId || null;
            appUserBase.clubId = firestoreData.clubId || null;
            appUserBase.firstAffiliatedClubId = firestoreData.firstAffiliatedClubId || null;
            appUserBase.assignedEventDate = toDateStringSafe(firestoreData.assignedEventDate);
            appUserBase.clubAffiliationDate = toDateStringSafe(firestoreData.clubAffiliationDate);
            appUserBase.firstAffiliationDate = toDateStringSafe(firestoreData.firstAffiliationDate);

            if (appUserBase.ownedClubId && firestoreDb) {
              try {
                const ownedClubDocRef = doc(firestoreDb, "clubs", appUserBase.ownedClubId);
                const ownedClubDocSnap = await getDoc(ownedClubDocRef);
                if (ownedClubDocSnap.exists()) {
                  const ownedClubData = ownedClubDocSnap.data() as any;
                  appUserBase.ownedClubName = ownedClubData.name || appUserBase.ownedClubName;
                  appUserBase.ownedClubLogoUrl = ownedClubData.logoUrl || null;
                  appUserBase.ownedClubInstagramUrl = ownedClubData.instagramUrl || null;
                  appUserBase.ownedClubFacebookUrl = ownedClubData.facebookUrl || null;
                }
              } catch (clubFetchError: any) {
                // log error
              }
            }
            if (appUserBase.clubId && firestoreDb && (appUserBase.clubId !== appUserBase.ownedClubId || !appUserBase.ownedClubId)) {
                try {
                    const affiliatedClubDocRef = doc(firestoreDb, "clubs", appUserBase.clubId);
                    const affiliatedClubDocSnap = await getDoc(affiliatedClubDocRef);
                    if (affiliatedClubDocSnap.exists()) {
                        appUserBase.clubName = (affiliatedClubDocSnap.data() as any).name || null;
                    } 
                } catch (clubFetchError: any) { /* log error */ }
            } else if (appUserBase.clubId && appUserBase.clubId === appUserBase.ownedClubId && appUserBase.ownedClubName) {
                appUserBase.clubName = appUserBase.ownedClubName;
            }
        }
      } else {
        appUserBase.name = fbUser.displayName || null;
        appUserBase.isAdmin = false;
        appUserBase.isVolunteer = false;
      }
      return appUserBase as User;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Profile Fetch Error', description: error.message, duration: 7000 });
      return { 
        uid: fbUser.uid, email: fbUser.email, emailVerified: fbUser.emailVerified,
        name: fbUser.displayName || null, photoURL: fbUser.photoURL || null,
        isAdmin: false, isVolunteer: false, activeDeferral: null, activeCancellation: null,
        assignedEventId: null, assignedEventName: null, assignedEventDate: null, assignedCounter: null,
      } as User;
    }
  }, [toast]);

  useEffect(() => {
    if (!isMounted) return () => {};

    if (!firebaseAuthService) {
      setIsAuthenticating(false);
      setLoading(false);
      setCurrentUser(null);
      setFirebaseUserFromAuth(null);
      return () => {}; 
    }

    setIsAuthenticating(true);
    setLoading(true);

    const handleAuthEvent = async (fbUser: FirebaseAuthUser | null) => {
      if (fbUser) {
        setFirebaseUserFromAuth(fbUser);
        const appUser = await fetchUserProfile(fbUser);
        setCurrentUser(appUser);
      } else {
        setFirebaseUserFromAuth(null);
        setCurrentUser(null);
      }
      setIsAuthenticating(false);
      setLoading(false); 
    };
    
    const initialFbUser = firebaseAuthService.currentUser;
    handleAuthEvent(initialFbUser); 

    const unsubscribe = onAuthStateChanged(firebaseAuthService, handleAuthEvent, (error) => {
      setCurrentUser(null);
      setFirebaseUserFromAuth(null);
      setIsAuthenticating(false);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isMounted, fetchUserProfile]); 

  const value = useMemo(() => ({
    currentUser,
    firebaseUserFromAuth,
    loading,
    isAuthenticating, 
    fetchUserProfile,
  }), [currentUser, firebaseUserFromAuth, loading, isAuthenticating, fetchUserProfile]);
  
  return (
    <AuthContext.Provider value={value}>
      <Suspense fallback={<div className="flex flex-col items-center justify-center min-h-screen"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="mt-4">Loading Application...</p></div>}>
        <ClientAuthManager>{children}</ClientAuthManager>
      </Suspense>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    const errorMsg = 'useAuth must be used within an AuthProvider.';
    throw new Error(errorMsg);
  }
  return context;
}
