// src/components/auth/LoginSlider.tsx
"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import type { HomepageSliderItem } from '@/lib/types';
import { useTheme } from 'next-themes';

interface LoginSliderProps {
    mediaItems: HomepageSliderItem[];
}

export default function LoginSlider({ mediaItems }: LoginSliderProps) {
    const [index, setIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();
    const [logoSrc, setLogoSrc] = useState('/bmforranking.png');

    useEffect(() => {
        setLogoSrc(resolvedTheme === 'dark' ? '/Bmlogowhite.png' : '/bmforranking.png');
    }, [resolvedTheme]);


    useEffect(() => {
        if (mediaItems.length <= 1) return;

        const timer = setInterval(() => {
            setIndex((prevIndex) => (prevIndex + 1) % mediaItems.length);
        }, 7000); 

        return () => clearInterval(timer);
    }, [mediaItems.length]);
    
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            const { clientX, clientY, currentTarget } = e;
            if (!currentTarget) return;
    
            const rect = (currentTarget as HTMLElement).getBoundingClientRect();
            const x = (clientX - rect.left - rect.width / 2) / 50; // Reduced divisor for more subtle effect
            const y = (clientY - rect.top - rect.height / 2) / 50;
            
            const mediaElement = containerRef.current.querySelector('[data-parallax-layer="true"]') as HTMLElement;
            if(mediaElement) {
                 mediaElement.style.transform = `translateX(${x}px) translateY(${y}px) scale(1.05)`; // Add scale here
            }
        };
    
        const currentRef = containerRef.current;
        currentRef?.addEventListener("mousemove", handleMouseMove);
    
        return () => {
            currentRef?.removeEventListener("mousemove", handleMouseMove);
        };
    }, []);

    const defaultMediaItem: HomepageSliderItem = {
        id: 'default-login-image',
        type: 'image',
        src: 'https://images.unsplash.com/photo-1552674605-db6ffd58590b?q=80&w=2896&auto=format&fit=crop',
        alt: 'Race-day sunrise over water',
        dataAiHint: 'race sunrise'
    };
    
    const itemsToDisplay = mediaItems.length > 0 ? mediaItems : [defaultMediaItem];
    const currentItem = itemsToDisplay[index];

    return (
        <motion.div 
            ref={containerRef}
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="relative h-full w-full flex-col bg-muted p-10 text-white hidden lg:flex border-r border-border"
        >
            <AnimatePresence initial={false}>
                <motion.div
                    key={currentItem.src}
                    initial={{ opacity: 0, scale: 1.1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.5, ease: 'easeInOut' }}
                    className="absolute inset-0 w-full h-full overflow-hidden"
                >
                     <motion.div
                        key={`${currentItem.src}-zoom`}
                        className="w-full h-full"
                        data-parallax-layer="true"
                        style={{ scale: 1.05 }}
                        animate={{ scale: [1.05, 1.15, 1.05] }}
                        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", repeatType: "mirror" }}
                    >
                    {currentItem.type === 'video' ? (
                        <video
                            key={currentItem.src}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="absolute inset-0 w-full h-full object-cover"
                        >
                            <source src={currentItem.src} type="video/mp4" />
                        </video>
                    ) : (
                        <Image
                            src={currentItem.src}
                            alt={currentItem.alt || 'Login background'}
                            fill
                            className="object-cover"
                            priority={index === 0}
                            data-ai-hint={currentItem.dataAiHint || 'athlete background'}
                        />
                    )}
                    </motion.div>
                </motion.div>
            </AnimatePresence>

            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/20" />

            {/* Logo removed from here */}

            <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.8 }}
                className="relative z-20 mt-auto"
            >
                <blockquote className="space-y-2 bg-black/50 p-4 rounded-lg backdrop-blur-sm border border-white/10">
                    <p className="text-lg">
                        &ldquo;Own Your Finish Line.&rdquo;
                    </p>
                    <footer className="text-sm">Bergman Triathlon</footer>
                </blockquote>
            </motion.div>
             <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                {itemsToDisplay.map((_, i) => (
                    <button
                        key={i}
                        onClick={() => setIndex(i)}
                        className={`h-2 w-2 rounded-full transition-all ${index === i ? 'bg-white w-6' : 'bg-white/50'}`}
                        aria-label={`Go to slide ${i + 1}`}
                    />
                ))}
            </div>
        </motion.div>
    );
}
