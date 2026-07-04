'use server';

import { getFirestoreInstance } from '../firebaseAdmin';
import { getKV, putKV } from '../cloudflare/kv';
import type { User } from '@/lib/types';
import { serializeValue } from '../utils';

interface UserSyncResult {
  success: boolean;
  message: string;
  syncedCount?: number;
  failedCount?: number;
  rateLimitRetries?: number;
  errors?: string[];
  details?: Array<{
    uid: string;
    email: string;
    status: 'synced' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

/**
 * Sync a single user to KV
 */
export async function syncSingleUserToKVAction(userId: string): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const userDoc = await adminDb.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return { success: false, message: 'User not found' };
    }

    const userData = userDoc.data() as User;
    const serialized = serializeValue(userData);

    // Sync to KV with key: user:{uid}:profile
    await putKV(`user:${userId}:profile`, serialized, 'syncSingleUserToKV');

    return { success: true, message: 'User synced to KV' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Sync all users to KV with rate limiting and batching
 * Limits concurrent requests to avoid 429 errors
 */
export async function syncAllUsersToKVAction(options?: {
  batchSize?: number;
  delayMs?: number;
  maxUsers?: number;
}): Promise<UserSyncResult> {
  const actionName = 'syncAllUsersToKVAction';
  const batchSize = options?.batchSize || 10;
  const delayMs = options?.delayMs || 500;
  const maxUsers = options?.maxUsers || undefined;

  const details: UserSyncResult['details'] = [];
  let syncedCount = 0;
  let failedCount = 0;
  let rateLimitRetries = 0;
  const errors: string[] = [];

  try {
    const adminDb = getFirestoreInstance();

    console.log(`[${actionName}] Starting user KV sync with batchSize=${batchSize}, delayMs=${delayMs}`);

    // Get all users
    let usersQuery = adminDb.collection('users');
    const usersSnapshot = await usersQuery.get();

    let userCount = 0;
    const users: Array<{ id: string; data: User }> = [];

    for (const doc of usersSnapshot.docs) {
      if (maxUsers && userCount >= maxUsers) break;
      users.push({ id: doc.id, data: doc.data() as User });
      userCount++;
    }

    console.log(`[${actionName}] Found ${users.length} users to sync`);

    // Process in batches
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      try {
        // Sync batch with delay
        const batchPromises = batch.map(async (user) => {
          try {
            const serialized = serializeValue(user.data);
            await putKV(`user:${user.id}:profile`, serialized, 'syncAllUsersToKV');

            syncedCount++;
            details.push({
              uid: user.id,
              email: user.data.email || 'N/A',
              status: 'synced',
            });

            return { success: true };
          } catch (error: any) {
            failedCount++;
            const errorMsg = error.message || 'Unknown error';
            errors.push(`User ${user.id}: ${errorMsg}`);
            details.push({
              uid: user.id,
              email: user.data.email || 'N/A',
              status: 'failed',
              reason: errorMsg,
            });

            // Track rate limit errors
            if (error.status === 429) {
              rateLimitRetries++;
            }

            return { success: false };
          }
        });

        await Promise.all(batchPromises);

        // Delay between batches to avoid rate limiting
        if (i + batchSize < users.length) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (batchError: any) {
        const errorMsg = `Batch ${Math.floor(i / batchSize)} failed: ${batchError.message}`;
        console.error(`[${actionName}] ${errorMsg}`);
        errors.push(errorMsg);

        if (batchError.status === 429) {
          rateLimitRetries++;
          // Exponential backoff on rate limit
          await new Promise((resolve) => setTimeout(resolve, delayMs * 2));
        }
      }
    }

    const message = `Synced ${syncedCount}/${users.length} users${rateLimitRetries > 0 ? ` (${rateLimitRetries} rate limit retries)` : ''}`;
    console.log(`[${actionName}] ${message}`);

    return {
      success: errors.length === 0 || syncedCount > 0,
      message,
      syncedCount,
      failedCount,
      rateLimitRetries,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Return first 10 errors
      details: details.slice(0, 100), // Return first 100 details
    };
  } catch (e: any) {
    const errorMsg = e.message || 'Unknown error';
    console.error(`[${actionName}] Failed:`, e);
    return {
      success: false,
      message: `User KV sync failed: ${errorMsg}`,
      syncedCount,
      failedCount,
      rateLimitRetries,
      errors: [errorMsg],
    };
  }
}

/**
 * Read user from KV cache
 */
export async function getUserFromKVAction(userId: string): Promise<{ success: boolean; message: string; user?: User }> {
  try {
    const user = await getKV<User>(`user:${userId}:profile`, 'getUserFromKV');

    if (!user) {
      return { success: false, message: 'User not found in KV cache' };
    }

    return { success: true, message: 'User loaded from KV', user };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Get user with fallback to KV cache
 */
export async function getUserWithKVFallbackAction(userId: string): Promise<{ success: boolean; message: string; user?: User; source?: 'firestore' | 'kv' }> {
  try {
    const adminDb = getFirestoreInstance();

    // Try Firestore first
    const userDoc = await adminDb.collection('users').doc(userId).get();

    if (userDoc.exists) {
      const userData = userDoc.data() as User;
      return {
        success: true,
        message: 'User loaded from Firestore',
        user: userData,
        source: 'firestore',
      };
    }

    // Fallback to KV cache
    const cachedUser = await getKV<User>(`user:${userId}:profile`, 'getUserWithFallback');

    if (cachedUser) {
      return {
        success: true,
        message: 'User loaded from KV cache (not in Firestore)',
        user: cachedUser,
        source: 'kv',
      };
    }

    return { success: false, message: 'User not found in Firestore or KV' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Create user from registration data and sync to KV
 */
export async function createUserFromRegistrationAction(userData: Partial<User>): Promise<{ success: boolean; message: string; userId?: string }> {
  try {
    const adminDb = getFirestoreInstance();

    // Validate required fields
    if (!userData.email || !userData.uid) {
      return { success: false, message: 'Email and UID are required' };
    }

    const lowerEmail = userData.email.toLowerCase().trim();

    // 1. Check if user already exists by UID
    const existingUser = await adminDb.collection('users').doc(userData.uid).get();
    if (existingUser.exists) {
      return { success: false, message: `User ${userData.uid} already exists` };
    }

    // 2. Check for duplicate by email in Firestore
    const emailQuery = await adminDb.collection('users')
      .where('email', '==', lowerEmail)
      .get();
    
    if (!emailQuery.empty) {
      return { success: false, message: `User with email ${userData.email} already exists` };
    }

    // 3. Create user document
    const userDocData = {
      ...userData,
      email: lowerEmail, // Ensure email is lowercase
      id: userData.uid,
      createdAt: new Date(),
      updatedAt: new Date(),
      isAdmin: false,
      isVolunteer: false,
      role: userData.role || 'athlete',
    };

    await adminDb.collection('users').doc(userData.uid).set(userDocData);

    // 4. Sync to KV immediately
    const serialized = serializeValue(userDocData);
    await putKV(`user:${userData.uid}:profile`, serialized, 'createUserFromRegistration');

    // 5. Also store in users list KV for quick lookups
    const usersList = await getKV<string[]>('users:list', 'createUserFromRegistration') || [];
    if (!usersList.includes(userData.uid)) {
      usersList.push(userData.uid);
      await putKV('users:list', usersList, 'createUserFromRegistration');
    }

    console.log(`[createUserFromRegistration] User ${userData.uid} (${lowerEmail}) created and synced to KV`);

    return {
      success: true,
      message: 'User created and synced to KV',
      userId: userData.uid,
    };
  } catch (e: any) {
    console.error('[createUserFromRegistration] Failed:', e);
    return { success: false, message: e.message };
  }
}

/**
 * Get sync status - how many users in Firestore vs KV
 */
export async function getUserSyncStatusAction(): Promise<{
  success: boolean;
  message: string;
  totalUsersInFirestore?: number;
  usersInKV?: number;
  syncPercentage?: number;
}> {
  try {
    const adminDb = getFirestoreInstance();

    // Count users in Firestore
    const usersSnapshot = await adminDb.collection('users').get();
    const totalUsersInFirestore = usersSnapshot.size;

    // Estimate users in KV (this is approximate as we can't list KV keys efficiently)
    // In a real scenario, we'd need a separate counter or metadata
    let usersInKV = 0;
    let syncPercentage = 0;

    if (totalUsersInFirestore > 0) {
      // Check how many users have KV entries
      for (const doc of usersSnapshot.docs) {
        const user = doc.data() as User;
        const kvUser = await getKV<User>(`user:${doc.id}:profile`, 'getUserSyncStatus');
        if (kvUser) {
          usersInKV++;
        }
      }
      syncPercentage = Math.round((usersInKV / totalUsersInFirestore) * 100);
    }

    return {
      success: true,
      message: 'Sync status retrieved',
      totalUsersInFirestore,
      usersInKV,
      syncPercentage,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message,
    };
  }
}
