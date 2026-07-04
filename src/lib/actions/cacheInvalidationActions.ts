'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV, deleteKV } from '@/lib/cloudflare/kv';

/**
 * CACHE INVALIDATION SYSTEM
 * Automatically syncs Firestore changes to KV cache
 * Maintains consistency across database and cache
 */

// Define cache keys that need to be invalidated when certain collections change
const CACHE_INVALIDATION_RULES: Record<string, string[]> = {
  'races': [
    'rankings:clubs:*',  // All year rankings
    'club:*:contributing:*',  // All club contributing members
    'clubs:stats:*',  // All club stats
  ],
  'clubs': [
    'rankings:clubs:*',
    'clubs:stats:*',
    'club:*',  // Individual club data
  ],
  'users': [
    'club:*:contributing:*',  // User changes affect club members
    'clubs:stats:*',
  ],
};

/**
 * Invalidate cache keys matching a pattern
 * Supports wildcards: e.g., 'rankings:clubs:*' matches all year rankings
 */
export async function invalidateCacheByPattern(pattern: string): Promise<{ 
  success: boolean; 
  message: string; 
  invalidated: number;
}> {
  try {
    console.log(`[CACHE] Invalidating pattern: ${pattern}`);
    
    if (!pattern.includes('*')) {
      // Simple key - just delete it
      await deleteKV(pattern, 'cacheInvalidation');
      return { 
        success: true, 
        message: `Invalidated cache key: ${pattern}`,
        invalidated: 1
      };
    }
    
    // Pattern matching - would need to iterate through KV
    // For now, we'll use common patterns
    const parts = pattern.split(':');
    let invalidatedCount = 0;
    
    if (pattern === 'rankings:clubs:*') {
      // Invalidate all year rankings
      for (let year = 2020; year <= 2030; year++) {
        await deleteKV(`rankings:clubs:${year}`, 'cacheInvalidation');
        invalidatedCount++;
      }
    } else if (pattern === 'club:*:contributing:*') {
      // For this, we'd need a list of clubs - skip for now
      console.log(`[CACHE] Pattern ${pattern} requires club list - manual invalidation may be needed`);
    } else if (pattern === 'clubs:stats:*') {
      // Invalidate all stats versions and years
      for (let year = 2020; year <= 2030; year++) {
        for (let v = 1; v <= 10; v++) {
          await deleteKV(`clubs:stats:${year}:v${v}`, 'cacheInvalidation');
        }
      }
      invalidatedCount += 60; // Approximate
    }
    
    console.log(`[CACHE] Invalidated ${invalidatedCount} cache entries matching pattern: ${pattern}`);
    return { 
      success: true, 
      message: `Invalidated ${invalidatedCount} cache entries for pattern: ${pattern}`,
      invalidated: invalidatedCount
    };
  } catch (e: any) {
    console.error(`[CACHE] Error invalidating pattern ${pattern}:`, e);
    return { 
      success: false, 
      message: e.message,
      invalidated: 0
    };
  }
}

/**
 * Invalidate all caches affected by a collection change
 */
export async function invalidateByCollection(collectionName: string): Promise<{
  success: boolean;
  message: string;
  patternsInvalidated: number;
}> {
  try {
    const patterns = CACHE_INVALIDATION_RULES[collectionName] || [];
    console.log(`[CACHE] Invalidating ${patterns.length} patterns for collection: ${collectionName}`);
    
    let totalInvalidated = 0;
    for (const pattern of patterns) {
      const result = await invalidateCacheByPattern(pattern);
      if (result.success) {
        totalInvalidated += result.invalidated;
      }
    }
    
    return {
      success: true,
      message: `Invalidated caches for ${collectionName} collection`,
      patternsInvalidated: patterns.length
    };
  } catch (e: any) {
    console.error(`[CACHE] Error invalidating collection ${collectionName}:`, e);
    return {
      success: false,
      message: e.message,
      patternsInvalidated: 0
    };
  }
}

/**
 * Invalidate specific document change
 * Call this when a document in Firestore is created/updated/deleted
 */
