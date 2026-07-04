
// src/context/AuthContext.tsx
"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  onAuthStateChanged,
  type User as FirebaseAuthUser,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth as firebaseAuthService, db as firestoreDb } from '@/lib/firebase';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { serializeValue } from '@/lib/utils';
import { autoVerifyUserOnFirstLoginAction, linkAccountOnLoginAction } from '@/lib/actions/userActions';

interface GoogleProfileData {
  name: string | null;
  email: string;
  photoURL: string | null;
}

interface AuthContextType {
  currentUser: User | null;
  firebaseUserFromAuth: FirebaseAuthUser | null;
  loading: boolean;
  isAuthenticating: boolean;
  error: string | null;
  googleProfileData: GoogleProfileData | null;
  login: (email: string, pass: string) => Promise<void>;
  loginWithOtp: (email: string, otp: string) => Promise<{ success: boolean; isNewUser: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<{ success: boolean; isNewUser: boolean }>;
  fetchUserProfile: (fbUser: FirebaseAuthUser) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [firebaseUserFromAuth, setFirebaseUserFromAuth] = useState<FirebaseAuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleProfileData, setGoogleProfileData] = useState<GoogleProfileData | null>(null);
  const { toast } = useToast();
  
  // Use a ref to prevent race conditions during interactive login
  const authStateLock = useRef(false);

  const buildFallbackUserFromAuth = useCallback(async (fbUser: FirebaseAuthUser): Promise<User> => {
    const tokenResult = await fbUser.getIdTokenResult().catch(() => null);
    const claims = (tokenResult?.claims || {}) as Record<string, any>;

    const isAdmin = !!(claims.admin || claims.isAdmin || claims.role === 'admin');
    const isVolunteer = !!(claims.volunteer || claims.isVolunteer || claims.role === 'volunteer');
    const volunteerActive = claims.volunteerActive !== false;
    const ownedClubId = (claims.ownedClubId as string | undefined) || null;
    const ownedClubName = (claims.ownedClubName as string | undefined) || null;

    const derivedRole: User['role'] = isAdmin
      ? 'admin'
      : ownedClubId
      ? 'club'
      : isVolunteer
      ? 'volunteer'
      : 'athlete';

    return {
      id: fbUser.uid,
      uid: fbUser.uid,
      email: fbUser.email,
      emailVerified: fbUser.emailVerified,
      name: fbUser.displayName || 'Athlete',
      photoURL: fbUser.photoURL || null,
      role: derivedRole,
      isAdmin,
      isVolunteer,
      volunteerActive,
      ownedClubId,
      ownedClubName,
      clubId: null,
      clubName: null,
    } as User;
  }, []);

