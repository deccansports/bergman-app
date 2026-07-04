/**
 * Relay Team Timing Utilities
 * Handles bib detection and timing logic for relay teams
 */

export type RelayRole = 'swim' | 'bike' | 'run';

/**
 * Extract relay team information from bib.
 * Format: 101S (team 101, swim), 101B (bike), 101R (run)
 * Legacy format also supported: R101-S, R101-B, R101-R
 */
export function parseRelayBib(bib: string): {
  isRelay: boolean;
  teamBib?: string;
  role?: RelayRole;
  rawBib: string;
} {
  // New format: 101S, 101B, 101R
  const newRelayRegex = /^(\d+)([SBR])$/i;
  // Legacy format: R101-S, R101-B, R101-R
  const legacyRelayRegex = /^R(\d+)-([SBR])$/i;

  const newMatch = bib.match(newRelayRegex);
  const legacyMatch = !newMatch ? bib.match(legacyRelayRegex) : null;
  const match = newMatch || legacyMatch;

  if (match) {
    const teamNum = match[1];
    const roleChar = match[2].toUpperCase();

    let role: RelayRole;
    switch (roleChar) {
      case 'S':
        role = 'swim';
        break;
      case 'B':
        role = 'bike';
        break;
      case 'R':
        role = 'run';
        break;
      default:
        return { isRelay: false, rawBib: bib };
    }

    return {
      isRelay: true,
      teamBib: teamNum, // e.g. "101"
      role,
      rawBib: bib,
    };
  }

  return { isRelay: false, rawBib: bib };
}

/**
 * Get role label from role name
 */
export function getRoleLabel(role: RelayRole): string {
  const labels: Record<RelayRole, string> = {
    swim: '🏊 Swim',
    bike: '🚴 Bike',
    run: '🏃 Run',
  };
  return labels[role] || role;
}

/**
 * Get segment name for relay role
 * Maps role to timing segment (e.g., 'swim' -> 'SWIM', 'bike' -> 'BIKE', 'run' -> 'RUN')
 */
export function roleToSegment(role: RelayRole): string {
  return role.toUpperCase();
}

/**
 * Calculate relay team total time from individual leg times
 * Includes transitions (T1, T2)
 */
export function calculateRelayTeamTime(legTimes: {
  swim?: number;
  t1?: number;
  bike?: number;
  t2?: number;
  run?: number;
}): number {
  return (
    (legTimes.swim || 0) +
    (legTimes.t1 || 0) +
    (legTimes.bike || 0) +
    (legTimes.t2 || 0) +
    (legTimes.run || 0)
  );
}

/**
 * Determine if a bib belongs to a relay team
 */
export function isRelayBib(bib: string): boolean {
  return parseRelayBib(bib).isRelay;
}

/**
 * Get all bibs for a relay team.
 * Input: team number as string, e.g. "101"
 * Output: { swim: "101S", bike: "101B", run: "101R" }
 */
export function getRelayTeamBibs(teamBib: string): {
  swim: string;
  bike: string;
  run: string;
} {
  // Strip any existing suffix (S/B/R) or legacy R-prefix and dash
  const cleanTeamBib = teamBib
    .replace(/^R/i, '')     // remove leading R (legacy "R101" → "101")
    .replace(/-[SBR]$/i, '') // remove legacy dash-suffix ("101-S" → "101")
    .replace(/[SBR]$/i, ''); // remove new suffix ("101S" → "101")

  return {
    swim: `${cleanTeamBib}S`,
    bike: `${cleanTeamBib}B`,
    run: `${cleanTeamBib}R`,
  };
}
