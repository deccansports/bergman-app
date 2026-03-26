import { RaceResult } from './results';

export type AthleteTier = 'Bergman Athlete';

export interface AthleteTierStats {
  name: string;
  mobile: string;
  points: number;
  tier: AthleteTier;
  progress: number;
  total_races: number;
  badges: string[];
  last_updated: string;
}

export interface DashboardApiResponse {
  success: boolean;
  message?: string;
  data?: AthleteTierStats & {
    leaderboard_rank: number;
    recent_results: Partial<RaceResult>[];
  };
}
