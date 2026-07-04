"use client";

import React, { createContext, useContext, type ReactNode } from 'react';
import type { ResolvedTimingConfiguration } from '@/lib/timingConfiguration';

type TimingConfigurationContextValue = {
  eventId: string;
  timingConfiguration: ResolvedTimingConfiguration | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const TimingConfigurationContext = createContext<TimingConfigurationContextValue | null>(null);

export function TimingConfigurationProvider({ value, children }: { value: TimingConfigurationContextValue; children: ReactNode }) {
  return <TimingConfigurationContext.Provider value={value}>{children}</TimingConfigurationContext.Provider>;
}

export function useTimingConfigurationContext() {
  return useContext(TimingConfigurationContext);
}
