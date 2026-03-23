// src/lib/pointsCalculator.ts
import { hmsToSeconds } from '@/lib/utils';
import { normalizeStatus } from '@/lib/utils';
import type { RaceResult } from './types';

interface TimePointBracket {
  timeStartSeconds: number; // Fastest time for this bracket (inclusive)
  timeEndSeconds: number;   // Slowest time for this bracket (inclusive)
  pointsAtStart: number;    // Points for achieving timeStartSeconds
  pointsAtEnd: number;      // Points for achieving timeEndSeconds
}

/**
 * Interpolates points linearly within a given time bracket.
 */
function interpolatePoints(
  athleteTimeSeconds: number,
  bracket: TimePointBracket
): number {
  if (athleteTimeSeconds <= bracket.timeStartSeconds) {
    return bracket.pointsAtStart;
  }
  if (athleteTimeSeconds >= bracket.timeEndSeconds) {
    return bracket.pointsAtEnd;
  }

  const timeRange = bracket.timeEndSeconds - bracket.timeStartSeconds;
  const pointsRange = bracket.pointsAtStart - bracket.pointsAtEnd; // Higher points for faster time

  if (timeRange <= 0 || pointsRange < 0) { 
    return bracket.pointsAtEnd; 
  }

  const timeProportion = (athleteTimeSeconds - bracket.timeStartSeconds) / timeRange;
  const calculatedPoints = bracket.pointsAtStart - (timeProportion * pointsRange);

  return Math.round(calculatedPoints);
}

/**
 * NEW: Calculates points for Swimathon events based on Category Rank, Multipliers, and Bonuses.
 */
function calculateSwimathonPoints(race: RaceResult): number {
    const category = (race.raceCategory || race.ticketName || '').toUpperCase();
    const cRank = parseInt(race.cRank || '0', 10);
    const oRank = parseInt(race.oRank || '0', 10);

    if (isNaN(cRank) || cRank <= 0) return 0;

    // 1. Base Points by Category Rank
    let basePoints = 30; // Finish fallback
    if (cRank === 1) basePoints = 100;
    else if (cRank === 2) basePoints = 90;
    else if (cRank === 3) basePoints = 85;
    else if (cRank === 4) basePoints = 80;
    else if (cRank === 5) basePoints = 75;
    else if (cRank === 6) basePoints = 70;
    else if (cRank === 7) basePoints = 65;
    else if (cRank === 8) basePoints = 60;
    else if (cRank === 9) basePoints = 55;
    else if (cRank === 10) basePoints = 50;
    else if (cRank <= 20) basePoints = 45;
    else if (cRank <= 30) basePoints = 40;
    else if (cRank <= 50) basePoints = 35;

    // 2. Distance Multipliers
    let multiplier = 1.0;
    if (category.includes('500M') || category.includes('KIDS')) multiplier = 0.6;
    else if (category.includes('2 KM') || category.includes('2KM')) multiplier = 1.3;
    else if (category.includes('4 KM') || category.includes('4KM')) multiplier = 1.6;
    // default is 1.0 for 1KM

    let finalPoints = basePoints * multiplier;

    // 3. Overall Podium Bonus
    if (oRank === 1) finalPoints += 40;
    else if (oRank === 2) finalPoints += 30;
    else if (oRank === 3) finalPoints += 20;

    // 4. Cap at 200 as per latest policy
    return Math.min(200, Math.round(finalPoints));
}

/**
 * Calculates points based on chip time and race category using predefined time brackets.
 */
function calculateTriathlonPoints(athleteChipTimeSeconds: number, raceCategoryString?: string): number {
  const category = typeof raceCategoryString === 'string' ? raceCategoryString.trim().toUpperCase() : 'UNKNOWN';

  let brackets: TimePointBracket[] = [];
  let pointsForFasterThanBrackets = 0;
  let pointsForSlowerThanBrackets = 0;

  if (category.includes('113') || category.includes('102')) {
    pointsForFasterThanBrackets = 1500;
    pointsForSlowerThanBrackets = 50; 
    brackets = [
      { timeStartSeconds: hmsToSeconds("4:00:00"), timeEndSeconds: hmsToSeconds("4:30:00"), pointsAtStart: 1500, pointsAtEnd: 1350 },
      { timeStartSeconds: hmsToSeconds("4:30:01"), timeEndSeconds: hmsToSeconds("6:30:00"), pointsAtStart: 1349, pointsAtEnd: 1200 },
      { timeStartSeconds: hmsToSeconds("6:30:01"), timeEndSeconds: hmsToSeconds("7:30:00"), pointsAtStart: 1199, pointsAtEnd: 1050 },
      { timeStartSeconds: hmsToSeconds("7:30:01"), timeEndSeconds: hmsToSeconds("9:30:00"), pointsAtStart: 1049, pointsAtEnd: 50 },
    ];
  } else if (category.includes('OLYMPIC')) {
    pointsForFasterThanBrackets = 1000;
    pointsForSlowerThanBrackets = 10;
    brackets = [
      { timeStartSeconds: hmsToSeconds("1:40:00"), timeEndSeconds: hmsToSeconds("2:20:00"), pointsAtStart: 1000, pointsAtEnd: 800 },
      { timeStartSeconds: hmsToSeconds("2:20:01"), timeEndSeconds: hmsToSeconds("3:00:00"), pointsAtStart: 799, pointsAtEnd: 600 },
      { timeStartSeconds: hmsToSeconds("3:00:01"), timeEndSeconds: hmsToSeconds("4:00:00"), pointsAtStart: 599, pointsAtEnd: 300 },
      { timeStartSeconds: hmsToSeconds("4:00:01"), timeEndSeconds: hmsToSeconds("6:30:00"), pointsAtStart: 299, pointsAtEnd: 10 },
    ];
  } else {
    return 0;
  }

  if (brackets.length > 0 && athleteChipTimeSeconds < brackets[0].timeStartSeconds) {
    return pointsForFasterThanBrackets;
  }

  for (const bracket of brackets) {
    if (athleteChipTimeSeconds >= bracket.timeStartSeconds && athleteChipTimeSeconds <= bracket.timeEndSeconds) {
      return interpolatePoints(athleteChipTimeSeconds, bracket);
    }
  }

  if (brackets.length > 0 && athleteChipTimeSeconds > brackets[brackets.length - 1].timeEndSeconds) {
    return pointsForSlowerThanBrackets;
  }
  
  return pointsForSlowerThanBrackets > 0 ? pointsForSlowerThanBrackets : 1;
}

/**
 * Wrapper function to calculate points for a given race result.
 */
export function calculatePointsForResult(race: RaceResult): number {
  if (normalizeStatus(race.status) !== 'Finished') {
    return 0;
  }

  const category = (race.raceCategory || race.ticketName || '').toUpperCase();
  if (category.includes('SWIMATHON') || category.includes('SWIMMING') || race.eventCategory === 'SWIMMING') {
      return calculateSwimathonPoints(race);
  }

  const athleteChipTimeSeconds = hmsToSeconds(race.chipTime);
  if (isNaN(athleteChipTimeSeconds) || athleteChipTimeSeconds <= 0 || athleteChipTimeSeconds === Infinity) {
    return 0;
  }

  return calculateTriathlonPoints(athleteChipTimeSeconds, race.raceCategory);
}
