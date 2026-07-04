// src/lib/actions/finishLineLedActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { putKV, getKV, deleteKV } from '@/lib/cloudflare/kv';
import type { LiveTrackingProviderState } from '@/lib/live-tracking/providerState';

const MAX_FINISHERS = 10;
const FINISH_LINE_FEED_TTL = 86400; // 24 hours in seconds
const PODIUM_ENTRIES_KEY = (eventId: string) => `podium_entries:${eventId}`;
const PODIUM_CURRENT_KEY = (eventId: string) => `podium_display:${eventId}:current`;

type ManualTimingMode = 'overall' | 'individual';
type ManualPodiumPosition = 'winner' | 'first_runner_up' | 'second_runner_up' | 'none';

export interface ManualPodiumEntryInput {
  docId?: string;
  eventId: string;
  bibNumber: string;
  timingMode: ManualTimingMode;
  podiumPosition?: ManualPodiumPosition;
  overallTime?: string;
  swim?: string;
  t1?: string;
  bike?: string;
  t2?: string;
  run?: string;
  athleteName?: string;
  category?: string;
  ageGroup?: string;
}

type PodiumResultRow = {
  name?: string;
  chipTime?: string | null;
  finishTime?: string | null;
  ticketName?: string | null;
  raceCategory?: string | null;
  category?: string | null;
  ageCategory?: string | null;
  ageGroup?: string | null;
  countryAtRace?: string | null;
  stateAtRace?: string | null;
  status?: string | null;
  statusNormalized?: string | null;
  oRank?: string | null;
  cRank?: string | null;
  manualPodiumPosition?: ManualPodiumPosition | null;
};

type PodiumAthlete = {
  name: string;
  finishTime: string;
  gapFromWinner: string;
  country?: string | null;
  state?: string | null;
};

export interface ManualPodiumEntry {
  docId: string;
  eventId: string;
  bibNumber: string;
  name: string;
  category: string;
  ageGroup: string;
  timingMode: ManualTimingMode;
  podiumPosition: ManualPodiumPosition;
  chipTime?: string | null;
  swim?: string | null;
  t1?: string | null;
  bike?: string | null;
  t2?: string | null;
  run?: string | null;
  updatedAt?: string | null;
}

export interface PodiumCategoryEntry {
  docId: string;
  eventId: string;
  bibNumber: string;
  name: string;
  category: string;
  ageGroup: string;
  timingMode: ManualTimingMode;
  finishTime: string;
  finishSeconds: number;
  podiumPosition: ManualPodiumPosition;
  sourceLabel: 'Auto Fetched' | 'Manually Added';
  isManualEntry: boolean;
  swim?: string | null;
  t1?: string | null;
  bike?: string | null;
  t2?: string | null;
  run?: string | null;
  updatedAt?: string | null;
}

export interface PodiumCurrentDisplay {
  eventId: string;
  category: string;
  ageGroup: string;
  style?: 'sequential' | 'full';
  displayMode?: 'top3' | 'single';
  selectedDocId?: string | null;
  athleteDisplaySeconds?: number;
  replayToken?: string | null;
  updatedAt: string;
}

export interface FinishLedBranding {
  eventId: string;
  eventName: string;
  logoUrl: string | null;
  sponsors: Array<{
    id: string;
    name: string;
    logoUrl?: string | null;
    order?: number;
  }>;
}

export interface FinishLedTracingEndpoint {
  label: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  description: string;
}

export interface FinishLedTracingSummary {
  eventId: string;
  eventName: string;
  provider: string;
  configurationSource: string;
  hasProviderState: boolean;
  providerStateUpdatedAt: string | null;
  participantsImported: boolean;
  lastSuccessfulParticipantImport: string | null;
  endpoints: FinishLedTracingEndpoint[];
  providerState: LiveTrackingProviderState | null;
}

