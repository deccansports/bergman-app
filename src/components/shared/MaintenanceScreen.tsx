"use client";

import React from 'react';
import Image from 'next/image';
import { RefreshCw, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MaintenanceScreen({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#050505] text-white text-center px-6 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-orange-600 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600 rounded-full blur-[120px]"></div>
      </div>

      <div className="relative z-10 max-w-lg space-y-8">
        <div className="flex justify-center">
            <Image 
                src="/Bmlogowhite.png" 
                alt="Bergman Logo" 
                width={240} 
                height={80} 
                className="object-contain"
                priority
            />
        </div>

        <div className="space-y-4">
            <div className="inline-flex items-center justify-center p-4 bg-orange-500/10 rounded-full border border-orange-500/20 mb-2">
                <Wrench className="h-10 w-10 text-orange-500 animate-pulse" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter text-orange-500">
                System Upgrade
            </h1>
            <p className="text-xl font-bold text-slate-200">
                Bergman Dashboard Under Maintenance
            </p>
            <p className="text-slate-400 leading-relaxed text-sm md:text-base">
                {message || "We’re currently upgrading your dashboard to provide a faster and more secure experience. We'll be back online in a few minutes."}
            </p>
        </div>

        <div className="pt-4">
            <Button 
                onClick={() => window.location.reload()}
                size="lg"
                className="bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 px-8 rounded-xl shadow-lg shadow-orange-600/20"
            >
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh Page
            </Button>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-6 font-bold">
                Expected Downtime: 30–60 Minutes
            </p>
        </div>
      </div>
    </div>
  );
}
