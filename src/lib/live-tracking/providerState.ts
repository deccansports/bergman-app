/**
 * DEPRECATED: This file exists only for legacy support during transition to Phase 3 (Contest Mapping)
 * New code should use src/lib/feibot-integration/ modules directly
 * 
 * This will be completely removed after Phase 3 is completed.
 */

export interface LiveTrackingProviderState {
  provider: 'feibot' | 'racemap' | 'chronotrack' | 'raceresult' | 'manual';
  configurationSource: 'cloud_api' | 'imported' | 'bergman_platform';
  replayEnabled?: boolean;
  updatedAt?: string;
  participantsImported?: boolean;
  lastSuccessfulParticipantImport?: string | null;
  [key: string]: any;
}

export function mergeProviderState(
  existing: any,
  patch: any,
  hub?: any
): LiveTrackingProviderState {
  return {
    provider: patch?.provider || existing?.provider || hub?.provider || 'feibot',
    configurationSource: patch?.configurationSource || existing?.configurationSource || 'cloud_api',
    replayEnabled: typeof patch?.replayEnabled === 'boolean' ? patch.replayEnabled : existing?.replayEnabled,
    updatedAt: patch?.updatedAt || existing?.updatedAt,
    participantsImported: patch?.participantsImported ?? existing?.participantsImported,
    lastSuccessfulParticipantImport: patch?.lastSuccessfulParticipantImport ?? existing?.lastSuccessfulParticipantImport,
    ...existing,
    ...patch,
  };
}
