// src/lib/actions/whatsappActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { toIsoStringSafe, serializeValue } from '@/lib/utils';
import type { CampaignLogEntry, ScheduledWhatsAppCampaign } from '@/lib/types';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';

const SCHEDULED_COLLECTION = 'scheduledWhatsAppCampaigns';

/**
 * Fetches WhatsApp campaign logs and summary stats.
 */
export async function getWhatsAppLogsAction(): Promise<{
  success: boolean;
  message: string;
  logs?: CampaignLogEntry[];
  stats?: { totalSent: number; sentToday: number };
}> {
  try {
    const db = getFirestoreInstance();
    const snap = await db
      .collection('whatsappLogs')
      .orderBy('sentAt', 'desc')
      .limit(500)
      .get();

    const logs = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      sentAt: toIsoStringSafe(doc.data().sentAt)
    })) as CampaignLogEntry[];

    const totalSent = logs.length;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const sentToday = logs.filter(log => {
        try {
            return new Date(log.sentAt!) >= startOfToday;
        } catch {
            return false;
        }
    }).length;

    return { 
        success: true, 
        message: 'WhatsApp logs fetched.', 
        logs: logs.slice(0, 200), 
        stats: { totalSent, sentToday } 
    };
  } catch (e: any) {
    console.error('[getWhatsAppLogsAction] Error:', e.message);
    return { success: false, message: e.message };
  }
}

/**
 * Sends a single test WhatsApp message.
 */
export async function sendTestWhatsAppCampaignAction(
    mobile: string,
    templateName: string,
    params: string[],
    media?: { filename: string; url: string; } | null
): Promise<{ success: boolean; message: string }> {
    const actionName = 'sendTestWhatsAppCampaignAction';
    
    if (!mobile || !templateName) {
        return { success: false, message: 'Mobile and Template Name are required.' };
    }

    try {
        const result = await sendAiSensyMessage(
            mobile,
            templateName,
            params,
            'Test Campaign',
            actionName,
            'Admin Test',
            media
        );

        if (result.success) {
            const db = getFirestoreInstance();
            await db.collection('whatsappLogs').add({
                recipientMobile: mobile,
                recipientName: 'Test Recipient',
                templateName,
                eventName: '[TEST] Manual Check',
                sentAt: FieldValue.serverTimestamp(),
                status: 'Success',
                sentBy: 'Admin',
            });
        }

        return result;
    } catch (error: any) {
        console.error(`[${actionName}] Error:`, error.message);
        return { success: false, message: error.message };
    }
}

/**
 * Schedules a WhatsApp campaign.
 */
export async function scheduleWhatsAppCampaignAction(
  data: any
): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const db = getFirestoreInstance();
    const payload = {
      ...data,
      status: data.scheduledAt ? 'scheduled' : 'draft',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection(SCHEDULED_COLLECTION).add(payload);
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Campaign saved successfully.', id: docRef.id };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Fetches all scheduled/upcoming campaigns.
 */
export async function getScheduledCampaignsAction(): Promise<{
  success: boolean;
  message: string;
  campaigns?: ScheduledWhatsAppCampaign[];
}> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection(SCHEDULED_COLLECTION)
      .where('status', 'in', ['scheduled', 'draft', 'processing'])
      .orderBy('createdAt', 'desc')
      .get();

    const campaigns = snap.docs.map(doc => ({
      id: doc.id,
      ...serializeValue(doc.data())
    })) as ScheduledWhatsAppCampaign[];

    return { success: true, message: 'Fetched upcoming campaigns.', campaigns };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Cancels a scheduled campaign.
 */
export async function cancelScheduledCampaignAction(id: string): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    await db.collection(SCHEDULED_COLLECTION).doc(id).update({
      status: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    });
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Campaign cancelled.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
