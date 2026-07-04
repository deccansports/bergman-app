/**
 * Feibot Integration Type Definitions
 * 
 * This module defines all types for the Feibot integration system.
 * Bergman remains the master platform for event configuration and presentation.
 * Feibot is the official timing engine.
 */

/**
 * Feibot Connection (Stored in Firestore)
 * Represents an authenticated connection to Feibot API
 * Credentials are encrypted before storage
 */
export interface FeibotConnection {
  // Document ID
  connectionId: string;
  
  // Account information
  accountId: string;
  accountName?: string;
  
  // Encrypted credentials (encrypted with encryptProviderSecret)
  encryptedAccessKey: string;
  encryptedSecretKey: string;
  encryptionVersion: number; // For future encryption version migrations
  
  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  createdBy: string; // User ID
  updatedBy?: string; // User ID
  
  // Status
  status: 'active' | 'inactive' | 'failed' | 'testing';
  statusReason?: string;
  
  // Connection history
  lastSuccessfulConnection?: string; // ISO timestamp
  lastSuccessfulSync?: string; // ISO timestamp
  lastFailedAttempt?: string; // ISO timestamp
  failureCount: number;
  consecutiveFailures: number;
  
  // Connection metadata
  apiBaseUrl: string; // e.g., https://apicn.feibot.com
  environment: 'production' | 'staging' | 'sandbox';
}

/**
 * Feibot API Configuration
 * Used at runtime to make API requests
 */
export interface FeibotAPIConfig {
  accountId: string;
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  credentialMeta?: {
    credentialType?: 'event' | 'account' | 'unknown';
    requestedEventUuid?: string;
    boundEventUuid?: string;
    storedAccessKeyRaw?: string;
    storedSecretKeyRaw?: string;
    decryptedAccessKey?: string;
    decryptedSecretKey?: string;
    source?: string;
  };
}

/**
 * Feibot Event Configuration
 * Imported from timingRulesGet endpoint
 */
export interface FeibotEventConfig {
  // Event basics
  event_uuid: string;
  event_name: string;
  event_date?: string;
  event_time?: string;
  
  // Contests (races)
  contests: FeibotContest[];
  
  // Splits/Checkpoints
  splits: FeibotSplit[];
  
  // Timing devices
  timing_devices: FeibotTimingDevice[];
  
  // Categories
  categories: FeibotCategory[];
  
  // Age groups
  age_groups: FeibotAgeGroup[];
  
  // Gender groups (if applicable)
  gender_groups?: string[];
  
  // Ranking and timing rules
  ranking_rules?: any;
  timing_rules?: any;
  cutoffs?: any;
  transition_rules?: any;
  
  // Raw metadata
  [key: string]: any;
}

/**
 * Feibot Contest
 */
export interface FeibotContest {
  contest_id: string;
  contest_uuid: string;
  contest_name: string;
  contest_type?: string; // e.g., 'individual', 'relay'
  sequence?: number;
  [key: string]: any;
}

/**
 * Feibot Split (Checkpoint/Timing Point)
 */
export interface FeibotSplit {
  split_id: string;
  split_name: string;
  split_sequence: number;
  timing_device_id?: string;
  split_type?: string; // e.g., 'start', 'intermediate', 'finish'
  [key: string]: any;
}

/**
 * Feibot Timing Device
 */
export interface FeibotTimingDevice {
  device_id: string;
  device_name: string;
  device_type?: string;
  [key: string]: any;
}

/**
 * Feibot Category
 */
export interface FeibotCategory {
  category_id: string;
  category_name: string;
  category_code?: string;
  [key: string]: any;
}

/**
 * Feibot Age Group
 */
export interface FeibotAgeGroup {
  age_group_id: string;
  age_group_name: string;
  min_age?: number;
  max_age?: number;
  [key: string]: any;
}

/**
 * Feibot Participant
 */
export interface FeibotParticipant {
  participant_id: string;
  participant_uuid: string;
  participant_bib: string;
  participant_name?: string;
  participant_email?: string;
  chip_id?: string;
  contest_uuid: string;
  age_group_id?: string;
  category_id?: string;
  [key: string]: any;
}

/**
 * Raw Feibot API Response (stored in KV)
 * Every response from Feibot is archived exactly as received
 */
export interface RawFeibotArchive {
  // Archive metadata
  archiveId: string;
  eventUuid: string;
  timestamp: number; // Unix timestamp (milliseconds)
  feibotTimestamp?: number; // If Feibot provides one
  
  // Request information
  apiEndpoint: string;
  apiPath: string;
  queryParameters?: Record<string, string>;
  requestMethod: 'GET' | 'POST';
  
  // Response information
  httpStatus: number;
  responseTimeMs: number;
  
  // Raw payload (exactly as received, never modified)
  rawResponse: any;
  
  // Metadata
  syncBatchId?: string;
  importStatus: 'pending' | 'processing' | 'complete' | 'failed';
  processingError?: string;
  
  // Signature info (for debugging/auditing)
  requestSignature?: string;
  signatureTimestamp?: number;
}

/**
 * Processed Live State (optimized for fast access)
 * Derived from raw archive but optimized for live tracking
 */
export interface ProcessedLiveState {
  eventUuid: string;
  timestamp: number;
  
  // Processed data
  activeAthletes: ProcessedAthlete[];
  leaderboard: LeaderboardEntry[];
  contestStatus: Record<string, ContestStatus>;
  
  // Cache metadata
  lastUpdated: number;
  processingDurationMs: number;
}

/**
 * Processed Athlete for Live Tracking
 */
export interface ProcessedAthlete {
  participantId: string;
  participantUuid: string;
  bibNumber: string;
  athleteName: string;
  
  // Current status
  status: 'not_started' | 'in_progress' | 'finished' | 'dns' | 'dnf' | 'dsq';
  
  // Timing
  lastSplitTime?: number;
  lastSplitName?: string;
  finishTime?: number;
  
  // Position
  currentSplitIndex?: number;
  totalSplits: number;
  completedSplits: number;
  
  // Performance
  pace?: number;
  estimatedFinish?: number;
}

/**
 * Leaderboard Entry
 */
export interface LeaderboardEntry {
  rank: number;
  participantId: string;
  bibNumber: string;
  athleteName: string;
  finishTime: number;
  status: string;
}

/**
 * Contest Status
 */
export interface ContestStatus {
  contestUuid: string;
  contestName: string;
  status: 'not_started' | 'in_progress' | 'finished';
  activeAthletes: number;
  finishedAthletes: number;
  totalAthletes: number;
}

/**
 * API Response Envelope (for HTTP responses)
 */
export interface APIResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

/**
 * Health Check Response
 */
export interface HealthCheckResponse {
  connectionStatus: 'connected' | 'failed' | 'testing';
  apiStatus: 'reachable' | 'unreachable';
  credentialsValid: boolean;
  lastConnection?: string;
  nextRetry?: string;
  diagnostics?: {
    responseTimeMs: number;
    httpStatus: number;
    error?: string;
  };
}
