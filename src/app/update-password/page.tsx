// src/app/update-password/page.tsx
"use client";

import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, CheckCircle, AlertTriangle, Loader2, KeyRound } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

const formSchema = z.object({
  password: z.string().min(6, { message: 'Password must be at least 6 characters.' }),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

function UpdatePasswordFormComponent() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });

  useEffect(() => {
    if (!auth) {
        setMessage({ type: 'error', text: 'Authentication service not available.' });
        setIsVerifyingCode(false);
        return;
    }
    const code = searchParams.get('oobCode');
    if (code) {
      setIsVerifyingCode(true);
      verifyPasswordResetCode(auth, code)
        .then((email) => {
          setOobCode(code);
          setMessage({ type: 'success', text: `Ready to set a new password for ${email}.` });
          setIsVerifyingCode(false);
        })
        .catch((error) => {
          console.error("Firebase verifyPasswordResetCode error:", error);
          setMessage({ type: 'error', text: error.message || 'Invalid or expired password reset link.' });
          toast({ variant: 'destructive', title: 'Link Invalid', description: 'The password reset link is invalid or has expired. Please request a new one.' });
          setOobCode(null); // Ensure oobCode is null on error
          setIsVerifyingCode(false);
        });
    } else {
      setMessage({ type: 'error', text: 'Password reset code missing from URL. Please request a new reset link.' });
      toast({ variant: 'destructive', title: 'Error', description: 'No password reset code found in the link.' });
      setOobCode(null);
      setIsVerifyingCode(false);
    }
  }, [searchParams, toast]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!auth) {
      toast({ variant: 'destructive', title: 'Error', description: 'Authentication service not available.' });
      return;
    }
    if (!oobCode) {
      setMessage({ type: 'error', text: 'Password reset code is missing or invalid. Cannot reset password.' });
      toast({ variant: 'destructive', title: 'Error', description: 'Cannot reset password without a valid code.' });
      return;
    }

    setIsLoading(true);
    setMessage(null); // Clear previous messages
    try {
      await confirmPasswordReset(auth, oobCode, values.password);
      setMessage({ type: 'success', text: 'Your password has been updated successfully! Redirecting to login...' });
      toast({
        title: 'Password Updated',
        description: 'You can now log in with your new password.',
      });
      form.reset();
      setTimeout(() => router.push('/login'), 3000);
    } catch (error: any) {
      console.error("Firebase confirmPasswordReset error:", error);
      const errorMessage = error.message || 'An unexpected error occurred. Please try again.';
      setMessage({ type: 'error', text: errorMessage });
      toast({
        variant: 'destructive',
        title: 'Update Password Failed',
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }
  
  if (isVerifyingCode) {
    return (
        <div className="flex flex-col items-center justify-center p-6">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Verifying reset link...</p>
        </div>
    );
  }

  return (
    <>
      {message && (
        <div className={`p-4 mb-4 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} flex items-center`}>
          {message.type === 'success' ? <CheckCircle className="h-5 w-5 mr-2" /> : <AlertTriangle className="h-5 w-5 mr-2" />}
          {message.text}
        </div>
      )}
      {oobCode && message?.type !== 'error' && !message?.text.includes('missing from URL') && !message?.text.includes('invalid or has expired') && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="pl-10" disabled={isLoading} />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm New Password</FormLabel>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="pl-10" disabled={isLoading} />
                    </FormControl>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Update Password'}
            </Button>
          </form>
        </Form>
      )}
    </>
  );
}

export default function UpdatePasswordPage() {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-slate-900 p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <Image src="/bmround.png" alt="Bergman Logo" width={72} height={72} className="mx-auto mb-4 rounded-full" />
            <CardTitle>Update Your Password</CardTitle>
            <CardDescription>Enter your new password below.</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={
                <div className="flex flex-col items-center justify-center p-6">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Loading form...</p>
                </div>
            }>
                <UpdatePasswordFormComponent />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    );
  }
