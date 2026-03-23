
// src/components/rankings/LegacyAthleteDisplayCard.tsx
"use client";

import type { LegacyAthlete } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Award, CalendarDays, MapPin, TrendingUp, Star, ShieldAlert } from 'lucide-react';
import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


interface LegacyAthleteDisplayCardProps {
  legacyAthletes: LegacyAthlete[];
}

const toTitleCase = (str: string | null | undefined): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export default function LegacyAthleteDisplayCard({ legacyAthletes }: LegacyAthleteDisplayCardProps) {
  const [selectedAthlete, setSelectedAthlete] = useState<LegacyAthlete | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const groupedByYears = useMemo(() => {
    const groups: { [key: number]: LegacyAthlete[] } = {};
    legacyAthletes.forEach(athlete => {
        const years = athlete.totalYears;
        if (!groups[years]) {
            groups[years] = [];
        }
        groups[years].push(athlete);
    });
    return Object.keys(groups)
        .map(Number)
        .sort((a, b) => b - a) 
        .reduce((acc, key) => {
            acc[key] = groups[key];
            return acc;
        }, {} as { [key: number]: LegacyAthlete[] });
  }, [legacyAthletes]);

  const defaultTab = useMemo(() => {
    const yearKeys = Object.keys(groupedByYears);
    return yearKeys.length > 0 ? yearKeys[0] : '3';
  }, [groupedByYears]);

  if (!legacyAthletes || legacyAthletes.length === 0) {
    return null;
  }

  const handleAthleteClick = (athlete: LegacyAthlete) => {
    setSelectedAthlete(athlete);
    setIsDialogOpen(true);
  };

  const motivationalMessage = "Saluting the titans of endurance! Your unwavering commitment and consecutive years of triumph embody the true spirit of a Bergman Legacy Athlete. Your journey inspires us all.";
  const criteriaMessage = "Honoring athletes who have achieved the remarkable feat of finishing at least one race in three or more consecutive years.";

  const AthleteList = ({ athletes }: { athletes: LegacyAthlete[] }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar-dark">
        {athletes.map((athlete, index) => (
            <div
                key={index}
                role="button"
                tabIndex={0}
                onClick={() => handleAthleteClick(athlete)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleAthleteClick(athlete)}
                className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-all duration-200 shadow-md text-left w-full focus:outline-none focus:ring-2 focus:ring-yellow-400 cursor-pointer"
                aria-label={`View details for ${athlete.name}`}
            >
                <Award className="h-8 w-8 text-yellow-400 flex-shrink-0" />
                <div>
                    <p className="text-lg font-semibold text-slate-100">{toTitleCase(athlete.name)}</p>
                    <p className="text-xs text-yellow-400/90 font-medium">Achievement: {athlete.achievementYears}</p>
                </div>
            </div>
        ))}
    </div>
  );


  return (
    <>
      <Card className="w-full shadow-2xl rounded-2xl overflow-hidden border-4 border-yellow-500/70 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 my-8">
        <CardHeader className="text-center p-6 bg-black/30">
          <div className="flex justify-center items-center gap-3 mb-3">
            <Award className="h-12 w-12 text-yellow-400" strokeWidth={1.5} />
          </div>
          <CardTitle className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-500 tracking-tight">
            Bergman Legacy Athletes
          </CardTitle>
          <CardDescription className="text-amber-100/80 text-lg mt-2">
            {criteriaMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 md:p-8 text-white">
          <p className="text-center text-md lg:text-lg italic text-slate-300 mb-8 leading-relaxed">
            {motivationalMessage}
          </p>

          <Tabs defaultValue={defaultTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4 bg-white/5 border border-white/10">
                {Object.keys(groupedByYears).map(yearCount => (
                    <TabsTrigger 
                      key={yearCount} 
                      value={yearCount} 
                      className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-300"
                    >
                        {yearCount} Years ({groupedByYears[parseInt(yearCount)].length})
                    </TabsTrigger>
                ))}
            </TabsList>
            {Object.entries(groupedByYears).map(([yearCount, athletes]) => (
                <TabsContent key={yearCount} value={yearCount}>
                    {athletes.length > 0 ? <AthleteList athletes={athletes} /> : <p className="text-center text-slate-400 py-4">No athletes in this category.</p>}
                </TabsContent>
            ))}
          </Tabs>
          
        </CardContent>
        <style jsx global>{`
          .custom-scrollbar-dark::-webkit-scrollbar {
            width: 8px;
          }
          .custom-scrollbar-dark::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.05);
            border-radius: 10px;
          }
          .custom-scrollbar-dark::-webkit-scrollbar-thumb {
            background-color: rgba(255,255,255,0.2);
            border-radius: 10px;
            border: 2px solid rgba(255,255,255,0.05);
          }
          .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover {
            background-color: rgba(255,255,255,0.4);
          }
        `}</style>
      </Card>

      {selectedAthlete && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-lg bg-slate-800 border-slate-700 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-2xl text-yellow-400">Race History: {toTitleCase(selectedAthlete.name)}</DialogTitle>
              <DialogDescription className="text-slate-300">
                Full race history for this athlete.
              </DialogDescription>
            </DialogHeader>
            {selectedAthlete.contributingRaces && selectedAthlete.contributingRaces.length > 0 ? (
              <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 custom-scrollbar-dialog">
                {selectedAthlete.contributingRaces
                  ?.sort((a, b) => new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime())
                  .map((race, index) => (
                    <div key={index} className="text-sm p-3 border rounded-md bg-slate-700/50">
                      <p className="font-semibold text-amber-400">{race.raceName}</p>
                      <div className="text-sm text-slate-300 flex items-center gap-1.5 mt-1">
                        <CalendarDays className="h-4 w-4 text-slate-400" />
                        {new Date(race.raceDate + 'T00:00:00Z').toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })}
                      </div>
                      <div className="text-sm text-slate-300 flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        {race.location}
                      </div>
                      <div className="text-sm text-slate-300 flex items-center gap-1.5 mt-0.5">
                        <Star className="h-4 w-4 text-yellow-400" />
                        Points Earned: <span className="font-medium text-yellow-300">{race.pointsEarned}</span>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-slate-400">No specific race details available for this period.</p>
            )}
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-slate-100">
                Close
              </Button>
            </DialogFooter>
            <style jsx global>{`
                .custom-scrollbar-dialog::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar-dialog::-webkit-scrollbar-track {
                    background: hsl(var(--muted) / 0.2);
                    border-radius: 10px;
                }
                .custom-scrollbar-dialog::-webkit-scrollbar-thumb {
                    background-color: hsl(var(--primary) / 0.5);
                    border-radius: 10px;
                }
                .custom-scrollbar-dialog::-webkit-scrollbar-thumb:hover {
                    background-color: hsl(var(--primary) / 0.7);
                }
            `}</style>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
