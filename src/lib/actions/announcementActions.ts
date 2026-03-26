// src/lib/actions/announcementActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { Announcement, AnnouncementType } from '@/lib/types';
import { AnnouncementSchema, type AnnouncementFormInput } from '@/lib/schemas';
import { serializeValue } from '@/lib/utils';
import { getKV, putKV, deleteKV } from '../cloudflare/kv';
import { runDataSyncAction } from './dataSyncActions';

const ANNOUNCEMENTS_COLLECTION = 'announcements';

/**
 * INTERNAL: Mirror active announcements to KV.
 */
export async function _syncAnnouncementsToKV(): Promise<{ count: number }> {
    const actionName = '_syncAnnouncementsToKV';
    const db = getFirestoreInstance();
    const snap = await db.collection(ANNOUNCEMENTS_COLLECTION).where('isActive', '==', true).get();
    
    const list = snap.docs.map(doc => serializeValue({ 
        ...doc.data(), 
        id: doc.id 
    })) as Announcement[];

    await putKV('announcements:active', list, actionName);
    return { count: list.length };
}

/**
 * Publishes a new announcement to the platform.
 */
export async function addAnnouncementAction(
  data: AnnouncementFormInput,
  adminUid: string
): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const validation = AnnouncementSchema.safeParse(data);
    if (!validation.success) {
      return { success: false, message: validation.error.errors[0].message };
    }

    const adminDb = getFirestoreInstance();
    const payload = {
      ...validation.data,
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await adminDb.collection(ANNOUNCEMENTS_COLLECTION).add(payload);
    
    // 🔥 AUTO-SYNC TO KV
    await _syncAnnouncementsToKV();
    
    revalidatePath('/', 'layout');
    return { success: true, message: 'Announcement published and synced successfully.', id: docRef.id };
  } catch (e: any) {
    console.error('[addAnnouncementAction] Error:', e);
    return { success: false, message: e.message };
  }
}

/**
 * Updates an existing announcement.
 */
export async function updateAnnouncementAction(
  id: string,
  data: Partial<AnnouncementFormInput>
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection(ANNOUNCEMENTS_COLLECTION).doc(id).update({
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    });
    
    // 🔥 AUTO-SYNC TO KV
    await _syncAnnouncementsToKV();

    revalidatePath('/', 'layout');
    return { success: true, message: 'Announcement updated and synced.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Permanently deletes an announcement.
 */
export async function deleteAnnouncementAction(id: string): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection(ANNOUNCEMENTS_COLLECTION).doc(id).delete();
    
    // 🔥 AUTO-SYNC TO KV
    await _syncAnnouncementsToKV();

    revalidatePath('/', 'layout');
    return { success: true, message: 'Announcement deleted successfully.' };
  } catch (e: any) {
    console.error('[deleteAnnouncementAction] Error:', e);
    return { success: false, message: e.message };
  }
}

/**
 * SCALE-FIRST: Fetches active announcements from KV.
 */
export async function getActiveAnnouncementsAction(params: {
  role?: AnnouncementType | 'admin';
  eventId?: string | null;
}): Promise<{ success: boolean; message: string; announcements?: Announcement[] }> {
  const actionName = 'getActiveAnnouncementsAction';
  try {
    const allActive = await getKV<Announcement[]>('announcements:active', actionName);
    
    if (!allActive || allActive.length === 0) {
        return { success: true, message: 'No active announcements.', announcements: [] };
    }

    const now = new Date().toISOString();
    const filtered = allActive.filter(a => {
      // 1. Time validity
      if (a.startDate > now || a.endDate < now) return false;

      // 2. Audience targeting
      if (a.type === 'global') return true;
      if (params.role === 'admin') return true;
      
      const userRole = params.role || 'athlete';
      if (a.type === userRole) {
          if (a.targetEventId && a.targetEventId !== 'all' && params.eventId !== a.targetEventId) return false;
          return true;
      }
      return false;
    });

    return { success: true, message: 'Fetched from cache.', announcements: filtered };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: e.message };
  }
}

/**
 * Admin view of all announcements (Firestore Direct).
 */
export async function getAllAnnouncementsAdminAction(): Promise<{ success: boolean; message: string; announcements?: Announcement[] }> {
    try {
        const db = getFirestoreInstance();
        const snapshot = await db.collection(ANNOUNCEMENTS_COLLECTION).orderBy('createdAt', 'desc').get();
        const list = snapshot.docs.map(doc => ({
            id: doc.id,
            ...serializeValue(doc.data())
        })) as Announcement[];
        return { success: true, message: 'Fetched all announcements.', announcements: list };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
