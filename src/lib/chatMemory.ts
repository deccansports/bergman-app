'use server';

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import type { ClubRankingEntry } from '@/lib/types';

// Get Firestore instance lazily to avoid initialization errors in build workers
let db: admin.firestore.Firestore | null = null;

function getDb() {
  if (!db) {
    db = admin.firestore();
  }
  return db;
}

// Cloudflare KV API configuration
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

const KV_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;

// Helper: Call Cloudflare KV API
async function kvFetch(method: string, path: string, body?: unknown) {
  try {
    const url = `${KV_BASE_URL}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
      console.error('[KV] Error:', response.status, await response.text());
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('[KV] Fetch error:', error);
    return null;
  }
}

// Helper: Get value from KV
async function kvGet(key: string): Promise<string | null> {
  try {
    const response = await fetch(`${KV_BASE_URL}/values/${encodeURIComponent(key)}`, {
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
      },
    });
    if (response.ok) return await response.text();
    return null;
  } catch (error) {
    console.error('[KV] Get error:', error);
    return null;
  }
}

// Helper: Put value in KV
async function kvPut(key: string, value: string, ttl?: number): Promise<boolean> {
  try {
    const url = `${KV_BASE_URL}/values/${encodeURIComponent(key)}`;
    const options: RequestInit = {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
      },
      body: value,
    };
    if (ttl) {
      options.headers = {
        ...options.headers,
        'X-TTL': String(ttl), // TTL in seconds (7 days = 604800)
      };
    }

    const response = await fetch(url, options);
    return response.ok;
  } catch (error) {
    console.error('[KV] Put error:', error);
    return false;
  }
}

// Helper: List keys in KV
async function kvList(prefix: string): Promise<string[]> {
  try {
    let allKeys: string[] = [];
    let cursor: string | undefined = undefined;
    
    // Handle pagination for Cloudflare KV API
    while (true) {
      const url = new URL(`${KV_BASE_URL}/keys`);
      url.searchParams.append('prefix', prefix);
      url.searchParams.append('limit', '1000'); // Max limit per page
      if (cursor) {
        url.searchParams.append('cursor', cursor);
      }
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
        },
      });
      
      if (!response.ok) {
        console.warn(`[KV] List error for prefix ${prefix}: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const keys = data.result?.map((item: { name: string }) => item.name) || [];
      allKeys.push(...keys);
      
      // Check if there are more pages
      cursor = data.result_info?.cursor;
      if (!cursor || keys.length === 0) {
        break;
      }
    }
    
    return allKeys;
  } catch (error) {
    console.error('[KV] List error:', error);
    return [];
  }
}

export interface ChatMemory {
  id?: string;
  question: string;
  answer: string;
  timestamp: Timestamp;
  userId?: string;
  eventId?: string;
  helpful?: boolean;
  views?: number;
}

/**
 * Save a Q&A pair to both Firestore and Cloudflare KV (learning database)
 */
export async function saveChatMemory(
  question: string,
  answer: string,
  userId?: string,
  eventId?: string
): Promise<string> {
  try {
    // Prepare memory object
    const memory: ChatMemory = {
      question: question.toLowerCase(),
      answer,
      timestamp: Timestamp.now(),
      userId,
      eventId,
      helpful: true,
      views: 0,
    };

    // Write to Firestore (for long-term storage and backups)
    const fsDocRef = await getDb().collection('chatMemory').add(memory);
    const memoryId = fsDocRef.id;

    // Also write to KV (for fast reads)
    const kvKey = `chat:${memoryId}`;
    const kvValue = JSON.stringify({ ...memory, id: memoryId });
    const kvSuccess = await kvPut(kvKey, kvValue, 604800); // 7 days TTL
    
    // Index for searching: store lowercase keywords
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const keyword of keywords) {
      const indexKey = `idx:${keyword}:${memoryId}`;
      await kvPut(indexKey, memoryId, 604800);
    }

    console.log('[ChatMemory] Saved:', memoryId, '| KV:', kvSuccess);
    return memoryId;
  } catch (error) {
    console.error('[ChatMemory] Error saving:', error);
    return '';
  }
}

