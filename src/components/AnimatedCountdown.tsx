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
    return (
      <div className="mx-auto text-center text-xl font-bold text-orange-500 py-4 bg-[#1a1a1a] rounded-xl border border-orange-500/30 shadow-lg shadow-orange-500/10 uppercase tracking-widest px-6 w-fit">
        Race Day 🔥
      </div>
    );
  }

  return (
    <div className="flex gap-2 sm:gap-4 justify-center mt-6 w-full text-center">
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
        "border rounded-xl px-2 py-2 sm:px-4 sm:py-3 text-center shadow-md transition-all duration-300 min-w-[68px] sm:min-w-[80px] group",
        "bg-[#1a1a1a] border-orange-500/20 shadow-xl hover:border-orange-500/50"
      )}
    >
      <div className="relative overflow-hidden h-7 sm:h-9 flex justify-center">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={value}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={cn(
              "text-lg sm:text-xl font-black font-mono",
              "text-orange-500 drop-shadow-[0_0_8px_rgba(255,140,0,0.6)]"
            )}
          >
            {value}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="text-[10px] tracking-widest font-bold uppercase mt-1 text-slate-400 group-hover:text-primary transition-colors">
        {label}
      </div>
    </motion.div>
  );
}
