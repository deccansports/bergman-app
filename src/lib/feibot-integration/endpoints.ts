/**
 * Feibot Cloud API Endpoints
 * 
 * Comprehensive collection of all Feibot API endpoints with proper typing
 * and HMAC-SHA256 authentication support.
 * 
 * Endpoints include:
 * - Leaderboard queries (rankings by split/gender/age group)
 * - Race process tracking (live progress)
 * - Real-time result lookups (participant results)
 * - Finish result queries (official final results)
 * - Raw device data (timing sensor reads)
 */

import crypto from 'crypto';
import type { FeibotAPIConfig } from './types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Leaderboard configuration with rankings organized by contest/ageGroup/gender
 */
export interface LeaderboardConfig {
  event_uuid: string;
  contest?: {
    [contestKey: string]: {
      ageGroup?: {
        [ageGroupKey: string]: {
          [genderKey: string]: Array<{
            rank: number;
            athlete_id: string;
            name: string;
            bib: string;
            contest: string;
            ageGroup: string;
            gender: string;
            currentLeg?: string;
            gap?: string;
            deltaTime?: string;
            status?: string;
            speed?: string;
            pace?: string;
            distanceCovered?: string;
            eta?: string;
          }>;
        };
      };
    };
  };
}

/**
 * Race process data showing current progress and stage
 */
export interface RaceProcess {
  event_uuid: string;
  process?: Array<{
    contestUuid?: string;
    contestName?: string;
    stage?: string;
    progress?: number;
    startTime?: number;
    expectedEndTime?: number;
    status?: string;
    participants?: {
      started?: number;
      finished?: number;
      total?: number;
    };
  }>;
}

/**
 * Participant result data (real-time or finished)
 */
export interface ParticipantResult {
  event_uuid: string;
  code: number;
  msg: string;
  data?: {
    athlete_id?: string;
    name?: string;
    bib?: string;
    chip_code?: string;
    contest?: string;
    ageGroup?: string;
    gender?: string;
    status?: string;
    totalTime?: string;
    splits?: Array<{
      splitUuid?: string;
      splitName?: string;
      splitDistance?: string;
      splitTime?: string;
      pace?: string;
      speed?: string;
    }>;
    rankings?: Array<{
      contest?: string;
      ageGroup?: string;
      gender?: string;
      rank?: number;
      gap?: string;
    }>;
    legs?: Array<{
      legUuid?: string;
      legName?: string;
      distance?: string;
      elevation?: string;
      currentProgress?: string;
      eta?: string;
    }>;
  };
}

/**
 * Raw timing device data from RFID sensors
 */
