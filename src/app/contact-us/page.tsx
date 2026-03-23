"use client";

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ContactUsSchema, type ContactUsFormInput } from '@/lib/schemas';
import { useToast } from '@/hooks/use-toast';
import { contactUsAction } from '@/lib/actions/contactActions';
import { Loader2, Send, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Turnstile } from '@marsidev/react-turnstile';
import { motion, AnimatePresence } from 'framer-motion';

export default function ContactUsPage() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<{ ticketId: string } | null>(null);
  const [formStartTime, setFormStartTime] = useState<number>(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    setFormStartTime(Date.now());
  }, []);

  const form = useForm<ContactUsFormInput & { website?: string }>({
    resolver: zodResolver(ContactUsSchema),
    defaultValues: { name: '', email: '', mobile: '', message: '', website: '' },
  });

  const onSubmit = async (data: ContactUsFormInput & { website?: string }) => {
    if (!turnstileToken) {
        toast({ variant: 'destructive', title: 'Verification Required', description: 'Please complete the security challenge.' });
        return;
    }

    setIsSubmitting(true);
    try {
      const result = await contactUsAction({
          ...data,
          formStartTime,
          turnstileToken
      });
      if (result.success && result.ticketId) {
        setSubmissionResult({ ticketId: result.ticketId });
        form.reset();
      } else {
        toast({ variant: 'destructive', title: 'Submission Failed', description: result.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: `An unexpected error occurred: ${e.message}` });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8fafc] to-[#eef2ff] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          {submissionResult ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-[2.5rem] p-12 shadow-2xl">
                <div className="h-24 w-24 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
                    <CheckCircle2 className="h-12 w-12 text-green-500" />
                </div>
                <h1 className="text-4xl font-black uppercase italic tracking-tighter mb-4 bg-gradient-to-r from-sky-500 to-green-500 bg-clip-text text-transparent text-center">
                  Query Logged
                </h1>
                <p className="text-slate-600 font-bold uppercase tracking-widest text-xs mb-8 text-center">Your request has been securely received.</p>
                
                <div className="p-8 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 mb-8">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2 text-center">Ticket Reference</p>
                  <p className="text-4xl font-black font-mono text-slate-900 tracking-tighter text-center">{submissionResult.ticketId}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase mt-6 tracking-widest flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-3 w-3" /> A confirmation has been sent to your email.
                  </p>
                </div>
                
                <Button 
                  onClick={() => setSubmissionResult(null)} 
                  className="w-full h-14 rounded-2xl font-black uppercase tracking-widest border-2 transition-all hover:bg-slate-50" 
                  variant="outline"
                >
                  Submit Another Inquiry
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative"
            >
              <div className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-[2.5rem] p-8 md:p-12 shadow-2xl relative overflow-hidden text-left">
                <div className="inline-flex items-center gap-2 bg-green-500/10 text-green-600 px-4 py-1.5 rounded-full font-black uppercase text-[10px] tracking-widest mb-6">
                  <Zap className="h-3.5 w-3.5 fill-green-600" /> ⚡ Fast Athlete Support
                </div>

                <div className="text-left mb-10">
                  <h1 className="text-4xl md:text-5xl font-black uppercase italic tracking-tighter mb-3 bg-gradient-to-r from-sky-500 to-green-500 bg-clip-text text-transparent leading-none">
                    Write to Bergman
                  </h1>
                  <p className="text-slate-600 font-medium md:text-lg leading-relaxed max-w-xl">
                    Questions about races, registrations, results, or partnerships?  
                    We&apos;re here to support your performance journey.
                  </p>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 text-left">
                    <div className="hidden">
                        <FormField control={form.control} name="website" render={({ field }) => (
                            <FormControl><Input {...field} tabIndex={-1} autoComplete="off" /></FormControl>
                        )} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                      <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Full Name*</FormLabel>
                          <FormControl>
                            <Input 
                              required 
                              placeholder="Your legal name" 
                              {...field} 
                              disabled={isSubmitting} 
                              className="rounded-2xl h-14 border-slate-200 bg-white shadow-sm focus:border-sky-500 focus:ring-sky-500/15 transition-all text-sm font-bold" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name="email" render={({ field }) => (
                        <FormItem className="text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Email Address*</FormLabel>
                          <FormControl>
                            <Input 
                              type="email" 
                              required 
                              placeholder="you@email.com" 
                              {...field} 
                              disabled={isSubmitting} 
                              className="rounded-2xl h-14 border-slate-200 bg-white shadow-sm focus:border-sky-500 focus:ring-sky-500/15 transition-all text-sm font-bold lowercase" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name="mobile" render={({ field }) => (
                        <FormItem className="text-left md:col-span-2">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Mobile Number (WhatsApp)*</FormLabel>
                          <FormControl>
                            <Input 
                              type="tel" 
                              required 
                              placeholder="+91 XXXXX XXXXX" 
                              {...field} 
                              disabled={isSubmitting} 
                              className="rounded-2xl h-14 border-slate-200 bg-white shadow-sm focus:border-sky-500 focus:ring-sky-500/15 transition-all text-sm font-bold" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      
                      <FormField control={form.control} name="message" render={({ field }) => (
                        <FormItem className="md:col-span-2 text-left">
                          <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Detailed Message*</FormLabel>
                          <FormControl>
                            <Textarea 
                              required 
                              placeholder="Tell us how we can help you…" 
                              {...field} 
                              disabled={isSubmitting} 
                              rows={6} 
                              className="rounded-[2rem] border-slate-200 bg-white shadow-sm focus:border-sky-500 focus:ring-sky-500/15 transition-all text-sm font-medium leading-relaxed resize-none p-6" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="space-y-6 pt-4 text-left">
                      {siteKey && (
                        <div className="flex justify-center md:justify-start">
                            <Turnstile
                                siteKey={siteKey}
                                onSuccess={(token: string) => setTurnstileToken(token)}
                                onExpire={() => setTurnstileToken(null)}
                                onError={() => toast({ variant: 'destructive', title: 'Security Error', description: 'Challenge failed to load.' })}
                            />
                        </div>
                      )}

                      <div className="w-full relative group">
                        <Button 
                          type="submit" 
                          className="w-full h-16 rounded-2xl bg-gradient-to-r from-sky-500 to-green-500 hover:from-sky-600 hover:to-green-600 text-white font-black uppercase tracking-widest shadow-2xl shadow-sky-500/20 transition-all active:scale-[0.98] disabled:opacity-50 text-sm text-center" 
                          disabled={isSubmitting || !turnstileToken}
                        >
                          {isSubmitting ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <Send className="mr-3 h-5 w-5" />}
                          Dispatch Inquiry 🚀
                        </Button>
                      </div>

                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center flex items-center justify-center gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-sky-500" />
                        Protected by Bergman Spam Guard & Cloudflare Security
                      </p>
                    </div>
                  </form>
                </Form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
