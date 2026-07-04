import { RaceResult } from '../types';
import { AthleteTier, AthleteTierStats } from '../types/athleteTier';
import { normalizeStatus } from '../utils';

function isLongDistance(race: RaceResult): boolean {
  const n = (race.eventName || race.raceCategory || '').toLowerCase();
  return n.includes('bergman') || n.includes('half') || n.includes('113') || n.includes('226') || n.includes('long');
}

export function calculateAthleteTierData(mobile: string, name: string, races: RaceResult[]): AthleteTierStats {
  const finishedRaces = races.filter(r => normalizeStatus(r.status) === 'Finished');
  let points = 0;
  let badges = new Set<string>();

  finishedRaces.forEach(race => {
    // Race completion
    points += 100;
    badges.add('Finisher');

    // Podium
    const oRank = race.ranks?.overall?.rank || parseInt(race.oRank || '0', 10);
    const oTotal = race.ranks?.overall?.total || 1000; // default large if unknown to prevent false top 10%
    if (oRank > 0) {
      if (oRank <= 3) {
        points += 200;
        badges.add('Podium');
      } else if (oRank <= Math.ceil(oTotal * 0.1)) {
        points += 150;
        badges.add('Top 10%');
      }
    }

    // Long distance
    if (isLongDistance(race)) {
      points += 100;
      badges.add('Endurance Mastery');
    }
  });

  // Multiple race bonus
  if (finishedRaces.length > 1) {
    points += 50;
    badges.add('Loyal Athlete');
  }

  let tier: AthleteTier = 'Bergman Athlete';
  let progress = 0;


  return {
    name,
    mobile,
    points,
    tier,
    progress,
    total_races: finishedRaces.length,
    badges: Array.from(badges),
    last_updated: new Date().toISOString()
  };
}
