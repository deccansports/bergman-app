'use server';

import { getKV, putKV, batchDeleteKV, listKVByPrefix } from '../cloudflare/kv';
import { getFirestoreInstance } from '../firebaseAdmin';
import type { User, Club } from '@/lib/types';

interface CacheSyncResult {
  success: boolean;
  message: string;
  details: {
    stalenessesFixed?: number;
    cacheEntriesCleared?: number;
    dataRebuilt?: number;
    duration?: number;
  };
}

interface CacheClearanceReport {
  success: boolean;
  timestamp: string;
  duration: number;
  summary: {
    totalEntriesCleared: number;
    ghostEntriesRemoved: number;
  };
  ghostUserIds: string[];
  ghostClubIds: string[];
  clearedEventEntries: string[];
  clearedSystemEntries: {
    tempEntries: string[];
    lockEntries: string[];
    syncEntries: string[];
    queueEntries: string[];
  };
  report: string;
}

/**
 * Master Sync: Flush stale cache entries and rebuild from Firestore
 * - Clears all cached user profiles
 * - Clears all cached club stats
 * - Rebuilds fresh data from Firestore
 * - Syncs to KV in batches to avoid 429 errors
 */
export async function masterSyncCacheAction(): Promise<CacheSyncResult> {
  const startTime = Date.now();
  console.log('[MASTER SYNC] Starting master cache sync...');

  try {
    const adminDb = getFirestoreInstance();
    let stalenessesFixed = 0;
    let cacheEntriesCleared = 0;
    let dataRebuilt = 0;

    // Step 1: Clear all user profile cache entries
    console.log('[MASTER SYNC] Step 1: Clearing user profile cache...');
    const userCacheKeys = await listKVByPrefix('user:', '[MASTER SYNC] USER PROFILES');
    if (userCacheKeys.length > 0) {
      const deleteResult = await batchDeleteKV(
        userCacheKeys,
        '[MASTER SYNC] USER PROFILES',
        200 // 200ms delay between deletes
      );
      cacheEntriesCleared += deleteResult.successful;
      console.log(`[MASTER SYNC] Cleared ${deleteResult.successful} user cache entries`);
    }

    // Step 2: Clear all club stats cache entries
    console.log('[MASTER SYNC] Step 2: Clearing club stats cache...');
    const clubCacheKeys = await listKVByPrefix('club:', '[MASTER SYNC] CLUB STATS');
    if (clubCacheKeys.length > 0) {
      const deleteResult = await batchDeleteKV(
        clubCacheKeys,
        '[MASTER SYNC] CLUB STATS',
        200
      );
      cacheEntriesCleared += deleteResult.successful;
      console.log(`[MASTER SYNC] Cleared ${deleteResult.successful} club cache entries`);
    }

    // Step 3: Clear event cache entries
    console.log('[MASTER SYNC] Step 3: Clearing event cache...');
    const eventCacheKeys = await listKVByPrefix('event:', '[MASTER SYNC] EVENTS');
    if (eventCacheKeys.length > 0) {
      const deleteResult = await batchDeleteKV(
        eventCacheKeys,
        '[MASTER SYNC] EVENTS',
        200
      );
      cacheEntriesCleared += deleteResult.successful;
      console.log(`[MASTER SYNC] Cleared ${deleteResult.successful} event cache entries`);
    }

    // Step 4: Rebuild user cache from Firestore
    console.log('[MASTER SYNC] Step 4: Rebuilding user cache from Firestore...');
    const usersSnapshot = await adminDb.collection('users').get();
    const userBatchSize = 10;
    
    for (let i = 0; i < usersSnapshot.docs.length; i += userBatchSize) {
      const batch = usersSnapshot.docs.slice(i, i + userBatchSize);
      const cacheOps = batch.map(async (doc) => {
        const userData = doc.data() as User;
        try {
          await putKV(
            `user:${doc.id}:profile`,
            {
              uid: doc.id,
              id: userData.id,
              name: userData.name,
              email: userData.email,
              mobile: userData.mobile,
              emailVerified: userData.emailVerified,
            },
            '[MASTER SYNC] USER REBUILD'
          );
          dataRebuilt++;
        } catch (error) {
          console.error(`[MASTER SYNC] Failed to rebuild user ${doc.id}:`, error);
          stalenessesFixed++; // Count as a fix attempt
        }
      });

      await Promise.all(cacheOps);
      
      // Delay between batches
      if (i + userBatchSize < usersSnapshot.docs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    console.log(`[MASTER SYNC] Rebuilt ${dataRebuilt} user cache entries from Firestore`);

    // Step 5: Rebuild club stats cache from Firestore
    console.log('[MASTER SYNC] Step 5: Rebuilding club stats cache from Firestore...');
    const clubsSnapshot = await adminDb.collection('clubs').get();
    const clubBatchSize = 10;

    for (let i = 0; i < clubsSnapshot.docs.length; i += clubBatchSize) {
      const batch = clubsSnapshot.docs.slice(i, i + clubBatchSize);
      const cacheOps = batch.map(async (doc) => {
        const clubData = doc.data() as Club;
        try {
          // Rebuild basic club info
          await putKV(
            `club:${doc.id}:info`,
            {
              id: doc.id,
              name: clubData.name,
              coach_name: clubData.coach_name,
              ownerEmail: clubData.ownerEmail,
              ownerUid: clubData.ownerUid,
              memberCount: 0, // Will be recalculated
            },
            '[MASTER SYNC] CLUB REBUILD'
          );
          dataRebuilt++;
        } catch (error) {
          console.error(`[MASTER SYNC] Failed to rebuild club ${doc.id}:`, error);
          stalenessesFixed++;
        }
      });

      await Promise.all(cacheOps);
      
      if (i + clubBatchSize < clubsSnapshot.docs.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    console.log(`[MASTER SYNC] Rebuilt ${dataRebuilt} club cache entries from Firestore`);

    // Step 6: Create sync metadata
    const syncMetadata = {
      lastSyncTime: new Date().toISOString(),
      cacheEntriesCleared,
      dataRebuilt,
      timestamp: Date.now(),
    };
    await putKV('system:cache:sync:metadata', syncMetadata, '[MASTER SYNC] METADATA');

    const duration = Date.now() - startTime;
    const message = `Master sync completed: cleared ${cacheEntriesCleared} stale entries, rebuilt ${dataRebuilt} entries in ${duration}ms`;
    
    console.log(`[MASTER SYNC] ✅ ${message}`);

    return {
      success: true,
      message,
      details: {
        stalenessesFixed,
        cacheEntriesCleared,
        dataRebuilt,
        duration,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[MASTER SYNC] ❌ Failed:', errorMsg);
    
    return {
      success: false,
      message: `Master sync failed: ${errorMsg}`,
      details: {
        duration: Date.now() - startTime,
      },
    };
  }
}

/**
 * Manual Clear Cache: Remove ghost entries and fix inconsistencies
 * - Finds entries in KV that don't have corresponding Firestore records
 * - Clears those orphaned entries
 * - Validates data integrity
 */
export async function manualClearCacheAction(): Promise<CacheSyncResult> {
  const startTime = Date.now();
  console.log('[MANUAL CLEAR] Starting manual cache clear and ghost entry removal...');

  try {
    const adminDb = getFirestoreInstance();
    let cacheEntriesCleared = 0;
    let ghostEntriesRemoved = 0;

    // Step 1: Get all users from Firestore
    console.log('[MANUAL CLEAR] Step 1: Loading Firestore users...');
    const usersSnapshot = await adminDb.collection('users').get();
    const validUserIds = new Set(usersSnapshot.docs.map(doc => doc.id));
    console.log(`[MANUAL CLEAR] Found ${validUserIds.size} valid users in Firestore`);

    // Step 2: Find and remove ghost user entries from cache
    console.log('[MANUAL CLEAR] Step 2: Scanning for ghost user entries...');
    const userCacheKeys = await listKVByPrefix('user:', '[MANUAL CLEAR] GHOST SCAN');
    
    if (userCacheKeys.length > 0) {
      const keysToDelete: string[] = [];
      
      for (const key of userCacheKeys) {
        // Extract UID from key format "user:{uid}:profile"
        const parts = key.split(':');
        if (parts.length >= 2) {
          const uid = parts[1];
          if (!validUserIds.has(uid)) {
            keysToDelete.push(key);
          }
        }
      }

      if (keysToDelete.length > 0) {
        console.log(`[MANUAL CLEAR] Found ${keysToDelete.length} ghost user entries, removing...`);
        const deleteResult = await batchDeleteKV(
          keysToDelete,
          '[MANUAL CLEAR] GHOST USERS',
          200
        );
        ghostEntriesRemoved += deleteResult.successful;
        cacheEntriesCleared += deleteResult.successful;
      }
    }

    // Step 3: Get all clubs from Firestore
    console.log('[MANUAL CLEAR] Step 3: Loading Firestore clubs...');
    const clubsSnapshot = await adminDb.collection('clubs').get();
    const validClubIds = new Set(clubsSnapshot.docs.map(doc => doc.id));
    console.log(`[MANUAL CLEAR] Found ${validClubIds.size} valid clubs in Firestore`);

    // Step 4: Find and remove ghost club entries from cache
    console.log('[MANUAL CLEAR] Step 4: Scanning for ghost club entries...');
    const clubCacheKeys = await listKVByPrefix('club:', '[MANUAL CLEAR] GHOST SCAN');
    
    if (clubCacheKeys.length > 0) {
      const keysToDelete: string[] = [];
      
      for (const key of clubCacheKeys) {
        // Extract club ID from key format "club:{clubId}:*"
        const parts = key.split(':');
        if (parts.length >= 2) {
          const clubId = parts[1];
          if (!validClubIds.has(clubId)) {
            keysToDelete.push(key);
          }
        }
      }

      if (keysToDelete.length > 0) {
        console.log(`[MANUAL CLEAR] Found ${keysToDelete.length} ghost club entries, removing...`);
        const deleteResult = await batchDeleteKV(
          keysToDelete,
          '[MANUAL CLEAR] GHOST CLUBS',
          200
        );
        ghostEntriesRemoved += deleteResult.successful;
        cacheEntriesCleared += deleteResult.successful;
      }
    }

    // Step 5: Verify orphaned system entries
    console.log('[MANUAL CLEAR] Step 5: Checking for orphaned system entries...');
    const systemKeys = await listKVByPrefix('system:', '[MANUAL CLEAR] SYSTEM');
    
    // Keep critical system entries, remove old/temporary ones
    const keysToDelete = systemKeys.filter(key => 
      key.includes('temp:') || 
      key.includes('lock:') ||
      (key.includes('sync:') && !key.includes('sync:metadata'))
    );

    if (keysToDelete.length > 0) {
      console.log(`[MANUAL CLEAR] Found ${keysToDelete.length} orphaned system entries, removing...`);
      const deleteResult = await batchDeleteKV(
        keysToDelete,
        '[MANUAL CLEAR] SYSTEM CLEANUP',
        200
      );
      cacheEntriesCleared += deleteResult.successful;
    }

    const duration = Date.now() - startTime;
    const message = `Manual clear completed: removed ${ghostEntriesRemoved} ghost entries, cleared ${cacheEntriesCleared} total cache entries in ${duration}ms`;
    
    console.log(`[MANUAL CLEAR] ✅ ${message}`);

    return {
      success: true,
      message,
      details: {
        stalenessesFixed: ghostEntriesRemoved,
        cacheEntriesCleared,
        duration,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[MANUAL CLEAR] ❌ Failed:', errorMsg);
    
    return {
      success: false,
      message: `Manual clear failed: ${errorMsg}`,
      details: {
        duration: Date.now() - startTime,
      },
    };
  }
}

/**
 * Auto Clear Cache: Automatically clears cache and ghost entries with detailed reporting
 * - Runs periodically to remove stale and orphaned entries
 * - Clears ghost entries that don't have Firestore records
 * - Cleans up temporary system entries
 * - Returns detailed report of cleared entries
 */
export async function autoClearCacheAction(): Promise<CacheClearanceReport> {
  const startTime = Date.now();
  console.log('[AUTO CLEAR] Starting automatic cache and ghost entry clearing...');

  try {
    const adminDb = getFirestoreInstance();
    let cacheEntriesCleared = 0;
    let ghostEntriesRemoved = 0;
    
    // Track detailed information
    const ghostUserIds: string[] = [];
    const ghostClubIds: string[] = [];
    const clearedEventEntries: string[] = [];
    const clearedSystemEntries = {
      tempEntries: [] as string[],
      lockEntries: [] as string[],
      syncEntries: [] as string[],
      queueEntries: [] as string[],
    };

    // Step 1: Get all valid users and clubs from Firestore
    console.log('[AUTO CLEAR] Step 1: Loading valid data from Firestore...');
    const [usersSnapshot, clubsSnapshot] = await Promise.all([
      adminDb.collection('users').get(),
      adminDb.collection('clubs').get(),
    ]);

    const validUserIds = new Set(usersSnapshot.docs.map(doc => doc.id));
    const validClubIds = new Set(clubsSnapshot.docs.map(doc => doc.id));
    console.log(`[AUTO CLEAR] Found ${validUserIds.size} valid users and ${validClubIds.size} valid clubs`);

    // Step 2: Clear ghost user entries
    console.log('[AUTO CLEAR] Step 2: Removing ghost user entries...');
    const userCacheKeys = await listKVByPrefix('user:', '[AUTO CLEAR] USERS');
    
    if (userCacheKeys.length > 0) {
      const ghostUserKeys: string[] = [];
      
      for (const key of userCacheKeys) {
        const parts = key.split(':');
        if (parts.length >= 2) {
          const uid = parts[1];
          if (!validUserIds.has(uid)) {
            ghostUserKeys.push(key);
            ghostUserIds.push(uid);
          }
        }
      }

      if (ghostUserKeys.length > 0) {
        const deleteResult = await batchDeleteKV(
          ghostUserKeys,
          '[AUTO CLEAR] GHOST USERS',
          150
        );
        ghostEntriesRemoved += deleteResult.successful;
        cacheEntriesCleared += deleteResult.successful;
        console.log(`[AUTO CLEAR] Removed ${deleteResult.successful} ghost user entries: ${ghostUserIds.join(', ')}`);
      }
    }

    // Step 3: Clear ghost club entries
    console.log('[AUTO CLEAR] Step 3: Removing ghost club entries...');
    const clubCacheKeys = await listKVByPrefix('club:', '[AUTO CLEAR] CLUBS');
    
    if (clubCacheKeys.length > 0) {
      const ghostClubKeys: string[] = [];
      
      for (const key of clubCacheKeys) {
        const parts = key.split(':');
        if (parts.length >= 2) {
          const clubId = parts[1];
          if (!validClubIds.has(clubId)) {
            ghostClubKeys.push(key);
            ghostClubIds.push(clubId);
          }
        }
      }

      if (ghostClubKeys.length > 0) {
        const deleteResult = await batchDeleteKV(
          ghostClubKeys,
          '[AUTO CLEAR] GHOST CLUBS',
          150
        );
        ghostEntriesRemoved += deleteResult.successful;
        cacheEntriesCleared += deleteResult.successful;
        console.log(`[AUTO CLEAR] Removed ${deleteResult.successful} ghost club entries: ${ghostClubIds.join(', ')}`);
      }
    }

    // Step 4: Clear orphaned event entries
    console.log('[AUTO CLEAR] Step 4: Removing orphaned event entries...');
    const eventCacheKeys = await listKVByPrefix('event:', '[AUTO CLEAR] EVENTS');
    
    if (eventCacheKeys.length > 0) {
      const orphanedEventKeys = eventCacheKeys.slice(); // Copy all event keys
      clearedEventEntries.push(...orphanedEventKeys);

      if (orphanedEventKeys.length > 0) {
        const deleteResult = await batchDeleteKV(
          orphanedEventKeys,
          '[AUTO CLEAR] ORPHANED EVENTS',
          150
        );
        cacheEntriesCleared += deleteResult.successful;
        console.log(`[AUTO CLEAR] Removed ${deleteResult.successful} orphaned event entries`);
      }
    }

    // Step 5: Clean up temporary and lock system entries
    console.log('[AUTO CLEAR] Step 5: Cleaning up temporary system entries...');
    const systemKeys = await listKVByPrefix('system:', '[AUTO CLEAR] SYSTEM');
    
    const tempKeysToDelete = systemKeys.filter(key => {
      if (key.includes('sync:metadata')) return false; // Keep sync metadata
      
      if (key.includes('temp:')) {
        clearedSystemEntries.tempEntries.push(key);
        return true;
      }
      if (key.includes('lock:')) {
        clearedSystemEntries.lockEntries.push(key);
        return true;
      }
      if (key.includes('sync:')) {
        clearedSystemEntries.syncEntries.push(key);
        return true;
      }
      if (key.includes('queue:')) {
        clearedSystemEntries.queueEntries.push(key);
        return true;
      }
      return false;
    });

    if (tempKeysToDelete.length > 0) {
      const deleteResult = await batchDeleteKV(
        tempKeysToDelete,
        '[AUTO CLEAR] TEMP ENTRIES',
        150
      );
      cacheEntriesCleared += deleteResult.successful;
      console.log(`[AUTO CLEAR] Removed ${deleteResult.successful} temporary system entries`);
    }

    // Step 6: Update auto-clear metadata
    const duration = Date.now() - startTime;
    const autoCleanMetadata = {
      lastAutoClearTime: new Date().toISOString(),
      ghostEntriesRemoved,
      totalEntriesCleared: cacheEntriesCleared,
      ghostUserIdsRemoved: ghostUserIds.length,
      ghostClubIdsRemoved: ghostClubIds.length,
      nextScheduledClear: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6 hours from now
      timestamp: Date.now(),
    };
    await putKV('system:cache:auto-clear:metadata', autoCleanMetadata, '[AUTO CLEAR] METADATA');

    // Generate detailed report
    const reportLines = [
      `═════════════════════════════════════════`,
      `   AUTO CACHE CLEARANCE REPORT`,
      `═════════════════════════════════════════`,
      `Timestamp: ${new Date().toISOString()}`,
      `Duration: ${duration}ms`,
      ``,
      `📊 SUMMARY:`,
      `  Total Entries Cleared: ${cacheEntriesCleared}`,
      `  Ghost Entries Removed: ${ghostEntriesRemoved}`,
      ``,
      `👤 GHOST USERS (${ghostUserIds.length}):`,
      ghostUserIds.length > 0 ? ghostUserIds.map(id => `  - ${id}`).join('\n') : '  None',
      ``,
      `🏢 GHOST CLUBS (${ghostClubIds.length}):`,
      ghostClubIds.length > 0 ? ghostClubIds.map(id => `  - ${id}`).join('\n') : '  None',
      ``,
      `📅 CLEARED EVENT ENTRIES (${clearedEventEntries.length}):`,
      clearedEventEntries.length > 0 ? clearedEventEntries.map(e => `  - ${e}`).join('\n') : '  None',
      ``,
      `⚙️  CLEARED SYSTEM ENTRIES:`,
      `  Temp Entries (${clearedSystemEntries.tempEntries.length}): ${clearedSystemEntries.tempEntries.length > 0 ? clearedSystemEntries.tempEntries.join(', ') : 'None'}`,
      `  Lock Entries (${clearedSystemEntries.lockEntries.length}): ${clearedSystemEntries.lockEntries.length > 0 ? clearedSystemEntries.lockEntries.join(', ') : 'None'}`,
      `  Sync Entries (${clearedSystemEntries.syncEntries.length}): ${clearedSystemEntries.syncEntries.length > 0 ? clearedSystemEntries.syncEntries.join(', ') : 'None'}`,
      `  Queue Entries (${clearedSystemEntries.queueEntries.length}): ${clearedSystemEntries.queueEntries.length > 0 ? clearedSystemEntries.queueEntries.join(', ') : 'None'}`,
      ``,
      `═════════════════════════════════════════`,
    ];

    const report = reportLines.join('\n');
    console.log(`[AUTO CLEAR] ✅ ${report}`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        totalEntriesCleared: cacheEntriesCleared,
        ghostEntriesRemoved,
      },
      ghostUserIds,
      ghostClubIds,
      clearedEventEntries,
      clearedSystemEntries,
      report,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;
    console.error('[AUTO CLEAR] ❌ Failed:', errorMsg);
    
    return {
      success: false,
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        totalEntriesCleared: 0,
        ghostEntriesRemoved: 0,
      },
      ghostUserIds: [],
      ghostClubIds: [],
      clearedEventEntries: [],
      clearedSystemEntries: {
        tempEntries: [],
        lockEntries: [],
        syncEntries: [],
        queueEntries: [],
      },
      report: `Auto clear failed: ${errorMsg}`,
    };
  }
}

/**
 * Get cache statistics and health info
 */
export async function getCacheStatsAction(): Promise<{
  success: boolean;
  stats: {
    userEntries: number;
    clubEntries: number;
    eventEntries: number;
    systemEntries: number;
    totalEntries: number;
    lastSyncTime?: string;
    lastAutoClearTime?: string;
  };
  message: string;
}> {
  try {
    const [userKeys, clubKeys, eventKeys, systemKeys] = await Promise.all([
      listKVByPrefix('user:', '[CACHE STATS] USERS'),
      listKVByPrefix('club:', '[CACHE STATS] CLUBS'),
      listKVByPrefix('event:', '[CACHE STATS] EVENTS'),
      listKVByPrefix('system:', '[CACHE STATS] SYSTEM'),
    ]);

    const [metadata, autoCleanMetadata] = await Promise.all([
      getKV<any>('system:cache:sync:metadata', '[CACHE STATS]'),
      getKV<any>('system:cache:auto-clear:metadata', '[CACHE STATS]'),
    ]);

    const stats = {
      userEntries: userKeys.length,
      clubEntries: clubKeys.length,
      eventEntries: eventKeys.length,
      systemEntries: systemKeys.length,
      totalEntries: userKeys.length + clubKeys.length + eventKeys.length + systemKeys.length,
      lastSyncTime: metadata?.lastSyncTime,
      lastAutoClearTime: autoCleanMetadata?.lastAutoClearTime,
    };

    return {
      success: true,
      stats,
      message: `Cache contains ${stats.totalEntries} total entries`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CACHE STATS] Failed:', errorMsg);
    
    return {
      success: false,
      stats: {
        userEntries: 0,
        clubEntries: 0,
        eventEntries: 0,
        systemEntries: 0,
        totalEntries: 0,
      },
      message: `Failed to get cache stats: ${errorMsg}`,
    };
  }
}

/**
 * Get the latest cache clearance report with detailed breakdown
 */
export async function getCacheClearanceReportAction(): Promise<{
  success: boolean;
  report: CacheClearanceReport | null;
  message: string;
}> {
  try {
    const autoCleanMetadata = await getKV<any>('system:cache:auto-clear:metadata', '[CLEARANCE REPORT]');
    
    if (!autoCleanMetadata) {
      return {
        success: false,
        report: null,
        message: 'No clearance report available. Auto-clear may not have run yet.',
      };
    }

    const stats = await getCacheStatsAction();

    const report: CacheClearanceReport = {
      success: true,
      timestamp: autoCleanMetadata.lastAutoClearTime,
      duration: autoCleanMetadata.duration || 0,
      summary: {
        totalEntriesCleared: autoCleanMetadata.totalEntriesCleared || 0,
        ghostEntriesRemoved: autoCleanMetadata.ghostEntriesRemoved || 0,
      },
      ghostUserIds: [],
      ghostClubIds: [],
      clearedEventEntries: [],
      clearedSystemEntries: {
        tempEntries: [],
        lockEntries: [],
        syncEntries: [],
        queueEntries: [],
      },
      report: generateClearanceReportText(autoCleanMetadata, stats.stats),
    };

    return {
      success: true,
      report,
      message: 'Clearance report retrieved successfully',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[CLEARANCE REPORT] Failed:', errorMsg);
    
    return {
      success: false,
      report: null,
      message: `Failed to get clearance report: ${errorMsg}`,
    };
  }
}

/**
 * Helper function to generate formatted clearance report text
 */
function generateClearanceReportText(metadata: any, stats: any): string {
  const reportLines = [
    `═══════════════════════════════════════════════════════`,
    `           CACHE CLEARANCE REPORT - SUMMARY`,
    `═══════════════════════════════════════════════════════`,
    ``,
    `📅 Last Clearance: ${metadata.lastAutoClearTime}`,
    `⏱️  Duration: ${metadata.duration || 'N/A'}ms`,
    `⏲️  Next Scheduled: ${metadata.nextScheduledClear || 'N/A'}`,
    ``,
    `📊 CLEARANCE STATISTICS:`,
    `  ├─ Total Entries Cleared: ${metadata.totalEntriesCleared || 0}`,
    `  ├─ Ghost Entries Removed: ${metadata.ghostEntriesRemoved || 0}`,
    `  ├─ Ghost User IDs Removed: ${metadata.ghostUserIdsRemoved || 0}`,
    `  └─ Ghost Club IDs Removed: ${metadata.ghostClubIdsRemoved || 0}`,
    ``,
    `💾 CURRENT CACHE STATE:`,
    `  ├─ User Entries: ${stats.userEntries || 0}`,
    `  ├─ Club Entries: ${stats.clubEntries || 0}`,
    `  ├─ Event Entries: ${stats.eventEntries || 0}`,
    `  ├─ System Entries: ${stats.systemEntries || 0}`,
    `  └─ Total Entries: ${stats.totalEntries || 0}`,
    ``,
    `═══════════════════════════════════════════════════════`,
  ];

  return reportLines.join('\n');
}

/**
 * Generate detailed cache health report with recommendations
 */
export async function generateCacheHealthReportAction(): Promise<{
  success: boolean;
  report: string;
  healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}> {
  try {
    const stats = await getCacheStatsAction();
    const clearanceData = await getKV<any>('system:cache:auto-clear:metadata', '[HEALTH CHECK]');

    if (!stats.success) {
      return {
        success: false,
        report: 'Failed to generate health report',
        healthStatus: 'CRITICAL',
      };
    }

    const totalEntries = stats.stats.totalEntries;
    const lastAutoClear = clearanceData?.lastAutoClearTime;
    const ghostUserCount = clearanceData?.ghostUserIdsRemoved || 0;
    const ghostClubCount = clearanceData?.ghostClubIdsRemoved || 0;

    // Determine health status
    let healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check total entries
    if (totalEntries > 10000) {
      healthStatus = 'WARNING';
      issues.push(`⚠️  High cache volume (${totalEntries} entries)`);
      recommendations.push('Consider running master sync to rebuild cache efficiently');
    }

    // Check ghost entries
    if (ghostUserCount > 50 || ghostClubCount > 20) {
      healthStatus = 'WARNING';
      issues.push(`⚠️  Recent ghost entries detected (${ghostUserCount} users, ${ghostClubCount} clubs)`);
      recommendations.push('Run auto-clear more frequently or enable continuous monitoring');
    }

    // Check last auto-clear time
    if (lastAutoClear) {
      const lastClearTime = new Date(lastAutoClear).getTime();
      const hoursSinceLastClear = (Date.now() - lastClearTime) / (1000 * 60 * 60);
      
      if (hoursSinceLastClear > 24) {
        healthStatus = 'WARNING';
        issues.push(`⚠️  Last auto-clear was ${Math.floor(hoursSinceLastClear)} hours ago`);
        recommendations.push('Schedule auto-clear more frequently (currently every 6 hours)');
      }
    } else {
      healthStatus = 'WARNING';
      issues.push(`⚠️  No auto-clear history found`);
      recommendations.push('Run initial auto-clear to establish baseline');
    }

    const reportLines = [
      `═════════════════════════════════════════════════════════════`,
      `              CACHE HEALTH REPORT`,
      `═════════════════════════════════════════════════════════════`,
      ``,
      `🏥 Health Status: ${healthStatus === 'HEALTHY' ? '✅ HEALTHY' : healthStatus === 'WARNING' ? '⚠️  WARNING' : '🔴 CRITICAL'}`,
      `📊 Generated: ${new Date().toISOString()}`,
      ``,
      `📈 CACHE METRICS:`,
      `  ├─ Total Entries: ${totalEntries}`,
      `  ├─ User Entries: ${stats.stats.userEntries}`,
      `  ├─ Club Entries: ${stats.stats.clubEntries}`,
      `  ├─ Event Entries: ${stats.stats.eventEntries}`,
      `  └─ System Entries: ${stats.stats.systemEntries}`,
      ``,
      `🔍 ISSUES DETECTED:`,
      issues.length > 0 ? issues.map(i => `  ${i}`).join('\n') : '  ✓ No issues detected',
      ``,
      `💡 RECOMMENDATIONS:`,
      recommendations.length > 0 ? recommendations.map((i, idx) => `  ${idx + 1}. ${i}`).join('\n') : '  ✓ No action required',
      ``,
      `═════════════════════════════════════════════════════════════`,
    ];

    return {
      success: true,
      report: reportLines.join('\n'),
      healthStatus,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[HEALTH REPORT] Failed:', errorMsg);
    
    return {
      success: false,
      report: `Failed to generate health report: ${errorMsg}`,
      healthStatus: 'CRITICAL',
    };
  }
}

/**
 * Clean up ghost registrations from KV
 * - Reads event indices from KV (event:{eventId}:index)
 * - Finds registrations with invalid/missing/corrupted data
 * - Removes corrupted entries from KV
 * - Validates registration data integrity
 */
export async function cleanupGhostRegistrationsAction(targetEventId?: string): Promise<{
  success: boolean;
  timestamp: string;
  duration: number;
  summary: {
    totalEventsScanned: number;
    ghostRegistrationsRemoved: number;
    invalidEntriesFound: string[];
    corruptedEntriesFound: string[];
  };
  report: string;
}> {
  const startTime = Date.now();
  const scope = targetEventId ? `event ${targetEventId}` : 'all upcoming events';
  console.log(`[GHOST CLEANUP] Starting ghost registration cleanup from KV for ${scope}...`);

  try {
    const ghostEntriesRemovedList: string[] = [];
    const invalidEntries: string[] = [];
    const corruptedEntries: string[] = [];
    let totalEventsScanned = 0;
    let ghostRegistrationsRemoved = 0;
    
    // Get today's date at midnight for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    console.log(`[GHOST CLEANUP] Current date: ${today.toISOString().split('T')[0]}`);

    // Step 1: Get event indices from KV
    console.log('[GHOST CLEANUP] Step 1: Loading event indices from KV...');
    let eventIndices: string[];
    
    if (targetEventId) {
      // Target specific event
      const indexKey = `event:${targetEventId}:index`;
      const exists = await getKV<any>(indexKey, '[GHOST CLEANUP]');
      eventIndices = exists ? [indexKey] : [];
      console.log(`[GHOST CLEANUP] Targeting specific event: ${targetEventId}`);
    } else {
      // Get all events
      const eventIndexKeys = await listKVByPrefix('event:', '[GHOST CLEANUP] EVENT INDEX');
      eventIndices = eventIndexKeys.filter(key => key.endsWith(':index'));
    }
    
    console.log(`[GHOST CLEANUP] Found ${eventIndices.length} event(s) to process`);
    
    // Step 2: Scan each event for ghost registrations (only upcoming events)
    console.log('[GHOST CLEANUP] Step 2: Scanning for ghost registrations in KV...');
    
    for (const indexKey of eventIndices) {
      // Extract eventId from key format "event:{eventId}:index"
      const eventId = indexKey.split(':')[1];
      
      try {
        const eventIndex = await getKV<any[]>(indexKey, '[GHOST CLEANUP]');
        
        if (!eventIndex || !Array.isArray(eventIndex)) {
          console.log(`[GHOST CLEANUP] Skipping ${eventId}: no index found`);
          continue;
        }

        // Check if this is an upcoming event by getting the first participant's date
        // Skip this check if we're targeting a specific event
        let isUpcomingEvent = !!targetEventId; // true if targeting specific event
        let eventDate: Date | null = null;
        
        if (!targetEventId && eventIndex.length > 0) {
          // Try to find eventDate from multiple participants (first 5)
          const maxAttempts = Math.min(5, eventIndex.length);
          
          for (let i = 0; i < maxAttempts; i++) {
            const participantKey = `event:${eventId}:participant:${eventIndex[i].bookingId}`;
            try {
              const participant = await getKV<any>(participantKey, '[GHOST CLEANUP]');
              if (participant && participant.eventDate) {
                // Parse eventDate in format "03 Oct 2026" or similar
                eventDate = new Date(participant.eventDate);
                eventDate.setHours(0, 0, 0, 0);
                isUpcomingEvent = eventDate >= today;
                console.log(`[GHOST CLEANUP] Found event date from participant ${i+1}: ${eventDate.toISOString().split('T')[0]}`);
                break;
              }
            } catch (error) {
              // Continue to next participant
              continue;
            }
          }
          
          // If still no date found, assume it's upcoming (process it)
          if (!eventDate) {
            console.log(`[GHOST CLEANUP] Could not find eventDate for ${eventId}, assuming upcoming`);
            isUpcomingEvent = true;
          }
        }

        if (!isUpcomingEvent) {
          const dateStr = eventDate ? eventDate.toISOString().split('T')[0] : 'unknown';
          console.log(`[GHOST CLEANUP] Skipping ${eventId}: past event (${dateStr})`);
          continue;
        }

        totalEventsScanned++;
        console.log(`[GHOST CLEANUP] Scanning event ${eventId}: ${eventIndex.length} registrations`);

        const validRegistrations: any[] = [];

        for (const indexEntry of eventIndex) {
          const bookingId = indexEntry.bookingId;
          
          // CRITICAL: Check 0 - Index entry itself is corrupted (missing bookingId)
          if (!bookingId || bookingId === 'undefined') {
            console.log(`[GHOST CLEANUP] ⚠️ Removing corrupted index entry for ${eventId}: missing bookingId`);
            invalidEntries.push(`${eventId}/[CORRUPTED_INDEX]: Missing or undefined bookingId in index`);
            continue; // Skip this entry entirely - don't add to validRegistrations
          }
          
          const participantKey = `event:${eventId}:participant:${bookingId}`;
          
          try {
            // Fetch full participant data from KV
            const participantData = await getKV<any>(participantKey, '[GHOST CLEANUP]');
            
            // Check for various ghost/corrupted entry indicators
            let isGhostEntry = false;
            let reason = '';

            // Check 1: Participant data missing entirely
            if (!participantData) {
              isGhostEntry = true;
              reason = 'Participant data not found in KV';
              invalidEntries.push(`${eventId}/${bookingId}: ${reason}`);
            } 
            // Check 2: Missing required fields
            else if (!participantData.name || !participantData.email) {
              isGhostEntry = true;
              reason = 'Missing name or email';
              invalidEntries.push(`${eventId}/${bookingId}: ${reason}`);
            } 
            // Check 3: Corrupted event date string
            else if (participantData.eventDate && participantData.eventDate.includes('ghost')) {
              isGhostEntry = true;
              reason = 'Corrupted event date (contains "ghost")';
              corruptedEntries.push(`${eventId}/${bookingId}: ${reason}`);
            } 
            // Check 4: Invalid ticket status
            else if (participantData.ticketStatus && !['Active', 'Confirmed', 'Deferred', 'Cancelled', 'Pending'].includes(participantData.ticketStatus)) {
              isGhostEntry = true;
              reason = 'Invalid ticket status';
              invalidEntries.push(`${eventId}/${bookingId}: ${reason}`);
            } 
            // Check 5: Missing critical registration metadata
            else if (!participantData.registeredAt && !participantData.createdAt) {
              isGhostEntry = true;
              reason = 'Missing registration timestamp';
              invalidEntries.push(`${eventId}/${bookingId}: ${reason}`);
            }
            
            // DEBUG: Log entry details for verification
            if (totalEventsScanned <= 2) { // Only log for first 2 events to avoid spam
              console.log(`[GHOST CLEANUP] DEBUG ${eventId}/${bookingId}: name="${participantData?.name}" email="${participantData?.email}" status="${participantData?.ticketStatus}" date="${participantData?.eventDate}"`);
            }

            if (isGhostEntry) {
              try {
                // Delete corrupted participant from KV
                await batchDeleteKV([participantKey], '[GHOST CLEANUP] DELETE', 100);
                
                ghostRegistrationsRemoved++;
                ghostEntriesRemovedList.push(`${eventId}/${bookingId}: ${reason}`);
                console.log(`[GHOST CLEANUP] ✓ Removed ghost registration: ${eventId}/${bookingId} (${reason})`);
              } catch (error) {
                console.error(`[GHOST CLEANUP] Failed to delete ghost registration ${participantKey}:`, error);
              }
            } else {
              // Keep valid entry
              validRegistrations.push(indexEntry);
            }
          } catch (error) {
            console.error(`[GHOST CLEANUP] Error processing participant ${participantKey}:`, error);
          }
        }

        // Update event index if entries were removed
        if (validRegistrations.length < eventIndex.length) {
          try {
            await putKV(indexKey, validRegistrations, '[GHOST CLEANUP] UPDATE INDEX');
            console.log(`[GHOST CLEANUP] ✓ Updated event index ${eventId}: ${eventIndex.length} → ${validRegistrations.length}`);
          } catch (error) {
            console.error(`[GHOST CLEANUP] Failed to update event index ${eventId}:`, error);
          }
        }
      } catch (error) {
        console.error(`[GHOST CLEANUP] Error scanning event ${eventId}:`, error);
      }
    }

    // Step 3: Clean up user registration indices using same ghost detection
    console.log('[GHOST CLEANUP] Step 3: Validating user registration indices in KV...');
    const userIndexKeys = await listKVByPrefix('user:', '[GHOST CLEANUP] USER INDEX');
    const eventIndexKeys_filter = userIndexKeys.filter(key => key.includes(':events:index'));
    let indicesUpdated = 0;

    for (const indexKey of eventIndexKeys_filter) {
      const userId = indexKey.split(':')[1];
      
      try {
        const userEventIndex = await getKV<any[]>(indexKey, '[GHOST CLEANUP]');
        
        if (userEventIndex && Array.isArray(userEventIndex)) {
          const validIndices: any[] = [];
          let indexChanged = false;
          
          for (const entry of userEventIndex) {
            // Check if this event/booking still exists and is valid in KV
            const participantKey = `event:${entry.eventId}:participant:${entry.bookingId}`;
            
            try {
              const participantData = await getKV<any>(participantKey, '[GHOST CLEANUP]');
              let isValidEntry = true;
              let removalReason = '';

              // Apply SAME ghost detection criteria as event cleanup
              if (!participantData) {
                isValidEntry = false;
                removalReason = 'Participant data missing';
              } 
              else if (!participantData.name || !participantData.email) {
                isValidEntry = false;
                removalReason = 'Missing name/email';
              } 
              else if (participantData.eventDate && participantData.eventDate.includes('ghost')) {
                isValidEntry = false;
                removalReason = 'Corrupted event date';
              } 
              else if (participantData.ticketStatus && !['Active', 'Confirmed', 'Deferred', 'Cancelled', 'Pending'].includes(participantData.ticketStatus)) {
                isValidEntry = false;
                removalReason = 'Invalid ticket status';
              } 
              else if (!participantData.registeredAt && !participantData.createdAt) {
                isValidEntry = false;
                removalReason = 'Missing registration timestamp';
              }

              if (isValidEntry) {
                validIndices.push(entry);
              } else {
                indexChanged = true;
                console.log(`[GHOST CLEANUP] Removing invalid registration from user ${userId}: ${entry.eventId}/${entry.bookingId} (${removalReason})`);
              }
            } catch (error) {
              console.error(`[GHOST CLEANUP] Error checking user index entry:`, error);
            }
          }

          // Update index if it changed
          if (indexChanged && validIndices.length < userEventIndex.length) {
            await putKV(indexKey, validIndices, '[GHOST CLEANUP] UPDATE USER INDEX');
            indicesUpdated++;
            console.log(`[GHOST CLEANUP] ✓ Updated user index ${userId}: ${userEventIndex.length} → ${validIndices.length}`);
          }
        }
      } catch (error) {
        console.error(`[GHOST CLEANUP] Error processing user index ${userId}:`, error);
      }
    }

    // Step 4: Generate detailed report
    const duration = Date.now() - startTime;
    const reportLines = [
      `═══════════════════════════════════════════════════════════`,
      `         GHOST REGISTRATION CLEANUP REPORT`,
      `═══════════════════════════════════════════════════════════`,
      ``,
      `📅 Timestamp: ${new Date().toISOString()}`,
      `⏱️  Duration: ${duration}ms`,
      ``,
      `📊 SCAN SUMMARY:`,
      `  ├─ Total Events Scanned: ${totalEventsScanned}`,
      `  ├─ Ghost Registrations Removed: ${ghostRegistrationsRemoved}`,
      `  ├─ Invalid Entries Found: ${invalidEntries.length}`,
      `  └─ Corrupted Entries Found: ${corruptedEntries.length}`,
      ``,
      `🗑️  INVALID ENTRIES REMOVED:`,
      invalidEntries.length > 0 ? invalidEntries.slice(0, 10).map(e => `  • ${e}`).join('\n') : '  None',
      invalidEntries.length > 10 ? `  ... and ${invalidEntries.length - 10} more` : '',
      ``,
      `⚠️  CORRUPTED ENTRIES REMOVED:`,
      corruptedEntries.length > 0 ? corruptedEntries.slice(0, 10).map(e => `  • ${e}`).join('\n') : '  None',
      corruptedEntries.length > 10 ? `  ... and ${corruptedEntries.length - 10} more` : '',
      ``,
      `🔄 USER INDICES UPDATED: ${indicesUpdated}`,
      ``,
      `═══════════════════════════════════════════════════════════`,
    ];

    const report = reportLines.join('\n');
    console.log(`[GHOST CLEANUP] ✅ ${report}`);

    // Store cleanup report in KV
    await putKV('system:ghost-cleanup:latest-report', {
      timestamp: new Date().toISOString(),
      ghostRegistrationsRemoved,
      invalidEntriesCount: invalidEntries.length,
      corruptedEntriesCount: corruptedEntries.length,
      totalEventsScanned,
      indicesUpdated,
    }, '[GHOST CLEANUP]');

    return {
      success: true,
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        totalEventsScanned,
        ghostRegistrationsRemoved,
        invalidEntriesFound: invalidEntries,
        corruptedEntriesFound: corruptedEntries,
      },
      report,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;
    console.error('[GHOST CLEANUP] ❌ Failed:', errorMsg);
    
    return {
      success: false,
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        totalEventsScanned: 0,
        ghostRegistrationsRemoved: 0,
        invalidEntriesFound: [],
        corruptedEntriesFound: [],
      },
      report: `Ghost cleanup failed: ${errorMsg}`,
    };
  }
}
