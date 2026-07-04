/**
 * Feibot Integration - Main Export
 * 
 * Modular architecture for Bergman ↔ Feibot synchronization
 * 
 * Phase 1: Credential & Connection Management
 * Phase 2: Event Configuration Import & Archival
 * Phase 3: Contest Mapping (1:1 relationships)
 * Phase 4: Split Mapping
 * Phase 5: Participant Mapping
 * Phase 6: Live Sync Engine
 * Phase 7: Raw Data Archival & Recovery
 */

// Types
export type {
  FeibotConnection,
  FeibotAPIConfig,
  FeibotEventConfig,
  FeibotContest,
  FeibotSplit,
  FeibotTimingDevice,
  FeibotCategory,
  FeibotAgeGroup,
  FeibotParticipant,
  RawFeibotArchive,
  ProcessedLiveState,
  ProcessedAthlete,
  HealthCheckResponse,
  APIResponse,
} from './types';

// Phase 1: Connection & Credential Management
export {
  saveFeibotConnection,
  getFeibotConnection,
  getDecryptedCredentials,
  getAccountConnections,
  updateConnectionStatus,
  markConnectionSuccessful,
  recordConnectionFailure,
  deleteFeibotConnection,
  getStoredFeibotGlobalCredential,
  getStoredFeibotEventCredential,
  getFeibotCredentialBundle,
  saveFeibotGlobalCredential,
  saveFeibotEventCredential,
} from './credentials';

export {
  testFeibotConnection,
  fetchEventConfiguration,
  fetchTimingRules,
  fetchParticipants,
  fetchParticipantsQuery,
  fetchResults,
  callFeibotAPI,
} from './api-client';

export {
  debugTimingRules,
} from './debug';

// Phase 2: Event Configuration & Archival
export {
  archiveRawResponse,
  getRawArchive,
  listEventArchives,
  updateArchiveStatus,
  saveProcessedEventConfig,
  getProcessedEventConfig,
  saveProcessedLiveState,
  getProcessedLiveState,
  saveSyncMetadata,
  getSyncMetadata,
} from './kv-archive';

// Phase 3: Contest Mapping
export type {
  FeibotContestMapping,
  FeibotContestMappingBatch,
  ContestMappingRequest,
  ContestMappingResponse,
  ContestMappingSummary,
} from './contest-mapping-types';

export {
  createContestMapping,
  getContestMapping,
  listContestMappings,
  updateContestMapping,
  deleteContestMapping,
  getContestMappingSummary,
  listContestMappingsByConnection,
  validateContestMapping,
  batchUpdateContestMappings,
} from './contest-mapping';

// Event Configuration (Phase 2 continued)
export {
  importEventConfiguration,
  synchronizeEventConfiguration,
  getImportedEventConfig,
  extractConfigSummary,
} from './event-config';
// Timing Rules Import (Comprehensive data-driven import)
export type {
  FeibotLeg,
  FeibotTimingRulesSplit,
  TimingRulesImportResult,
} from './timing-rules-importer';

export {
  extractLegs,
  extractSplits,
  mapSplitsToLegs,
  validateTimingRules,
  formatValidationReport,
  importFeibotTimingRules,
  getTimingRulesKVKey,
  formatLegsForKV,
  formatSplitsForKV,
} from './timing-rules-importer';

export type {
  TimingRulesKVValidation,
} from './timing-rules-kv-storage';

export {
  saveLegsToKV,
  saveSplitsToKV,
  verifyLegsInKV,
  verifySplitsInKV,
  loadLegsFromKV,
  loadSplitsFromKV,
  formatKVValidationReport,
} from './timing-rules-kv-storage';

