// src/lib/registrationEngine/registrationNotifications.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { EventParticipant, EventCalendarEntry, User, RegistrationAttempt } from '@/lib/types';
import {
  sendRegistrationConfirmationEmail,
  sendAdminTicketSaleNotificationEmail,
  sendClubAthleteRegistrationNoticeEmail,
} from '@/lib/auth/brevoService';
import {
  sendRegistrationConfirmationViaWhatsApp,
  sendClubAthleteRegistrationNoticeWhatsApp,
} from '../auth/aisensyService';
import { NO_CLUB_SELECTED_VALUE } from '../constants';

/**
 * Fires off notifications after a successful registration.
 * This function should NOT throw errors and should not block
 * the main registration flow. It's a "fire and forget" operation.
 */
export async function sendRegistrationNotifications(orderId: string, overrideBib?: string | null): Promise<void> {
  const actionName = 'sendRegistrationNotifications';
  try {
    const db = getFirestoreInstance();
    const orderSnap = await db.collection('registrationAttempts').doc(orderId).get();
    if (!orderSnap.exists) {
        console.error(`[${actionName}] Registration Attempt ${orderId} not found.`);
        return;
    }
    
    const orderData = orderSnap.data()! as RegistrationAttempt;
    const participantId = orderData.participantId;
    if (!participantId) {
        console.error(`[${actionName}] Participant ID missing on attempt ${orderId}.`);
        return;
    }
    const eventId = orderData.eventId;
    const currency = orderData.pricingBreakdown?.currency || 'INR';
    
    const [eventSnap, participantSnap] = await Promise.all([
        db.collection('events').doc(eventId).get(),
        db.collection('events').doc(eventId).collection('participants').doc(participantId).get(),
    ]);

    if (!eventSnap.exists || !participantSnap.exists) {
        console.error(`[${actionName}] Event or Participant not found for attempt ${orderId}.`);
        return;
    }

    const event = eventSnap.data() as EventCalendarEntry;
    const participant = participantSnap.data() as EventParticipant;

    const registrationTimestamp = new Date();
    
    // ENSURE WE USE THE CALCULATED BIB AND NOT "TBD"
    const finalBib = overrideBib || participant.bibNumber || 'TBD';

    // 🔥 CRITICAL FIX: RESOLVE MOST SPECIFIC DATE
    const ticketDef = event.ticketDefinitions?.find(td => td.id === participant.ticketId);
    const finalEventDate = participant.eventDate || ticketDef?.eventDate || event.eventDate || null;

    // 1. Send confirmation to athlete
    if (participant.email) {
      await sendRegistrationConfirmationEmail(
        participant.email, participant.name, event.eventName, participant.bookingId!,
        registrationTimestamp, participant.ticketName ?? 'N/A', event.venueName || event.address,
        finalEventDate,
        participant.address, participant.mobile, participant.emergencyContactNumber,
        participant.invoiceNumber, finalBib,
        event.organizerName, event.organizerAddress, event.organizerCompanyDescription, participant.country,
        currency as any
      );
    }
    if (participant.mobile) {
      await sendRegistrationConfirmationViaWhatsApp(
        participant.mobile,
        participant.name ?? null,
        event.eventName ?? null,
        participant.bookingId ?? null,
        registrationTimestamp,
        participant.ticketName ?? 'N/A',
        finalBib,
        event.venueName || null,
        finalEventDate,
      );
    }
    
    // 2. Send notification to admin
    await sendAdminTicketSaleNotificationEmail(
      participant.name, event.eventName, participant.bookingId!, registrationTimestamp,
      participant.ticketName!, event.venueName, finalEventDate, participant.address,
      participant.mobile, participant.emergencyContactNumber, participant.email,
      participant.invoiceNumber, finalBib, event.organizerName,
      event.organizerAddress, event.organizerCompanyDescription, participant.country,
      currency as any
    );

    // 3. Send notification to club owner if applicable (IGNORE PLACEHOLDER)
    if (participant.clubId && participant.clubId !== NO_CLUB_SELECTED_VALUE) {
      const clubDoc = await db.collection('clubs').doc(participant.clubId).get();
      if (clubDoc.exists) {
        const clubData = clubDoc.data();
        const ownerId = (clubData as any)?.ownerUid;
        if (ownerId) {
          const ownerDoc = await db.collection('users').doc(ownerId).get();
          if (ownerDoc.exists) {
            const ownerData = ownerDoc.data() as User;
            if (ownerData.email) {
              await sendClubAthleteRegistrationNoticeEmail(
                ownerData.email,
                participant.name || 'An athlete',
                (clubData as any)?.name,
                event.eventName,
                participant.ticketName ?? 'N/A',
                event.venueName || null,
                finalEventDate
              );
            }
            if (ownerData.mobile) {
              await sendClubAthleteRegistrationNoticeWhatsApp(ownerData.mobile, participant.name || 'An athlete', event.eventName, participant.ticketName ?? 'N/A', finalEventDate);
            }
          }
        }
      }
    }
    
    console.log(`[${actionName}] All notifications triggered for order ${orderId}.`);
    
  } catch (error: any) {
    console.error(`[${actionName}] Uncaught error sending notifications for order ${orderId}:`, error.message);
  }
}
