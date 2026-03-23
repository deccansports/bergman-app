"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { sendEmailVerification } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Mail, RefreshCw, Send, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailPage() {
  const { currentUser, firebaseUserFromAuth, loading: authLoading, fetchUserProfile } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (!firebaseUserFromAuth || resendCooldown > 0) return;
    setIsSending(true);
    try {
      await sendEmailVerification(firebaseUserFromAuth);
      toast({ title: "Verification Email Sent", description: "Please check your inbox (and spam folder)." });
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Failed to Send Email", description: error.message || "An unexpected error occurred." });
    } finally {
      setIsSending(false);
    }
  };

  const handleRefresh = async () => {
    if (!firebaseUserFromAuth) return;
    setIsRefreshing(true);
    try {
        await firebaseUserFromAuth.reload();
        // The onAuthStateChanged listener in AuthContext will handle the redirect if verification is successful.
        // To be safe, we can also manually check and redirect here.
        if (firebaseUserFromAuth.emailVerified) {
            toast({ title: "Email Verified!", description: "Redirecting you to your dashboard..." });
            if (fetchUserProfile) {
                await fetchUserProfile(firebaseUserFromAuth); // Trigger profile update
            }
            // The AuthContext redirect logic should kick in.
        } else {
            toast({ variant: 'destructive', title: "Not Yet Verified", description: "Please check your email and click the verification link." });
        }
    } catch (error: any) {
         toast({ variant: 'destructive', title: "Refresh Failed", description: "Could not refresh your session. Please try again." });
    } finally {
        setIsRefreshing(false);
    }
  };
  
  if (authLoading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }
  
  // If the user becomes verified while on this page, redirect them.
  if (currentUser?.emailVerified) {
    router.replace('/dashboard');
    return <div className="flex h-screen w-full items-center justify-center bg-background"><p>Email verified. Redirecting...</p></div>;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-amber-50 dark:bg-slate-900 p-4">
      <Card className="w-full max-w-lg text-center shadow-xl border-amber-500/50">
        <CardHeader className="bg-amber-100/50 p-6">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <CardTitle className="text-2xl font-bold text-amber-800 dark:text-amber-200 mt-4">
            Verify Your Email Address
          </CardTitle>
          <CardDescription className="text-muted-foreground pt-2">
            <p>{"We've sent a verification link to your registered email:"}</p>
            <br />
            <strong className="text-foreground">{currentUser?.email}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Please check your inbox (and spam/junk folder) and click the link to verify your email address to continue.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={handleResend} className="w-full" disabled={isSending || resendCooldown > 0}>
              {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Email'}
            </Button>
            <Button onClick={handleRefresh} variant="secondary" className="w-full" disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {"I've Verified, Refresh"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
