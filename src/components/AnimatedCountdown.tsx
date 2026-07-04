"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCountdown } from "@/hooks/useCountdown";
import React, { useState, useEffect } from 'react';
import { cn } from "@/lib/utils";

export function AnimatedCountdown({ date }: { date?: string }) {
  const c = useCountdown(date);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return <div className="h-[72px] mt-6 flex justify-center" />; 
  }

  if (!date || c.isPast) {
    return null;
  }

    return (
    <div className="flex flex-wrap gap-2 sm:gap-4 justify-center sm:justify-start items-center w-full text-center">
      <TimeUnit value={c.days} label="Days" />
      <TimeUnit value={c.hours} label="Hrs" />
      <TimeUnit value={c.minutes} label="Min" />
      <TimeUnit value={c.seconds} label="Sec" />
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <motion.div 
      whileHover={{ scale: 1.05 }}
      className={cn(
        "border rounded-xl px-2.5 py-2 sm:px-4 sm:py-3 text-center shadow-md transition-all duration-300 min-w-[56px] sm:min-w-[76px] group flex flex-col items-center justify-center",
        "bg-[#1a1a1a] border-orange-500/20 shadow-xl hover:border-orange-500/50"
      )}
    >
      <div className="relative overflow-hidden h-7 sm:h-8 flex justify-center items-center w-full">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={value}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={cn(
              "text-lg sm:text-2xl font-black font-mono leading-none",
              "text-orange-500 drop-shadow-[0_0_8px_rgba(255,140,0,0.6)]"
            )}
          >
            {String(value).padStart(2, '0')}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="text-[9px] tracking-widest font-bold uppercase mt-1.5 text-slate-400 group-hover:text-primary transition-colors whitespace-nowrap">
        {label}
      </div>
    </motion.div>
  );
}