export async function getFinishLedBranding(eventId: string): Promise<{
  success: boolean;
  branding?: FinishLedBranding;
  message?: string;
}> {
  const actionName = 'getFinishLedBranding';
  const ev = String(eventId || '').trim();
  if (!ev) {
    return { success: false, message: 'Missing eventId' };
  }

  try {
    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(ev);
    const [eventSnap, sponsorsSnap] = await Promise.all([
      eventRef.get(),
      eventRef.collection('sponsors').orderBy('order', 'asc').get().catch(async () => eventRef.collection('sponsors').get()),
    ]);

    const eventData = eventSnap.exists ? eventSnap.data() || {} : {};
    const sponsors = sponsorsSnap.docs
      .map((doc) => ({
        id: doc.id,
        name: String(doc.data()?.name || '').trim(),
        logoUrl: doc.data()?.logoUrl ? String(doc.data()?.logoUrl).trim() : null,
        order: Number(doc.data()?.order ?? 9999),
      }))
      .filter((s) => s.name || s.logoUrl)
      .sort((a, b) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    return {
      success: true,
      branding: {
        eventId: ev,
        eventName: String(eventData?.eventName || '').trim(),
        logoUrl: eventData?.finishLedLogoUrl ? String(eventData.finishLedLogoUrl).trim() : null,
        sponsors,
      },
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, message: 'Failed to load finish LED branding' };
  }
}

export async function getFinishLedTracing(eventId: string): Promise<{
  success: boolean;
  tracing?: FinishLedTracingSummary;
  message?: string;
}> {
  const actionName = 'getFinishLedTracing';
  const ev = String(eventId || '').trim();
  if (!ev) {
    return { success: false, message: 'Missing eventId' };
  }

  try {
    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(ev);
    const [eventSnap, providerConfig, providerState, providerParticipants] = await Promise.all([
      eventRef.get(),
      getKV<Record<string, any>>(`live:event:${ev}:provider-config`, actionName).catch(() => null),
      getKV<LiveTrackingProviderState>(`event:${ev}:providerState`, actionName).catch(() => null),
      getKV<Record<string, any>>(`event:${ev}:providerParticipants`, actionName).catch(() => null),
    ]);

    const eventData = eventSnap.exists ? eventSnap.data() || {} : {};
    const participantsImported = Boolean(
      providerState?.participantsImported ||
      (Array.isArray(providerParticipants?.participants) ? providerParticipants.participants.length > 0 : Number(providerParticipants?.importedCount || 0) > 0)
    );
    const provider = String(providerState?.provider || providerConfig?.provider || providerConfig?.feibotConfig?.provider || 'feibot').trim() || 'feibot';
    const configurationSource = String(providerState?.configurationSource || 'cloud_api').trim() || 'cloud_api';
    const providerStateUpdatedAt = providerState?.updatedAt ? String(providerState.updatedAt) : null;
    const lastSuccessfulParticipantImport = providerState?.lastSuccessfulParticipantImport
      || providerParticipants?.importTime
      || null;

    return {
      success: true,
      tracing: {
        eventId: ev,
        eventName: String(eventData?.eventName || '').trim(),
        provider,
        configurationSource,
        hasProviderState: Boolean(providerState),
        providerStateUpdatedAt,
        participantsImported,
        lastSuccessfulParticipantImport: lastSuccessfulParticipantImport ? String(lastSuccessfulParticipantImport) : null,
        providerState: providerState || null,
        endpoints: [
          {
            label: 'Finish LED public display',
            method: 'GET',
            path: `/finish_line_led.html?eventId=${encodeURIComponent(ev)}`,
            description: 'Public screen used on the LED display computer.',
          },
          {
            label: 'Finish LED data API',
            method: 'GET',
            path: `/api/finish-line-led?eventId=${encodeURIComponent(ev)}`,
            description: 'KV-first finisher feed used by the LED display.',
          },
          {
            label: 'Finish LED current podium',
            method: 'GET',
            path: `/api/finish-line-led?eventId=${encodeURIComponent(ev)}&action=podium-current`,
            description: 'Current podium or guest carousel state.',
          },
          {
            label: 'Finish LED branding',
            method: 'GET',
            path: `/api/finish-line-led?eventId=${encodeURIComponent(ev)}&action=branding`,
            description: 'Event logo and sponsor carousel source.',
          },
          {
            label: 'Live tracing provider state',
            method: 'GET',
            path: `/api/events/${encodeURIComponent(ev)}/liveTracking/providerState`,
            description: 'Live tracing state published by the tracking hub.',
          },
          {
            label: 'Live tracing provider config',
            method: 'GET',
            path: `/api/live/provider-config/${encodeURIComponent(ev)}`,
            description: 'Provider configuration and runtime validation.',
          },
        ],
      },
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, message: 'Failed to load finish LED tracing' };
  }
}

export async function resolveAthleteByBib(eventId: string, bibNumber: string): Promise<{
  success: boolean;
  athlete?: { name: string; category: string; ageGroup: string };
}> {
  const actionName = 'resolveAthleteByBib';
  const ev = String(eventId || '').trim();
  const bib = String(bibNumber || '').trim();
  if (!ev || !bib) return { success: false };

  try {
    const participants = await getKV<any[]>(`event:${ev}:participants:index`, actionName);
    if (Array.isArray(participants) && participants.length > 0) {
      const p = participants.find((x) => String(x?.bibNumber || '').trim() === bib);
      if (p) {
        return {
          success: true,
          athlete: {
            name: String(p?.name || '').trim(),
            category: String(p?.ticketName || p?.raceCategory || '').trim(),
            ageGroup: String(p?.ageCategory || '').trim(),
          },
        };
      }
    }

    // Fallback to results KV
    const resultRows = await getKV<any[]>(`results:${ev}`, actionName);
    if (Array.isArray(resultRows) && resultRows.length > 0) {
      const r = resultRows.find((x) => String(x?.bibNumber || '').trim() === bib);
      if (r) {
        return {
          success: true,
          athlete: {
            name: String(r?.name || '').trim(),
            category: String(r?.ticketName || r?.raceCategory || r?.category || '').trim(),
            ageGroup: String(r?.ageCategory || r?.ageGroup || '').trim(),
          },
        };
      }
    }

    return { success: false };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false };
  }
}

function parseTimeToSeconds(value?: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = String(value).trim();
  if (!t) return Number.POSITIVE_INFINITY;

  const parts = t.split(':').map(p => Number(p.trim()));
  if (parts.some(n => Number.isNaN(n))) return Number.POSITIVE_INFINITY;

  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }
  return Number.POSITIVE_INFINITY;
}

function formatSecondsToGap(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '+00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `+${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `+${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatSecondsToHMS(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeCategory(row: PodiumResultRow): string {
  return String(row.ticketName || row.raceCategory || row.category || '').trim();
}

function normalizeAgeGroup(row: PodiumResultRow): string {
  return String(row.ageCategory || row.ageGroup || '').trim();
}

