// src/lib/registrationEngine/finalizeRegistration.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { EventParticipant, EventCalendarEntry, TicketDefinition, RegistrationAttempt, SwimDistanceCategory } from '@/lib/types';
import { assignNextAvailableBib } from '@/lib/actions/bibActions';
import { calculateAgeGroup } from '@/lib/utils';
import { syncRegistrationToZoho } from './zohoSync';
import { sendRegistrationNotifications } from './registrationNotifications';
import { NO_CLUB_SELECTED_VALUE } from '../constants';
import { runDataSyncAction } from '@/lib/actions/dataSyncActions';

/**
 * FINAL REGISTRATION ENGINE
 */
export async function finalizeRegistration(orderId: string): Promise<{ success: boolean; message: string; participantId?: string; bookingId?: string | null; bibNumber?: string | null }> {
  const db = getFirestoreInstance();

  try {
    const attemptRef = db.collection("registrationAttempts").doc(orderId);
    const attemptSnap = await attemptRef.get();

    if (!attemptSnap.exists) return { success: false, message: `Registration attempt ${orderId} not found.` };
    const attempt = attemptSnap.data() as RegistrationAttempt;

    if (attempt.status === 'Completed') {
        return { success: true, message: "Already finalized.", participantId: attempt.participantId ?? undefined, bookingId: attempt.bookingId, bibNumber: attempt.bibNumber };
    }

    const finalResult = await db.runTransaction(async (transaction) => {
      const freshAttemptSnap = await transaction.get(attemptRef);
      if (!freshAttemptSnap.exists) throw new Error("Attempt missing.");
      const freshAttempt = freshAttemptSnap.data() as RegistrationAttempt;

      if (freshAttempt.status === 'Completed') return { success: true, message: 'Already finalized', participantId: freshAttempt.participantId ?? undefined, bookingId: freshAttempt.bookingId, bibNumber: freshAttempt.bibNumber };

      const eventRef = db.collection('events').doc(attempt.eventId);
      const eventSnap = await transaction.get(eventRef);
      if (!eventSnap.exists) throw new Error('Event missing.');

      const ticketRef = eventRef.collection('ticketDefinitions').doc(attempt.ticketId);
      const ticketSnap = await transaction.get(ticketRef);
      if (!ticketSnap.exists) throw new Error('Ticket missing.');
      
      const eventData = eventSnap.data() as EventCalendarEntry;
      const ticketData = ticketSnap.data() as TicketDefinition;

      let subCategoryData: SwimDistanceCategory | null = null;
      if (attempt.selectedSubCategory) {
          subCategoryData = ticketData.subCategories?.find(s => s.id === attempt.selectedSubCategory) || null;
      }

      const ageGroupsRaw = subCategoryData?.applicableAgeGroups || ticketData.applicableAgeGroups || eventData.ageCategories;
      const ageGroups = Array.isArray(ageGroupsRaw) ? ageGroupsRaw : (typeof ageGroupsRaw === 'string' ? ageGroupsRaw.split(',').map(s => s.trim()) : []);
      const { age, ageCategory } = calculateAgeGroup(attempt.dob, eventData.eventName, ageGroups);
      
      const finalEventDate = ticketData.eventDate || eventData.eventDate || null;

      const participantsCol = eventRef.collection('participants');
      const allAssignedBibs = new Set<string>((await participantsCol.select('bibNumber').get()).docs.map(doc => doc.data().bibNumber).filter(Boolean).map(String));

      const bibNumber = await assignNextAvailableBib(
        attempt.eventId, 
        attempt.ticketId, 
        ageCategory, 
        attempt.gender || null, 
        allAssignedBibs,
        attempt.selectedSubCategory
      );
      
      const bookingId = `BMIN${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const registrationTimestamp = new Date();
      
      const finalClubId = attempt.clubId === NO_CLUB_SELECTED_VALUE ? null : (attempt.clubId || null);

      const finalTicketName = subCategoryData 
        ? `${ticketData.ticketName} - ${subCategoryData.name}`
        : (ticketData.ticketName || 'N/A');

      const participantRef = participantsCol.doc();
      const participantPayload: Omit<EventParticipant, 'id'> = {
        ...attempt,
        name: (attempt.name || '').trim(),
        clubId: finalClubId,
        athleteUid: attempt.userId ?? (attempt as any).athleteUid ?? null,
        registrationAttemptId: orderId,
        paymentId: attempt.transactionId ?? undefined,
        paymentMethod: (attempt as any).specificPaymentMethod || (attempt.transactionId?.startsWith('pi_') ? 'Stripe' : 'Razorpay'),
        buyerName: attempt.name!,
        buyerEmail: (attempt.email || '').toLowerCase(),
        email: (attempt.email || '').toLowerCase(),
        bookingId,
        bibNumber,
        age: age ?? undefined,
        ageCategory: ageCategory ?? undefined,
        eventDate: finalEventDate,
        ticketStatus: 'Active',
        ticketName: finalTicketName,
        eventName: eventData.eventName,
        registeredAt: registrationTimestamp.toISOString(),
        createdAt: registrationTimestamp.toISOString(),
        updatedAt: registrationTimestamp.toISOString(),
        zohoSynced: false,
      };

      transaction.set(participantRef, participantPayload);
      transaction.update(attemptRef, { status: 'Completed', participantId: participantRef.id, bookingId, bibNumber, updatedAt: FieldValue.serverTimestamp() });

      if ((attempt as any).deferralId) {
          const defRef = db.collection("deferrals").doc((attempt as any).deferralId);
          transaction.update(defRef, {
              status: 'Used',
              deferredToEventId: attempt.eventId,
              deferredToEventName: eventData.eventName,
              deferredToTicketId: attempt.ticketId,
              deferredToTicketName: ticketData.ticketName,
              updatedAt: FieldValue.serverTimestamp()
          });
          const uId = attempt.userId || (attempt as any).athleteUid;
          if (uId) {
              transaction.update(db.collection("users").doc(uId), {
                  activeDeferral: FieldValue.delete()
              });
          }
      }

      if (attempt.couponCode) {
          const couponRef = db.collection("coupons").doc(attempt.couponCode.toUpperCase());
          transaction.update(couponRef, {
              usageCount: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp()
          });
      }

      return { success: true, message: 'Finalized', participantId: participantRef.id, bookingId, bibNumber };
    });

    if (finalResult.success && finalResult.participantId) {
        sendRegistrationNotifications(orderId).catch(console.error);
        syncRegistrationToZoho(orderId).catch(console.error);
        
        // Refresh the public event cache to update slot-based pricing counts
        runDataSyncAction('calendar').catch(console.error);
    }

    return {
        success: finalResult.success,
        message: finalResult.message,
        participantId: finalResult.participantId ?? undefined,
        bookingId: finalResult.bookingId,
        bibNumber: finalResult.bibNumber
    };
  } catch (error: any) {
    await db.collection('registrationAttempts').doc(orderId).set({ status: 'RegistrationFailed', lastError: error.message, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { success: false, message: error.message };
  }
}