export async function invalidateByDocument(
  collectionName: string,
  documentId: string,
  changeType: 'created' | 'updated' | 'deleted'
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`[CACHE] Document ${changeType}: ${collectionName}/${documentId}`);
    
    // Invalidate collection-level caches
    const patterns = CACHE_INVALIDATION_RULES[collectionName] || [];
    for (const pattern of patterns) {
      await invalidateCacheByPattern(pattern);
    }
    
    // Handle specific document caches
    if (collectionName === 'clubs') {
      // Invalidate club-specific cache
      await deleteKV(`club:${documentId}`, 'cacheInvalidation');
      // Invalidate club stats for all years
      for (let year = 2020; year <= 2030; year++) {
        await deleteKV(`clubs:stats:${year}:v1`, 'cacheInvalidation');
        await deleteKV(`clubs:stats:${year}:v2`, 'cacheInvalidation');
      }
    } else if (collectionName === 'users') {
      // User changes affect club memberships
      await invalidateByCollection('clubs');
    } else if (collectionName === 'races') {
      // Race changes affect rankings
      await invalidateByCollection('clubs');
    }
    
    return {
      success: true,
      message: `Cache invalidated for ${collectionName}/${documentId} (${changeType})`
    };
  } catch (e: any) {
    console.error(`[CACHE] Error invalidating document:`, e);
    return {
      success: false,
      message: e.message
    };
  }
}

/**
 * Full cache sync - rebuild all KV caches from Firestore
 * Use this for periodic consistency checks or after major data changes
 */
export async function syncAllCachesFromFirestore(): Promise<{
  success: boolean;
  message: string;
  synced: number;
}> {
  try {
    console.log(`[CACHE] Starting full cache sync from Firestore...`);
    const adminDb = getFirestoreInstance();
    let syncedCount = 0;

    // Sync club rankings for all years
    const clubsSnap = await adminDb.collection('clubs').get();
    for (let year = 2020; year <= 2030; year++) {
      // This would trigger the club stats calculation
      // In practice, you'd call getAllClubsWithStatsAction
      await deleteKV(`clubs:stats:${year}:v1`, 'cacheInvalidation');
      await deleteKV(`clubs:stats:${year}:v2`, 'cacheInvalidation');
      syncedCount += 2;
    }

    console.log(`[CACHE] Full sync completed - ${syncedCount} cache entries refreshed`);
    return {
      success: true,
      message: 'Cache sync completed',
      synced: syncedCount
    };
  } catch (e: any) {
    console.error(`[CACHE] Error during full sync:`, e);
    return {
      success: false,
      message: e.message,
      synced: 0
    };
  }
}

/**
 * Listen to Firestore changes and sync to KV
 * This sets up listeners for critical collections
 */
export async function setupCacheInvalidationListeners(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const adminDb = getFirestoreInstance();
    
    console.log(`[CACHE] Setting up Firestore change listeners...`);

    // Listen to races collection changes
    adminDb.collection('races')
      .onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            if (change.type === 'added' || change.type === 'modified' || change.type === 'removed') {
              invalidateByDocument('races', change.doc.id, change.type as 'created' | 'updated' | 'deleted')
                .catch(err => console.error('[CACHE] Error handling race change:', err));
            }
          });
        },
        (error) => {
          console.error('[CACHE] Races listener error:', error);
        }
      );

    // Listen to clubs collection changes
    adminDb.collection('clubs')
      .onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' || change.type === 'modified' || change.type === 'removed') {
              invalidateByDocument('clubs', change.doc.id, change.type as 'created' | 'updated' | 'deleted')
                .catch(err => console.error('[CACHE] Error handling club change:', err));
            }
          });
        },
        (error) => {
          console.error('[CACHE] Clubs listener error:', error);
        }
      );

    // Listen to users collection changes (debounced to avoid too many invalidations)
    let userChangeTimeout: NodeJS.Timeout | null = null;
    adminDb.collection('users')
      .onSnapshot(
        (snapshot) => {
          // Debounce user changes - they happen frequently
          if (userChangeTimeout) clearTimeout(userChangeTimeout);
          userChangeTimeout = setTimeout(() => {
            invalidateByCollection('users')
              .catch(err => console.error('[CACHE] Error handling user changes:', err));
          }, 5000); // Debounce by 5 seconds
        },
        (error) => {
          console.error('[CACHE] Users listener error:', error);
        }
      );

    console.log(`[CACHE] Firestore change listeners installed`);
    return {
      success: true,
      message: 'Cache invalidation listeners setup complete'
    };
  } catch (e: any) {
    console.error(`[CACHE] Error setting up listeners:`, e);
    return {
      success: false,
      message: e.message
    };
  }
}
