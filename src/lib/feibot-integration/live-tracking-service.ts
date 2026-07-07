/**
 * Feibot Live Tracking Service
 * 
 * High-level service that integrates all Feibot endpoints with:
 * - Caching and request deduplication
 * - Polling for real-time updates
 * - Error handling and retry logic
 * - Event-driven data synchronization
 */

import type { FeibotAPIConfig } from './types';
import type {
  LeaderboardConfig,
  RaceProcess,
  ParticipantResult,
  RawTimingData,
} from './endpoints';
import {
  fetchLeaderboardQuery,
  fetchProcessQuery,
  fetchResultDataQuery,
  fetchResultDataGetAll,
  fetchFinishResultQuery,
  fetchRawTimingData,
  fetchFinishResultsBatch,
  pollLeaderboardWithRetry,
} from './endpoints';

// ============================================================================
// TYPES
// ============================================================================

export interface PollingConfig {
  enabled: boolean;
  intervalMs: number; // milliseconds between polls
  maxCacheAgeMs?: number; // cache valid duration
  retryOnError?: boolean;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface LeaderboardPollState {
  leaderboard: LeaderboardConfig | null;
  process: RaceProcess | null;
  lastUpdate: number;
  isPolling: boolean;
  error: string | null;
}

export interface ResultsSyncState {
  allResults: Map<string, ParticipantResult['data']>;
  lastSync: number;
  syncCount: number;
  error: string | null;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class FeibotLiveTrackingService {
  private config: FeibotAPIConfig;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pollingStates: Map<string, LeaderboardPollState> = new Map();
  private resultsSyncState: Map<string, ResultsSyncState> = new Map();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(config: FeibotAPIConfig) {
    this.config = config;
  }

  // ========================================================================
  // CACHE MANAGEMENT
  // ========================================================================

  /**
   * Get cached data if still valid
   */
  private getCached<T>(key: string, maxAgeMs?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (maxAgeMs && age > maxAgeMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cache entry
   */
  private setCached<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Clear cache by prefix
   */
  clearCache(prefix?: string): void {
    if (!prefix) {
      this.cache.clear();
      return;
    }

    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // ========================================================================
  // EVENT LISTENERS
  // ========================================================================

  /**
   * Subscribe to data updates for a key
   */
  subscribe(key: string, listener: (data: any) => void): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(key)?.delete(listener);
    };
  }

  /**
   * Emit update to all listeners
   */
  private emit(key: string, data: any): void {
    this.listeners.get(key)?.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        console.error(`Listener error for key ${key}:`, error);
      }
    });
  }

  // ========================================================================
  // LEADERBOARD POLLING
  // ========================================================================

  /**
   * Start polling leaderboard and process data
   */
  async startLeaderboardPolling(
    eventUuid: string,
    config: PollingConfig = {
      enabled: true,
      intervalMs: 2000, // 2 seconds
      maxCacheAgeMs: 3000, // 3 second cache
    }
  ): Promise<void> {
    if (!config.enabled) return;

    const stateKey = `leaderboard:${eventUuid}`;
    if (this.pollingIntervals.has(stateKey)) {
      console.warn(`Polling already active for ${stateKey}`);
      return;
    }

    // Initialize polling state
    this.pollingStates.set(stateKey, {
      leaderboard: null,
      process: null,
      lastUpdate: 0,
      isPolling: true,
      error: null,
    });

    const poll = async () => {
      const state = this.pollingStates.get(stateKey)!;
      try {
        // Fetch both leaderboard and process in parallel
        const [leaderboard, process] = await Promise.all([
          pollLeaderboardWithRetry(this.config, eventUuid),
          this.getProcessData(eventUuid, { maxCacheAgeMs: config.maxCacheAgeMs }),
        ]);

        state.leaderboard = leaderboard;
        state.process = process;
        state.lastUpdate = Date.now();
        state.error = null;

        // Emit updates
        this.emit(stateKey, { leaderboard, process });
      } catch (error) {
        state.error = String(error);
        console.error(`Leaderboard polling error for ${eventUuid}:`, error);
      }
    };

    // Initial poll
    await poll();

    // Set up interval
    const interval = setInterval(poll, config.intervalMs);
    this.pollingIntervals.set(stateKey, interval);
    console.log(`[Leaderboard] Started polling ${eventUuid} every ${config.intervalMs}ms`);
  }

