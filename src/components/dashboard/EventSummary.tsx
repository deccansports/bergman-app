// src/components/dashboard/EventSummary.tsx
"use client";

import type { RaceResult } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, AlertCircle, HelpCircle, Layers3, Combine, Route } from 'lucide-react'; // Removed Trophy, added Combine, Route
import { normalizeStatus } from '@/lib/utils';
import { isTriathlonEvent, isDuathlonEvent } from '@/lib/utils'; // Use the updated functions

interface EventSummaryProps {
  races: RaceResult[] | undefined; // Allow undefined to be handled by default prop or internal check
}

export function EventSummary({ races = [] }: EventSummaryProps) { // Default races to []
  // Ensure races is an array before using array methods
  const safeRaces = Array.isArray(races) ? races : [];

  // Calculate stats based on ALL races fetched for the user
  const totalRaces = safeRaces.length; // Total races found for the user

  // Use normalizeStatus for consistent counting
  const finishedCount = safeRaces.filter(race => normalizeStatus(race.status) === 'Finished').length;
  const dnfCount = safeRaces.filter(race => normalizeStatus(race.status) === 'DNF').length;
  const dnqCount = safeRaces.filter(race => normalizeStatus(race.status) === 'DNQ').length;
  const dnsCount = safeRaces.filter(race => normalizeStatus(race.status) === 'DNS').length;

  // Count Triathlon and Duathlon events
  const triathlonCount = safeRaces.filter(r => isTriathlonEvent(r.eventCategory || r.raceCategory)).length;
  const duathlonCount = safeRaces.filter(r => isDuathlonEvent(r.eventCategory || r.raceCategory)).length;


  const stats = [
    { title: 'Finished', value: finishedCount, icon: CheckCircle2, color: 'text-accent' },
    { title: 'DNF', value: dnfCount, icon: XCircle, color: 'text-destructive' },
    { title: 'DNQ', value: dnqCount, icon: HelpCircle, color: 'text-orange-600' },
    { title: 'DNS', value: dnsCount, icon: AlertCircle, color: 'text-yellow-500' },
    { title: 'Triathlon Events', value: triathlonCount, icon: Combine, color: 'text-indigo-600' },
    { title: 'Duathlon Events', value: duathlonCount, icon: Route, color: 'text-purple-600' },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => (
        <Card key={stat.title} className="shadow-lg hover:shadow-xl transition-shadow duration-300 rounded-xl overflow-hidden border-l-4 border-transparent hover:border-primary/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-base font-semibold text-muted-foreground">
              {stat.title}
            </CardTitle>
            <stat.icon className={`h-6 w-6 ${stat.color}`} />
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
             {(stat.title === 'Finished' || stat.title === 'DNF' || stat.title === 'DNQ' || stat.title === 'DNS') && totalRaces > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                    {((stat.value / totalRaces) * 100).toFixed(1)}% of All Races
                </p>
             )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
