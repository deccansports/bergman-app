// src/lib/actions/systemActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { serializeValue } from '@/lib/utils';
import type { GlobalServiceFees, ServiceFeeConfig } from '@/lib/types';

const SETTINGS_COLLECTION = 'settings';
const SYSTEM_CONTROL_DOC = 'systemControl';
const SERVICE_FEES_DOC = 'serviceFees';

const DEFAULT_SERVICE_FEE: ServiceFeeConfig = {
  deferralFeePaisa: 200000,
  categoryChangeFeePaisa: 200000
};

const DEFAULT_GLOBAL_FEES: GlobalServiceFees = {
  Triathlon: DEFAULT_SERVICE_FEE,
  Duathlon: DEFAULT_SERVICE_FEE,
  Swimming: { deferralFeePaisa: 100000, categoryChangeFeePaisa: 100000 },
  Marathon: DEFAULT_SERVICE_FEE,
  Cycling: DEFAULT_SERVICE_FEE,
  Other: DEFAULT_SERVICE_FEE,
};

export async function getSystemControlAction() {
  try {
    const db = getFirestoreInstance();
    const doc = await db.collection(SETTINGS_COLLECTION).doc(SYSTEM_CONTROL_DOC).get();
    if (!doc.exists) {
      return {
        success: true,
        settings: {
          athleteDashboardMaintenance: false,
          clubDashboardMaintenance: false,
          volunteerDashboardMaintenance: false,
          maintenanceMessage: "We're upgrading your dashboard for a better experience. Please check back shortly.",
        }
      };
    }
    return { success: true, settings: serializeValue(doc.data()) };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateSystemControlAction(data: any, adminUid: string, adminName: string) {
  try {
    const db = getFirestoreInstance();
    const settingsRef = db.collection(SETTINGS_COLLECTION).doc(SYSTEM_CONTROL_DOC);
    
    await db.runTransaction(async (transaction) => {
      transaction.set(settingsRef, {
        ...data,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const logRef = settingsRef.collection('logs').doc();
      transaction.set(logRef, {
        ...data,
        changedBy: { uid: adminUid, name: adminName },
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'System controls updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getSystemControlLogsAction() {
    try {
        const db = getFirestoreInstance();
        const snap = await db.collection(SETTINGS_COLLECTION).doc(SYSTEM_CONTROL_DOC).collection('logs').orderBy('timestamp', 'desc').limit(20).get();
        const logs = snap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
        return { success: true, logs };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function getServiceFeesAction(): Promise<{ success: boolean; fees?: GlobalServiceFees; message?: string }> {
  try {
    const db = getFirestoreInstance();
    const doc = await db.collection(SETTINGS_COLLECTION).doc(SERVICE_FEES_DOC).get();
    if (!doc.exists) {
      return { success: true, fees: serializeValue(DEFAULT_GLOBAL_FEES) };
    }
    return { success: true, fees: serializeValue(doc.data()) as GlobalServiceFees };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateServiceFeesAction(fees: GlobalServiceFees): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    await db.collection(SETTINGS_COLLECTION).doc(SERVICE_FEES_DOC).set({
      ...fees,
      updatedAt: FieldValue.serverTimestamp()
    });
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Service fees updated successfully.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
