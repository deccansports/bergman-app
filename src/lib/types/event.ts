// src/lib/types/event.ts
import type { TicketDefinition } from './ticket';

export interface Sponsor {
  id: string;
  name: string;
  logoUrl: string;
  website?: string | null;
  type?: string; 
  order: number;
  createdAt: string;
  updatedAt?: string;
  eventId: string;
}

export interface Influencer {
  id: string;
  name: string;
  photoUrl: string;
  achievements: string;
  details?: string | null;
  title?: string | null;
  socialUrl?: string | null;
  order: number;
  createdAt: string;
  updatedAt?: string;
  eventId: string;
  importSourceKey?: string | null;
  email?: string | null;
  mobile?: string | null;
  isActive?: boolean;
  approvedAt?: string | null;
  registrationMatchedAt?: string | null;
  discountCouponCode?: string | null;
  publicCouponCode?: string | null;
  emailTemplateKey?: string | null;
  whatsappTemplateKey?: string | null;
}

export interface InfluencerFormConfig {
  formUrl: string;
  sheetUrl: string;
  sheetId: string;
  sheetGid?: string | null;
  emailTemplateKey?: string | null;
  whatsappTemplateKey?: string | null;
  defaultWhatsappNumber?: string | null;
  discountPercent?: number | null;
  updatedAt: string;
}

export interface InfluencerPostTemplateConfig {
  squareFrameUrl?: string | null;
  templateOnTop?: boolean;
  squareWidth?: number;
  squareHeight?: number;
  squareImageScale?: number;
  squareImageOffsetX?: number;
  squareImageOffsetY?: number;
  squareNameOffsetX?: number;
  squareNameOffsetY?: number;
  storyFrameUrl?: string | null;
  storyWidth?: number;
  storyHeight?: number;
  storyImageScale?: number;
  storyImageOffsetX?: number;
  storyImageOffsetY?: number;
  storyNameOffsetX?: number;
  storyNameOffsetY?: number;
  nameFontFamily?: string | null;
  nameFontSize?: number;
  nameFontColor?: string | null;
  nameLetterSpacing?: number;
  nameShapeEnabled?: boolean;
  nameShapeColor?: string | null;
  nameShapeOpacity?: number;
  nameShapePaddingX?: number;
  nameShapePaddingY?: number;
  nameShapeRadius?: number;
  includeBrandingText?: boolean;
  updatedAt: string;
}

export interface InfluencerFormResponseRow {
  id: string;
  timestamp?: string | null;
  name: string;
  title?: string | null;
  achievements?: string | null;
  details?: string | null;
  socialUrl?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  mobile?: string | null;
  missingFields: string[];
  canImport: boolean;
  alreadyImported: boolean;
  isRejected?: boolean;
  isRegistered?: boolean | null;
  couponCode?: string | null;
  participantCouponCode?: string | null;
  razorpayPaymentId?: string | null;
  paidAmountPaisa?: number;
  ticketPricePaisa?: number;
  couponDiscountPaisa?: number;
  pricingTotalPayablePaisa?: number;
  pricingFullStickerPaisa?: number;
  existingDiscountPercent?: number;
  isDiscountRefunded?: boolean;
  influencerRefundId?: string | null;
  influencerRefundStatus?: string | null;
  influencerRefundPaymentId?: string | null;
  influencerRefundAt?: string | null;
  influencerRefundRrn?: string | null;
  influencerRefundAmountPaisa?: number;
  rawData: Record<string, string>;
}

export interface ContentBlock {
  id: string;
  html: string;
}

export interface EventStats {
    totalParticipants: number;
    activeParticipants: number;
    cancelledParticipants: number;
    ticketBreakdown: { [ticketName: string]: number };
    totalRevenuePaisa: number;
    totalGSTPaisa: number;
    deferralCount: number;
    foodRevenuePaisa: number;
}

