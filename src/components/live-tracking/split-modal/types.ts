import type { LiveAthlete, Split, TicketDefinition } from '@/lib/types';
import type { ResolvedTimingConfiguration, ResolvedTimingPoint } from '@/lib/timingConfiguration';

export type SectionThemeKey = 'swim' | 'bike' | 'run' | 'transition' | 'finish' | 'generic';
export type PointState = 'completed' | 'current' | 'future' | 'missed';

export type TimingRow = {
  point: ResolvedTimingPoint;
  split: Split | null;
  splitUuid?: string | null;
  index: number;
  distanceKm: number | null;
  splitSeconds: number | null;
  cumulativeSeconds: number | null;
  avgSpeedKph: number | null;
  trend: 'faster' | 'slower' | 'same' | 'neutral';
  reached: boolean;
  state: PointState;
  isFastest: boolean;
  rankDelta: number | null;
  pointRank: number | null;
};

export type SectionGroup = {
  key: string;
  theme: SectionThemeKey;
  label: string;
  iconKey: SectionThemeKey | 'generic';
  rows: TimingRow[];
  startIndex: number;
  endIndex: number;
  reachedCount: number;
  durationSeconds: number | null;
  paceText: string;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  secondaryMetricLabel?: string;
  secondaryMetricValue?: string;
  tertiaryMetricLabel?: string;
  tertiaryMetricValue?: string;
  summaryChips: Array<{ label: string; value: string }>;
};

export type SplitModalModel = {
  participantProfile: {
    name: string;
    bib: string;
    gender: string;
    category: string;
    ageGroup: string;
    country: string | null;
    club: string | null;
    team: string | null;
    contestUuid: string | null;
    contestName: string | null;
    contestDate: string | null;
    contestEtd: string | null;
    startTime: number | null;
  };
  athleteStatus: string;
  noContestAssigned: boolean;
  isNotStarted: boolean;
  isFinished: boolean;
  isDnfLike: boolean;
  timingPoints: ResolvedTimingPoint[];
  rows: TimingRow[];
  sections: SectionGroup[];
  currentIndex: number;
  currentPoint: TimingRow | null;
  currentSection: SectionGroup | null;
  totalDistanceKm: number;
  totalRaceTimeSeconds: number | null;
  overallAverageSpeed: number | null;
  overallAveragePace: number | null;
  completedRows: number;
  currentSpeedText: string;
  estimatedFinishText: string;
  gapToLeaderText: string;
  currentStatusLabel: string;
  lastUpdatedSeconds: number;
  sectionTimeline: Array<{ section: SectionGroup; state: PointState }>;
  rankSummary: {
    overall: number | null;
    gender: number | null;
    category: number | null;
  };
  splitDebug: {
    contestUuid: string | null;
    contestName: string | null;
    splitSource: string;
    eventConfigurationVersion: string | null;
    lastSynced: string | null;
    contestFound: boolean;
    splitCount: number;
    courseDistanceKm: number;
    duplicateSplitCount: number;
    missingTimingPointCount: number;
    validation: {
      contestUuidFound: boolean;
      contestExists: boolean;
      splitsFound: boolean;
      sortedByDistance: boolean;
      courseDistanceCalculated: boolean;
    };
    splits: Array<{
      name: string;
      splitUuid: string | null;
      timingPointUuid: string | null;
      distanceKm: number | null;
    }>;
    logs: string[];
  };
};

export interface DynamicSplitSummaryTableProps {
  athlete: LiveAthlete;
  timingConfiguration?: ResolvedTimingConfiguration | null;
  participant?: Record<string, any> | null;
  participantsByBib?: Record<string, any> | null;
  ticketDef?: TicketDefinition | null;
  isLoading?: boolean;
}