function isFinished(row: PodiumResultRow): boolean {
  const status = String(row.statusNormalized || row.status || '').toLowerCase();
  if (status === 'finished') return true;
  const sec = parseTimeToSeconds(row.chipTime || row.finishTime);
  return Number.isFinite(sec) && sec < Number.POSITIVE_INFINITY;
}

/**
 * AUTO-SYNC: Called by Cloud Function when athlete finishes
 * Caches finisher data in KV for instant LED updates
 */
export async function _syncFinisherToKV(eventId: string, finisherData: any): Promise<void> {
  if (!eventId || !finisherData) return;
  const actionName = '_syncFinisherToKV';

  try {
    // 1. Add to KV finishers list
    const feedKey = `finish_line_feed:${eventId}`;
    const currentFinishers = await getKV<any[]>(feedKey, actionName) || [];

    // Add new finisher to front of list
    const updatedFinishers = [
      {
        ...finisherData,
        addedAt: new Date().toISOString()
      },
      ...currentFinishers
    ].slice(0, MAX_FINISHERS); // Keep only latest 10

    // Write back to KV with TTL
    await putKV(feedKey, updatedFinishers, actionName);

    // 2. Also cache individual finisher for quick lookup
    const finisherKey = `finish_line_feed:${eventId}:latest`;
    await putKV(finisherKey, finisherData, actionName);

    // 3. Update last-updated timestamp
    const metaKey = `finish_line_feed:${eventId}:meta`;
    await putKV(metaKey, {
      lastUpdate: new Date().toISOString(),
      totalFinishers: updatedFinishers.length,
      eventId
    }, actionName);

    console.log(`[${actionName}] Synced finisher ${finisherData.name} (BIB: ${finisherData.bib}) to KV for event ${eventId}`);
  } catch (error) {
    console.error(`[${actionName}] Error syncing finisher:`, error);
  }
}

/**
 * BULK SYNC: Sync all finishers from Firestore to KV
 * Useful for initial setup or recovery
 */
