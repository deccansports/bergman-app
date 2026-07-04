// src/components/auth/AuthForm.tsx
"use client";

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import {
  Mail, ArrowLeft, Loader2, 
  Building, Trophy, Globe, Instagram, Facebook
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription
} from '@/components/ui/form';
import { 
    AthleteSignupSchemaBase,
    type AthleteSignupFormInput
} from '@/lib/schemas';
import { registerClubForExistingUser } from '@/lib/actions/clubActions';
import { updateUserProfile } from '@/lib/actions/userActions';
import { ClubPolicyAcceptance } from '@/components/club/ClubPolicyAcceptance';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { countriesByContinent } from '@/lib/countries';
import { INDIAN_STATES, NO_CLUB_SELECTED_VALUE } from '@/lib/constants';
import { COUNTRY_CODES } from '@/lib/constants/country-codes';

type AuthStep = 'identifier' | 'otp' | 'role-select' | 'athlete-signup' | 'club-signup';

export function AuthForm({ defaultRole = 'athlete' }: { defaultRole?: 'athlete' | 'club' }) {
  const { loginWithOtp, loginWithGoogle, fetchUserProfile, firebaseUserFromAuth, googleProfileData } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [step, setStep] = useState<AuthStep>('identifier');
  const [email, setEmail] = useState('');
  const [maskedMobile, setMaskedMobile] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDialCode, setSelectedDialCode] = useState('+91');
  const [otpResendCountdown, setOtpResendCountdown] = useState(0);
  const [clubPolicyAccepted, setClubPolicyAccepted] = useState(false);

  const idForm = useForm({ defaultValues: { email: '' } });
  const otpForm = useForm({ defaultValues: { otp: '' } });

  const athleteSignupForm = useForm<AthleteSignupFormInput>({
    resolver: zodResolver(AthleteSignupSchemaBase), 
    defaultValues: { name: googleProfileData?.name || '', email: googleProfileData?.email || '', mobile: '', country: 'India', state: '' }
  });

  const clubSignupForm = useForm({
    resolver: zodResolver(z.object({
        clubName: z.string().min(3, "Club name is too short"),
        coachName: z.string().min(2, "Coach name is required"),
        clubContactEmail: z.string().email(),
        clubContactMobile: z.string().min(10),
        city: z.string().min(2),
        state: z.string().min(2),
        country: z.string().default('India'),
        instagramUrl: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
        facebookUrl: z.string().url("Invalid URL").or(z.literal('')).optional().nullable(),
    })),
    defaultValues: { clubName: '', coachName: googleProfileData?.name || '', clubContactEmail: googleProfileData?.email || '', clubContactMobile: '', city: '', state: '', country: 'India', instagramUrl: '', facebookUrl: '' }
  });

  useEffect(() => {
    if (email) {
        athleteSignupForm.setValue('email', email);
        clubSignupForm.setValue('clubContactEmail', email);
    }
  }, [email, athleteSignupForm, clubSignupForm]);

  // Auto-fill forms with Google profile data when available
  useEffect(() => {
    if (googleProfileData) {
        athleteSignupForm.setValue('name', googleProfileData.name || '');
        athleteSignupForm.setValue('email', googleProfileData.email);
        clubSignupForm.setValue('coachName', googleProfileData.name || '');
        clubSignupForm.setValue('clubContactEmail', googleProfileData.email);
    }
  }, [googleProfileData, athleteSignupForm, clubSignupForm]);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (otpResendCountdown <= 0) return;
    const timer = setTimeout(() => setOtpResendCountdown(otpResendCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [otpResendCountdown]);

  const handleSendOtp = async (values: { email: string }) => {
    setIsProcessing(true);
    try {
        const res = await fetch('/api/send-email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: values.email }),
        });
        const result = await res.json();
        if (res.ok) {
            setEmail(values.email);
          setMaskedMobile(result.maskedMobile || null);
            setStep('otp');
            setOtpResendCountdown(50);
            toast({ title: "OTP Sent", description: "Please check your email inbox and WhatsApp." });
        } else {
            toast({ variant: 'destructive', description: result.message });
        }
    } finally {
        setTimeout(() => setIsProcessing(false), 500);
    }
  };

  const handleVerifyOtp = async (values: { otp: string }) => {
    setIsProcessing(true);
    const result = await loginWithOtp(email, values.otp);
    if (result.success) {
        if (result.isNewUser) {
            setStep('role-select');
        } else {
            toast({ title: "Welcome back!" });
            router.push('/dashboard');
        }
    } else {
        toast({ variant: 'destructive', description: "Invalid code. Please try again." });
    }
    setIsProcessing(false);
  };

  const handleGoogleLogin = async () => {
    setIsProcessing(true);
    try {
        const result = await loginWithGoogle();
        if (result.success) {
            if (result.isNewUser) {
                setStep('role-select');
            } else {
                router.push('/dashboard');
            }
        }
    } catch (e: any) {
        toast({ variant: 'destructive', description: e.message });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleAthleteSignup = async (data: any) => {
    if (!firebaseUserFromAuth?.uid) {
        toast({ variant: 'destructive', description: "Authentication session expired. Please log in again." });
        setStep('identifier');
        return;
    }
    
    setIsProcessing(true);
    try {
        const fullMobile = `${selectedDialCode}${data.mobile.replace(/\D/g, '')}`;
        
        const res = await updateUserProfile(firebaseUserFromAuth.uid, {
            ...data,
            mobile: fullMobile,
            nameLower: data.name.toLowerCase(),
            emailVerified: true
        });

        if (res.success) {
            toast({ title: "Account Created!", description: "Welcome to the Bergman Hub." });
            if (fetchUserProfile) await fetchUserProfile(firebaseUserFromAuth);
            router.push('/dashboard');
        } else {
            toast({ variant: 'destructive', title: "Profile Error", description: res.message });
        }
    } catch (err: any) {
        toast({ variant: 'destructive', title: "Submission Error", description: err.message });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleClubSignup = async (data: any) => {
    if (!firebaseUserFromAuth?.uid) {
        toast({ variant: 'destructive', description: "Authentication session expired." });
        return;
    }
    setIsProcessing(true);
    try {
        const fullMobile = `${selectedDialCode}${data.clubContactMobile.replace(/\D/g, '')}`;
        const res = await registerClubForExistingUser(firebaseUserFromAuth.uid, data.coachName, { ...data, clubContactMobile: fullMobile });
        if (res.success) {
            toast({ title: "Club Registered!", description: "Your club portal is now ready." });
            if (fetchUserProfile) await fetchUserProfile(firebaseUserFromAuth);
            router.push('/club-dashboard');
        } else {
            toast({ variant: 'destructive', description: res.message });
        }
    } catch (err: any) {
        toast({ variant: 'destructive', title: "Submission Error", description: err.message });
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <AnimatePresence mode="wait">
        
        {step === 'identifier' && (
          <motion.div key="id" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 text-left">
            <Form {...idForm}>
              <form onSubmit={idForm.handleSubmit(handleSendOtp)} className="space-y-4">
                <FormField name="email" control={idForm.control} render={({ field }) => (
                  <FormItem className="text-left">
                    <FormLabel className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Login Identifier</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                        <Input {...field} placeholder="you@email.com" className="pl-10 h-12 rounded-xl font-bold border-muted" disabled={isProcessing} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest shadow-xl" disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="animate-spin h-5 w-5" /> : "Request Access Code"}
                </Button>
              </form>
            </Form>
            
            <div className="relative flex items-center py-4">
                <div className="flex-grow border-t border-border"></div>
                <span className="flex-shrink mx-4 text-[10px] font-black uppercase text-muted-foreground tracking-widest">OR</span>
                <div className="flex-grow border-t border-border"></div>
            </div>

            <Button variant="outline" className="w-full h-12 rounded-xl font-bold uppercase text-xs flex items-center justify-center gap-3 border-2" onClick={handleGoogleLogin} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin h-4 w-4"/> : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                )}
                Continue with Google
            </Button>
          </motion.div>
        )}

        {step === 'otp' && (
          <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 text-left">
            <button onClick={() => setStep('identifier')} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 hover:text-primary transition-colors mb-2">
                <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <div className="text-left">
                <h3 className="font-black uppercase tracking-tight text-lg leading-none">Security Check</h3>
                <p className="text-xs text-muted-foreground font-medium mt-2">
                  Enter the 6-digit code sent to <strong>{email}</strong>
                  {maskedMobile ? (
                    <>
                      {' '}and WhatsApp <strong>{maskedMobile}</strong>
                    </>
                  ) : (
                    ' and WhatsApp'
                  )}
                </p>
                <p className="text-[11px] text-red-600 font-semibold mt-1">
                  OTP not received in Inbox? Please check Spam/Junk folder.
                </p>
            </div>
            <Form {...otpForm}>
              <form onSubmit={otpForm.handleSubmit(handleVerifyOtp)} className="space-y-4">
                <FormField name="otp" control={otpForm.control} render={({ field }) => (
                  <FormItem className="text-left">
                    <FormControl>
                      <Input {...field} maxLength={6} placeholder="000000" className="h-14 text-center text-2xl font-black tracking-[0.5em] rounded-xl border-muted" disabled={isProcessing} autoFocus />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full h-12 rounded-xl bg-orange-600 hover:bg-orange-50 text-white font-black uppercase tracking-widest shadow-xl shadow-orange-600/20" disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="animate-spin h-5 w-5" /> : "Verify Identity"}
                </Button>
                {otpResendCountdown > 0 ? (
                  <p className="text-xs font-semibold text-center text-muted-foreground">
                    Resend OTP in <span className="text-primary font-black">{otpResendCountdown}s</span>
                  </p>
                ) : (
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full h-10 rounded-xl font-bold uppercase tracking-widest text-xs"
                    onClick={() => handleSendOtp({ email })}
                    disabled={isProcessing}
                  >
                    Resend OTP
                  </Button>
                )}
              </form>
            </Form>
          </motion.div>
        )}

        {step === 'role-select' && (
          <motion.div key="role" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6 text-left">
            <div className="text-center">
                <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 mb-2 uppercase font-black tracking-widest">New Identity</Badge>
                <h3 className="text-xl font-black uppercase tracking-tight italic">Choose Your Path</h3>
                {googleProfileData && (
                    <p className="text-xs text-muted-foreground mt-2">Your profile will be pre-filled with your Google account details</p>
                )}
            </div>
            <div className="grid grid-cols-1 gap-4">
                <Button variant="outline" className="h-20 rounded-2xl border-2 hover:border-primary hover:bg-primary/5 flex items-center justify-start px-6 gap-4 group" onClick={() => setStep('athlete-signup')}>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                        <Trophy className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                        <p className="font-black uppercase tracking-tighter">I am an Athlete</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Register for races & track performance</p>
                    </div>
                </Button>
                <Button variant="outline" className="h-20 rounded-2xl border-2 hover:border-orange-600 hover:bg-orange-600/5 flex items-center justify-start px-6 gap-4 group" onClick={() => setStep('club-signup')}>
                    <div className="h-10 w-10 rounded-full bg-orange-600/10 flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                        <Building className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                        <p className="font-black uppercase tracking-tighter">I am a Club Owner</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">Manage your team & squad standings</p>
                    </div>
                </Button>
            </div>
          </motion.div>
        )}

        {step === 'athlete-signup' && (
          <motion.div key="athlete" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 text-left">
            <button onClick={() => setStep('role-select')} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 hover:text-primary transition-colors">
                <ArrowLeft className="h-3 w-3" /> Change Role
            </button>
            <Form {...athleteSignupForm}>
              <form onSubmit={athleteSignupForm.handleSubmit(handleAthleteSignup)} className="space-y-4 text-left">
                <FormField name="name" control={athleteSignupForm.control} render={({ field }) => (
                  <FormItem><FormLabel className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Full Name*</FormLabel><FormControl><Input {...field} className="rounded-xl h-11 font-bold border-muted" placeholder="As per Identity" /></FormControl><FormMessage/></FormItem>
                )} />
                <div className="space-y-1">
                    <FormLabel className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">WhatsApp Number*</FormLabel>
                    <div className="flex gap-2">
                        <Select value={selectedDialCode} onValueChange={setSelectedDialCode}>
                            <SelectTrigger className="w-20 h-11 rounded-xl font-bold px-2">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {COUNTRY_CODES.map(c => <SelectItem key={c.code} value={c.dial_code}>{c.dial_code}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormField name="mobile" control={athleteSignupForm.control} render={({ field }) => (
                            <FormItem className="flex-grow"><FormControl><Input {...field} placeholder="9876543210" className="rounded-xl h-11 font-bold border-muted" /></FormControl><FormMessage/></FormItem>
                        )} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <FormField name="country" control={athleteSignupForm.control} render={({ field }) => (
                        <FormItem><FormLabel className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Country</FormLabel>
                            <Select onValueChange={(val) => {
                                field.onChange(val);
                                const matched = COUNTRY_CODES.find(c => c.name.toLowerCase() === val.toLowerCase());
                                if (matched) setSelectedDialCode(matched.dial_code);
                            }} value={field.value || 'India'}>
                                <FormControl><SelectTrigger className="rounded-xl h-11 font-bold"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {Object.entries(countriesByContinent).map(([continent, countries]) => (
                                        <SelectGroup key={continent}>
                                            <SelectLabel>{continent}</SelectLabel>
                                            {(countries as any[]).map((c: any) => <SelectItem key={c.code} value={c.name}>{c.name}</SelectItem>)}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />
                    {athleteSignupForm.watch('country') === 'India' && (
                        <FormField name="state" control={athleteSignupForm.control} render={({ field }) => (
                            <FormItem><FormLabel className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">State</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                    <FormControl><SelectTrigger className="rounded-xl h-11 font-bold"><SelectValue placeholder="Select..."/></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {INDIAN_STATES.map(s => <SelectItem key={s.value} value={s.name}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </FormItem>
                        )} />
                    )}
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest shadow-xl" disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="animate-spin h-5 w-5" /> : "Complete My Profile"}
                </Button>
              </form>
            </Form>
          </motion.div>
        )}

        {step === 'club-signup' && (
          <motion.div key="club" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 text-left">
            <button onClick={() => setStep('role-select')} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 hover:text-primary transition-colors">
                <ArrowLeft className="h-3 w-3" /> Change Role
            </button>
            <Form {...clubSignupForm}>
              <form onSubmit={clubSignupForm.handleSubmit(handleClubSignup)} className="space-y-4 text-left">
                <div className="h-[40vh] overflow-y-auto pr-4 -mr-4 space-y-4 py-2">
                        <div className="p-4 border rounded-2xl bg-muted/20 space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Club Identity</h4>
                            <FormField name="clubName" control={clubSignupForm.control} render={({ field }) => (
                                <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Club Name*</FormLabel><FormControl><Input {...field} placeholder="Official Club Name" className="rounded-xl h-10 font-bold border-muted" /></FormControl><FormMessage/></FormItem>
                            )} />
                            <FormField name="coachName" control={clubSignupForm.control} render={({ field }) => (
                                <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Lead Coach Name*</FormLabel><FormControl><Input {...field} placeholder="Name of Head Coach" className="rounded-xl h-10 font-bold border-muted" /></FormControl><FormMessage/></FormItem>
                            )} />
                            <FormField name="clubContactEmail" control={clubSignupForm.control} render={({ field }) => (
                                <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Contact Email</FormLabel><FormControl><Input {...field} placeholder="public.contact@club.com" className="rounded-xl h-10 lowercase border-muted" /></FormControl><FormMessage/></FormItem>
                            )} />
                            <div className="space-y-1">
                                <FormLabel className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">WhatsApp Mobile*</FormLabel>
                                <div className="flex gap-2">
                                    <Select value={selectedDialCode} onValueChange={setSelectedDialCode}>
                                        <SelectTrigger className="w-20 h-10 rounded-xl font-bold px-2">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {COUNTRY_CODES.map(c => <SelectItem key={c.code} value={c.dial_code}>{c.dial_code}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                    <FormField name="clubContactMobile" control={clubSignupForm.control} render={({ field }) => (
                                        <FormItem className="flex-grow"><FormControl><Input {...field} placeholder="9876543210" className="rounded-xl h-10 border-muted" /></FormControl><FormMessage/></FormItem>
                                    )} />
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border rounded-2xl bg-muted/20 space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Social Reach</h4>
                            <FormField name="instagramUrl" control={clubSignupForm.control} render={({ field }) => (
                                <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2"><Instagram className="h-3 w-3 text-pink-600"/> Instagram URL</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="https://instagram.com/..." className="rounded-xl h-10 border-muted" /></FormControl></FormItem>
                            )} />
                            <FormField name="facebookUrl" control={clubSignupForm.control} render={({ field }) => (
                                <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2"><Facebook className="h-3 w-3 text-blue-600"/> Facebook URL</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="https://facebook.com/..." className="rounded-xl h-10 border-muted" /></FormControl></FormItem>
                            )} />
                        </div>

                        <div className="p-4 border rounded-2xl bg-muted/20 space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Locale</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <FormField name="city" control={clubSignupForm.control} render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">City*</FormLabel><FormControl><Input {...field} placeholder="Base City" className="rounded-xl h-10 font-bold border-muted" /></FormControl><FormMessage/></FormItem>
                                )} />
                                <FormField name="state" control={clubSignupForm.control} render={({ field }) => (
                                    <FormItem><FormLabel className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">State*</FormLabel><FormControl><Input {...field} placeholder="Base State" className="rounded-xl h-10 font-bold border-muted" /></FormControl><FormMessage/></FormItem>
                                )} />
                            </div>
                        </div>
                        <ClubPolicyAcceptance
                          accepted={clubPolicyAccepted}
                          onAcceptChange={setClubPolicyAccepted}
                        />
                    </div>
                <Button type="submit" className="w-full h-12 rounded-xl bg-orange-600 hover:bg-orange-50 text-white font-black uppercase tracking-widest shadow-xl shadow-orange-600/20" disabled={isProcessing || !clubPolicyAccepted}>
                  {isProcessing ? <Loader2 className="animate-spin h-5 w-5" /> : "Register My Club"}
                </Button>
              </form>
            </Form>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