export interface EventCalendarEntry {
  id: string;
  eventName: string;
  eventDate: string | null;
  displayDateRange?: string; 
  disciplineSchedule?: { 
    date: string;
    disciplines: string[];
  }[];
  isRaceWeekend?: boolean; 
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  isHidden?: boolean;
  isSoldOut?: boolean;
  registrationButtonState?: 'show' | 'hide' | 'sold_out';
  showLiveTrackingOnHomepage?: boolean; 
  liveDataSource?: 'none' | 'participants' | 'timing_partner' | 'race_results' | 'racemap'; 
  liveTimingConfig?: LiveTimingConfig | null;
  liveTrackingHub?: LiveTrackingHubConfig | null;
  timingPartner?: {
    provider: 'wiclax' | 'racemap' | 'other';
    eventId: string;
    apiToken?: string;
    apiVersion: string;
    timezone: string;
    lastSyncAt?: number; 
  } | null;
  venueName?: string | null;
  address?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  venueDetails?: string | null;
  googleMapsUrl?: string | null;
  nearestAirport?: {
    name?: string;
    url?: string;
  } | null;
  description?: string | null;
  photoUrl?: string | null;
  finishLedLogoUrl?: string | null;
  registrationUrl?: string | null;
  customSlug?: string | null;
  currency?: 'INR' | 'USD' | string;
  organizerName?: string | null;
  organizerAddress?: string | null;
  organizerCompanyDescription?: string | null;
  courseDetails?: {
    swim?: string;
    bike?: string;
    run?: string;
  } | null;
  temperatureMetrics?: {
    highAirTemp?: string;
    lowAirTemp?: string;
    avgWaterTemp?: string;
  } | null;
  ageCategories?: string[];
  participants?: Array<{
    ticketId?: string;
    ticketName?: string;
    selectedSubCategory?: string | null;
  }>;
  ticketDefinitions?: TicketDefinition[];
  createdAt?: string;
  mode?: 'Offline' | 'Virtual' | 'Hybrid' | null;
  cutoffs?: any; 
  blocks?: ContentBlock[];
  athleteGuideBookUrl?: string | null; 
  sponsors?: Sponsor[];
  influencers?: Influencer[];
  customRules?: string | null;
  eventMapperPro?: {
    pdfUrl?: string | null;
    pdfName?: string | null;
    sportType?: 'swim' | 'bike' | 'run' | null;
    updatedAt?: string | null;
    updatedBy?: string | null;
  } | null;
  stats?: EventStats | null;
  isRaceWeekendHeader?: boolean;
  foodPurchaseSlug?: string | null;
  /** Numeric event ID used by Split Second Pix race photography partner */
  splitSecondPixEventId?: string | null;
  splitSecondPixEventName?: string | null;
  splitSecondPixEventSlug?: string | null;
  splitSecondPixSearchByBib?: boolean | null;
  splitSecondPixSearchByFace?: boolean | null;
}

export type LiveTrackingProvider = 'feibot' | 'racemap' | 'chronotrack' | 'raceresult' | 'manual';

export type LiveTrackingLeaderboardMode = 'overall' | 'male' | 'female' | 'age_group' | 'club' | 'team' | 'relay';

export type LiveTrackingTimingPointMarkerType =
  | 'tracking'
  | 'leaderboard'
  | 'cutoff'
  | 'transition'
  | 'medical'
  | 'checkpoint'
  | 'finish'
  | 'hidden';

export interface LiveTrackingTimingPoint {
  id: string;
  splitUUID?: string;
  timingPointUUID?: string;
  label: string;
  splitCode?: string;
  markerType: LiveTrackingTimingPointMarkerType;
  order: number;
  distanceKm?: number;
  pointType?: LiveTrackingTimingPointMarkerType;
  cutoffMinutes?: number;
  trackingMarkerId?: string;
  leaderboardMarkerId?: string;
  medicalPoint?: boolean;
  active?: boolean;
  showOnPublicMap?: boolean;
  announcementTrigger?: boolean;
  waterStation?: boolean;
  pushNotification?: boolean;
  customColor?: string;
  mapIcon?: string;
  source?: 'feibot' | 'bergman' | 'manual' | 'imported';
}

