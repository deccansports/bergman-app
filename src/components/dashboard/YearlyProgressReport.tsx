
// src/components/dashboard/YearlyProgressReport.tsx
"use client";

import * as React from "react";
import { useMemo, useState, useCallback }
from "react";
import type { RaceResult, User } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowUp,
  TrendingUp,
  CalendarDays,
  ListFilter,
  CheckCircle2,
  XCircle,
  Repeat,
  Rocket,
  Star, // For PB or significant achievements
  Waves, // Swim
  Bike as BikeIcon, // Bike
  Footprints, // Run1 / Run2
  PersonStanding, // Run
  BarChart3, // Overall Rank
  Users as UsersIcon, // Age Group Rank
  Info,
  HelpCircle,
  CheckSquare,
  Layers3,
  FilterX,
  ChevronsUpDown,
  Hourglass,
  Goal
} from "lucide-react";
import { hmsToSeconds, formatSecondsToHMS, getOrdinal, isTriathlonEvent, isDuathlonEvent, normalizeStatus } from '@/lib/utils';
import Link from 'next/link';
import { calculatePointsForResult } from '@/lib/pointsCalculator';
import { cn } from "@/lib/utils"; // Import the cn utility function


interface MetricChange {
  value?: string;
  improved: boolean;
  icon?: React.ElementType;
  message?: string;
  isPB: boolean;
}

interface YearlyProgressReportProps {
  currentUserRaces: RaceResult[];
  currentUser: User | null;
}

interface ProcessedYearData {
  year: string;
  avgChipTimeSeconds?: number;
  racesFinished: number;
  racesDNF: number;
  bestSwimSeconds?: number;
  bestBikeSeconds?: number;
  bestRunSeconds?: number; // For Tri
  bestRun1Seconds?: number; // For Dua
  bestRun2Seconds?: number; // For Dua
  bestOverallRank?: number;
  bestAgeGroupRank?: number;
}

interface ComparisonYearData extends ProcessedYearData {
  changeAvgChipTime?: MetricChange;
  changeRacesFinished?: MetricChange;
  changeRacesDNF?: MetricChange;
  changeBestSwim?: MetricChange;
  changeBestBike?: MetricChange;
  changeBestRun?: MetricChange;
  changeBestRun1?: MetricChange;
  changeBestRun2?: MetricChange;
  changeBestOverallRank?: MetricChange;
  changeBestAgeGroupRank?: MetricChange;
}


const MIN_YEAR_FOR_REPORT = 2022;


