
// src/components/dashboard/FinishCard.tsx
"use client";

import type { RaceResult } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Award, CheckCircle2, Clock, Users, BarChart3, Waves, Bike, Footprints, ChevronsRight, Info, Flag } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getOrdinal, formatSecondsToHMS, hmsToSeconds } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

interface FinishCardProps {
  race: RaceResult;
  onDismiss: () => void;
}

const DetailRow = ({ icon: Icon, label, value, valueClass = '' }: { icon: React.ElementType, label: string, value: React.ReactNode, valueClass?: string }) => (
    <div className="flex justify-between items-center py-2 border-b border-muted">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span>{label}</span>
        </div>
        <span className={`font-semibold ${valueClass}`}>{value || 'N/A'}</span>
    </div>
);

export default function FinishCard({ race, onDismiss }: FinishCardProps) {
  const raceCategoryUpper = race.raceCategory?.toUpperCase() || '';
  const distanceKm = 
      raceCategoryUpper.includes('113') ? 113 : 
      raceCategoryUpper.includes('OLYMPIC') ? 51.5 : 
      raceCategoryUpper.includes('SPRINT') ? 25.75 : 
      null;
  
  const overallPaceSecondsPerKm = race.chipTime && distanceKm ? hmsToSeconds(race.chipTime) / distanceKm : 0;
  
  return (
    <Card className="w-full max-w-2xl mx-auto shadow-2xl rounded-2xl overflow-hidden border-2 border-green-500 bg-gradient-to-br from-green-50 via-white to-blue-50">
        <CardHeader className="text-center p-6 bg-green-100/50">
            <Award className="h-16 w-16 text-green-600 mx-auto mb-3" />
            <CardTitle className="text-3xl font-extrabold text-green-700">Congratulations, {race.name}!</CardTitle>
            <CardDescription className="text-lg text-muted-foreground mt-1">
                You have successfully finished the <strong>{race.raceCategory}</strong>!
            </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div><p className="font-bold text-lg text-primary">{race.bibNumber}</p><p className="text-xs text-muted-foreground">BIB No.</p></div>
                <div><p className="font-bold text-lg">{race.category || 'N/A'}</p><p className="text-xs text-muted-foreground">Age Group</p></div>
                <div><p className="font-bold text-lg">{race.gender}</p><p className="text-xs text-muted-foreground">Gender</p></div>
                <div><p className="font-bold text-lg">{race.raceCategory || 'N/A'}</p><p className="text-xs text-muted-foreground">Category</p></div>
            </div>

            <Separator />

            <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">Finish Time</p>
                <p className="text-5xl font-bold tracking-tighter text-primary">{formatSecondsToHMS(hmsToSeconds(race.chipTime))}</p>
            </div>
             {overallPaceSecondsPerKm > 0 && (
                <div className="text-center space-y-1">
                    <p className="text-sm text-muted-foreground">Overall Pace</p>
                    <p className="text-2xl font-semibold text-muted-foreground">{formatSecondsToHMS(overallPaceSecondsPerKm)}/km</p>
                </div>
             )}

            <Card className="bg-background/50">
              <CardHeader className="p-3">
                <CardTitle className="text-center text-lg text-primary">Your Ranks</CardTitle>
              </CardHeader>
              <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                  <div><p className="text-sm text-muted-foreground">Overall Rank</p><p className="text-2xl font-bold">{race.oRank || 'N/A'}{getOrdinal(Number(race.oRank))}</p></div>
                  <div><p className="text-sm text-muted-foreground">Gender Rank</p><p className="text-2xl font-bold">{race.gRank || 'N/A'}{getOrdinal(Number(race.gRank))}</p></div>
                  <div><p className="text-sm text-muted-foreground">Category Rank</p><p className="text-2xl font-bold">{race.cRank || 'N/A'}{getOrdinal(Number(race.cRank))}</p></div>
              </CardContent>
            </Card>
            
            <div>
                 <h4 className="text-md font-semibold mb-2 text-center text-primary">Your Splits</h4>
                 <div className="text-sm space-y-1">
                    {race.swim && <DetailRow icon={Waves} label="Swim" value={formatSecondsToHMS(hmsToSeconds(race.swim))} />}
                    {race.run1 && <DetailRow icon={Footprints} label="Run 1" value={formatSecondsToHMS(hmsToSeconds(race.run1))} />}
                    {race.t1 && <DetailRow icon={ChevronsRight} label="T1" value={formatSecondsToHMS(hmsToSeconds(race.t1))} />}
                    {race.bike && <DetailRow icon={Bike} label="Bike" value={formatSecondsToHMS(hmsToSeconds(race.bike))} />}
                    {race.t2 && <DetailRow icon={ChevronsRight} label="T2" value={formatSecondsToHMS(hmsToSeconds(race.t2))} />}
                    {race.run && <DetailRow icon={Footprints} label="Run" value={formatSecondsToHMS(hmsToSeconds(race.run))} />}
                    {race.run2 && <DetailRow icon={Footprints} label="Run 2" value={formatSecondsToHMS(hmsToSeconds(race.run2))} />}
                    <DetailRow icon={Flag} label="Finish" value={formatSecondsToHMS(hmsToSeconds(race.chipTime))} valueClass="text-primary font-bold" />
                 </div>
            </div>

        </CardContent>
        <CardFooter>
            <Button onClick={onDismiss} className="w-full">
                <CheckCircle2 className="mr-2 h-4 w-4" /> Great, Thanks!
            </Button>
        </CardFooter>
    </Card>
  );
}
