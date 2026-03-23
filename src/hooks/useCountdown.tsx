// src/hooks/useCountdown.tsx
"use client";

import { useEffect, useState } from "react";
import { parseISO, differenceInMilliseconds } from "date-fns";

export type CountdownState = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
  isStartingSoon: boolean;
};

const EMPTY: CountdownState = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  isPast: true,
  isStartingSoon: false,
};

const getRemainingTime = (targetDate?: string | null, targetTime: string = "06:00"): CountdownState => {
  if (!targetDate) return EMPTY;

  try {
    const [h, m, s = 0] = targetTime.split(":").map(Number);
    const target = parseISO(targetDate);
    target.setHours(h, m, s);

    const diff = differenceInMilliseconds(target, new Date());

    if (diff <= 0) return EMPTY;

    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / 1000 / 60) % 60),
      seconds: Math.floor((diff / 1000) % 60),
      isPast: false,
      isStartingSoon: diff < 24 * 60 * 60 * 1000,
    };
  } catch {
    return EMPTY;
  }
};


export function useCountdown(
  targetDate?: string | null,
  targetTime: string = "06:00"
): CountdownState {
  const [countdown, setCountdown] = useState<CountdownState>(EMPTY);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    // Set initial countdown on client mount
    setCountdown(getRemainingTime(targetDate, targetTime));

    if (!targetDate) return;
    
    const timer = setInterval(() => {
      setCountdown(getRemainingTime(targetDate, targetTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate, targetTime]);

  // On the server, and on the initial client render, return EMPTY to prevent hydration mismatch.
  if (!isClient) {
    return EMPTY;
  }

  return countdown;
}

export const CountdownTimeUnit = ({ value, label }: { value: number; label: string }) => (
  <div className="flex flex-col items-center w-14">
    <span className="text-2xl font-bold tracking-tighter">{value}</span>
    <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
  </div>
);