export interface LiveTrackingCategoryTimingConfiguration {
  categoryId: string;
  categoryName: string;
  localId?: string;
  contestId?: string;
  providerContestUuid?: string;
  timingPoints: LiveTrackingTimingPoint[];
  splits?: Array<Record<string, any>>;
  leaderboardRules?: {
    modes?: LiveTrackingLeaderboardMode[];
    displayCount?: number;
  };
}

export interface LiveTrackingFeibotConfig {
  // Legacy flat fields (kept for backward compatibility)
  accessKey?: string;
  secretKey?: string;
  secretKeyEncrypted?: string;
  eventUuid?: string;
  apiBaseUrl?: string;

  // Provider V2 fields
  cloud?: {
    eventUuid?: string;
    apiBaseUrl?: string;
    accessKey?: string;
    secretKey?: string;
    secretKeyEncrypted?: string;
    connected?: boolean;
    authenticated?: boolean;
  };
  score?: {
    eventUuid?: string;
    overviewUrl?: string;
    progressUrl?: string;
    available?: boolean;
  };
  diagnostics?: {
    lastConnectionTest?: string;
    responseTimeMs?: number;
    lastStatus?: 'connected' | 'setup_required' | 'authentication_failed' | 'offline' | string;
    lastApiCall?: {
      endpoint?: string;
      responseTimeMs?: number;
      status?: number;
      success?: boolean;
      timestamp?: string;
    };
    lastError?: string | null;
  };
  timingRuleSource?: 'cloud' | 'local_database' | 'manual';
  ticketContestMappings?: Array<{
    ticketId?: string;
    provider?: 'feibot' | 'bergman' | 'manual';
    providerContestUuid?: string | null;
    providerContestName?: string | null;
  }>;
  cloudTimingRules?: {
    contests?: Array<Record<string, any>>;
    splits?: Array<Record<string, any>>;
    timingPoints?: Array<Record<string, any>>;
    ageGroups?: Array<Record<string, any>>;
    updatedAt?: string;
  };
}

export interface LiveTrackingPartnerConfig {
  apiUrl?: string;
  apiKey?: string;
  eventId?: string;
}

export interface LiveTrackingCloudflareConfig {
  workerBaseUrl?: string;
  kvNamespace?: string;
  r2Bucket?: string;
  r2S3Endpoint?: string;
  durableObjectName?: string;
}

export interface LiveTrackingSyncEngineConfig {
  participantsEveryMinutes: 1 | 5 | 15 | 'manual';
  resultsEverySeconds: 10 | 15 | 30 | 60 | 'manual';
  leaderboardEverySeconds: 5 | 10 | 30 | 'manual';
}

export interface LiveTrackingLeaderboardConfig {
  modes: LiveTrackingLeaderboardMode[];
  displayCount: 10 | 25 | 50 | 100;
  enableTeamRanking?: boolean;
  enableRelayRanking?: boolean;
}

export interface LiveTrackingReplayConfig {
  enabled: boolean;
  speeds: Array<1 | 2 | 5 | 10>;
  storagePrefix?: string;
}

export interface LiveTrackingMonitoringConfig {
  enabled: boolean;
  logRetentionDays: number;
  alertWebhookUrl?: string;
}

export interface LiveTrackingApiTesterConfig {
  enabled: boolean;
  lastRunAt?: string;
  lastEndpoint?: string;
  lastStatus?: string;
}

