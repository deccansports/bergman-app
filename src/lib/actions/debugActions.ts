// src/lib/actions/debugActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue, toIsoStringSafe } from '@/lib/utils';
import type { RegistrationAttempt } from '@/lib/types';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';

function isParticipantActiveStatus(status: any): boolean {
  const raw = String(status || '').trim().toLowerCase();
  return !(raw === 'cancelled' || raw === 'refunded' || raw === 'inactive');
}

export async function findBrokenRegistrations(): Promise<{
  success: boolean;
  message: string;
  broken: { orderId: string; email: string; name: string; transactionId?: string | null; updatedAt?: string; status?: string; }[];
}> {
  const actionName = 'findBrokenRegistrations';
  try {
    const adminDb = getFirestoreInstance();

    // --- Define Problematic States ---
    // 1. Stuck in 'PaymentInitiated' for more than 10 minutes
    const tenMinutesAgo = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
    const staleInitiatedQuery = adminDb.collection("registrationAttempts")
      .where("status", "==", "PaymentInitiated")
      .where("updatedAt", "<=", tenMinutesAgo)
      .orderBy("updatedAt", "desc")
      .limit(25);

    // 2. Stuck in 'PaymentCaptured' but didn't complete
    const staleCapturedQuery = adminDb.collection("registrationAttempts")
      .where("status", "==", "PaymentCaptured")
      .orderBy("updatedAt", "desc")
      .limit(25);

    // 3. Explicitly failed
    const failedQuery = adminDb.collection("registrationAttempts")
      .where("status", "==", "RegistrationFailed")
      .orderBy("updatedAt", "desc")
      .limit(25);
      
    // --- Execute all queries in parallel ---
    const [
        staleInitiatedSnap,
        staleCapturedSnap,
        failedSnap
    ] = await Promise.all([
        staleInitiatedQuery.get(),
        staleCapturedQuery.get(),
        failedQuery.get()
    ]);
    
    // --- Combine and de-duplicate results ---
    const allProblematicDocs = [...staleInitiatedSnap.docs, ...staleCapturedSnap.docs, ...failedSnap.docs];
    const uniqueDocsMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    allProblematicDocs.forEach(doc => {
        if (!uniqueDocsMap.has(doc.id)) {
            uniqueDocsMap.set(doc.id, doc);
        }
    });

    if (uniqueDocsMap.size === 0) {
      return { success: true, message: 'No broken or stale registrations found.', broken: [] };
    }

    let broken: { orderId: string; email: string; name: string; transactionId?: string | null; updatedAt?: string; status?: string; }[] = [];
    
    // --- Verify which ones are actually broken ---
    for (const doc of Array.from(uniqueDocsMap.values())) {
      const attempt = doc.data() as RegistrationAttempt;
      
      let participantExists = false;
      let matchedParticipantId: string | null = null;
      let matchedBookingId: string | null = null;
      let matchedBibNumber: string | null = null;
      // If we have a transactionId, that's the most reliable way to check for an existing participant.
      if (attempt.transactionId && attempt.eventId) {
        const participantSnap = await adminDb.collection("events")
          .doc(attempt.eventId)
          .collection("participants")
          .where("transactionId", "==", attempt.transactionId)
          .limit(1)
          .get();
        if (!participantSnap.empty) {
            participantExists = true;
            matchedParticipantId = participantSnap.docs[0].id;
            matchedBookingId = String((participantSnap.docs[0].data() as any)?.bookingId || '') || null;
            matchedBibNumber = String((participantSnap.docs[0].data() as any)?.bibNumber || '') || null;
        }
      }

      // Fallback for manually fixed registrations where transactionId wasn't copied to participant.
      if (!participantExists && attempt.eventId && attempt.email) {
        const normalizedEmail = String(attempt.email || '').trim().toLowerCase();
        const byEmailSnap = await adminDb.collection('events')
          .doc(attempt.eventId)
          .collection('participants')
          .where('email', '==', normalizedEmail)
          .limit(25)
          .get();

        const matched = byEmailSnap.docs.find((doc) => {
          const p = doc.data() as any;
          const sameTicket = String(p?.ticketId || '') === String(attempt.ticketId || '');
          const sameSubCategory = String(p?.selectedSubCategory || '') === String((attempt as any)?.selectedSubCategory || '');
          const isActive = isParticipantActiveStatus(p?.ticketStatus);
          return sameTicket && sameSubCategory && isActive;
        });

        if (matched) {
          participantExists = true;
          matchedParticipantId = matched.id;
          matchedBookingId = String((matched.data() as any)?.bookingId || '') || null;
          matchedBibNumber = String((matched.data() as any)?.bibNumber || '') || null;
        }
      }

      // If a participant doesn't exist, this registration is broken.
      if (!participantExists) {
        broken.push({
          orderId: doc.id,
          email: attempt.email,
          name: attempt.name,
          transactionId: attempt.transactionId || null,
          updatedAt: toIsoStringSafe(attempt.updatedAt) || undefined,
          status: attempt.status,
        });
      } else if (String(attempt.status || '') !== 'Completed') {
        await adminDb.collection('registrationAttempts').doc(doc.id).set({
          status: 'Completed',
          participantId: matchedParticipantId,
          bookingId: matchedBookingId,
          bibNumber: matchedBibNumber,
          duplicateSuppressed: true,
          manualRegistrationExists: true,
          lastError: '',
          updatedAt: Timestamp.now(),
          autoReconciledBy: 'findBrokenRegistrations',
          autoReconciledAt: Timestamp.now(),
        }, { merge: true });
      }
    }

    return { success: true, message: `Scan complete. Found ${broken.length} potentially broken registrations that need attention.`, broken };

  } catch (error: any) {
    console.error(`[${actionName}] Error:`, error);
     if ((error as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: `A database index is required for this query. Please create the necessary composite indexes on the 'registrationAttempts' collection.`, broken: [] };
    }
    return { success: false, message: `Failed to find broken registrations: ${error.message}`, broken: [] };
  }
}

export async function getRegistrationDebugLogsAction(): Promise<{ success: boolean; message: string; logs?: any[] }> {
    const actionName = 'getRegistrationDebugLogsAction';
    try {
        const adminDb = getFirestoreInstance();
        const snapshot = await adminDb.collection('registrationDebugLogs').orderBy('updatedAt', 'desc').limit(100).get();
        if (snapshot.empty) {
            return { success: true, message: 'No debug logs found.', logs: [] };
        }
        const logs = snapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));
        return { success: true, message: 'Logs fetched.', logs };
    } catch (e: any) {
        return { success: false, message: `Failed to fetch logs: ${e.message}`, logs: [] };
    }
}
