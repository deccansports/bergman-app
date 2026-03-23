// src/lib/actions/registrationActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { RegistrationAttempt, PublicEventRegistrationFormInputClient } from '@/lib/types';
import { serializeValue } from '@/lib/utils';

export async function getRegistrationAttemptsAction(eventId?: string): Promise<{
  success: boolean;
  message: string;
  attempts?: RegistrationAttempt[];
}> {
  const actionName = 'getRegistrationAttemptsAction';
  try {
    const adminDb = getFirestoreInstance();
    let query: FirebaseFirestore.Query = adminDb.collection('registrationAttempts');

    if (eventId) {
      query = query.where('eventId', '==', eventId);
    }
    
    query = query.orderBy('updatedAt', 'desc').limit(200);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { success: true, message: 'No registration attempts found.', attempts: [] };
    }

    const attempts: RegistrationAttempt[] = snapshot.docs.map(doc => {
      return serializeValue({ id: doc.id, ...doc.data() }) as RegistrationAttempt;
    });

    return { success: true, message: 'Attempts fetched.', attempts };
  } catch (e: any) {
    if ((e as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: "A database index is required for this query. Please check your Firestore indexes." };
    }
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function deleteRegistrationAttemptAction(attemptId: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteRegistrationAttemptAction';
  if (!attemptId) {
    return { success: false, message: 'Attempt ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const attemptRef = adminDb.collection('registrationAttempts').doc(attemptId);
    const doc = await attemptRef.get();
    
    if (!doc.exists) {
        return { success: false, message: 'Registration attempt not found.' };
    }

    await attemptRef.delete();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Registration attempt deleted.' };
  } catch (e: any) {
    return { success: false, message: `Failed to delete attempt: ${e.message}` };
  }
}

export async function logRegistrationAttemptAction(
  attemptId: string,
  data: Partial<RegistrationAttempt> | Partial<PublicEventRegistrationFormInputClient>
): Promise<{ success: boolean; message: string; attemptId?: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const attemptRef = adminDb.collection("registrationAttempts").doc(attemptId);

    // Save the attempt details. This is used by the webhook to reconstruct the registration if needed.
    await attemptRef.set({
      ...data,
      id: attemptId,
      status: 'PaymentInitiated',
      participantId: null,
      bookingId: null,
      remindersSent: {
        email: { count: 0, dates: [] },
        whatsapp: { count: 0, dates: [] }
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true, message: 'Attempt logged.', attemptId: attemptId };

  } catch (e: any) {
    console.error("[logRegistrationAttemptAction] Error:", e.message);
    return { success: false, message: `Failed to log attempt: ${e.message}` };
  }
}
