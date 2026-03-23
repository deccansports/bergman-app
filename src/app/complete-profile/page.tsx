// src/app/complete-profile/page.tsx
"use client";

import { zodResolver } from '@hookform/resolvers/zod';
import { User as UserIconLucide, Smartphone, CheckCircle, AlertTriangle, Loader2, Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

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
import { useAuth } from '@/context/AuthContext';
import { updateUserProfile } from '@/lib/actions/userActions';
import type { UserProfileUpdateData } from '@/lib/types';
import Image from 'next/image';

const profileSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  mobile: z
  .string()
  .min(10, { message: 'Mobile number must be at least 10 digits.' })
  .regex(/^\d+$/, "Mobile number must contain only digits.")
  .optional()
  .or(z.literal('')),
});

type ProfileFormData = z.infer<typeof profileSchema>;

function CompleteProfileForm() {
  const { currentUser, loading: authLoading, firebaseUserFromAuth, fetchUserProfile } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      mobile: '',
    },
  });

  useEffect(() => {
    if (!authLoading && currentUser) {
      form.reset({
        name: currentUser.name || '',
        mobile: currentUser.mobile || '',
      });
    } else if (!authLoading && !currentUser) {
        router.replace('/login?reason=no_user_for_profile');
    }
  }, [currentUser, authLoading, router, form]);


  async function onSubmit(values: ProfileFormData) {
    if (!currentUser?.uid || !currentUser?.email) {
      toast({ variant: 'destructive', title: 'Error', description: 'User not authenticated or email missing.' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    
    const payload: UserProfileUpdateData = {
      name: values.name,
      mobile: values.mobile || null, 
      email: currentUser.email, 
    };

    try {
      const result = await updateUserProfile(currentUser.uid, payload);

      if (result.success) {
        setMessage({ type: 'success', text: result.message || 'Profile completed! Redirecting...' });
        toast({ title: 'Profile Complete', description: 'Redirecting to your dashboard.' });
        if (firebaseUserFromAuth && fetchUserProfile) {
          await fetchUserProfile(firebaseUserFromAuth); 
        }
        router.push('/dashboard');
      } else {
        const responseMessage = result.message || 'Failed to complete profile.';
        setMessage({ type: 'error', text: responseMessage });
        toast({
          variant: 'destructive',
          title: 'Profile Completion Failed',
          description: responseMessage,
        });
      }
    } catch (error: any) {
      let description = 'An unexpected error occurred. Please try again.';
       if (error.message) {
        description = error.message;
      }
      setMessage({ type: 'error', text: description });
      toast({
        variant: 'destructive',
        title: 'Profile Completion Error',
        description: description,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (authLoading && !currentUser) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading profile form...</p>
      </div>
    );
  }
  
  if (!currentUser) {
     return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="text-muted-foreground">User session not found. Redirecting to login...</p>
        </div>
     );
  }

  return (
    <>
      {message && (
        <div className={`p-4 mb-6 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} flex items-center`}>
          {message.type === 'success' ? <CheckCircle className="h-5 w-5 mr-2" /> : <AlertTriangle className="h-5 w-5 mr-2" />}
          {message.text}
        </div>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <FormLabel htmlFor="email">Email Address (Verified)</FormLabel>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                value={currentUser.email || ''}
                readOnly
                className="pl-10 bg-muted/50 cursor-not-allowed"
                aria-label="Email Address"
              />
            </div>
          </div>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full Name</FormLabel>
                <div className="relative">
                  <UserIconLucide className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <FormControl>
                    <Input placeholder="Your Full Name" {...field} className="pl-10" aria-label="Full Name" disabled={isSubmitting} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mobile Number (Optional)</FormLabel>
                <div className="relative">
                  <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <FormControl>
                    <Input type="tel" placeholder="1234567890" {...field} value={field.value || ''} className="pl-10" aria-label="Mobile Number" disabled={isSubmitting} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Complete Profile'}
          </Button>
        </form>
      </Form>
    </>
  );
}

export default function CompleteProfilePage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-slate-900 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
            <Image src="/bmround.png" alt="Bergman Logo" width={72} height={72} className="mx-auto mb-4 rounded-full" />
            <CardTitle>Complete Your Profile</CardTitle>
            <CardDescription>Please provide your name and optionally your mobile number to finish setting up your account.</CardDescription>
        </CardHeader>
        <CardContent>
            <Suspense fallback={
            <div className="flex flex-col items-center justify-center p-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-2 text-sm text-muted-foreground">Loading form...</p>
            </div>
            }>
            <CompleteProfileForm />
            </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
