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

  if (timeRange <= 0 || pointsRange < 0) { // Should not happen with valid brackets
    return bracket.pointsAtEnd; // Default to lower points if bracket is invalid
  }

  const timeProportion = (athleteTimeSeconds - bracket.timeStartSeconds) / timeRange;
  const calculatedPoints = bracket.pointsAtStart - (timeProportion * pointsRange);

  return Math.round(calculatedPoints);
}

/**
 * Calculates points based on chip time and race category using predefined time brackets.
 * @param athleteChipTimeSeconds The athlete's chip time in seconds.
 * @param raceCategoryString The category of the race (e.g., "Bergman 113 Triathlon").
 * @returns The calculated points.
 */
function calculatePoints(athleteChipTimeSeconds: number, raceCategoryString?: string): number {
  console.log(`[pointsCalculator.calculatePoints] Inputs - Category: ${raceCategoryString}, Athlete Time (s): ${athleteChipTimeSeconds}`);

  if (isNaN(athleteChipTimeSeconds) || athleteChipTimeSeconds <= 0 || athleteChipTimeSeconds === Infinity) {
    console.warn(`[pointsCalculator.calculatePoints] Invalid athleteChipTimeSeconds (${athleteChipTimeSeconds}). Awarding 0 points.`);
    return 0;
  }

  const category = typeof raceCategoryString === 'string' ? raceCategoryString.trim().toUpperCase() : 'UNKNOWN';

  let brackets: TimePointBracket[] = [];
  let pointsForFasterThanBrackets = 0;
  let pointsForSlowerThanBrackets = 0;

  // Define brackets ONLY for Triathlon events as per new policy
  if (category.includes('BERGMAN 113 TRIATHLON') || category.includes('BERGMAN 102 TRIATHLON')) {
    pointsForFasterThanBrackets = 1500;
    pointsForSlowerThanBrackets = 50; // Points for finishing slower than the last bracket
    brackets = [
      { timeStartSeconds: hmsToSeconds("4:00:00"), timeEndSeconds: hmsToSeconds("4:30:00"), pointsAtStart: 1500, pointsAtEnd: 1350 },
      { timeStartSeconds: hmsToSeconds("4:30:01"), timeEndSeconds: hmsToSeconds("6:30:00"), pointsAtStart: 1349, pointsAtEnd: 1200 },
      { timeStartSeconds: hmsToSeconds("6:30:01"), timeEndSeconds: hmsToSeconds("7:30:00"), pointsAtStart: 1199, pointsAtEnd: 1050 },
      { timeStartSeconds: hmsToSeconds("7:30:01"), timeEndSeconds: hmsToSeconds("9:30:00"), pointsAtStart: 1049, pointsAtEnd: 50 },
    ];
  } else if (category.includes('BERGMAN OLYMPIC TRIATHLON')) {
    pointsForFasterThanBrackets = 1000;
    pointsForSlowerThanBrackets = 10;
    brackets = [
      { timeStartSeconds: hmsToSeconds("1:40:00"), timeEndSeconds: hmsToSeconds("2:20:00"), pointsAtStart: 1000, pointsAtEnd: 800 },
      { timeStartSeconds: hmsToSeconds("2:20:01"), timeEndSeconds: hmsToSeconds("3:00:00"), pointsAtStart: 799, pointsAtEnd: 600 },
      { timeStartSeconds: hmsToSeconds("3:00:01"), timeEndSeconds: hmsToSeconds("4:00:00"), pointsAtStart: 599, pointsAtEnd: 300 },
      { timeStartSeconds: hmsToSeconds("4:00:01"), timeEndSeconds: hmsToSeconds("6:30:00"), pointsAtStart: 299, pointsAtEnd: 10 },
    ];
  } else {
    // Non-triathlon events or unrecognized categories get 0 points for ranking purposes
    console.log(`[pointsCalculator.calculatePoints] Category '${category}' is not an eligible Triathlon event for points. Awarding 0 points.`);
    return 0;
  }

  // Check if faster than the first bracket
  if (athleteChipTimeSeconds < brackets[0].timeStartSeconds) {
    console.log(`[pointsCalculator.calculatePoints] Athlete faster than fastest bracket for ${category}. Awarding ${pointsForFasterThanBrackets} points.`);
    return pointsForFasterThanBrackets;
  }

  for (const bracket of brackets) {
    if (athleteChipTimeSeconds >= bracket.timeStartSeconds && athleteChipTimeSeconds <= bracket.timeEndSeconds) {
      const points = interpolatePoints(athleteChipTimeSeconds, bracket);
      console.log(`[pointsCalculator.calculatePoints] Athlete in bracket for ${category} (${bracket.timeStartSeconds}-${bracket.timeEndSeconds}s). Calculated points: ${points}`);
      return points;
    }
  }

  // Check if slower than the last bracket
  if (athleteChipTimeSeconds > brackets[brackets.length - 1].timeEndSeconds) {
    console.log(`[pointsCalculator.calculatePoints] Athlete slower than slowest bracket for ${category}. Awarding ${pointsForSlowerThanBrackets} points.`);
    return pointsForSlowerThanBrackets;
  }
  
  // Fallback if no brackets matched but it's a known category
  console.warn(`[pointsCalculator.calculatePoints] Athlete time did not fit any bracket for ${category}. Awarding default minimum.`);
  return pointsForSlowerThanBrackets > 0 ? pointsForSlowerThanBrackets : 1;

}

/**
 * Wrapper function to calculate points for a given race result using the bracket system.
 * @param race The RaceResult object.
 * @returns The calculated points (number), or 0 if the race was not 'Finished' or time was invalid.
 */
export function calculatePointsForResult(race: RaceResult): number {
  const raceNameForLog = `Athlete: ${race.name || 'N/A'}, Race: ${race.raceCategory || 'N/A'} on ${race.raceDate || 'N/A'}`;
  
  if (normalizeStatus(race.status) !== 'Finished') {
    return 0;
  }

  const athleteChipTimeSeconds = hmsToSeconds(race.chipTime);
  if (isNaN(athleteChipTimeSeconds) || athleteChipTimeSeconds <= 0 || athleteChipTimeSeconds === Infinity) {
    console.warn(`[pointsCalculator.calculatePointsForResult] Invalid athlete chip time ('${race.chipTime}' -> ${athleteChipTimeSeconds}s) for finished race ${raceNameForLog}. Awarding 0 points.`);
    return 0;
  }

  return calculatePoints(athleteChipTimeSeconds, race.raceCategory);
}