  const fetchUserProfile = useCallback(async (fbUser: FirebaseAuthUser) => {
    if (!firestoreDb) {
      const fallbackUser = await buildFallbackUserFromAuth(fbUser);
      setCurrentUser(fallbackUser);
      return;
    }
    try {
      const userDocRef = doc(firestoreDb, "users", fbUser.uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        const resolvedEmail = data?.email || fbUser.email || null;
        const activeClubFromHistory = Array.isArray(data?.clubHistory)
          ? (data.clubHistory.find((entry: any) => entry?.isActive) || null)
          : null;
        const resolvedProfile = {
          ...data,
          uid: fbUser.uid,
          email: resolvedEmail,
          emailVerified: data?.emailVerified ?? fbUser.emailVerified,
          clubId: data?.clubId || activeClubFromHistory?.clubId || null,
          clubName: data?.clubName || activeClubFromHistory?.clubName || null,
        };
        setCurrentUser(serializeValue(resolvedProfile) as User);

        // Backfill missing email/emailVerified for legacy profiles
        if ((!data?.email || data?.email !== resolvedEmail) && fbUser.email) {
          await setDoc(userDocRef, {
            email: fbUser.email,
            emailVerified: fbUser.emailVerified,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
      } else {
        // Try linking legacy/email-based profiles before creating a new one
        if (fbUser.email) {
          await linkAccountOnLoginAction(fbUser.uid, fbUser.email);
          const linkedDocSnap = await getDoc(userDocRef);
          if (linkedDocSnap.exists()) {
            const linkedData = linkedDocSnap.data();
            const activeClubFromHistory = Array.isArray(linkedData?.clubHistory)
              ? (linkedData.clubHistory.find((entry: any) => entry?.isActive) || null)
              : null;
            setCurrentUser(serializeValue({
              ...linkedData,
              uid: fbUser.uid,
              email: linkedData?.email || fbUser.email,
              emailVerified: linkedData?.emailVerified ?? fbUser.emailVerified,
              clubId: linkedData?.clubId || activeClubFromHistory?.clubId || null,
              clubName: linkedData?.clubName || activeClubFromHistory?.clubName || null,
            }) as User);
            return;
          }
        }

        // Profile doesn't exist - create it with basic info from Firebase Auth
        console.log("[AuthContext] Creating new user profile for:", fbUser.email);
        const newProfileData = {
          uid: fbUser.uid,
          email: fbUser.email,
          emailVerified: fbUser.emailVerified,
          name: fbUser.displayName || 'Athlete',
          displayName: fbUser.displayName || null,
          photoURL: fbUser.photoURL || null,
          role: 'athlete',
          isAdmin: false,
          isVolunteer: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        // Try to write to Firestore - if it fails, still set local user
        try {
          // Use fetch to call server action to create profile
          const response = await fetch('/api/sync-user-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: fbUser.uid }),
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              console.log("[AuthContext] User profile created successfully");
            }
          }
        } catch (apiError) {
          console.warn("[AuthContext] Failed to create profile via API:", apiError);
        }
        
        // Set local user state with the new data
        setCurrentUser(newProfileData as unknown as User);
      }
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error("[AuthContext] Profile fetch error:", errMsg);
        const fallbackUser = await buildFallbackUserFromAuth(fbUser);
        setCurrentUser(prev => {
          if (prev?.uid === fbUser.uid) {
            return {
              ...fallbackUser,
              ...prev,
              uid: fbUser.uid,
              id: prev.id || fbUser.uid,
              email: prev.email || fallbackUser.email,
              isAdmin: prev.isAdmin ?? fallbackUser.isAdmin,
              isVolunteer: prev.isVolunteer ?? fallbackUser.isVolunteer,
              role: prev.role || fallbackUser.role,
              ownedClubId: prev.ownedClubId ?? fallbackUser.ownedClubId,
              ownedClubName: prev.ownedClubName ?? fallbackUser.ownedClubName,
            } as User;
          }
          return fallbackUser;
        });
    }
  }, [buildFallbackUserFromAuth]);

  useEffect(() => {
    if (!firebaseAuthService) {
      setLoading(false);
      return;
    }
    
    const unsubscribe = onAuthStateChanged(firebaseAuthService, async (fbUser) => {
      if (!authStateLock.current) {
        if (fbUser) {
          setFirebaseUserFromAuth(fbUser);
          if (fbUser.uid) {
            await autoVerifyUserOnFirstLoginAction(fbUser.uid, fbUser.email);
          }
          await fetchUserProfile(fbUser);
        } else {
          setFirebaseUserFromAuth(null);
          setCurrentUser(null);
        }
        setLoading(false);
      }
    });
    
    return () => unsubscribe();
  }, [fetchUserProfile]);

  const login = useCallback(async (email: string, pass: string) => {
    setError(null);
    setIsAuthenticating(true);
    authStateLock.current = true;
    try {
      await signInWithEmailAndPassword(firebaseAuthService, email, pass);
      const authUser = firebaseAuthService.currentUser;
      if (authUser) {
          setFirebaseUserFromAuth(authUser);
          if (authUser.email) {
            await linkAccountOnLoginAction(authUser.uid, authUser.email);
          }
          await autoVerifyUserOnFirstLoginAction(authUser.uid, authUser.email);
          await fetchUserProfile(authUser);
      }
    } catch (error: unknown) { 
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      setError(errMsg);
      toast({ variant: 'destructive', title: 'Login Failed', description: errMsg });
    } finally {
      setIsAuthenticating(false);
      authStateLock.current = false;
      setLoading(false);
    }
  }, [fetchUserProfile, toast]);

  const loginWithOtp = useCallback(async (email: string, otp: string) => {
    setError(null);
    setIsAuthenticating(true);
    authStateLock.current = true;
    try {
      const response = await fetch('/api/verify-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'OTP verification failed.');
      
      await signInWithCustomToken(firebaseAuthService, result.token);
      
      const authUser = firebaseAuthService.currentUser;
      if (authUser) {
          setFirebaseUserFromAuth(authUser);
          if (authUser.email) {
            await linkAccountOnLoginAction(authUser.uid, authUser.email);
          }
          await autoVerifyUserOnFirstLoginAction(authUser.uid, authUser.email);
          await fetchUserProfile(authUser);
      }

      return { success: true, isNewUser: result.isNewUser };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      setError(errMsg);
      toast({ variant: 'destructive', title: 'Verification Failed', description: errMsg });
      return { success: false, isNewUser: false };
    } finally {
      setIsAuthenticating(false);
      authStateLock.current = false;
      setLoading(false);
    }
  }, [fetchUserProfile, toast]);
  
  const loginWithGoogle = useCallback(async () => {
    setError(null);
    setIsAuthenticating(true);
    authStateLock.current = true;
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });

        const result = await signInWithPopup(firebaseAuthService, provider);
        const additionalInfo = getAdditionalUserInfo(result);
        
        if (result.user && result.user.email) {
            console.log("[Auth] Google sign-in successful, checking profile for:", result.user.email);
            setFirebaseUserFromAuth(result.user);
            
            // Store Google profile data for new users to auto-fill signup form
            if (additionalInfo?.isNewUser) {
                setGoogleProfileData({
                    name: result.user.displayName,
                    email: result.user.email,
                    photoURL: result.user.photoURL,
                });
            } else {
                setGoogleProfileData(null);
            }
            
            await linkAccountOnLoginAction(result.user.uid, result.user.email);
            await autoVerifyUserOnFirstLoginAction(result.user.uid, result.user.email);
            await fetchUserProfile(result.user);
        }

        return { 
          success: true, 
          isNewUser: !!additionalInfo?.isNewUser 
        };
    } catch (error: unknown) { 
        const e = error as any;
        console.error("[Auth] Google login error:", e);
        let msg = e?.message || "Google login failed.";
        if (e.code === 'auth/popup-closed-by-user') {
            msg = "Sign-in window was closed before completion.";
        }
        setError(msg);
        toast({ variant: 'destructive', title: 'Google Login Error', description: msg });
        return { success: false, isNewUser: false };
    } finally {
        setIsAuthenticating(false);
        authStateLock.current = false;
        setLoading(false);
    }
  }, [fetchUserProfile, toast]);

  const resetPassword = useCallback(async (email: string) => {
    setError(null);
    try {
      await sendPasswordResetEmail(firebaseAuthService, email);
      toast({ title: 'Password Reset Sent', description: 'Please check your email.' });
    } catch (error: unknown) { 
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      setError(errMsg);
      toast({ variant: 'destructive', title: 'Error', description: errMsg });
    }
  }, [toast]);

  const value = useMemo(() => ({
    currentUser, 
    firebaseUserFromAuth, 
    loading, 
    isAuthenticating, 
    error,
    googleProfileData,
    login, 
    loginWithOtp, 
    resetPassword, 
    loginWithGoogle, 
    fetchUserProfile,
  }), [currentUser, firebaseUserFromAuth, loading, isAuthenticating, error, googleProfileData, login, loginWithOtp, resetPassword, loginWithGoogle, fetchUserProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