export interface RawTimingData {
  code: number;
  msg: string;
  data?: {
    devices: string[];
    compressedItems: Array<{
      '0': string; // UUID
      '1': string; // deviceCode
      '2': number; // unixTimeStamp (microseconds)
      '3': string; // epc (chip code)
      '4': number; // epcTimeStamp
      '5': number; // rssi (signal strength)
      '6': number; // antennaPort
      '7': number; // generatedBySimulatorFlag
    }>;
    unixTimeStampMax: Record<string, number>;
    result?: string; // "no raw data found"
    debug?: {
      requested_devices: string[];
      rejected_devices: string[];
      allowed_devices: string[];
      hint: string;
    };
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildSignatureQuery(query: Record<string, any>): string {
  return Object.keys(query)
    .sort()
    .filter((k) => query[k] !== undefined && query[k] !== null && String(query[k]) !== '')
    .map((k) => {
      const value = String(query[k]);
      return `${k}=${value}`;
    })
    .join('&');
}

function buildSignature(
  method: string,
  path: string,
  timestamp: string,
  queryString: string,
  requestBody: string,
  secretKey: string
): { signature: string; stringToSign: string } {
  const stringToSign =
    method.toUpperCase() +
    path +
    timestamp +
    queryString +
    requestBody;

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return { signature, stringToSign };
}

// ============================================================================
// ENDPOINT IMPLEMENTATIONS
// ============================================================================

/**
 * Fetch leaderboard dashboard statistics by event UUID
 * Returns JSON with leaderboard configs and ranking data per split/gender
 * 
 * GET /api/leaderboardQuery?event_uuid={eventUuid}
 */
export async function fetchLeaderboardQuery(
  config: FeibotAPIConfig,
  eventUuid: string
): Promise<LeaderboardConfig> {
  const path = '/api/leaderboardQuery';
  const query = { event_uuid: eventUuid };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'GET';
  const body = '';

  const signatureQuery = buildSignatureQuery(query);
  const { signature } = buildSignature(method, path, timestamp, signatureQuery, body, config.secretKey);

  const url = new URL(config.apiBaseUrl + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, String(v)));

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Feibot-AK': config.accessKey,
      'X-Feibot-Timestamp': timestamp,
      'X-Feibot-Signature': signature,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Feibot leaderboardQuery failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch race process data by event UUID
 * Returns JSON including a process field (may be null when empty)
 * 
 * GET /api/processQuery?event_uuid={eventUuid}
 */
export async function fetchProcessQuery(
  config: FeibotAPIConfig,
  eventUuid: string
): Promise<RaceProcess> {
  const path = '/api/processQuery';
  const query = { event_uuid: eventUuid };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'GET';
  const body = '';

  const signatureQuery = buildSignatureQuery(query);
  const { signature } = buildSignature(method, path, timestamp, signatureQuery, body, config.secretKey);

  const url = new URL(config.apiBaseUrl + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, String(v)));

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Feibot-AK': config.accessKey,
      'X-Feibot-Timestamp': timestamp,
      'X-Feibot-Signature': signature,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Feibot processQuery failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch finished results for one or more participants in an event
 * Returns JSON with participant result data
 * 
 * GET /temporary/temporary_ResultDataQuery?event_uuid={eventUuid}&bib={bib1,bib2}
 * 
 * @param config Feibot API configuration
 * @param eventUuid Event UUID
 * @param filters Object with optional filters:
 *   - bib: comma-separated bib numbers (no spaces)
 *   - chip_code: chip code
 *   - name: participant name
 */
export async function fetchResultDataQuery(
  config: FeibotAPIConfig,
  eventUuid: string,
  filters?: {
    bib?: string | string[];
    chip_code?: string;
    name?: string;
  }
): Promise<ParticipantResult> {
  const path = '/temporary/temporary_ResultDataQuery';
  const query: Record<string, any> = { event_uuid: eventUuid };

  if (filters?.bib) {
    query.bib = Array.isArray(filters.bib) ? filters.bib.join(',') : filters.bib;
  }
  if (filters?.chip_code) query.chip_code = filters.chip_code;
  if (filters?.name) query.name = filters.name;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'GET';
  const body = '';

  const signatureQuery = buildSignatureQuery(query);
  const { signature } = buildSignature(method, path, timestamp, signatureQuery, body, config.secretKey);

  const url = new URL(config.apiBaseUrl + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, String(v)));

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Feibot-AK': config.accessKey,
      'X-Feibot-Timestamp': timestamp,
      'X-Feibot-Signature': signature,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Feibot resultDataQuery failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch all result data for an event by event UUID
 * Returns complete result dataset for all participants
 * 
 * GET /temporary/temporary_ResultDataGetAll?event_uuid={eventUuid}
 */
export async function fetchResultDataGetAll(
  config: FeibotAPIConfig,
  eventUuid: string
): Promise<{
  code: number;
  msg: string;
  data?: Array<ParticipantResult['data']>;
}> {
  const path = '/temporary/temporary_ResultDataGetAll';
  const query = { event_uuid: eventUuid };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'GET';
  const body = '';

  const signatureQuery = buildSignatureQuery(query);
  const { signature } = buildSignature(method, path, timestamp, signatureQuery, body, config.secretKey);

  const url = new URL(config.apiBaseUrl + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, String(v)));

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Feibot-AK': config.accessKey,
      'X-Feibot-Timestamp': timestamp,
      'X-Feibot-Signature': signature,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Feibot resultDataGetAll failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Look up one finisher's official result (RESULT_data) for an event
 * Returns JSON with single result object including splits, rankings, legs, etc.
 * id_code is normalized to last 6 alphanumeric characters before lookup
 * 
 * GET /finishResultQuery?event_uuid={eventUuid}&bib={bib1,bib2}
 * 
 * @param config Feibot API configuration
 * @param eventUuid Event UUID
 * @param filters Object with optional filters (at least one required):
 *   - bib: comma-separated bib numbers
 *   - chip_code: chip code
 *   - name: participant name
 *   - id_code: ID document number (normalized to last 6 chars)
 */
export async function fetchFinishResultQuery(
  config: FeibotAPIConfig,
  eventUuid: string,
  filters?: {
    bib?: string | string[];
    chip_code?: string;
    name?: string;
    id_code?: string;
  }
): Promise<ParticipantResult> {
  const path = '/finishResultQuery';
  const query: Record<string, any> = { event_uuid: eventUuid };

  if (filters?.bib) {
    query.bib = Array.isArray(filters.bib) ? filters.bib.join(',') : filters.bib;
  }
  if (filters?.chip_code) query.chip_code = filters.chip_code;
  if (filters?.name) query.name = filters.name;
  if (filters?.id_code) {
    const normalized = String(filters.id_code).slice(-6);
    query.id_code = normalized;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'GET';
  const body = '';

  const signatureQuery = buildSignatureQuery(query);
  const { signature } = buildSignature(method, path, timestamp, signatureQuery, body, config.secretKey);

  const url = new URL(config.apiBaseUrl + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.append(k, String(v)));

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Feibot-AK': config.accessKey,
      'X-Feibot-Timestamp': timestamp,
      'X-Feibot-Signature': signature,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Feibot finishResultQuery failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch raw timing data for devices under the current account
 * Uses account-level (AK-ACCOUNT) authentication
 * Returns compressed timing data from RFID sensors
 * 
 * POST /rawData/openDownload
 * 
 * Request body:
 * {
 *   "deviceCode": "D001,D002",
 *   "unixTimeStampMin": "0",
 *   "unixTimeStampMax": "9999999999999999",
 *   "N": 500
 * }
 * 
 * @param config Feibot API configuration (must be account-level AK)
 * @param deviceCodes Device codes comma-separated (max 100)
 * @param options Request options
 */
export async function fetchRawTimingData(
  config: FeibotAPIConfig,
  deviceCodes: string[],
  options?: {
    unixTimeStampMin?: number;
    unixTimeStampMax?: number;
    maxRowsPerDevice?: number;
    perDeviceMinTimestamps?: Record<string, number>;
  }
): Promise<RawTimingData> {
  const path = '/rawData/openDownload';
  const method = 'POST';

  const requestBody = {
    deviceCode: deviceCodes.join(','),
    unixTimeStampMin: options?.unixTimeStampMin?.toString() || '0',
    unixTimeStampMax: options?.unixTimeStampMax?.toString(),
    N: options?.maxRowsPerDevice || 500,
    ...(options?.perDeviceMinTimestamps || {}),
  };

  const body = JSON.stringify(requestBody);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signatureQuery = ''; // POST with body, no query params in signature

  const { signature } = buildSignature(method, path, timestamp, signatureQuery, body, config.secretKey);

  const url = new URL(config.apiBaseUrl + path);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      'X-Feibot-AK': config.accessKey,
      'X-Feibot-Timestamp': timestamp,
      'X-Feibot-Signature': signature,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Feibot rawTimingData failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Batch fetch finish results for multiple athletes
 * Utility function that calls fetchFinishResultQuery for multiple bibs/identifiers
 * 
 * @param config Feibot API configuration
 * @param eventUuid Event UUID
 * @param bibs Array of bib numbers
 */
export async function fetchFinishResultsBatch(
  config: FeibotAPIConfig,
  eventUuid: string,
  bibs: string[]
): Promise<ParticipantResult[]> {
  // Split into chunks of max 50 bibs per request (conservative limit)
  const chunkSize = 50;
  const results: ParticipantResult[] = [];

  for (let i = 0; i < bibs.length; i += chunkSize) {
    const chunk = bibs.slice(i, i + chunkSize);
    try {
      const result = await fetchFinishResultQuery(config, eventUuid, {
        bib: chunk,
      });
      if (result.data) {
        results.push(result);
      }
    } catch (error) {
      console.error(`Error fetching results for bibs ${chunk.join(',')}: ${error}`);
    }
  }

  return results;
}

/**
 * Poll leaderboard for real-time updates with exponential backoff retry
 * 
 * @param config Feibot API configuration
 * @param eventUuid Event UUID
 * @param maxAttempts Maximum retry attempts
 * @param initialDelayMs Initial delay between retries
 */
export async function pollLeaderboardWithRetry(
  config: FeibotAPIConfig,
  eventUuid: string,
  maxAttempts: number = 3,
  initialDelayMs: number = 1000
): Promise<LeaderboardConfig | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fetchLeaderboardQuery(config, eventUuid);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts - 1) {
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  if (lastError) {
    console.error(`Failed to fetch leaderboard after ${maxAttempts} attempts:`, lastError.message);
  }

  return null;
}
