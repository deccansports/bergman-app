// src/lib/actions/apiKeyActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes, createHash } from 'crypto';
import type { ApiKey } from '@/lib/types';
import { toIsoStringSafe } from '@/lib/utils';

export async function createApiKeyAction(
  userId: string,
  name: string
): Promise<{ success: boolean; message: string; apiKey?: string }> {
  const actionName = 'createApiKeyAction';
  if (!userId || !name) {
    return { success: false, message: 'User ID and key name are required.' };
  }
  
  try {
    const adminDb = getFirestoreInstance();
    const apiKey = `bm_live_${randomBytes(24).toString('hex')}`;
    const prefix = apiKey.substring(0, 15);
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const newKeyRef = await adminDb.collection('apiKeys').add({
      userId,
      name,
      prefix,
      keyHash,
      createdAt: FieldValue.serverTimestamp(),
      lastUsed: null,
    });
    
    return { success: true, message: 'API Key created.', apiKey };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Failed to create API key: ${e.message}` };
  }
}

export async function getApiKeysAction(
  userId: string
): Promise<{ success: boolean; message: string; keys?: ApiKey[] }> {
  const actionName = 'getApiKeysAction';
  if (!userId) {
    return { success: false, message: 'User ID is required.' };
  }
  
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection('apiKeys')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
      
    if (snapshot.empty) {
      return { success: true, message: 'No API keys found.', keys: [] };
    }
    
    const keys: ApiKey[] = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        name: data.name,
        prefix: data.prefix,
        keyHash: data.keyHash, // For server-side validation, not for client
        createdAt: toIsoStringSafe(data.createdAt) || '',
        lastUsed: toIsoStringSafe(data.lastUsed),
      };
    });
    
    return { success: true, message: 'API Keys fetched.', keys };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    if ((e as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: 'A database index is required for this query. Please create one on the `apiKeys` collection.' };
    }
    return { success: false, message: `Failed to get API keys: ${e.message}` };
  }
}

export async function revokeApiKeyAction(
  keyId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'revokeApiKeyAction';
  if (!keyId) {
    return { success: false, message: 'Key ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('apiKeys').doc(keyId).delete();
    return { success: true, message: 'API Key revoked.' };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Failed to revoke API key: ${e.message}` };
  }
}
