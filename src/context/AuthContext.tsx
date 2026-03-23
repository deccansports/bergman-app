
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
import { doc, getDoc } from 'firebase/firestore';
import { auth as firebaseAuthService, db as firestoreDb } from '@/lib/firebase';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { serializeValue } from '@/lib/utils';
import { linkAccountOnLoginAction } from '@/lib/actions/userActions';

interface AuthContextType {
  currentUser: User | null;
  firebaseUserFromAuth: FirebaseAuthUser | null;
  loading: boolean;
  isAuthenticating: boolean;
  error: string | null;
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
  const { toast } = useToast();
  
  // Use a ref to prevent race conditions during interactive login
  const authStateLock = useRef(false);

  const fetchUserProfile = useCallback(async (fbUser: FirebaseAuthUser) => {
    if (!firestoreDb) return;
    try {
      const userDocRef = doc(firestoreDb, "users", fbUser.uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        setCurrentUser(serializeValue({ ...data, uid: fbUser.uid }) as User);
      } else {
        setCurrentUser({ 
            uid: fbUser.uid, 
            email: fbUser.email, 
            emailVerified: fbUser.emailVerified,
            name: fbUser.displayName || 'Athlete'
        } as User);
      }
    } catch (profileError: any) {
        console.error("[AuthContext] Profile fetch error:", profileError);
    }
  }, []);

  useEffect(() => {
    if (!firebaseAuthService) {
      setLoading(false);
      return;
    }
    
    const unsubscribe = onAuthStateChanged(firebaseAuthService, async (fbUser) => {
      if (!authStateLock.current) {
        if (fbUser) {
          setFirebaseUserFromAuth(fbUser);
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
          await fetchUserProfile(authUser);
      }
    } catch (e: any) { 
      setError(e.message);
      toast({ variant: 'destructive', title: 'Login Failed', description: e.message });
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
      if (authUser?.email) {
          setFirebaseUserFromAuth(authUser);
          await linkAccountOnLoginAction(authUser.uid, authUser.email);
          await fetchUserProfile(authUser);
      }

      return { success: true, isNewUser: result.isNewUser };
    } catch (e: any) {
      setError(e.message);
      toast({ variant: 'destructive', title: 'Verification Failed', description: e.message });
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
            await linkAccountOnLoginAction(result.user.uid, result.user.email);
            await fetchUserProfile(result.user);
        }

        return { 
          success: true, 
          isNewUser: !!additionalInfo?.isNewUser 
        };
    } catch (e: any) { 
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
    } catch (e: any) { 
      setError(e.message);
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  }, [toast]);

  const value = useMemo(() => ({
    currentUser, 
    firebaseUserFromAuth, 
    loading, 
    isAuthenticating, 
    error,
    login, 
    loginWithOtp, 
    resetPassword, 
    loginWithGoogle, 
    fetchUserProfile,
  }), [currentUser, firebaseUserFromAuth, loading, isAuthenticating, error, login, loginWithOtp, resetPassword, loginWithGoogle, fetchUserProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