  /**
   * Stop polling leaderboard
   */
  stopLeaderboardPolling(eventUuid: string): void {
    const stateKey = `leaderboard:${eventUuid}`;
    const interval = this.pollingIntervals.get(stateKey);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(stateKey);

      const state = this.pollingStates.get(stateKey);
      if (state) {
        state.isPolling = false;
      }

      console.log(`[Leaderboard] Stopped polling ${eventUuid}`);
    }
  }

  /**
   * Get current polling state
   */
  getLeaderboardState(eventUuid: string): LeaderboardPollState | null {
    return this.pollingStates.get(`leaderboard:${eventUuid}`) || null;
  }

  // ========================================================================
  // RESULT DATA QUERIES
  // ========================================================================

  /**
   * Get leaderboard data
   */
  async getLeaderboard(
    eventUuid: string,
    options?: { maxCacheAgeMs?: number; force?: boolean }
  ): Promise<LeaderboardConfig> {
    const cacheKey = `leaderboard:${eventUuid}:data`;

    if (!options?.force) {
      const cached = this.getCached<LeaderboardConfig>(cacheKey, options?.maxCacheAgeMs);
      if (cached) return cached;
    }

    const data = await fetchLeaderboardQuery(this.config, eventUuid);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get race process data
   */
  async getProcessData(
    eventUuid: string,
    options?: { maxCacheAgeMs?: number; force?: boolean }
  ): Promise<RaceProcess> {
    const cacheKey = `process:${eventUuid}:data`;

    if (!options?.force) {
      const cached = this.getCached<RaceProcess>(cacheKey, options?.maxCacheAgeMs);
      if (cached) return cached;
    }

    const data = await fetchProcessQuery(this.config, eventUuid);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get result data for specific participants
   */
  async getParticipantResult(
    eventUuid: string,
    filters?: {
      bib?: string | string[];
      chip_code?: string;
      name?: string;
    },
    options?: { maxCacheAgeMs?: number; force?: boolean }
  ): Promise<ParticipantResult> {
    const cacheKey = `result:${eventUuid}:${JSON.stringify(filters || {})}`;

    if (!options?.force) {
      const cached = this.getCached<ParticipantResult>(cacheKey, options?.maxCacheAgeMs);
      if (cached) return cached;
    }

    const data = await fetchResultDataQuery(this.config, eventUuid, filters);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get all results for event
   */
  async getAllResults(
    eventUuid: string,
    options?: { maxCacheAgeMs?: number; force?: boolean }
  ): Promise<Array<any>> {
    const cacheKey = `results:${eventUuid}:all`;

    if (!options?.force) {
      const cached = this.getCached<Array<any>>(cacheKey, options?.maxCacheAgeMs);
      if (cached) return cached;
    }

    const response = await fetchResultDataGetAll(this.config, eventUuid);
    const data = (response.data || []).filter((item) => item !== undefined);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get finish result for participant
   */
  async getFinishResult(
    eventUuid: string,
    filters?: {
      bib?: string | string[];
      chip_code?: string;
      name?: string;
      id_code?: string;
    },
    options?: { maxCacheAgeMs?: number; force?: boolean }
  ): Promise<ParticipantResult> {
    const cacheKey = `finish:${eventUuid}:${JSON.stringify(filters || {})}`;

    if (!options?.force) {
      const cached = this.getCached<ParticipantResult>(cacheKey, options?.maxCacheAgeMs);
      if (cached) return cached;
    }

    const data = await fetchFinishResultQuery(this.config, eventUuid, filters);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get finish results for multiple athletes
   */
  async getFinishResultsBatch(
    eventUuid: string,
    bibs: string[],
    options?: { maxCacheAgeMs?: number; force?: boolean }
  ): Promise<ParticipantResult[]> {
    const cacheKey = `finish:${eventUuid}:batch:${bibs.join(',')}`;

    if (!options?.force) {
      const cached = this.getCached<ParticipantResult[]>(cacheKey, options?.maxCacheAgeMs);
      if (cached) return cached;
    }

    const data = await fetchFinishResultsBatch(this.config, eventUuid, bibs);
    this.setCached(cacheKey, data);
    return data;
  }

  // ========================================================================
  // RAW TIMING DATA
  // ========================================================================

  /**
   * Get raw timing data from devices
   */
  async getRawTimingData(
    deviceCodes: string[],
    options?: {
      unixTimeStampMin?: number;
      unixTimeStampMax?: number;
      maxRowsPerDevice?: number;
      maxCacheAgeMs?: number;
      force?: boolean;
    }
  ): Promise<RawTimingData> {
    const cacheKey = `raw:${deviceCodes.join(',')}:${options?.unixTimeStampMin || 0}`;

    if (!options?.force) {
      const cached = this.getCached<RawTimingData>(
        cacheKey,
        options?.maxCacheAgeMs
      );
      if (cached) return cached;
    }

    const data = await fetchRawTimingData(this.config, deviceCodes, {
      unixTimeStampMin: options?.unixTimeStampMin,
      unixTimeStampMax: options?.unixTimeStampMax,
      maxRowsPerDevice: options?.maxRowsPerDevice,
    });

    this.setCached(cacheKey, data);
    return data;
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  /**
   * Stop all polling and cleanup resources
   */
  destroy(): void {
    // Stop all polling intervals
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
    this.pollingStates.clear();

    // Clear cache
    this.cache.clear();

    // Clear listeners
    this.listeners.clear();

    console.log('[FeibotLiveTrackingService] Destroyed');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let serviceInstance: FeibotLiveTrackingService | null = null;

export function initializeFeibotLiveTrackingService(config: FeibotAPIConfig): FeibotLiveTrackingService {
  if (serviceInstance) {
    console.warn('[FeibotLiveTrackingService] Service already initialized');
    return serviceInstance;
  }

  serviceInstance = new FeibotLiveTrackingService(config);
  return serviceInstance;
}

export function getFeibotLiveTrackingService(): FeibotLiveTrackingService {
  if (!serviceInstance) {
    throw new Error('[FeibotLiveTrackingService] Service not initialized. Call initializeFeibotLiveTrackingService first.');
  }
  return serviceInstance;
}