/**
 * Search for similar past questions - READ FROM KV FIRST for speed
 */
export async function searchSimilarQuestions(
  question: string,
  limit: number = 3
): Promise<ChatMemory[]> {
  try {
    const questionLower = question.toLowerCase();
    const keywords = questionLower.split(/\s+/).filter(w => w.length > 2);

    if (keywords.length === 0) return [];

    // Step 1: Try KV first (fast, cheap reads)
    console.log('[ChatMemory] Searching KV for keywords:', keywords);
    const kvResults: { doc: ChatMemory; score: number }[] = [];
    
    for (const keyword of keywords) {
      const indexKeys = await kvList(`idx:${keyword}:`);
      console.log('[ChatMemory] Found', indexKeys.length, 'matches for keyword:', keyword);
      
      for (const indexKey of indexKeys.slice(0, 20)) {
        const memoryId = indexKey.split(':')[2];
        const kvKey = `chat:${memoryId}`;
        const kvValue = await kvGet(kvKey);
        
        if (kvValue) {
          const data = JSON.parse(kvValue) as ChatMemory;
          const existingResult = kvResults.find(r => r.doc.id === data.id);
          
          if (existingResult) {
            existingResult.score += 2;
          } else {
            kvResults.push({
              doc: data,
              score: 2,
            });
          }
        }
      }
    }

    console.log('[ChatMemory] KV search returned', kvResults.length, 'results');

    // If we got good results from KV, return them (avoid Firestore read)
    if (kvResults.length >= limit) {
      return kvResults
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(r => r.doc);
    }

    // Step 2: Fallback to Firestore only if KV doesn't have enough results
    console.log('[ChatMemory] KV had', kvResults.length, 'results, querying Firestore...');
    
    const fsSnapshot = await getDb().collection('chatMemory').limit(50).get();
    const fsResults: { doc: ChatMemory; score: number }[] = [];

    fsSnapshot.forEach((doc: FirebaseFirestore.DocumentSnapshot) => {
      const data = doc.data() as ChatMemory;
      let score = 0;

      keywords.forEach(keyword => {
        if (data.question.includes(keyword)) score += 2;
        if (data.answer.toLowerCase().includes(keyword)) score += 1;
      });

      if (score > 0) {
        fsResults.push({
          doc: { ...data, id: doc.id },
          score,
        });
      }
    });

    // Merge KV and Firestore results
    const allResults = [...kvResults, ...fsResults];
    const merged = new Map<string, { doc: ChatMemory; score: number }>();
    
    for (const result of allResults) {
      const key = result.doc.id || '';
      if (!key) continue;
      
      if (merged.has(key)) {
        merged.get(key)!.score += result.score;
      } else {
        merged.set(key, result);
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.doc);
  } catch (error) {
    console.error('[ChatMemory] Error searching:', error);
    return [];
  }
}

/**
 * Get the most helpful past answers (for FAQ generation)
 */
export async function getMostHelpfulAnswers(limit: number = 10): Promise<ChatMemory[]> {
  try {
    const snapshot = await getDb()
      .collection('chatMemory')
      .where('helpful', '==', true)
      .orderBy('views', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc: FirebaseFirestore.DocumentSnapshot) => ({
      ...doc.data() as ChatMemory,
      id: doc.id,
    }));
  } catch (error) {
    console.error('[ChatMemory] Error getting helpful answers:', error);
    return [];
  }
}

/**
 * Mark an answer as helpful/unhelpful
 */
export async function markAnswerHelpful(
  chatMemoryId: string,
  helpful: boolean
): Promise<void> {
  try {
    await getDb().collection('chatMemory').doc(chatMemoryId).update({
      helpful,
      views: Timestamp.now(),
    });
  } catch (error) {
    console.error('[ChatMemory] Error marking helpful:', error);
  }
}

