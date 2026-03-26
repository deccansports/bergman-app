// src/lib/actions/bikeRackActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BikeRackAssignment, EventParticipant } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { serializeValue } from '../utils';
import { sendBikeRackAssignmentWhatsApp } from '../auth/aisensyService';
import { sendBikeRackAssignmentEmail } from '../auth/brevoService'; 

const BIKE_RACKS_COLLECTION = 'bikeRackAssignments';

export async function saveBikeRackAssignmentsAction(
  eventId: string,
  assignments: Partial<BikeRackAssignment>[]
): Promise<{ success: boolean; message: string; assignments?: BikeRackAssignment[] }> {
  const actionName = 'saveBikeRackAssignmentsAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const batch = adminDb.batch();
    const collectionRef = adminDb.collection('events').doc(eventId).collection(BIKE_RACKS_COLLECTION);

    for (const assignment of assignments) {
      const { id, ...data } = assignment;
      if (id) {
        // Update existing rule
        batch.update(collectionRef.doc(id), { ...data, updatedAt: FieldValue.serverTimestamp() });
      } else {
        // Add new rule
        const newDocRef = collectionRef.doc();
        batch.set(newDocRef, { ...data, createdAt: FieldValue.serverTimestamp() });
      }
    }
    
    // Handle deletions
    const existingAssignmentsSnap = await collectionRef.get();
    const submittedIds = new Set(assignments.map(a => a.id).filter(Boolean));
    existingAssignmentsSnap.docs.forEach(doc => {
      if (!submittedIds.has(doc.id)) {
        batch.delete(doc.ref);
      }
    });

    await batch.commit();
    revalidatePath('/admin/dashboard');
    revalidatePath('/volunteer/dashboard'); // Also revalidate volunteer dashboard

    const updatedAssignments = await getBikeRackAssignmentsAction(eventId);
    return { success: true, message: 'Bike rack assignments saved.', assignments: updatedAssignments.assignments };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getBikeRackAssignmentsAction(
  eventId: string
): Promise<{ success: boolean; message: string; assignments?: BikeRackAssignment[] }> {
  const actionName = 'getBikeRackAssignmentsAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection('events').doc(eventId).collection(BIKE_RACKS_COLLECTION).orderBy('createdAt').get();
    const assignments = snapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as BikeRackAssignment);
    return { success: true, message: 'Assignments fetched.', assignments };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function sendBikeRackNotificationsAction(
    eventId: string
): Promise<{ success: boolean; message: string; }> {
    const actionName = 'sendBikeRackNotificationsAction';
    if (!eventId) {
        return { success: false, message: 'Event ID is required.' };
    }

    try {
        const adminDb = getFirestoreInstance();
        const eventDoc = await adminDb.collection('events').doc(eventId).get();
        if (!eventDoc.exists) return { success: false, message: 'Event not found.' };
        const eventData = eventDoc.data()!;
        const eventName = eventData.eventName || 'the event';
        const eventDate = eventData.eventDate || null;
        const location = eventData.venueName || null;

        const assignmentsResult = await getBikeRackAssignmentsAction(eventId);
        if (!assignmentsResult.success || !assignmentsResult.assignments || assignmentsResult.assignments.length === 0) {
            return { success: false, message: 'No bike rack assignments have been configured for this event.' };
        }
        
        const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
        const participantsSnap = await participantsRef.where('checkInStatus', '==', 'CheckedIn').get();
        
        if (participantsSnap.empty) {
            return { success: true, message: 'No waiver-signed participants found to notify.' };
        }

        const participantsToNotify = participantsSnap.docs.filter(doc => {
            const p = doc.data() as EventParticipant;
            return !(p.notificationsSent?.bikeRackAssignment?.count && p.notificationsSent.bikeRackAssignment.count > 0);
        });

        if (participantsToNotify.length === 0) {
            return { success: true, message: "All waiver-signed participants have already been notified." };
        }

        let sentCount = 0;
        let failedCount = 0;

        for (const pDoc of participantsToNotify) {
            const participant = pDoc.data() as EventParticipant;
            if (!participant.bibNumber) continue;

            const bibNum = parseInt(participant.bibNumber, 10);
            if (isNaN(bibNum)) continue;

            const assignedRack = assignmentsResult.assignments.find(
                a => bibNum >= a.bibFrom && bibNum <= a.bibTo
            );

            if (assignedRack && assignedRack.rackName) {
                let emailSent = false;
                let whatsappSent = false;

                if (participant.email) {
                    emailSent = await sendBikeRackAssignmentEmail(
                        participant.email, participant.name, eventName,
                        participant.bibNumber, assignedRack.rackName, eventDate, location
                    );
                }

                if (participant.mobile) {
                    const whatsappResult = await sendBikeRackAssignmentWhatsApp(
                        participant.mobile, participant.name, eventName,
                        participant.bibNumber, assignedRack.rackName
                    );
                    whatsappSent = whatsappResult.success;
                }

                if (emailSent || whatsappSent) {
                    sentCount++;
                    await pDoc.ref.update({
                        'notificationsSent.bikeRackAssignment': {
                            count: FieldValue.increment(1),
                            dates: FieldValue.arrayUnion(new Date().toISOString())
                        }
                    });
                } else {
                    failedCount++;
                }
            }
        }

        const message = `Notification process complete. Sent to: ${sentCount}, Failures: ${failedCount}.`;
        revalidatePath('/volunteer/dashboard');
        return { success: true, message };

    } catch (e: any) {
        console.error(`[${actionName}] Error sending notifications:`, e);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}
