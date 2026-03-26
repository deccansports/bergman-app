// functions/src/live/evaluateAthleteState.ts
export function evaluateAthleteState(
  currentLeg: string,
  splitsCount: number,
  cutoffBreached: boolean
) {
  if (cutoffBreached) return 'DNF';
  if (currentLeg === 'FINISH' || currentLeg === 'FINISHED') return 'Finished';
  if (splitsCount === 0) return 'Not Started';
  return 'On Course';
}