/**
 * Get format for including past Q&A in context
 */
export async function formatPastAnswers(memories: ChatMemory[]): Promise<string> {
  if (memories.length === 0) return '';

  const formattedAnswers = memories
    .map((m, i) => `PAST Q&A ${i + 1}:\nQ: ${m.question}\nA: ${m.answer}`)
    .join('\n\n');

  return `\n\nRELATED PAST ANSWERS (for context and consistency):\n${formattedAnswers}`;
}
/**
 * Get upcoming races for an athlete by searching KV participant registrations
 * Key format: event:{eventId}:participant:{bookingId}
 * Searches all KV entries and filters by email
 */
export async function getUpcomingRacesFromKV(email: string): Promise<Array<{ eventId: string; eventName: string; bookingId: string; registeredDate?: string }>> {
  try {
    const normalizedEmail = email.toLowerCase();
    const upcomingRaces: Array<{ eventId: string; eventName: string; bookingId: string; registeredDate?: string }> = [];
    
    // List all participant keys in KV
    const keys = await kvList('event:');
    
    for (const key of keys) {
      // Parse key: event:{eventId}:participant:{bookingId}
      const match = key.match(/^event:([^:]+):participant:(.+)$/);
      if (!match) continue;
      
      const [, eventId, bookingId] = match;
      const kvValue = await kvGet(key);
      
      if (!kvValue) continue;
      
      try {
        const participantData = JSON.parse(kvValue);
        
        // Match by email
        if (participantData.email?.toLowerCase() === normalizedEmail) {
          // Only include active registrations
          if (participantData.ticketStatus === 'Active' || participantData.ticketStatus === 'Confirmed') {
            upcomingRaces.push({
              eventId,
              eventName: participantData.eventName || 'Unknown Event',
              bookingId,
              registeredDate: participantData.registeredAt || participantData.createdAt
            });
          }
        }
      } catch (parseError) {
        // Skip malformed entries
        console.warn(`[ChatMemory] Failed to parse KV value for ${key}:`, parseError);
      }
    }
    
    console.log(`[ChatMemory] Found ${upcomingRaces.length} upcoming races for ${email} from KV`);
    return upcomingRaces;
    
  } catch (error) {
    console.error('[ChatMemory] Error fetching upcoming races from KV:', error);
    return [];
  }
}

/**
 * Search clubs from KV by optional city filter with ranking
 * Ranking based on: member count + upcoming participants
 * Key format: club:{clubId}
 * Returns club details with ranking score
 */
