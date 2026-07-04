
// functions/src/types.ts

export interface User {
  uid: string;
  email?: string | null;
  name?: string | null;
  mobile?: string | null;
  zohoCustomerId?: string | null;
  gstin?: string | null;
}

export interface EventParticipant {
  id: string;
  name?: string | null;
  email: string;
  eventName?: string;
  ticketName?: string;
  ticketId?: string;
  isDeferral?: boolean;
  ticketChange?: { priceDifferencePaisa: number };
  amountPaidPaisa?: number;
  zohoInvoiceId?: string;
  upgradeInvoiceId?: string;
  previousDeferralDetails?: { originalEventName?: string };
  categoryChangeDetails?: { fromTicketName?: string };
  bookingId?: string;
}

export interface TicketDefinition {
  id: string; // FIX: Added ID field
  hsnCode?: string;
  ticketName?: string;
  cutoffs?: any;
  courseMaps?: {
    swimSplits?: CustomSplitPoint[];
    bikeSplits?: CustomSplitPoint[];
    runSplits?: CustomSplitPoint[];
    run1Splits?: CustomSplitPoint[];
    run2Splits?: CustomSplitPoint[];
  };
}

export type Leg = 'SWIM' | 'T1' | 'BIKE' | 'T2' | 'RUN' | 'RUN1' | 'RUN2' | 'FINISH' | 'FINISHED';
export type Status = 'Not Started' | 'On Course' | 'Finished' | 'DNF' | 'DNQ' | 'DNS';

export interface Split {
  segment: Leg;
  name?: string;
  distance: number; // cumulative distance in km
  time: number; // For live data: absolute timestamp. For results: elapsed time in seconds.
  timeOfDay?: string;
  pace?: string; // pace for this specific split
  avgPace?: string; // average pace up to this split
  position?: {lat: number, lng: number};
  absoluteTimestamp?: number;
  rawSplitLabel?: string;
}

export interface LiveAthlete {
  id?: string;
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
  liveTracking?: {
    provider?: string | null;
    participantUuid?: string | null;
    contestUuid?: string | null;
    contestName?: string | null;
    bib?: string | null;
    chip?: string | null;
  };
  status: Status;
  leg: Leg | 'NOT_STARTED';
  splits: Split[];
  summary?: { // NEW: For final-state summary
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
  completedLegIndex?: number; // For sorting
  startTime: number | null; // Unix timestamp in seconds
  lastUpdateTime: number; // Unix timestamp in milliseconds
  lastSeenSplit?: string; // NEW
  lastSeenAt?: number;
  avatarUrl?: string;
  predictedLocation?: { lat: number; lng: number };
  legProgressPct?: number; // 0-100
  ticketId?: string | null;
  ticketName?: string | null; // NEW: To carry over from participant data
  predictedPaceSecPerKm?: number;
  etaNextSplitUTC?: number; // Unix timestamp in seconds
  etaFinishUTC?: number; // Unix timestamp in seconds
  cutoffStatus?: 'On Track' | 'May Miss Cutoff' | 'N/A'; // NEW
  cutoffReason?: string | null; // NEW
  clubName?: string | null;
  courseProgress?: number;
  ranks?: {
    overall?: { rank: number; total: number };
    gender?: { rank: number; total: number };
    ageGroup?: { rank: number; total: number };
  };
  rank?: number; // Overall rank
  prevRank?: number; // Previous overall rank for animation
  eventId?: string; // Added to live_athletes doc
  publish?: boolean; // Added to live_athletes doc
  // Properties added for consistency with processRawRead
  totalDistanceKm?: number;
  coursePolyline?: any[];
  distanceMap?: { [key: string]: number };
  cutoffConfig?: any;
}

export interface EventCalendarEntry {
  id: string;
  eventName: string;
  eventDate: string | null;
  ticketDefinitions?: TicketDefinition[];
  liveTimingConfig?: {
    jsonMapping?: string;
  }
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
  eventCategory?: string | null;
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

export interface CustomSplitPoint {
  id: string;
  name: string;
  distance: number; // in km
}
