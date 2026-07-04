// src/app/login/page.tsx
"use client";

import { AuthForm } from '@/components/auth/AuthForm';
import LoginSlider from '@/components/auth/LoginSlider';
import { getHomepageSliderItemsAction } from '@/lib/actions';
import type { HomepageSliderItem } from '@/lib/types';
import { motion } from 'framer-motion';
import { Suspense, useEffect, useState } from 'react';
import { Loader2, User as UserIconLucide } from 'lucide-react';
import Image from 'next/image';
import { useTheme } from 'next-themes';

function AuthPageClient() {
    const { resolvedTheme } = useTheme();
    const [loginMediaItems, setLoginMediaItems] = useState<HomepageSliderItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [logoSrc, setLogoSrc] = useState('/bmforranking.png');

    useEffect(() => {
        setLogoSrc(resolvedTheme === 'dark' ? '/Bmlogowhite.png' : '/bmforranking.png');
    }, [resolvedTheme]);

    useEffect(() => {
        getHomepageSliderItemsAction().then(result => {
            if (result.success && result.items) {
                setLoginMediaItems(result.items.filter(item => item.pageSlug === 'login'));
            }
        }).finally(() => setIsLoading(false));
    }, []);

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }
    
    return (
        <main className="min-h-screen w-full grid lg:grid-cols-[55fr_45fr]">
            <LoginSlider mediaItems={loginMediaItems} />
            <motion.div
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: "easeInOut" }}
                className="relative flex items-center justify-center overflow-hidden py-12 px-4 sm:px-0 flex-grow bg-background"
            >
                <div className="absolute inset-0 -z-10 h-full w-full bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl"></div>
                <div className="relative z-10 flex flex-col items-center gap-4">
                   <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className="mb-6 flex justify-center"
                    >
                        <Image
                            src={logoSrc}
                            alt="Bergman Logo"
                            width={220}
                            height={74}
                            className="object-contain w-auto h-auto max-w-[180px] sm:max-w-[220px]"
                            priority
                        />
                    </motion.div>
                   <AuthForm defaultRole="athlete" />
                </div>
            </motion.div>
        </main>
    );
}


export default function LoginPage() {
  return (
    <Suspense fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
    }>
        <AuthPageClient />
    </Suspense>
  );
}