export interface LiveTrackingHubConfig {
  provider: LiveTrackingProvider;
  trackingConfig?: {
    enabled: boolean;
    showOnHomepage: boolean;
    edgeCacheSeconds: number;
    spectatorSoftLimit?: number;
    enableAthleteSearch?: boolean;
    enableReplayMode?: boolean;
    enableClubRankings?: boolean;
  };
  feibotConfig?: LiveTrackingFeibotConfig;
  racemapConfig?: LiveTrackingPartnerConfig;
  chronotrackConfig?: LiveTrackingPartnerConfig;
  raceResultConfig?: LiveTrackingPartnerConfig;
  manualConfig?: {
    notes?: string;
  };
  cloudflareConfig?: LiveTrackingCloudflareConfig;
  syncEngine?: LiveTrackingSyncEngineConfig;
  categoryTimingConfiguration?: LiveTrackingCategoryTimingConfiguration[];
  /** @deprecated Use categoryTimingConfiguration instead */
  timingPoints?: LiveTrackingTimingPoint[];
  leaderboardConfig?: LiveTrackingLeaderboardConfig;
  replayConfig?: LiveTrackingReplayConfig;
  monitoringConfig?: LiveTrackingMonitoringConfig;
  apiTesterConfig?: LiveTrackingApiTesterConfig;
  mapsSplitsConfig?: Array<{
    id: string;
    name: string;
    type: 'triathlon' | 'duathlon' | 'swimathon' | 'relay';
    segments: { swim?: number; bike?: number; run?: number };
    maps: { swim?: string; bike?: string; run?: string };
    mapDescriptions: { swim?: string; bike?: string; run?: string };
    splits: { swim?: string[]; bike?: string[]; run?: string[] };
  }>;
}

export interface BackupRecord {
  id: string;
  eventId: string;
  eventName: string;
  createdAt: string;
  participantCount: number;
  participantsData?: string | null;
  eventDocument?: string | null;
  ticketDefinitionsData?: string | null;
  bibAssignmentsData?: string | null;
  sponsorsData?: string | null;
  inventoryData?: string | null;
  // If the full backup payload was too large for Firestore it may be stored
  // in Firebase Storage and referenced here.
  storagePath?: string | null;
  storageSize?: number | null;
  storageCompressed?: boolean | null;
}

export interface EventInventory {
  id: string;
  tshirts?: Record<string, { initial: number; issued: number }>;
  medals?: Record<string, { initial: number; issued: number }>;
  trophies?: Record<string, { initial: number; issued: number }>;
  finisherJerseys?: Record<string, { initial: number; issued: number }>;
  swimCaps?: Record<string, { initial: number; issued: number }>;
  bags?: { initial: number; issued: number };
  waterStationConfig?: any;
  updatedAt?: string;
}

export type InventoryItemType = 'T-Shirt' | 'Finisher Jersey' | 'Medal' | 'Trophy' | 'Swim Cap' | 'Bag' | 'Food' | 'Breakfast' | 'Lunch';

export interface LiveTimingConfig {
  apiUrl?: string;
  apiKey?: string;
  jsonMapping?: string;
}

export interface CategoryChangeLogEntry {
  id: string;
  eventId: string;
  eventName: string;
  participantId: string;
  participantName: string;
  participantEmail: string;
  fromTicketName: string;
  toTicketName: string;
  fromBibNumber: string | null;
  toBibNumber: string | null;
  paymentId: string | null;
  changedAt: string;
  invoiceNumber: string | null;
}

export interface AidStationConfig {
  bikeStations: number;
  runStations: number;
  venueStations: number;
}

export interface CustomItem {
  id: string;
  name: string;
  unit: string;
  type: 'consumable' | 'fixed';
  consumptionType?: 'perHour' | 'perAthlete';
  consumptionRate?: number;
  quantityPerStation?: number;
  perStation?: number;
  total?: number;
}

// ============================================================================
// BERGMAN LIVE TRACKING & RESULTS PLATFORM V2 TYPES
// ============================================================================