export function YearlyProgressReport({
  currentUserRaces = [],
  currentUser,
}: YearlyProgressReportProps) {
  const [selectedSpecificRaceCategory, setSelectedSpecificRaceCategory] = useState<string | null>(null);

  const safeCurrentUserRaces = useMemo(() => Array.isArray(currentUserRaces) ? currentUserRaces : [], [currentUserRaces]);

  const availableSpecificRaceCategories = useMemo((): string[] => {
    if (safeCurrentUserRaces.length === 0) return [];
    const categories = new Set<string>();
    safeCurrentUserRaces.forEach(race => {
      const categoryName = race.raceCategory?.trim(); // Trim the category name
      if (categoryName && categoryName !== "" && normalizeStatus(race.status) === 'Finished') { // Ensure it's not an empty string
        categories.add(categoryName);
      }
    });
    return Array.from(categories).sort();
  }, [safeCurrentUserRaces]);

  React.useEffect(() => {
    if (!selectedSpecificRaceCategory && availableSpecificRaceCategories.length > 0) {
      setSelectedSpecificRaceCategory(availableSpecificRaceCategories[0]);
    } else if (availableSpecificRaceCategories.length === 0 && selectedSpecificRaceCategory) {
      // If categories become empty (e.g. data changes) and one was selected, clear it
      setSelectedSpecificRaceCategory(null);
    }
  }, [availableSpecificRaceCategories, selectedSpecificRaceCategory]);

  const historicalDataForSelectedCategory = useMemo((): ComparisonYearData[] => {
    if (safeCurrentUserRaces.length === 0 || !selectedSpecificRaceCategory) {
        return [];
    }

    const racesOfSelectedCategory = safeCurrentUserRaces.filter(
      race => race.raceCategory === selectedSpecificRaceCategory
    );

    if (racesOfSelectedCategory.length === 0) return [];

    const yearsData: Record<string, {
        chipTimesSeconds: number[];
        finishedCount: number;
        dnfCount: number;
        swimTimesSeconds: number[];
        bikeTimesSeconds: number[];
        runTimesSeconds: number[]; // Tri
        run1TimesSeconds: number[]; // Dua
        run2TimesSeconds: number[]; // Dua
        overallRanksFromSheet: number[];
        ageGroupRanksFromSheet: number[];
        points: number;
    }> = {};

    racesOfSelectedCategory.forEach(race => {
      if (race.raceDate) {
        const year = new Date(race.raceDate).getFullYear().toString();
        if (parseInt(year) < MIN_YEAR_FOR_REPORT) return;

        if (!yearsData[year]) {
          yearsData[year] = {
            chipTimesSeconds: [], finishedCount: 0, dnfCount: 0,
            swimTimesSeconds: [], bikeTimesSeconds: [], runTimesSeconds: [],
            run1TimesSeconds: [], run2TimesSeconds: [],
            overallRanksFromSheet: [], ageGroupRanksFromSheet: [],
            points: 0,
          };
        }

        const status = normalizeStatus(race.status);
        if (status === "Finished") {
          yearsData[year].finishedCount++;
          const chipSec = hmsToSeconds(race.chipTime);
          if (chipSec !== Infinity && chipSec > 0) yearsData[year].chipTimesSeconds.push(chipSec);

          yearsData[year].points += calculatePointsForResult(race);


          const swimSec = hmsToSeconds(race.swim);
          if (swimSec !== Infinity && swimSec > 0) yearsData[year].swimTimesSeconds.push(swimSec);
          const bikeSec = hmsToSeconds(race.bike);
          if (bikeSec !== Infinity && bikeSec > 0) yearsData[year].bikeTimesSeconds.push(bikeSec);
          const runSec = hmsToSeconds(race.run);
          if (runSec !== Infinity && runSec > 0) yearsData[year].runTimesSeconds.push(runSec);
          const run1Sec = hmsToSeconds(race.run1);
          if (run1Sec !== Infinity && run1Sec > 0) yearsData[year].run1TimesSeconds.push(run1Sec);
          const run2Sec = hmsToSeconds(race.run2);
          if (run2Sec !== Infinity && run2Sec > 0) yearsData[year].run2TimesSeconds.push(run2Sec);

          if (race.oRank) {
            const oRankNum = parseInt(race.oRank, 10);
            if (!isNaN(oRankNum) && oRankNum > 0) yearsData[year].overallRanksFromSheet.push(oRankNum);
          }
          if (race.cRank) { // cRank is Age Group Rank from sheet
            const cRankNum = parseInt(race.cRank, 10);
            if (!isNaN(cRankNum) && cRankNum > 0) yearsData[year].ageGroupRanksFromSheet.push(cRankNum);
          }
        } else if (status === "DNF") {
          yearsData[year].dnfCount++;
        }
      }
    });

    const sortedYears = Object.keys(yearsData).sort((a, b) => parseInt(a) - parseInt(b));
    if (sortedYears.length === 0) return [];

    const processed: ComparisonYearData[] = [];
    for (let i = 0; i < sortedYears.length; i++) {
      const year = sortedYears[i];
      const currentYearStats = yearsData[year];
      const previousYear = i > 0 ? sortedYears[i - 1] : null;
      const previousYearStats = previousYear ? yearsData[previousYear] : null;

      const avgChipTime = currentYearStats.chipTimesSeconds.length > 0
        ? currentYearStats.chipTimesSeconds.reduce((a, b) => a + b, 0) / currentYearStats.chipTimesSeconds.length
        : undefined;

      const bestORank = currentYearStats.overallRanksFromSheet.length > 0 ? Math.min(...currentYearStats.overallRanksFromSheet) : undefined;
      const bestAGRank = currentYearStats.ageGroupRanksFromSheet.length > 0 ? Math.min(...currentYearStats.ageGroupRanksFromSheet) : undefined;

      const currentData: ComparisonYearData = {
        year,
        avgChipTimeSeconds: avgChipTime,
        racesFinished: currentYearStats.finishedCount,
        racesDNF: currentYearStats.dnfCount,
        bestSwimSeconds: currentYearStats.swimTimesSeconds.length > 0 ? Math.min(...currentYearStats.swimTimesSeconds) : undefined,
        bestBikeSeconds: currentYearStats.bikeTimesSeconds.length > 0 ? Math.min(...currentYearStats.bikeTimesSeconds) : undefined,
        bestRunSeconds: currentYearStats.runTimesSeconds.length > 0 ? Math.min(...currentYearStats.runTimesSeconds) : undefined,
        bestRun1Seconds: currentYearStats.run1TimesSeconds.length > 0 ? Math.min(...currentYearStats.run1TimesSeconds) : undefined,
        bestRun2Seconds: currentYearStats.run2TimesSeconds.length > 0 ? Math.min(...currentYearStats.run2TimesSeconds) : undefined,
        bestOverallRank: bestORank,
        bestAgeGroupRank: bestAGRank,
      };

      if (previousYearStats) {
        const prevAvgChipTime = previousYearStats.chipTimesSeconds.length > 0
            ? previousYearStats.chipTimesSeconds.reduce((a,b) => a + b, 0) / previousYearStats.chipTimesSeconds.length
            : undefined;
        const prevBestSwim = previousYearStats.swimTimesSeconds.length > 0 ? Math.min(...previousYearStats.swimTimesSeconds) : undefined;
        const prevBestBike = previousYearStats.bikeTimesSeconds.length > 0 ? Math.min(...previousYearStats.bikeTimesSeconds) : undefined;
        const prevBestRun = previousYearStats.runTimesSeconds.length > 0 ? Math.min(...previousYearStats.runTimesSeconds) : undefined;
        const prevBestRun1 = previousYearStats.run1TimesSeconds.length > 0 ? Math.min(...previousYearStats.run1TimesSeconds) : undefined;
        const prevBestRun2 = previousYearStats.run2TimesSeconds.length > 0 ? Math.min(...previousYearStats.run2TimesSeconds) : undefined;
        const prevBestORank = previousYearStats.overallRanksFromSheet.length > 0 ? Math.min(...previousYearStats.overallRanksFromSheet) : undefined;
        const prevBestAGRank = previousYearStats.ageGroupRanksFromSheet.length > 0 ? Math.min(...previousYearStats.ageGroupRanksFromSheet) : undefined;


        const calculateChange = (currentVal?: number, prevVal?: number, lowerIsBetter = false, isTime = false): MetricChange | undefined => {
          if (currentVal === undefined || prevVal === undefined || isNaN(currentVal) || isNaN(prevVal)) return undefined;
          const diff = currentVal - prevVal;
          if (diff === 0) return { value: isTime ? "0s" : "No Change", improved: true, isPB: false, message: isTime ? "Consistent!" : "Steady!" };

          const improved = lowerIsBetter ? diff < 0 : diff > 0;
          const valueStr = isTime ? `${diff < 0 ? "-" : "+"}${formatSecondsToHMS(Math.abs(diff))}` : `${diff > 0 ? "+" : ""}${diff.toFixed(0)}`;
          let message = "";
          if (isTime) message = improved ? "Faster! Great work!" : "Slower. Keep pushing!";
          else message = improved ? (lowerIsBetter ? "Reduced! Good." : "Improved!") : (lowerIsBetter ? "Increased." : "Declined.");

          return { value: valueStr, improved, icon: improved ? (lowerIsBetter ? ArrowDown : ArrowUp) : (lowerIsBetter ? ArrowUp : ArrowDown), message, isPB: improved && isTime };
        };

        const calculateRankChange = (currentRank?: number, prevRank?: number): MetricChange | undefined => {
            if (currentRank === undefined || prevRank === undefined || isNaN(currentRank) || isNaN(prevRank)) return undefined;
            const diff = currentRank - prevRank; // lower rank is better
            if (diff === 0) return { value: "No Change", improved: true, isPB: false, message: "Rank stable."};
            const improved = diff < 0;
            const valueStr = `${diff < 0 ? "" : "+"}${Math.abs(diff)}`;
            return { value: valueStr, improved, icon: improved ? ArrowUp : ArrowDown, message: improved ? `Rank up by ${Math.abs(diff)}!` : `Rank down by ${Math.abs(diff)}.`, isPB: false };
        };

        currentData.changeAvgChipTime = calculateChange(avgChipTime, prevAvgChipTime, true, true);
        currentData.changeRacesFinished = calculateChange(currentData.racesFinished, previousYearStats.finishedCount, false, false);
        currentData.changeRacesDNF = calculateChange(currentData.racesDNF, previousYearStats.dnfCount, true, false);
        if (currentData.racesDNF === 0 && (previousYearStats.dnfCount > 0 || currentData.changeRacesDNF?.value === "No Change")) {
            currentData.changeRacesDNF = { ...currentData.changeRacesDNF, improved: true, message: "Excellent, 0 DNFs!", icon: CheckCircle2, isPB: false };
        }

        currentData.changeBestSwim = calculateChange(currentData.bestSwimSeconds, prevBestSwim, true, true);
        currentData.changeBestBike = calculateChange(currentData.bestBikeSeconds, prevBestBike, true, true);
        currentData.changeBestRun = calculateChange(currentData.bestRunSeconds, prevBestRun, true, true);
        currentData.changeBestRun1 = calculateChange(currentData.bestRun1Seconds, prevBestRun1, true, true);
        currentData.changeBestRun2 = calculateChange(currentData.bestRun2Seconds, prevBestRun2, true, true);

        currentData.changeBestOverallRank = calculateRankChange(bestORank, prevBestORank);
        currentData.changeBestAgeGroupRank = calculateRankChange(bestAGRank, prevBestAGRank);
      }
      processed.push(currentData);
    }
    return processed.sort((a,b) => parseInt(b.year) - parseInt(a.year));

  }, [safeCurrentUserRaces, selectedSpecificRaceCategory]);

  const isSelectedTri = selectedSpecificRaceCategory ? isTriathlonEvent(selectedSpecificRaceCategory) : false;
  const isSelectedDua = selectedSpecificRaceCategory ? isDuathlonEvent(selectedSpecificRaceCategory) : false;

  const metricsDisplayOrder = [
    { key: 'avgChipTimeSeconds', title: 'Average Chip Time', icon: CalendarDays, changeKey: 'changeAvgChipTime', isTime: true },
    { key: 'racesFinished', title: 'Races Finished', icon: CheckCircle2, changeKey: 'changeRacesFinished', isTime: false },
    { key: 'racesDNF', title: 'Races DNF', icon: XCircle, changeKey: 'changeRacesDNF', isTime: false },
    // Conditional segment times based on selected category type
    ...(isSelectedTri ? [
        { key: 'bestSwimSeconds', title: 'Best Swim', icon: Waves, changeKey: 'changeBestSwim', isTime: true },
        { key: 'bestBikeSeconds', title: 'Best Bike', icon: BikeIcon, changeKey: 'changeBestBike', isTime: true },
        { key: 'bestRunSeconds', title: 'Best Run', icon: PersonStanding, changeKey: 'changeBestRun', isTime: true },
    ] : []),
    ...(isSelectedDua ? [
        { key: 'bestRun1Seconds', title: 'Best Run 1', icon: Footprints, changeKey: 'changeBestRun1', isTime: true },
        { key: 'bestBikeSeconds', title: 'Best Bike', icon: BikeIcon, changeKey: 'changeBestBike', isTime: true },
        { key: 'bestRun2Seconds', title: 'Best Run 2', icon: Footprints, changeKey: 'changeBestRun2', isTime: true },
    ] : []),
    // Common rank metrics
    { key: 'bestAgeGroupRank', title: 'Best Age Group Rank (Sheet)', icon: UsersIcon, changeKey: 'changeBestAgeGroupRank', isTime: false, isRank: true },
    { key: 'bestOverallRank', title: 'Best Overall Rank (Sheet)', icon: BarChart3, changeKey: 'changeBestOverallRank', isTime: false, isRank: true },
  ];

  const displayYears = historicalDataForSelectedCategory.slice(0, 2).reverse();
  
  if (!currentUserRaces || currentUserRaces.length === 0) {
    return (
      <Card className="shadow-xl rounded-xl overflow-hidden border-t-4 border-accent/30">
        <CardHeader className="bg-muted/30">
          <CardTitle className="flex items-center gap-2 text-2xl font-bold"><TrendingUp className="h-7 w-7 text-accent" />Yearly Progress Report</CardTitle>
          <CardDescription>Review your performance summary year by year. No race data found.</CardDescription>
        </CardHeader>
        <CardContent className="p-6 text-center">
            <ListFilter className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No race history found to generate a progress report.</p>
            <p className="text-sm text-muted-foreground">Participate in races to see your progress here!</p>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card className="w-full shadow-xl rounded-xl overflow-hidden border-t-4 border-accent">
      <CardHeader className="bg-accent/5">
        <CardTitle className="flex items-center gap-2 text-2xl font-bold"><TrendingUp className="h-7 w-7 text-accent" />Yearly Progress Report</CardTitle>
        <CardDescription>Compare your performance year-over-year for a specific race category. PB (🔥) indicates a personal best against the previous compared year for that segment.</CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="mb-4">
          <label htmlFor="raceCategorySelectProgress" className="block text-sm font-medium text-muted-foreground mb-1">Select Race Category to Analyze:</label>
          <Select
            value={selectedSpecificRaceCategory || ""}
            onValueChange={(value) => setSelectedSpecificRaceCategory(value === "" || value === "--no-categories-placeholder--" ? null : value)}
          >
            <SelectTrigger id="raceCategorySelectProgress" className="w-full md:w-1/2">
              <SelectValue placeholder="Choose a race category..." />
            </SelectTrigger>
            <SelectContent>
              {availableSpecificRaceCategories.length > 0 ? (
                availableSpecificRaceCategories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))
              ) : (
                <SelectItem value="--no-categories-placeholder--" disabled>No race categories with finished races found</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {!selectedSpecificRaceCategory ? (
             <div className="text-center py-6">
                <ListFilter className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Please select a race category to view your progress report.</p>
            </div>
        ) : historicalDataForSelectedCategory.length === 0 && selectedSpecificRaceCategory ? (
             <div className="text-center py-6">
                <ListFilter className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No data found for &quot;{selectedSpecificRaceCategory}&quot;.</p>
            </div>
        ): historicalDataForSelectedCategory.length < 2 && selectedSpecificRaceCategory ? (
             <div className="text-center py-6">
                <ListFilter className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                    Need at least two years of race data in &quot;{selectedSpecificRaceCategory}&quot; to show a year-over-year comparison.
                    So far, you have data for {historicalDataForSelectedCategory.length} year(s) in this category. Keep racing!
                </p>
            </div>
        ) : displayYears.length === 2 && (
          <div className="overflow-x-auto">
            <h3 className="text-xl font-semibold my-4 text-primary text-center">
                Performance Summary for &quot;{selectedSpecificRaceCategory}&quot;: {displayYears[0]?.year} vs {displayYears[1]?.year}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-center">{displayYears[0]?.year}</TableHead>
                  <TableHead className="text-center">{displayYears[1]?.year}</TableHead>
                  <TableHead className="text-center">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricsDisplayOrder.map((metric) => {
                  const dataYear1 = displayYears[0]?.[metric.key as keyof ProcessedYearData];
                  const dataYear2 = displayYears[1]?.[metric.key as keyof ProcessedYearData];
                  const changeData = displayYears[1]?.[metric.changeKey as keyof ComparisonYearData];

                  let displayValue1 = "N/A";
                  if (dataYear1 !== undefined) {
                    if (metric.isTime) displayValue1 = formatSecondsToHMS(dataYear1 as number);
                    else if (metric.isRank) displayValue1 = `${dataYear1}${getOrdinal(dataYear1 as number)}`;
                    else displayValue1 = String(dataYear1);
                  }

                  let displayValue2 = "N/A";
                   if (dataYear2 !== undefined) {
                    if (metric.isTime) displayValue2 = formatSecondsToHMS(dataYear2 as number);
                    else if (metric.isRank) displayValue2 = `${dataYear2}${getOrdinal(dataYear2 as number)}`;
                    else displayValue2 = String(dataYear2);
                  }

                  if (metric.key === 'bestSwimSeconds' && !isSelectedTri) return null;
                  if (metric.key === 'bestRunSeconds' && !isSelectedTri) return null;
                  if (metric.key === 'bestRun1Seconds' && !isSelectedDua) return null;
                  if (metric.key === 'bestRun2Seconds' && !isSelectedDua) return null;
                  if (metric.key === 'bestBikeSeconds' && !isSelectedTri && !isSelectedDua && selectedSpecificRaceCategory) return null;


                  return (
                    <TableRow key={metric.key}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <metric.icon className="h-5 w-5 text-muted-foreground" />
                          {metric.title}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {displayValue1}
                      </TableCell>
                      <TableCell className="text-center">
                        {displayValue2}
                        {metric.isTime && typeof changeData === 'object' && changeData?.isPB && (
                            <span className="text-xs text-accent ml-1 whitespace-nowrap">🔥 PB!</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {typeof changeData === 'object' && changeData?.value !== undefined ? (
                          <span className={`flex items-center justify-center gap-1 ${changeData.improved ? "text-green-600" : "text-red-600"}`}>
                            {changeData.icon && <changeData.icon className="h-4 w-4" />}
                            {String(changeData.value)}
                          </span>
                        ) : (
                          "N/A"
                        )}
                         {typeof changeData === 'object' && changeData?.message && <p className="text-xs text-muted-foreground mt-0.5">{changeData.message}</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
             <div className="mt-4 text-xs text-muted-foreground">
                <p><Info className="inline-block h-3.5 w-3.5 mr-1" />&quot;Best Age Group/Overall Rank (Sheet)&quot; is the best rank achieved in the selected category that year, taken directly from race result sheets. Best Segment times are your personal bests for those segments in the selected race category during that year.</p>
                 <p className="mt-1">&quot;🔥 PB!&quot; indicates this year&apos;s segment time is faster than the corresponding segment time from the previous year being compared, for this race category.</p>
             </div>
          </div>
        )}
         <div className="mt-6 text-sm text-muted-foreground">
            <p><Repeat className="inline-block h-4 w-4 text-primary mr-1" /> Data compares your performance in the selected race category across two consecutive years of participation.</p>
        </div>
      </CardContent>
    </Card>
  );
}
