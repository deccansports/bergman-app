"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { applyActionCode, getAuth, checkActionCode } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function AuthActionPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    const oobCode = searchParams.get("oobCode");
    const mode = searchParams.get("mode");

    if (mode === "verifyEmail" && oobCode) {
      const auth = getAuth();
      // First, check if the code is valid without applying it.
      // This prevents errors if the user is not logged in.
      checkActionCode(auth, oobCode)
        .then((info) => {
            // Now apply the action code.
            applyActionCode(auth, oobCode)
              .then(() => {
                setStatus('success');
                setMessage('Your email has been successfully verified! You will be redirected to the login page shortly.');
                setTimeout(() => {
                  router.replace("/login?verified=true");
                }, 3000);
              })
              .catch((error) => {
                setStatus('error');
                setMessage(error.message || "Failed to apply verification code. It may have expired or already been used.");
              });
        })
        .catch((error) => {
            setStatus('error');
            setMessage(error.message || "This verification link is invalid or has expired. Please request a new one.");
        });
    } else {
        setStatus('error');
        setMessage('Invalid request. No action code or mode provided.');
    }
  }, [searchParams, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/30 p-4">
        <Card className="w-full max-w-md text-center">
            <CardHeader className="p-6">
                {status === 'loading' && <Loader2 className="h-12 w-12 text-primary mx-auto animate-spin" />}
                {status === 'success' && <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />}
                {status === 'error' && <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />}
                <CardTitle className="text-2xl font-bold mt-4">{
                    status === 'loading' ? 'Verifying...' : 
                    status === 'success' ? 'Verification Successful!' : 
                    'Verification Failed'
                }</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">{message}</p>
            </CardContent>
            <CardFooter>
                 <Button asChild className="w-full">
                    <Link href="/login">Back to Login</Link>
                </Button>
            </CardFooter>
        </Card>
    </div>
  );
}
