/**
 * DEPRECATED: This file exists only for legacy support during transition to Phase 1-2
 * New code should use src/lib/feibot-integration/ modules directly
 * 
 * Migration path:
 * - loadFeibotProviderConfig → getDecryptedCredentials + event config from Firestore
 * - feibotGet → callFeibotAPI
 * - feibotRequest → callFeibotAPI
 * 
 * This will be completely removed after all legacy code is migrated.
 */

export interface FeibotProviderConfig {
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  eventUuid?: string;
  scoreEventUuid?: string;
  scoreOverviewUrl?: string;
  scoreProgressUrl?: string;
  [key: string]: any;
}

export interface FeibotResponse {
  ok: boolean;
  status: number;
  text: string;
  data?: any;
  timestamp?: number;
  stringToSign?: string;
  signatureLength?: number;
  url: string;
}

export async function loadFeibotProviderConfig(
  eventId: string
): Promise<FeibotProviderConfig> {
  throw new Error('loadFeibotProviderConfig is deprecated. Use Phase 1 endpoints instead.');
}

export async function feibotGet(
  path: string,
  config: FeibotProviderConfig
): Promise<FeibotResponse> {
  throw new Error('feibotGet is deprecated. Use callFeibotAPI from feibot-integration instead.');
}

export async function feibotRequest(options: {
  accessKey: string;
  secretKey: string;
  apiBaseUrl: string;
  method: string;
  path: string;
  query?: Record<string, any>;
  body?: any;
}): Promise<FeibotResponse> {
  throw new Error('feibotRequest is deprecated. Use callFeibotAPI from feibot-integration instead.');
}

export async function fetchFeibotTimingRules(config: FeibotProviderConfig): Promise<FeibotResponse> {
  throw new Error('fetchFeibotTimingRules is deprecated. Use Phase 2 event config endpoint instead.');
}
