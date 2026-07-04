// src/lib/types/results.ts

export type EventCategory = 'TRIATHLON' | 'DUATHLON' | 'SWIMMING' | 'OTHER';

export interface Split {
  id?: string;
  uuid?: string;
  splitUuid?: string;
  providerId?: string | null;
  providerCode?: string | null;
  segment: string;
  name?: string;
  label?: string;
  distance: number;
  time: number;
  absoluteTimestamp?: number;
  position?: { lat: number; lng: number };
  rawSplitLabel?: string;
}

export interface RaceResult {
  docId?: string;
  bibNumber: string;
  name: string;
  mobile?: string | null;
  email: string;
  emailLower: string;
  registrationStatus?: string;
  status: 'Finished' | 'DNF' | 'DNS' | 'DNQ' | string;
  statusNormalized?: 'Finished' | 'DNF' | 'DNS' | 'DNQ' | 'Unknown';
  category: string;
  gender: 'Male' | 'Female' | 'Unknown';
  swim?: string | null;
  run1?: string | null;
  t1?: string | null;
  bike?: string | null;
  t2?: string | null;
  run?: string | null;
  run2?: string | null;
  chipTime?: string | null;
  cRank?: string | null;
  oRank?: string | null;
  gRank?: string | null;
  raceCategory: string;
  ticketId?: string | null;
  ticketName?: string | null;
  raceDate: string | null;
  location: string;
  eventCategory?: EventCategory | null;
  athleteEmail?: string;
  raceYear?: number;
  uploadedAt?: string | null;
  backfilledAt?: string | null;
  eventId?: string;
  eventName?: string;
  customSlug?: string | null;
  ranks?: {
    overall?: { rank: number; total: number };
    gender?: { rank: number; total: number };
    ageGroup?: { rank: number; total: number };
  };
  courseProgress?: number;
  clubIdAtRace?: string | null;
  clubNameAtRace?: string | null;
  countryAtRace?: string | null;
  stateAtRace?: string | null;
  cityAtRace?: string | null;
  athleteUid?: string | null;
  pointsAwarded?: number | null;
  clubResolutionStatus?: 'resolved' | 'unresolved';
  clubResolutionReason?: string | null;
  clubResolvedFrom?: 'participant_profile' | 'user_profile' | 'none';
}

export interface RankedAthlete {
  athleteId: string;
  name: string;
  email: string | null;
  mobile: string | null;
  clubName: string | null;
  country: string | null;
  totalPoints: number;
  racesFinished: number;
  overallRank: number;
  gender: string;
  ageCategory: string | null;
  categoryRank: number;
  totalInCategory: number;
  photoURL?: string | null;
  genderOverallRank?: { rank: number; total: number };
  countryRank?: number;
  races: RaceResult[];
}

export interface LegacyAthlete {
  athleteUid?: string;
  name: string;
  email: string;
  mobile?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  achievementYears: string;
  totalYears: number;
  contributingRaces: {
    raceName: string;
    raceDate: string;
    location: string;
    year: number;
    pointsEarned: number;
  }[];
}

export interface AthleteStats {
  yearsFinished: number[];
  consecutiveStreak: number;
  lastFinishedYear: number | null;
  isLegacy: boolean;
  legacyValidTill: number | null;
}

export interface AthleteRankingEntry {
  athleteId: string;
  name: string;
  totalPoints: number;
  racesFinished: number;
  overallRank?: number;
}

export interface LiveAthlete {
  id: string;
  athleteUid?: string | null;
  participantUuid?: string | null;
  participant_uuid?: string | null;
  bib: string;
  name: string;
  category: string;
  ageGroup: string | null;
  ageGroupUuid?: string | null;
  ageGroupName?: string | null;
  age_group_uuid?: string | null;
  age_group_name?: string | null;
  gender: 'Male' | 'Female';
  country?: string | null;
  contestUuid?: string | null;
  contest_uuid?: string | null;
  contestName?: string | null;
  contest_name?: string | null;
  providerContestUuid?: string | null;
  providerContestName?: string | null;
  privacy?: 'PUBLIC' | 'PRIVATE' | string | null;
  liveTracking?: {
    provider?: string | null;
    participantUuid?: string | null;
    contestUuid?: string | null;
    contestName?: string | null;
    bib?: string | null;
    chip?: string | null;
    privacy?: 'PUBLIC' | 'PRIVATE' | string | null;
  };
  status: string;
  leg: string;
  splits: Split[];
  summary?: {
    SWIM?: number | null;
    T1?: number | null;
    BIKE?: number | null;
    T2?: number | null;
    RUN?: number | null;
    RUN1?: number | null;
    RUN2?: number | null;
    FINISH?: number | null;
    FINISHED?: number | null;
  };
  startTime: number | null;
  lastUpdateTime: number;
  avatarUrl?: string;
  predictedLocation?: { lat: number; lng: number };
  legProgressPct?: number;
  ticketId?: string | null;
  ticketName?: string | null;
  predictedPaceSecPerKm?: number;
  etaNextSplitUTC?: number;
  etaFinishUTC?: number;
  cutoffStatus?: 'On Track' | 'May Miss Cutoff' | 'N/A';
  cutoffReason?: string | null;
  clubName?: string | null;
  courseProgress?: number;
  ranks?: any;
  rank?: number;
  prevRank?: number;
  completedLegIndex?: number;
}

export interface ParticipantMapping {
  bergmanParticipantId: string | null;
  feibotParticipantUUID: string | null;
  eventId: string;
  contestUUID: string | null;
  bib: string | null;
  chipCode: string | null;
  synced: boolean;
  lastSync: string;
  status: 'matched' | 'needs_review' | 'unmatched';
}

export interface LoopLog {
  id: string;
  eventId: string;
  bibNumber: string;
  segment: 'SWIM' | 'BIKE' | 'RUN';
  timestamp: string;
  loopNumber: number;
  action: 'increment' | 'decrement';
  volunteerId: string;
  volunteerName: string;
}