export async function _syncAllFinishersToKV(eventId: string): Promise<{ success: boolean; message: string; finishersCount?: number }> {
  if (!eventId) return { success: false, message: 'No event ID provided' };
  const actionName = '_syncAllFinishersToKV';

  try {
    const db = getFirestoreInstance();

    // Fetch all finishers from Firestore
    const feedRef = db.collection('finish_line_feed').doc(eventId).collection('entries');
    const snapshot = await feedRef.orderBy('timestamp', 'desc').limit(MAX_FINISHERS).get();

    const finishers: any[] = [];
    snapshot.forEach(doc => {
      finishers.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Write to KV
    const feedKey = `finish_line_feed:${eventId}`;
    await putKV(feedKey, finishers, actionName);

    // Update metadata
    const metaKey = `finish_line_feed:${eventId}:meta`;
    await putKV(metaKey, {
      lastUpdate: new Date().toISOString(),
      totalFinishers: finishers.length,
      syncedFrom: 'Firestore',
      eventId
    }, actionName);

    console.log(`[${actionName}] Synced ${finishers.length} finishers to KV for event ${eventId}`);

    return {
      success: true,
      message: `Synced ${finishers.length} finishers from Firestore to KV`,
      finishersCount: finishers.length
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      message: `Error syncing finishers: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * GET FROM KV: Fetch finishers from KV cache
 * Ultra-fast, no database query needed
 */
export async function getFinishersFromKV(eventId: string): Promise<{ success: boolean; finishers: any[]; source: 'kv' | 'firestore' | 'error' }> {
  if (!eventId) return { success: false, finishers: [], source: 'error' };
  const actionName = 'getFinishersFromKV';

  try {
    // Try KV first (ultra-fast)
    const feedKey = `finish_line_feed:${eventId}`;
    const cachedFinishers = await getKV<any[]>(feedKey, actionName);

    if (cachedFinishers && cachedFinishers.length > 0) {
      return {
        success: true,
        finishers: cachedFinishers,
        source: 'kv'
      };
    }

    // Fallback to Firestore if KV empty
    const db = getFirestoreInstance();
    const feedRef = db.collection('finish_line_feed').doc(eventId).collection('entries');
    const snapshot = await feedRef.orderBy('timestamp', 'desc').limit(MAX_FINISHERS).get();

    const finishers: any[] = [];
    snapshot.forEach(doc => {
      finishers.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Also save to KV for next time
    if (finishers.length > 0) {
      await putKV(feedKey, finishers, actionName);
    }

    return {
      success: true,
      finishers,
      source: 'firestore'
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      finishers: [],
      source: 'error'
    };
  }
}

/**
 * CLEAR KV CACHE: Reset finish line LED cache for an event
 */
export async function clearFinishLineKVCache(eventId: string): Promise<{ success: boolean; message: string }> {
  if (!eventId) return { success: false, message: 'No event ID provided' };
  const actionName = 'clearFinishLineKVCache';

  try {
    const feedKey = `finish_line_feed:${eventId}`;
    const latestKey = `finish_line_feed:${eventId}:latest`;
    const metaKey = `finish_line_feed:${eventId}:meta`;

    await Promise.all([
      deleteKV(feedKey, actionName),
      deleteKV(latestKey, actionName),
      deleteKV(metaKey, actionName)
    ]);

    console.log(`[${actionName}] Cleared KV cache for event ${eventId}`);
    return {
      success: true,
      message: `Cleared finish line LED cache for event ${eventId}`
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      message: `Error clearing cache: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * PODIUM OPTIONS: Fetch available race categories and age groups for an event.
 */
export async function getPodiumOptions(eventId: string): Promise<{
  success: boolean;
  categories: string[];
  ageGroups: string[];
  categoryAgeGroups: Record<string, string[]>;
  source: 'kv' | 'firestore' | 'error';
}> {
  if (!eventId) return { success: false, categories: [], ageGroups: [], categoryAgeGroups: {}, source: 'error' };
  const actionName = 'getPodiumOptions';

  const buildCategoryAgeMap = (rows: PodiumResultRow[]): Record<string, string[]> => {
    const map = new Map<string, Set<string>>();
    rows.forEach((r) => {
      const c = normalizeCategory(r);
      const a = normalizeAgeGroup(r);
      if (!c || !a) return;
      if (!map.has(c)) map.set(c, new Set<string>());
      map.get(c)!.add(a);
    });

    const out: Record<string, string[]> = {};
    map.forEach((set, key) => {
      out[key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    });
    return out;
  };

  try {
    // 1) SOURCE OF TRUTH: Event configuration from Tickets tab + Event age categories
    const db = getFirestoreInstance();
    const eventSnap = await db.collection('events').doc(eventId).get();
    const eventData = eventSnap.exists ? eventSnap.data() || {} : {};

    const eventAgeGroups: string[] = Array.isArray(eventData.ageCategories)
      ? eventData.ageCategories.map((x: any) => String(x || '').trim()).filter(Boolean)
      : [];

    const parseAgeGroups = (value: any, fallback: string[]): string[] => {
      if (Array.isArray(value)) {
        const arr = value.map((x) => String(x || '').trim()).filter(Boolean);
        return arr.length > 0 ? arr : fallback;
      }
      if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return fallback;
        if (s.toLowerCase() === 'all' || s.toLowerCase() === 'open') return fallback;
        const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
        return arr.length > 0 ? arr : fallback;
      }
      return fallback;
    };

    let ticketDefinitions: any[] = Array.isArray(eventData.ticketDefinitions)
      ? eventData.ticketDefinitions
      : [];

    // If not present in event doc, fallback to subcollection used by Tickets tab in some flows.
    if (ticketDefinitions.length === 0) {
      const ticketsSnap = await db.collection('events').doc(eventId).collection('ticketDefinitions').get();
      ticketDefinitions = ticketsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    if (ticketDefinitions.length > 0) {
      const sortedVisibleTickets = [...ticketDefinitions]
        .filter((ticket: any) => ticket && ticket.isHidden !== true)
        .sort((a: any, b: any) => Number(a?.order ?? 9999) - Number(b?.order ?? 9999));

      const categoryAgeGroups: Record<string, string[]> = {};

      sortedVisibleTickets.forEach((ticket: any) => {
        const baseName = String(ticket?.ticketName || '').trim();
        if (!baseName) return;

        const ticketAges = parseAgeGroups(ticket?.applicableAgeGroups, eventAgeGroups);
        const subCategories = Array.isArray(ticket?.subCategories) ? ticket.subCategories : [];

        // Swimathon sub-categories should appear as separate category options.
        // If sub-categories exist, we intentionally DO NOT add base ticket as a standalone category.
        if (subCategories.length > 0) {
          subCategories.forEach((sub: any) => {
            const subName = String(sub?.name || '').trim();
            if (!subName) return;
            const label = `${baseName} - ${subName}`;
            categoryAgeGroups[label] = parseAgeGroups(sub?.applicableAgeGroups, ticketAges);
          });
        } else if (!categoryAgeGroups[baseName]) {
          categoryAgeGroups[baseName] = ticketAges;
        }
      });

      const categories = Object.keys(categoryAgeGroups).sort((a, b) => a.localeCompare(b));
      const ageGroups = [...new Set(Object.values(categoryAgeGroups).flat().filter(Boolean))].sort((a, b) => a.localeCompare(b));

      return {
        success: true,
        categories,
        ageGroups,
        categoryAgeGroups,
        source: 'firestore',
      };
    }

    // 2) Fallback only if ticket definitions are unavailable.
    let rows: PodiumResultRow[] = [];
    const kvRows = await getKV<PodiumResultRow[]>(`results:${eventId}`, actionName);

    if (Array.isArray(kvRows) && kvRows.length > 0) {
      rows = kvRows;
      const categoryAgeGroups = buildCategoryAgeMap(rows);
      const categories = [...new Set(rows.map(normalizeCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const ageGroups = [...new Set(rows.map(normalizeAgeGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return { success: true, categories, ageGroups, categoryAgeGroups, source: 'kv' };
    }

    const snapshot = await db.collection('raceResults').where('eventId', '==', eventId).get();
    rows = snapshot.docs.map((doc) => doc.data() as PodiumResultRow);

    const categoryAgeGroups = buildCategoryAgeMap(rows);
    const categories = [...new Set(rows.map(normalizeCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const ageGroups = [...new Set(rows.map(normalizeAgeGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    return { success: true, categories, ageGroups, categoryAgeGroups, source: 'firestore' };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, categories: [], ageGroups: [], categoryAgeGroups: {}, source: 'error' };
  }
}

/**
 * PODIUM RESULTS: Get top 3 finished athletes by category and age group.
 */
export async function getPodiumResults(
  eventId: string,
  category: string,
  ageGroup: string
): Promise<{
  success: boolean;
  source: 'kv' | 'firestore' | 'error';
  category: string;
  ageGroup: string;
  podium: PodiumAthlete[];
}> {
  if (!eventId) return { success: false, source: 'error', category, ageGroup, podium: [] };
  const actionName = 'getPodiumResults';

  const pickTop3 = (rows: PodiumResultRow[]): PodiumAthlete[] => {
    const filtered = rows
      .filter(isFinished)
      .filter((r) => {
        const rowCategory = normalizeCategory(r).toLowerCase();
        const rowAge = normalizeAgeGroup(r).toLowerCase();
        const wantedCategory = category.trim().toLowerCase();
        const wantedAge = ageGroup.trim().toLowerCase();
        return rowCategory === wantedCategory && rowAge === wantedAge;
      })
      .map((r) => {
        const sec = parseTimeToSeconds(r.chipTime || r.finishTime);
        return {
          row: r,
          sec,
          oRank: Number.parseInt(String(r.oRank || ''), 10),
          cRank: Number.parseInt(String(r.cRank || ''), 10),
        };
      })
      .filter((x) => Number.isFinite(x.sec));

    if (filtered.length === 0) return [];

    const toAthlete = (x: typeof filtered[number], winnerSec: number): PodiumAthlete => ({
      name: String(x.row.name || 'Athlete').trim() || 'Athlete',
      finishTime: String(x.row.chipTime || x.row.finishTime || 'N/A'),
      gapFromWinner: formatSecondsToGap(Math.max(0, x.sec - winnerSec)),
      country: x.row.countryAtRace || null,
      state: x.row.stateAtRace || null,
    });

    const autoSorted = [...filtered]
      .sort((a, b) => {
        if (a.sec !== b.sec) return a.sec - b.sec;
        const aRank = Number.isFinite(a.cRank) ? a.cRank : (Number.isFinite(a.oRank) ? a.oRank : Number.MAX_SAFE_INTEGER);
        const bRank = Number.isFinite(b.cRank) ? b.cRank : (Number.isFinite(b.oRank) ? b.oRank : Number.MAX_SAFE_INTEGER);
        return aRank - bRank;
      });

    const byPosition: Record<'winner' | 'first_runner_up' | 'second_runner_up', typeof filtered[number] | undefined> = {
      winner: undefined,
      first_runner_up: undefined,
      second_runner_up: undefined,
    };

    filtered.forEach((x) => {
      const p = (x.row.manualPodiumPosition || 'none') as ManualPodiumPosition;
      if ((p === 'winner' || p === 'first_runner_up' || p === 'second_runner_up') && !byPosition[p]) {
        byPosition[p] = x;
      }
    });

    const usedNames = new Set<string>();
    const pickFallback = () => {
      const candidate = autoSorted.find((x) => {
        const key = `${x.row.name || ''}|${x.row.chipTime || x.row.finishTime || ''}`;
        return !usedNames.has(key);
      });
      if (!candidate) return undefined;
      const key = `${candidate.row.name || ''}|${candidate.row.chipTime || candidate.row.finishTime || ''}`;
      usedNames.add(key);
      return candidate;
    };

    const pickManualOrFallback = (manual?: typeof filtered[number]) => {
      if (manual) {
        const key = `${manual.row.name || ''}|${manual.row.chipTime || manual.row.finishTime || ''}`;
        if (!usedNames.has(key)) {
          usedNames.add(key);
          return manual;
        }
      }
      return pickFallback();
    };

    const p1 = pickManualOrFallback(byPosition.winner);
    const p2 = pickManualOrFallback(byPosition.first_runner_up);
    const p3 = pickManualOrFallback(byPosition.second_runner_up);

    const selected = [p1, p2, p3].filter(Boolean) as Array<typeof filtered[number]>;
    if (selected.length === 0) return [];

    const winnerSec = p1?.sec ?? selected[0].sec;
    return selected.map((x) => toAthlete(x, winnerSec));
  };

  try {
    const kvRows = await getKV<PodiumResultRow[]>(`results:${eventId}`, actionName);
    if (Array.isArray(kvRows) && kvRows.length > 0) {
      return {
        success: true,
        source: 'kv',
        category,
        ageGroup,
        podium: pickTop3(kvRows),
      };
    }

    const db = getFirestoreInstance();
    const snapshot = await db.collection('raceResults').where('eventId', '==', eventId).get();
    const rows = snapshot.docs.map((doc) => doc.data() as PodiumResultRow);

    return {
      success: true,
      source: 'firestore',
      category,
      ageGroup,
      podium: pickTop3(rows),
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, source: 'error', category, ageGroup, podium: [] };
  }
}

/**
 * MANUAL PODIUM ENTRY: Link athlete with BIB and save manual event timing.
 * Supports overall time OR individual leg times (SWIM + T1 + BIKE + T2 + RUN).
 */
export async function upsertManualPodiumEntry(input: ManualPodiumEntryInput): Promise<{
  success: boolean;
  message: string;
  docId?: string;
  category?: string;
  ageGroup?: string;
}> {
  const actionName = 'upsertManualPodiumEntry';

  try {
    const eventId = String(input.eventId || '').trim();
    const requestedDocId = String(input.docId || '').trim();
    const bibNumber = String(input.bibNumber || '').trim();
    const timingMode = input.timingMode;
    const podiumPosition = (input.podiumPosition || 'none') as ManualPodiumPosition;

    if (!eventId || !bibNumber) {
      return { success: false, message: 'Event ID and BIB number are required.' };
    }

    if (timingMode !== 'overall' && timingMode !== 'individual') {
      return { success: false, message: 'Invalid timing mode.' };
    }

    if (!['winner', 'first_runner_up', 'second_runner_up', 'none'].includes(podiumPosition)) {
      return { success: false, message: 'Invalid podium position.' };
    }

    const db = getFirestoreInstance();

    // KV-FIRST athlete lookup by BIB
    let participant: any = null;
    const participantsFromKv = await getKV<any[]>(`event:${eventId}:participants:index`, actionName);
    if (Array.isArray(participantsFromKv) && participantsFromKv.length > 0) {
      participant = participantsFromKv.find((p) => String(p?.bibNumber || '').trim() === bibNumber) || null;
    }

    // Fallback to Firestore if not found in KV
    if (!participant) {
      const participantSnap = await db
        .collection('events')
        .doc(eventId)
        .collection('participants')
        .where('bibNumber', '==', bibNumber)
        .limit(1)
        .get();
      participant = participantSnap.empty ? null : participantSnap.docs[0].data();
    }

    let swim: string | null = null;
    let t1: string | null = null;
    let bike: string | null = null;
    let t2: string | null = null;
    let run: string | null = null;
    let chipTime: string | null = null;

    if (timingMode === 'overall') {
      const overallSec = parseTimeToSeconds(input.overallTime || '');
      if (!Number.isFinite(overallSec) || overallSec <= 0) {
        return { success: false, message: 'Overall time must be in HH:MM:SS format.' };
      }
      chipTime = formatSecondsToHMS(overallSec);
    } else {
      swim = input.swim?.trim() || null;
      t1 = input.t1?.trim() || null;
      bike = input.bike?.trim() || null;
      t2 = input.t2?.trim() || null;
      run = input.run?.trim() || null;

      const swimSec = parseTimeToSeconds(swim);
      const t1Sec = parseTimeToSeconds(t1);
      const bikeSec = parseTimeToSeconds(bike);
      const t2Sec = parseTimeToSeconds(t2);
      const runSec = parseTimeToSeconds(run);

      if (![swimSec, t1Sec, bikeSec, t2Sec, runSec].every((v) => Number.isFinite(v) && v >= 0)) {
        return { success: false, message: 'All leg fields (SWIM, T1, BIKE, T2, RUN) must be in HH:MM:SS format.' };
      }

      chipTime = formatSecondsToHMS(swimSec + t1Sec + bikeSec + t2Sec + runSec);
    }

    const eventSnap = await db.collection('events').doc(eventId).get();
    const eventData = eventSnap.exists ? eventSnap.data() : null;

    const name = String(participant?.name || input.athleteName || '').trim();
    const category = String(participant?.ticketName || input.category || '').trim();
    const ageGroup = String(participant?.ageCategory || input.ageGroup || '').trim();

    if (!name) {
      return { success: false, message: 'Athlete not found by BIB. Please enter athlete name manually.' };
    }
    if (!category) {
      return { success: false, message: 'Race category is required.' };
    }
    if (!ageGroup) {
      return { success: false, message: 'Age group is required.' };
    }

    const eventDateRaw = eventData?.eventDate || null;
    const raceDate = typeof eventDateRaw === 'string' && eventDateRaw ? eventDateRaw : new Date().toISOString().slice(0, 10);
    const raceYear = Number.parseInt(String(raceDate).slice(0, 4), 10) || new Date().getFullYear();

    const payload: Record<string, any> = {
      bibNumber,
      name,
      email: String(participant?.email || '').trim(),
      emailLower: String(participant?.email || '').trim().toLowerCase(),
      mobile: participant?.mobile || null,
      registrationStatus: participant?.registrationStatus || 'confirmed',
      status: 'Finished',
      statusNormalized: 'Finished',
      category,
      ageCategory: ageGroup,
      ageGroup,
      gender: participant?.gender || 'Unknown',
      swim,
      t1,
      bike,
      t2,
      run,
      run1: null,
      run2: null,
      chipTime,
      cRank: null,
      oRank: null,
      gRank: null,
      raceCategory: category,
      ticketId: participant?.ticketId || null,
      ticketName: category,
      raceDate,
      location: String(eventData?.location || '').trim() || 'N/A',
      eventCategory: eventData?.eventCategory || null,
      athleteEmail: String(participant?.email || '').trim() || null,
      raceYear,
      eventId,
      eventName: String(eventData?.eventName || '').trim() || null,
      customSlug: eventData?.customSlug || null,
      athleteUid: participant?.athleteUid || participant?.userId || null,
      uploadedAt: new Date().toISOString(),
      backfilledAt: new Date().toISOString(),
      isManualEntry: true,
      manualTimingMode: timingMode,
      manualPodiumPosition: podiumPosition,
      updatedAt: new Date().toISOString(),
    };

    let docId: string;
    if (requestedDocId) {
      const ref = db.collection('raceResults').doc(requestedDocId);
      await ref.set(payload, { merge: true });
      docId = ref.id;
    } else {
      const existingSnap = await db
        .collection('raceResults')
        .where('eventId', '==', eventId)
        .where('bibNumber', '==', bibNumber)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        const ref = existingSnap.docs[0].ref;
        await ref.set(payload, { merge: true });
        docId = ref.id;
      } else {
        const created = await db.collection('raceResults').add({
          ...payload,
          createdAt: new Date().toISOString(),
        });
        docId = created.id;
      }
    }

    const kvKey = `results:${eventId}`;
    const kvRows = (await getKV<any[]>(kvKey, actionName)) || [];
    const updatedRow = { docId, ...payload };
    const existingIdx = kvRows.findIndex((r) => String(r?.bibNumber || '') === bibNumber);
    if (existingIdx >= 0) {
      kvRows[existingIdx] = { ...kvRows[existingIdx], ...updatedRow };
    } else {
      kvRows.push(updatedRow);
    }
    await putKV(kvKey, kvRows, actionName);

    // Save into dedicated podium KV store (manual entries list)
    const podiumEntriesKey = PODIUM_ENTRIES_KEY(eventId);
    const podiumEntries = (await getKV<ManualPodiumEntry[]>(podiumEntriesKey, actionName)) || [];
    const mappedManual: ManualPodiumEntry = {
      docId,
      eventId,
      bibNumber,
      name,
      category,
      ageGroup,
      timingMode,
      podiumPosition,
      chipTime,
      swim,
      t1,
      bike,
      t2,
      run,
      updatedAt: payload.updatedAt,
    };
    const podiumIdx = podiumEntries.findIndex((e) => e.docId === docId);
    if (podiumIdx >= 0) {
      podiumEntries[podiumIdx] = mappedManual;
    } else {
      podiumEntries.unshift(mappedManual);
    }
    await putKV(podiumEntriesKey, podiumEntries, actionName);

    return {
      success: true,
      message: `Manual result saved for BIB ${bibNumber}`,
      docId,
      category,
      ageGroup,
    };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      message: `Failed to save manual podium entry: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getManualPodiumEntries(eventId: string): Promise<{
  success: boolean;
  entries: ManualPodiumEntry[];
  source: 'kv' | 'firestore' | 'error';
}> {
  const actionName = 'getManualPodiumEntries';
  if (!eventId) return { success: false, entries: [], source: 'error' };

  const mapRow = (row: any): ManualPodiumEntry | null => {
    if (!row?.docId || !row?.isManualEntry) return null;
    return {
      docId: String(row.docId),
      eventId: String(row.eventId || eventId),
      bibNumber: String(row.bibNumber || ''),
      name: String(row.name || ''),
      category: String(row.ticketName || row.raceCategory || row.category || ''),
      ageGroup: String(row.ageCategory || row.ageGroup || ''),
      timingMode: (row.manualTimingMode || 'overall') as ManualTimingMode,
      podiumPosition: (row.manualPodiumPosition || 'none') as ManualPodiumPosition,
      chipTime: row.chipTime || null,
      swim: row.swim || null,
      t1: row.t1 || null,
      bike: row.bike || null,
      t2: row.t2 || null,
      run: row.run || null,
      updatedAt: row.updatedAt || null,
    };
  };

  try {
    const podiumEntries = await getKV<ManualPodiumEntry[]>(PODIUM_ENTRIES_KEY(eventId), actionName);
    if (Array.isArray(podiumEntries) && podiumEntries.length > 0) {
      const sorted = [...podiumEntries].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return { success: true, entries: sorted, source: 'kv' };
    }

    const kvRows = await getKV<any[]>(`results:${eventId}`, actionName);
    if (Array.isArray(kvRows) && kvRows.length > 0) {
      const entries = kvRows
        .map(mapRow)
        .filter(Boolean) as ManualPodiumEntry[];
      entries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return { success: true, entries, source: 'kv' };
    }

    const db = getFirestoreInstance();
    const snap = await db
      .collection('raceResults')
      .where('eventId', '==', eventId)
      .where('isManualEntry', '==', true)
      .get();

    const entries = snap.docs
      .map((doc) => mapRow({ docId: doc.id, ...doc.data() }))
      .filter(Boolean) as ManualPodiumEntry[];

    entries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { success: true, entries, source: 'firestore' };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, entries: [], source: 'error' };
  }
}

export async function deleteManualPodiumEntry(eventId: string, docId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const actionName = 'deleteManualPodiumEntry';
  if (!eventId || !docId) {
    return { success: false, message: 'eventId and docId are required.' };
  }

  try {
    const db = getFirestoreInstance();
    await db.collection('raceResults').doc(docId).delete();

    const kvKey = `results:${eventId}`;
    const kvRows = (await getKV<any[]>(kvKey, actionName)) || [];
    const filtered = kvRows.filter((r) => String(r?.docId || '') !== docId);
    await putKV(kvKey, filtered, actionName);

    const podiumEntries = (await getKV<ManualPodiumEntry[]>(PODIUM_ENTRIES_KEY(eventId), actionName)) || [];
    const filteredPodiumEntries = podiumEntries.filter((e) => e.docId !== docId);
    await putKV(PODIUM_ENTRIES_KEY(eventId), filteredPodiumEntries, actionName);

    return { success: true, message: 'Manual award deleted.' };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      message: `Failed to delete manual award: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getPodiumCategoryEntries(
  eventId: string,
  category: string,
  ageGroup: string
): Promise<{
  success: boolean;
  entries: PodiumCategoryEntry[];
  source: 'kv' | 'firestore' | 'error';
}> {
  const actionName = 'getPodiumCategoryEntries';
  if (!eventId) return { success: false, entries: [], source: 'error' };

  const mapRow = (row: any): PodiumCategoryEntry | null => {
    const rowCategory = String(row?.ticketName || row?.raceCategory || row?.category || '').trim();
    const rowAge = String(row?.ageCategory || row?.ageGroup || '').trim();
    if (!rowCategory || !rowAge) return null;
    if (rowCategory.toLowerCase() !== category.trim().toLowerCase()) return null;
    if (rowAge.toLowerCase() !== ageGroup.trim().toLowerCase()) return null;

    const finishTime = String(row?.chipTime || row?.finishTime || '').trim();
    const finishSeconds = parseTimeToSeconds(finishTime);
    if (!Number.isFinite(finishSeconds)) return null;

    const manual = !!row?.isManualEntry;
    return {
      docId: String(row?.docId || ''),
      eventId: String(row?.eventId || eventId),
      bibNumber: String(row?.bibNumber || ''),
      name: String(row?.name || ''),
      category: rowCategory,
      ageGroup: rowAge,
      timingMode: (row?.manualTimingMode || 'overall') as ManualTimingMode,
      finishTime,
      finishSeconds,
      podiumPosition: (row?.manualPodiumPosition || 'none') as ManualPodiumPosition,
      sourceLabel: manual ? 'Manually Added' : 'Auto Fetched',
      isManualEntry: manual,
      swim: row?.swim || null,
      t1: row?.t1 || null,
      bike: row?.bike || null,
      t2: row?.t2 || null,
      run: row?.run || null,
      updatedAt: row?.updatedAt || null,
    };
  };

  const sortEntries = (entries: PodiumCategoryEntry[]) => {
    return [...entries].sort((a, b) => {
      const posWeight = (p: ManualPodiumPosition) => {
        if (p === 'winner') return 0;
        if (p === 'first_runner_up') return 1;
        if (p === 'second_runner_up') return 2;
        return 999;
      };
      const diffPos = posWeight(a.podiumPosition) - posWeight(b.podiumPosition);
      if (diffPos !== 0) return diffPos;
      if (a.finishSeconds !== b.finishSeconds) return a.finishSeconds - b.finishSeconds;
      return a.name.localeCompare(b.name);
    });
  };

  try {
    const kvRows = await getKV<any[]>(`results:${eventId}`, actionName);
    if (Array.isArray(kvRows) && kvRows.length > 0) {
      const entries = sortEntries(
        kvRows
          .map((r) => mapRow(r))
          .filter(Boolean) as PodiumCategoryEntry[]
      );
      return { success: true, entries, source: 'kv' };
    }

    const db = getFirestoreInstance();
    const snap = await db.collection('raceResults').where('eventId', '==', eventId).get();
    const entries = sortEntries(
      snap.docs
        .map((doc) => mapRow({ docId: doc.id, ...doc.data() }))
        .filter(Boolean) as PodiumCategoryEntry[]
    );

    return { success: true, entries, source: 'firestore' };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, entries: [], source: 'error' };
  }
}

export async function setPodiumCurrentDisplay(input: {
  eventId: string;
  category: string;
  ageGroup: string;
  style?: 'sequential' | 'full';
  displayMode?: 'top3' | 'single' | 'sponsors' | 'guests';
  selectedDocId?: string | null;
  athleteDisplaySeconds?: number;
  replayToken?: string | null;
  guests?: Array<{ name: string; designation?: string }>;
}): Promise<{ success: boolean; message: string; data?: PodiumCurrentDisplay }> {
  const actionName = 'setPodiumCurrentDisplay';
  const eventId = String(input.eventId || '').trim();
  const category = String(input.category || '').trim();
  const ageGroup = String(input.ageGroup || '').trim();
  if (!eventId || !category || !ageGroup) {
    return { success: false, message: 'eventId, category and ageGroup are required.' };
  }

  try {
    const payload: any = {
      eventId,
      category,
      ageGroup,
      style: input.style || 'sequential',
      displayMode: input.displayMode || 'top3',
      selectedDocId: input.selectedDocId || null,
      athleteDisplaySeconds: Number.isFinite(Number(input.athleteDisplaySeconds))
        ? Math.min(30, Math.max(2, Number(input.athleteDisplaySeconds)))
        : 4,
      replayToken: input.replayToken ? String(input.replayToken) : null,
      updatedAt: new Date().toISOString(),
    };

    // Add guests if provided
    if (input.guests && Array.isArray(input.guests)) {
      payload.guests = input.guests;
    }

    await putKV(PODIUM_CURRENT_KEY(eventId), payload, actionName);
    return { success: true, message: 'Current podium display updated.', data: payload };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return {
      success: false,
      message: `Failed to set current podium display: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getPodiumCurrentDisplay(eventId: string): Promise<{
  success: boolean;
  data: PodiumCurrentDisplay | null;
}> {
  const actionName = 'getPodiumCurrentDisplay';
  const id = String(eventId || '').trim();
  if (!id) return { success: false, data: null };

  try {
    const data = await getKV<PodiumCurrentDisplay>(PODIUM_CURRENT_KEY(id), actionName);
    return { success: true, data: data || null };
  } catch (error) {
    console.error(`[${actionName}] Error:`, error);
    return { success: false, data: null };
  }
}