export async function searchClubsFromKV(city?: string): Promise<Array<{
  id: string;
  name: string;
  coach_name: string;
  email: string;
  mobile?: string;
  city?: string;
  state?: string;
  country?: string;
  memberCount?: number;
  rankingScore?: number;
  lastYearRank?: number;
  lastYearPoints?: number;
  rankingYear?: number;
  logoUrl?: string;
}>> {
  try {
    const TRAINING_CLUBS_CACHE_KEY = 'training:clubs:ranked:v2';
    const TRAINING_CLUBS_CACHE_TTL_SECONDS = 2 * 60;

    const filterByCity = (items: Array<{
      id: string;
      name: string;
      coach_name: string;
      email: string;
      mobile?: string;
      city?: string;
      state?: string;
      country?: string;
      memberCount?: number;
      rankingScore?: number;
      lastYearRank?: number;
      lastYearPoints?: number;
      rankingYear?: number;
      logoUrl?: string;
    }>) => {
      if (!city) return items;
      const normalizedCity = city.toLowerCase();
      return items.filter((club) => String(club.city || '').toLowerCase().includes(normalizedCity));
    };

    // Fast path: read pre-ranked aggregate list from a single KV key.
    const cachedPayloadRaw = await kvGet(TRAINING_CLUBS_CACHE_KEY);
    if (cachedPayloadRaw) {
      try {
        const cachedPayload = JSON.parse(cachedPayloadRaw) as {
          generatedAt?: string;
          clubs?: Array<{
            id: string;
            name: string;
            coach_name: string;
            email: string;
            mobile?: string;
            city?: string;
            state?: string;
            country?: string;
            memberCount?: number;
            rankingScore?: number;
            lastYearRank?: number;
            lastYearPoints?: number;
            rankingYear?: number;
            logoUrl?: string;
          }>;
        };

        if (Array.isArray(cachedPayload?.clubs) && cachedPayload.clubs.length > 0) {
          const ageMs = cachedPayload.generatedAt ? Date.now() - new Date(cachedPayload.generatedAt).getTime() : Number.MAX_SAFE_INTEGER;
          if (ageMs < TRAINING_CLUBS_CACHE_TTL_SECONDS * 1000) {
            const filteredFromCache = filterByCity(cachedPayload.clubs);
            console.log(`[ChatMemory] Training clubs served from aggregated KV cache (${filteredFromCache.length} clubs${city ? ` in ${city}` : ''})`);
            return filteredFromCache;
          }
        }
      } catch {
        // Ignore malformed cache and rebuild below.
      }
    }

    const currentYear = new Date().getFullYear();
    const rankingYears = [currentYear - 1, currentYear - 2, currentYear - 3, currentYear];

    const getRankingsForYear = async (year: number): Promise<ClubRankingEntry[]> => {
      const raw = await kvGet(`rankings:clubs:${year}`);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as ClubRankingEntry[] : [];
      } catch {
        return [];
      }
    };

    const rankingsByYear = await Promise.all(rankingYears.map(async (year) => ({
      year,
      rankings: await getRankingsForYear(year),
    })));

    const historicalPerformanceByClubId = new Map<string, {
      weightedPoints: number;
      weightedAthletes: number;
      bestRank?: number;
      latestYear?: number;
      latestPoints?: number;
    }>();

    rankingsByYear.forEach(({ year, rankings }, index) => {
      const weight = index === 0 ? 1 : index === 1 ? 0.75 : index === 2 ? 0.5 : 0.6;
      for (const ranking of rankings) {
        if (!ranking?.clubId) continue;
        const clubId = String(ranking.clubId);
        const existing = historicalPerformanceByClubId.get(clubId) || {
          weightedPoints: 0,
          weightedAthletes: 0,
          bestRank: undefined,
          latestYear: undefined,
          latestPoints: undefined,
        };

        existing.weightedPoints += Number(ranking.totalPoints || 0) * weight;
        existing.weightedAthletes += Number(ranking.athleteCount || 0) * weight;

        if (ranking.overallRank && (!existing.bestRank || ranking.overallRank < existing.bestRank)) {
          existing.bestRank = ranking.overallRank;
        }

        if (!existing.latestYear || year > existing.latestYear) {
          existing.latestYear = year;
          existing.latestPoints = Number(ranking.totalPoints || 0);
        }

        historicalPerformanceByClubId.set(clubId, existing);
      }
    });

    const clubs: Array<{
      id: string;
      name: string;
      coach_name: string;
      email: string;
      mobile?: string;
      city?: string;
      state?: string;
      country?: string;
      memberCount?: number;
      rankingScore?: number;
      lastYearRank?: number;
      lastYearPoints?: number;
      rankingYear?: number;
      logoUrl?: string;
    }> = [];
    
    // Track seen club IDs to prevent duplicates
    const seenClubIds = new Set<string>();

    // PRIMARY SOURCE: aggregate `clubs:full` key (always rewritten on every sync,
    // and immediately readable since it's a get-by-key, not a list).
    // Cloudflare KV's `list` API is eventually consistent (writes take up to ~60s
    // to appear), so reading `clubs:full` directly avoids that lag and is also
    // far faster than walking N per-club keys.
    let clubKeyValuePairs: Array<{ key: string; raw: string }> = [];
    try {
      const fullRaw = await kvGet('clubs:full');
      if (fullRaw) {
        const parsed = JSON.parse(fullRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          clubKeyValuePairs = parsed
            .filter((c) => c && (c.id || c.clubId))
            .map((c) => ({
              key: `club:${c.id || c.clubId}`,
              raw: JSON.stringify(c),
            }));
          console.log(`[ChatMemory] Loaded ${clubKeyValuePairs.length} clubs from clubs:full aggregate`);
        }
      }
    } catch (e) {
      console.warn('[ChatMemory] Failed to read clubs:full aggregate, will fall back to kvList:', e);
    }

    // FALLBACK: list per-club keys (slower, eventually consistent)
    if (clubKeyValuePairs.length === 0) {
      const keys = await kvList('club:');
      for (const key of keys) {
        if (key.includes(':members:') || key.includes(':upcoming')) continue;
        if (!key.match(/^club:[^:]+$/)) continue;
        const raw = await kvGet(key);
        if (raw) clubKeyValuePairs.push({ key, raw });
      }
      console.log(`[ChatMemory] Fallback: loaded ${clubKeyValuePairs.length} clubs via kvList`);
    }

    for (const { key, raw: kvValue } of clubKeyValuePairs) {
      try {
        const clubData = JSON.parse(kvValue);
        const clubId = clubData.id || key.replace('club:', '');
        
        // Skip if we've already processed this club
        if (seenClubIds.has(clubId)) {
          console.warn(`[ChatMemory] Duplicate club found: ${clubId} from key ${key}`);
          continue;
        }
        seenClubIds.add(clubId);
        
        // Skip clubs with no name (truly invalid)
        if (!clubData.name) {
          console.warn(`[ChatMemory] Skipping club with no name:`, clubData.id);
          continue;
        }

        // Get member count and upcoming participants for ranking
        // Member count is already in club data
        const memberCount = clubData.memberCount || 0;
        
        // Fetch upcoming participants count
        let upcomingCount = 0;
        const upcomingKey = `club:${clubId}:upcoming`;
        const upcomingValue = await kvGet(upcomingKey);
        if (upcomingValue) {
          try {
            const upcoming = JSON.parse(upcomingValue);
            upcomingCount = Array.isArray(upcoming) ? upcoming.length : 0;
          } catch (e) {
            upcomingCount = 0;
          }
        }

        const performance = historicalPerformanceByClubId.get(clubId);
        const lastYearRank = Number(performance?.bestRank || 0) || undefined;
        const lastYearPoints = Number(performance?.latestPoints || 0) || 0;

        // Temporary score; normalized score is computed after collecting all clubs.
        const rankingScore = Number(performance?.weightedPoints || 0) + (memberCount * 2) + (upcomingCount * 0.5);
        
        if (memberCount > 0 || upcomingCount > 0) {
          console.log(`[ChatMemory] Club: ${clubData.name}, Members: ${memberCount}, Upcoming: ${upcomingCount}, Score: ${rankingScore.toFixed(2)}`);
        }
        
        clubs.push({
          id: clubData.id,
          name: clubData.name || 'Unknown Club',
          coach_name: clubData.coach_name || clubData.coachName || 'N/A',
          email: clubData.email || clubData.ownerEmail || 'N/A',
          mobile: clubData.mobile || clubData.ownerMobile || undefined,
          city: clubData.city || undefined,
          state: clubData.state || undefined,
          country: clubData.country || 'India',
          memberCount,
          rankingScore,
          lastYearRank,
          lastYearPoints,
          rankingYear: performance?.latestYear || rankingYears[0],
          logoUrl: clubData.logoUrl || undefined
        });
      } catch (parseError) {
        console.warn(`[ChatMemory] Failed to parse club data for ${key}:`, parseError);
      }
    }

    // Deduplicate by name: if same name exists, keep the one with higher ranking score
    const uniqueByName = new Map<string, typeof clubs[0]>();
    for (const club of clubs) {
      const normalizedName = club.name.toLowerCase().trim();
      const existing = uniqueByName.get(normalizedName);
      
      if (!existing || (club.rankingScore || 0) > (existing.rankingScore || 0)) {
        uniqueByName.set(normalizedName, club);
      } else if ((club.rankingScore || 0) === (existing.rankingScore || 0) && club.id !== existing.id) {
        console.warn(`[ChatMemory] Duplicate club by name: "${club.name}" (${club.id}) - keeping ${existing.id}`);
      }
    }
    
    const deduplicatedClubs = Array.from(uniqueByName.values());
    const removedCount = clubs.length - deduplicatedClubs.length;
    if (removedCount > 0) {
      console.log(`[ChatMemory] Removed ${removedCount} duplicate club(s) by name`);
    }

    // Sort by multi-year performance, contributors and current club strength.
    const maxMembers = Math.max(1, ...deduplicatedClubs.map(c => Number(c.memberCount || 0)));
    const maxPoints = Math.max(1, ...deduplicatedClubs.map(c => Number(c.lastYearPoints || 0)));
    const maxRawScore = Math.max(1, ...deduplicatedClubs.map(c => Number(c.rankingScore || 0)));

    for (const club of deduplicatedClubs) {
      const performanceNorm = (Number(club.rankingScore || 0) / maxRawScore) * 55;
      const membersNorm = (Number(club.memberCount || 0) / maxMembers) * 25;
      const pointsNorm = (Number(club.lastYearPoints || 0) / maxPoints) * 20;
      const rankBonus = club.lastYearRank ? Math.max(0, 12 - Math.min(12, club.lastYearRank)) : 0;
      club.rankingScore = Number((performanceNorm + membersNorm + pointsNorm + rankBonus).toFixed(2));
    }

    deduplicatedClubs.sort((a, b) => {
      const scoreA = Number(a.rankingScore || 0);
      const scoreB = Number(b.rankingScore || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;

      // Tiebreakers
      if ((Number(b.lastYearPoints || 0)) !== (Number(a.lastYearPoints || 0))) {
        return Number(b.lastYearPoints || 0) - Number(a.lastYearPoints || 0);
      }
      return (b.memberCount || 0) - (a.memberCount || 0);
    });

    // Persist ranked aggregate for fast subsequent reads.
    await kvPut(
      TRAINING_CLUBS_CACHE_KEY,
      JSON.stringify({ generatedAt: new Date().toISOString(), clubs: deduplicatedClubs }),
      TRAINING_CLUBS_CACHE_TTL_SECONDS
    );

    const finalClubs = filterByCity(deduplicatedClubs);
    
    console.log(`[ChatMemory] Found ${finalClubs.length} unique clubs${city ? ` in ${city}` : ''} from KV, sorted by ranking`);
    if (finalClubs.length > 0) {
      console.log('[ChatMemory] Club list:', finalClubs.map(c => ({ id: c.id, name: c.name, score: c.rankingScore })));
    }
    return finalClubs;
    
  } catch (error) {
    console.error('[ChatMemory] Error fetching clubs from KV:', error);
    return [];
  }
}

/**
 * Format clubs for AI context
 */
export async function formatClubsContext(clubs: Array<{
  id: string;
  name: string;
  coach_name: string;
  email: string;
  mobile?: string;
  city?: string;
  state?: string;
  country?: string;
}>): Promise<string> {
  if (clubs.length === 0) return 'No clubs found.';
  
  return clubs
    .map(
      c =>
        `CLUB: ${c.name}\nCoach: ${c.coach_name}\nEmail: ${c.email}\nMobile: ${c.mobile || 'N/A'}\nLocation: ${[c.city, c.state, c.country].filter(Boolean).join(', ')}`
    )
    .join('\n\n---\n\n');
}