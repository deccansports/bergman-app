export type ProviderType = 'feibot' | 'racemap' | 'chronotrack' | 'raceresult' | 'manual';

export interface WorkerEnv {
  BERGMAN_KV: any;
  BERGMAN_R2: any;
  LIVE_RACE_STATE: any;
  BERGMAN_ADMIN_API_BASE: string;
  BERGMAN_INTERNAL_TOKEN: string;
  LIVE_TRACKING_PUBLIC_CACHE_TTL?: string;
}

export interface EventConfigResponse {
  success: boolean;
  eventId: string;
  liveTrackingHub?: any;
  liveTracking?: any;
  liveDataSource?: string;
  liveTimingConfig?: any;
  event?: {
    id?: string;
    eventName?: string;
    raceDate?: string | null;
    startTime?: string | null;
    phase?: string | null;
    status?: string | null;
    updatedAt?: string | null;
    liveTrackingEnabled?: boolean;
  };
  eventName?: string;
  eventDate?: string | null;
  eventStartTime?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  registrationStats?: {
    registered?: number;
    totalDocuments?: number;
    cancelled?: number;
    withBib?: number;
    bibNumbers?: string[];
    duplicates?: number;
    missingChips?: number;
  };
}

export interface FeibotConfig {
  accessKey: string;
  secretKey: string;
  /** Legacy compatibility only. Do not use for new API calls. */
  eventUuid?: string;
  /** Cloud UUID for timing rules and .FDB timing configuration. */
  cloudEventUuid?: string;
  /** Score UUID for participants, progress, results, leaderboard, live tracking, athlete import, and splits summary. */
  scoreEventUuid?: string;
  apiBaseUrl?: string;
  timingRuleSource?: string;
  cloud?: {
    eventUuid: string;
    [key: string]: any;
  };
  score?: {
    eventUuid: string;
    [key: string]: any;
  };
  localDatabase?: Record<string, any> | null;
}