export interface RaceCategory {
  id: string;
  name: string; // e.g., 'BERGMAN 102', 'BERGMAN OLYMPIC'
  type: 'triathlon' | 'swimathon' | 'duathlon' | 'other';
  distances: {
    swim?: number; // km
    bike?: number; // km
    run?: number; // km
  };
  description?: string;
  gpxRouteUrl?: string;
  lapCount?: number;
  timingStructure: 'wave_start' | 'individual_start' | 'mass_start';
  order: number;
}

export interface TimingCorrection {
  id: string;
  eventId: string;
  bib: string;
  athleteName: string;
  splitCode: string;
  originalTime: number; // milliseconds
  correctedTime: number; // milliseconds
  reason: string;
  evidence?: string; // URL to supporting document
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  submittedBy: {
    userId: string;
    email: string;
    name: string;
  };
  submittedAt: Date;
  approvedBy?: {
    userId: string;
    email: string;
    name: string;
  };
  approvedAt?: Date;
  appliedAt?: Date;
  auditTrail: Array<{
    action: 'created' | 'approved' | 'rejected' | 'applied';
    timestamp: Date;
    actor: string;
    notes?: string;
  }>;
}

export interface ResultsSummary {
  registered: number;
  started: number;
  finished: number;
  dnf: number;
  dns: number;
  dsq: number;
  dnq: number;
}

export interface ReplayDataset {
  id: string;
  eventId: string;
  startTime: Date;
  endTime: Date;
  frameCount: number;
  athleteCount: number;
  r2Url: string;
  createdAt: Date;
  expiresAt?: Date; // Auto-cleanup after event
}

export interface EventOperationsStatus {
  eventId: string;
  status: 'not_started' | 'in_progress' | 'paused' | 'finished';
  currentPhase?: 'swim' | 'transition' | 'bike' | 'run' | 'awards';
  activeAthletes: number;
  finishedAthletes: number;
  problemsReported: number;
  lastUpdate: Date;
  estimatedFinishTime?: Date;
}

export interface EventAnalytics {
  eventId: string;
  date: Date;
  totalViews: number;
  uniqueSpectators: number;
  avgSessionDuration: number; // seconds
  heatmapData?: any; // GeoJSON or custom format
  athleteSearchQuery: Record<string, number>; // query -> count
  topAthletes: Array<{ bib: string; name: string; views: number }>;
  deviceBreakdown: Record<string, number>; // device type -> count
  geographicBreakdown: Record<string, number>; // country -> count
}

export interface CertificateGenerationRequest {
  eventId: string;
  bib: string;
  format: 'pdf' | 'png' | 'svg';
  customMessage?: string;
  includeQrCode?: boolean;
  signedBy?: string;
}

export interface ExportRequest {
  id: string;
  eventId: string;
  type: 'results_csv' | 'leaderboard' | 'participants' | 'analytics' | 'replay_data';
  format: 'csv' | 'json' | 'xlsx';
  filters?: Record<string, any>;
  requestedBy: string;
  requestedAt: Date;
  completedAt?: Date;
  downloadUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface ApiUsageStats {
  eventId: string;
  date: Date;
  totalRequests: number;
  requestsByEndpoint: Record<string, number>;
  avgLatency: number; // ms
  p99Latency: number; // ms
  cacheHitRate: number; // percentage
  errorRate: number; // percentage
  bandwidthUsed: number; // bytes
}

export interface ProviderSyncJob {
  id: string;
  eventId: string;
  provider: string;
  jobType: 'participants' | 'results' | 'leaderboards' | 'timing_rules' | 'full_sync';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  recordsProcessed: number;
  errorMessage?: string;
  nextRunAt?: Date;
}

export interface WorkerHealthMetrics {
  workerId: string;
  timestamp: Date;
  kvReadsPerSecond: number;
  kvWritesPerSecond: number;
  r2Requests: number;
  durableObjectRequests: number;
  averageLatency: number; // ms
  errorRate: number; // percentage
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
  lastErrorMessage?: string;
}
