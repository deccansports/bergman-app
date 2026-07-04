'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { format } from 'date-fns';
import type {
  RelayTeamRegistration,
  RelayTeamRegistrationFormInput,
  RelayTeamParticipant,
} from '@/lib/types';
import { serializeParticipantData, serializeValue } from '@/lib/utils';
import { validateRelayTeamRegistration } from '@/lib/utils/relayValidation';
import { sendRegistrationConfirmationEmail } from '@/lib/auth/brevoService';
import { sendRegistrationConfirmationViaWhatsApp } from '@/lib/auth/aisensyService';
import { sendAdminTicketSaleNotificationEmail } from '@/lib/auth/brevoService';
import { calculatePricing } from '@/lib/pricingEngine';
import { PAYMENT_GATEWAY_FEE_PERCENTAGE, PLATFORM_FEE_PAISA, GST_PERCENTAGE } from '@/lib/constants';
import { validateCouponAction } from './couponActions';
import { createServiceFeeInvoiceAction, sendInvoiceEmailBrevoAction, sendWhatsAppInvoiceAction } from './invoiceActions';
import { findZohoCustomerByEmail, findZohoCustomerByName, createZohoCustomer } from '@/lib/zoho/customer';
import { markInvoiceAsSent } from '@/lib/zoho/invoice';
import { _mirrorParticipantToKV } from './dataSyncActions';

function generateRelayBookingId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BMRELAY-${rand}`;
}

function sanitizeRelayZohoValue(val: string | null | undefined, length = 100): string {
  if (!val) return '';
  return String(val)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, length);
}

async function resolveRelayZohoCustomer(primaryParticipant: any, participantRef: any) {
  if (primaryParticipant.zohoCustomerId) return primaryParticipant.zohoCustomerId;

  const cleanEmail = String(primaryParticipant.email || primaryParticipant.buyerEmail || '').toLowerCase().trim();
  if (!cleanEmail) throw new Error('Missing email for relay invoice customer resolution');

  let customer = await findZohoCustomerByEmail(cleanEmail);
  if (!customer) customer = await findZohoCustomerByName(primaryParticipant.name || cleanEmail);

  if (customer?.contact_id) {
    await participantRef.update({ zohoCustomerId: customer.contact_id, updatedAt: new Date().toISOString() });
    return customer.contact_id;
  }

  const created = await createZohoCustomer({
    contact_name: sanitizeRelayZohoValue(primaryParticipant.name || cleanEmail, 95),
    email: cleanEmail,
    phone: String(primaryParticipant.mobile || '').replace(/\D/g, '').slice(-10) || undefined,
    gst_treatment: 'consumer',
    billing_address: {
      address: sanitizeRelayZohoValue(primaryParticipant.address, 128) || undefined,
      city: sanitizeRelayZohoValue(primaryParticipant.city, 50) || undefined,
      state: sanitizeRelayZohoValue(primaryParticipant.state || 'Maharashtra', 50) || 'Maharashtra',
      country: sanitizeRelayZohoValue(primaryParticipant.country || 'India', 50) || 'India',
      zip: String(primaryParticipant.pincode || '').trim() || undefined,
    }
  });

  await participantRef.update({ zohoCustomerId: created.contact_id, updatedAt: new Date().toISOString() });
  return created.contact_id;
}

function getSharedRolesFromConfig(config?: RelayTeamRegistrationFormInput['relayConfiguration']): Array<'swim' | 'bike' | 'run'> {
  if (!config || config.type !== 'two_athletes_one_double_leg') return [];
  if (config.sharedLegs === 'SB') return ['swim', 'bike'];
  if (config.sharedLegs === 'SR') return ['swim', 'run'];
  if (config.sharedLegs === 'BR') return ['bike', 'run'];
  return [];
}

async function upsertRelayParticipantUsers(
  participants: RelayTeamParticipant[],
  clubId?: string | null
) {
  const adminDb = getFirestoreInstance();

  for (const participant of participants) {
    const lowerEmail = (participant.email || '').toLowerCase().trim();
    if (!lowerEmail) continue;

    const userPayload = {
      email: lowerEmail,
      name: participant.name || null,
      nameLower: (participant.name || '').toLowerCase(),
      mobile: participant.mobile || null,
      dob: participant.dob || null,
      gender: participant.gender || null,
      bloodGroup: participant.bloodGroup || null,
      tshirtSize: participant.tshirtSize || null,
      emergencyContactNumber: participant.emergencyContactNumber || null,
      address: participant.address || null,
      city: participant.city || null,
      state: participant.state || null,
      country: participant.country || null,
      pincode: participant.pincode || null,
      idProofUrl: participant.idProofUrl || null,
      clubId: clubId || null,
      role: 'athlete' as const,
      updatedAt: new Date().toISOString(),
    };

    const existingByEmail = await adminDb
      .collection('users')
      .where('email', '==', lowerEmail)
      .limit(1)
      .get();

    if (!existingByEmail.empty) {
      const existingDoc = existingByEmail.docs[0];
      await existingDoc.ref.set(userPayload, { merge: true });
      continue;
    }

    const newUserRef = adminDb.collection('users').doc();
    await newUserRef.set({
      id: newUserRef.id,
      uid: newUserRef.id,
      createdAt: new Date().toISOString(),
      ...userPayload,
    });
  }
}

async function sendRelayParticipantConfirmations(
  eventId: string,
  ticketId: string,
  relayTeamId: string,
  bookingId: string,
  teamName: string,
  teamBib: string,
  participants: RelayTeamParticipant[]
) {
  const adminDb = getFirestoreInstance();
  const [eventDoc, ticketDoc] = await Promise.all([
    adminDb.collection('events').doc(eventId).get(),
    adminDb.collection('events').doc(eventId).collection('ticketDefinitions').doc(ticketId).get(),
  ]);

  const eventData = eventDoc.exists ? (eventDoc.data() as any) : {};
  const ticketData = ticketDoc.exists ? (ticketDoc.data() as any) : {};
  const bookingDate = new Date();

  for (const participant of participants) {
    try {
      const roleLabel = participant.role === 'swim' ? 'Swim' : participant.role === 'bike' ? 'Bike' : 'Run';
      const participantTicketName = `${ticketData.ticketName || 'Relay Ticket'} • ${roleLabel} • Team ${teamName}`;
      const bib = participant.bibNumber || participant.bib || `${teamBib}-${roleLabel.charAt(0).toUpperCase()}`;

      if (participant.mobile) {
        await sendRegistrationConfirmationViaWhatsApp(
          participant.mobile,
          participant.name,
          eventData.eventName || null,
          bookingId,
          bookingDate,
          participantTicketName,
          bib,
          eventData.venueName ?? eventData.address ?? null,
          eventData.eventDate ?? null
        );
      }

      if (participant.email) {
        await sendRegistrationConfirmationEmail(
          participant.email,
          participant.name,
          eventData.eventName || 'Event',
          bookingId,
          bookingDate,
          participantTicketName,
          eventData.venueName || null,
          eventData.eventDate || null,
          participant.address || null,
          participant.mobile || null,
          participant.emergencyContactNumber || null,
          null,
          bib,
          eventData.organizerName || null,
          eventData.organizerAddress || null,
          eventData.organizerCompanyDescription || null,
          participant.country || 'India'
        );
      }
    } catch (notifyError: any) {
      console.warn(`Relay confirmation failed for ${participant.email || participant.name}:`, notifyError?.message || notifyError);
    }
  }
}

/**
 * Generate unique team bib and participant bibs.
 *
 * New format:  teamBib = "101",  participantBibs = { swim: "101S", bike: "101B", run: "101R" }
 *
 * If the admin has configured a relay BIB range for the ticket (via BIB Management panel,
 * isRelay = true rule), the next available number in that range is used.
 * Otherwise falls back to auto-increment across all relay registrations for the event.
 */
export async function generateRelayBibsAction(
  eventId: string,
  ticketId?: string
): Promise<{
  success: boolean;
  message: string;
  teamBib?: string;
  participantBibs?: { swim: string; bike: string; run: string };
}> {
  try {
    const adminDb = getFirestoreInstance();

    // ── 1. Try admin-configured relay BIB range ──────────────────────────────
    if (ticketId) {
      const bibRuleSnap = await adminDb
        .collection('events')
        .doc(eventId)
        .collection('bibAssignments')
        .where('ticketId', '==', ticketId)
        .where('isRelay', '==', true)
        .limit(1)
        .get();

      if (!bibRuleSnap.empty) {
        const rule = bibRuleSnap.docs[0].data();
        const startBib = rule.startBib as number;
        const endBib = rule.endBib as number;

        // Collect all used team numbers for this ticket
        const relaySnap = await adminDb
          .collection('relayTeamRegistrations')
          .where('eventId', '==', eventId)
          .where('ticketId', '==', ticketId)
          .get();

        const usedNumbers = new Set(
          relaySnap.docs.map((doc) => {
            const tb = String(doc.data().teamBib ?? '');
            // Support both "101" (new) and "R101" (legacy)
            const m = tb.match(/^R?(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
          })
        );

        let nextNum: number | null = null;
        for (let i = startBib; i <= endBib; i++) {
          if (!usedNumbers.has(i)) {
            nextNum = i;
            break;
          }
        }

        if (nextNum === null) {
          return { success: false, message: `No available relay BIB numbers in the configured range (${startBib}–${endBib}). Please expand the range in BIB Management.` };
        }

        const teamBib = String(nextNum);
        return {
          success: true,
          message: 'Bibs generated from configured range',
          teamBib,
          participantBibs: { swim: `${teamBib}S`, bike: `${teamBib}B`, run: `${teamBib}R` },
        };
      }
    }

    // ── 2. Fallback: auto-increment across all relay registrations ───────────
    const relayQuery = adminDb
      .collection('relayTeamRegistrations')
      .where('eventId', '==', eventId);

    const relaySnapshot = await relayQuery.get();
    const maxTeamNum = relaySnapshot.docs
      .map((doc) => {
        const teamBib = String(doc.data().teamBib ?? '');
        const match = teamBib.match(/^R?(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .reduce((a, b) => Math.max(a, b), 100); // Start from 101 if no relays exist

    const nextTeamNum = maxTeamNum + 1;
    const teamBib = String(nextTeamNum);

    return {
      success: true,
      message: 'Bibs generated (auto-increment — configure a range in BIB Management for precise control)',
      teamBib,
      participantBibs: { swim: `${teamBib}S`, bike: `${teamBib}B`, run: `${teamBib}R` },
    };
  } catch (e: any) {
    console.error('generateRelayBibsAction error:', e);
    return { success: false, message: `Failed to generate bibs: ${e.message}` };
  }
}

/**
 * Create relay team registration
 */
export async function createRelayTeamRegistrationAction(
  data: RelayTeamRegistrationFormInput,
  userEmail: string,
  userId: string,
  userName: string,
  paymentMeta?: {
    transactionId?: string | null;
    razorpayOrderId?: string | null;
    amountPaidPaisa?: number | null;
    paymentMethod?: string | null;
  }
): Promise<{
  success: boolean;
  message: string;
  relayTeamId?: string;
  teamBib?: string;
}> {
  try {
    // Validate input
    const validation = validateRelayTeamRegistration(data);
    if (!validation.valid) {
      return {
        success: false,
        message: `Validation failed: ${validation.errors.join('; ')}`,
      };
    }

    const adminDb = getFirestoreInstance();
    const [eventDoc, ticketDoc] = await Promise.all([
      adminDb.collection('events').doc(data.eventId).get(),
      adminDb.collection('events').doc(data.eventId).collection('ticketDefinitions').doc(data.ticketId).get(),
    ]);

    if (!eventDoc.exists) {
      return { success: false, message: 'Event not found' };
    }
    if (!ticketDoc.exists) {
      return { success: false, message: 'Ticket not found' };
    }

    const eventData = eventDoc.data() as any;
    const ticketData = ticketDoc.data() as any;
    const eventCurrency = String(eventData?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR';

    let couponDiscountPaisa = 0;
    if (data.couponCode) {
      const couponValidation = await validateCouponAction(
        data.couponCode,
        data.eventId,
        data.ticketId,
        userId,
        data.participants?.[0]?.email || userEmail
      );

      if (!couponValidation.success) {
        return { success: false, message: couponValidation.message || 'Invalid coupon code' };
      }

      couponDiscountPaisa = Number(couponValidation.discountAmountPaisa || 0);
    }

    const effectiveTaxPercent = eventCurrency === 'USD'
      ? 0
      : (Number.isFinite(Number(ticketData?.gstPercent)) && Number(ticketData?.gstPercent) > 0
          ? Number(ticketData.gstPercent)
          : GST_PERCENTAGE);

    const pricingBreakdown = calculatePricing({
      basePrice: Number(ticketData?.price || 0),
      discount: couponDiscountPaisa,
      gatewayRate: eventCurrency === 'USD' ? 0.03 : (PAYMENT_GATEWAY_FEE_PERCENTAGE / 100),
      platformFeeBase: eventCurrency === 'USD' ? 0 : PLATFORM_FEE_PAISA,
      taxEnabled: effectiveTaxPercent > 0,
      gstRate: effectiveTaxPercent > 0 ? (effectiveTaxPercent / 100) : 0,
      currency: eventCurrency,
    });

    // Generate bibs
    // Generate bibs (respects admin-configured range for this ticket)
    const bibResult = await generateRelayBibsAction(data.eventId, data.ticketId);
    if (!bibResult.success || !bibResult.teamBib || !bibResult.participantBibs) {
      return { success: false, message: 'Failed to generate team bibs' };
    }

    // Prepare participants with bibs and roles in order
    const sharedRoles = getSharedRolesFromConfig(data.relayConfiguration);
    const sharedBibSuffix = data.relayConfiguration?.type === 'two_athletes_one_double_leg'
      ? data.relayConfiguration.sharedLegs
      : undefined;

    const participantsWithBibs: RelayTeamParticipant[] = [
      {
        ...data.participants[0],
        role: 'swim',
        bib: bibResult.participantBibs.swim,
        bibNumber: sharedRoles.includes('swim') && sharedBibSuffix
          ? `${bibResult.teamBib}${sharedBibSuffix}`
          : bibResult.participantBibs.swim,
      },
      {
        ...data.participants[1],
        role: 'bike',
        bib: bibResult.participantBibs.bike,
        bibNumber: sharedRoles.includes('bike') && sharedBibSuffix
          ? `${bibResult.teamBib}${sharedBibSuffix}`
          : bibResult.participantBibs.bike,
      },
      {
        ...data.participants[2],
        role: 'run',
        bib: bibResult.participantBibs.run,
        bibNumber: sharedRoles.includes('run') && sharedBibSuffix
          ? `${bibResult.teamBib}${sharedBibSuffix}`
          : bibResult.participantBibs.run,
      },
    ];

    const registration: RelayTeamRegistration = {
      id: '', // Will be set by Firestore
      bookingId: generateRelayBookingId(),
      eventId: data.eventId,
      eventName: eventData?.eventName || '',
      ticketId: data.ticketId,
      ticketName: ticketData?.ticketName || '',
      teamName: data.teamName,
      teamBib: bibResult.teamBib,
      participants: participantsWithBibs as [
        RelayTeamParticipant,
        RelayTeamParticipant,
        RelayTeamParticipant
      ],
      relayConfiguration: data.relayConfiguration || { type: 'three_athletes' },
      createdByUid: userId,
      createdByName: userName,
      createdByEmail: userEmail,
      clubId: data.clubId || null,
      couponCode: data.couponCode || null,
      agreedRules: data.agreedRules,
      agreedWaiver: data.agreedWaiver,
      agreedCutoff: data.agreedCutoff,
      consentPromotions: data.consentPromotions,
      amountPaidPaisa: Number(paymentMeta?.amountPaidPaisa ?? pricingBreakdown.totalPayable ?? 0),
      pricingBreakdown,
      transactionId: paymentMeta?.transactionId || null,
      razorpayOrderId: paymentMeta?.razorpayOrderId || null,
      status: Number(pricingBreakdown.totalPayable || 0) === 0 || !!paymentMeta?.transactionId ? 'Completed' : 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save to Firestore
    const relayCollectionRef = adminDb.collection('relayTeamRegistrations');
    const docRef = relayCollectionRef.doc();
    const registrationWithId = {
      ...registration,
      id: docRef.id,
    };
    await docRef.set(registrationWithId);

    // Create a single team entry in event participants with all relay athletes nested inside
    const participantsResult = await createRelayTeamParticipantsAction(
      data.eventId,
      docRef.id,
      registrationWithId
    );

    if (!participantsResult.success) {
      console.warn('Failed to create participant entries:', participantsResult.message);
      // Don't fail the whole registration if participant creation fails
    }

    // Send confirmations to all relay participants (email + WhatsApp)
    try {
      await sendRelayParticipantConfirmations(
        data.eventId,
        data.ticketId,
        docRef.id,
        registrationWithId.bookingId || docRef.id,
        data.teamName,
        bibResult.teamBib,
        participantsWithBibs
      );
    } catch (notifyError: any) {
      console.warn('Relay participant confirmations failed:', notifyError?.message || notifyError);
    }

    return {
      success: true,
      message: 'Relay team registration created successfully',
      relayTeamId: docRef.id,
      teamBib: bibResult.teamBib,
    };
  } catch (e: any) {
    console.error('createRelayTeamRegistrationAction error:', e);
    return { success: false, message: `Failed to create registration: ${e.message}` };
  }
}

/**
 * Get relay team registration details
 */
export async function getRelayTeamRegistrationAction(relayTeamId: string): Promise<{
  success: boolean;
  message: string;
  registration?: RelayTeamRegistration;
}> {
  try {
    const adminDb = getFirestoreInstance();
    const docRef = adminDb.collection('relayTeamRegistrations').doc(relayTeamId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return { success: false, message: 'Relay team registration not found' };
    }

    const registration = serializeValue({
      id: doc.id,
      ...doc.data(),
    }) as RelayTeamRegistration;

    return { success: true, message: 'Fetched successfully', registration };
  } catch (e: any) {
    console.error('getRelayTeamRegistrationAction error:', e);
    return { success: false, message: `Failed to fetch: ${e.message}` };
  }
}

/**
 * Get all relay teams for an event
 */
export async function getRelayTeamsForEventAction(eventId: string): Promise<{
  success: boolean;
  message: string;
  teams?: RelayTeamRegistration[];
}> {
  try {
    const adminDb = getFirestoreInstance();
    const query = adminDb
      .collection('relayTeamRegistrations')
      .where('eventId', '==', eventId)
      .orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { success: true, message: 'No relay teams found', teams: [] };
    }

    const teams = snapshot.docs.map((doc) =>
      serializeValue({
        id: doc.id,
        ...doc.data(),
      })
    ) as RelayTeamRegistration[];

    return { success: true, message: 'Fetched successfully', teams };
  } catch (e: any) {
    console.error('getRelayTeamsForEventAction error:', e);
    return { success: false, message: `Failed to fetch teams: ${e.message}` };
  }
}

/**
 * Update relay team participant (e.g., replacement)
 */
export async function updateRelayTeamParticipantAction(
  relayTeamId: string,
  role: 'swim' | 'bike' | 'run',
  updatedParticipant: RelayTeamParticipant
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const adminDb = getFirestoreInstance();
    const docRef = adminDb.collection('relayTeamRegistrations').doc(relayTeamId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return { success: false, message: 'Relay team registration not found' };
    }

    const data = doc.data() as RelayTeamRegistration;
    const participantIndex = data.participants.findIndex((p) => p.role === role);

    if (participantIndex === -1) {
      return { success: false, message: `Participant with role '${role}' not found` };
    }

    data.participants[participantIndex] = {
      ...updatedParticipant,
      role,
      bib: data.participants[participantIndex].bib, // Keep original bib
    };

    await docRef.update({
      participants: data.participants,
      updatedAt: new Date().toISOString(),
    });

    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Participant updated successfully' };
  } catch (e: any) {
    console.error('updateRelayTeamParticipantAction error:', e);
    return { success: false, message: `Failed to update participant: ${e.message}` };
  }
}

/**
 * Create one team participant entry with all 3 relay athletes nested in the payload
 */
export async function createRelayTeamParticipantsAction(
  eventId: string,
  relayTeamId: string,
  relayTeamRegistration: RelayTeamRegistration
): Promise<{ success: boolean; message: string }> {
  try {
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection('events').doc(eventId);
    const [ticketSnap, eventSnap] = await Promise.all([
      eventRef.collection('ticketDefinitions').doc(relayTeamRegistration.ticketId).get(),
      eventRef.get(),
    ]);

    if (!ticketSnap.exists) {
      return { success: false, message: 'Ticket definition not found' };
    }

    const tData = ticketSnap.data() as any;
    const eData = eventSnap.exists ? (eventSnap.data() as any) : {};
    const batch = adminDb.batch();
    const primaryParticipantRef = eventRef.collection('participants').doc(relayTeamId);
    const primaryParticipant = relayTeamRegistration.participants[0];
    const bookingId = relayTeamRegistration.bookingId || relayTeamId;
    const relayParticipants = relayTeamRegistration.participants.map((participant) => ({
      role: participant.role,
      name: participant.name,
      email: participant.email?.toLowerCase() || '',
      mobile: participant.mobile || null,
      dob: participant.dob || null,
      gender: participant.gender || null,
      bloodGroup: participant.bloodGroup || null,
      tshirtSize: participant.tshirtSize || null,
      emergencyContactNumber: participant.emergencyContactNumber || null,
      address: participant.address || null,
      city: participant.city || null,
      state: participant.state || null,
      country: participant.country || null,
      pincode: participant.pincode || null,
      idProofUrl: participant.idProofUrl || null,
      bib: participant.bib || null,
      bibNumber: participant.bibNumber || participant.bib || null,
      athleteUid: participant.athleteUid || null,
      finishTime: participant.finishTime,
      finishTimestamp: participant.finishTimestamp || null,
      status: participant.status || 'Pending',
    }));

    batch.set(primaryParticipantRef, {
      // Core team info
      name: relayTeamRegistration.teamName,
      email: primaryParticipant.email?.toLowerCase() || null,
      mobile: primaryParticipant.mobile || null,
      athleteUid: primaryParticipant.athleteUid || relayTeamRegistration.createdByUid || null,
      buyerName: primaryParticipant.name,
      buyerEmail: primaryParticipant.email?.toLowerCase() || null,
      bookingId,
      eventId,
      eventName: relayTeamRegistration.eventName || eData?.eventName || null,
      eventDate: tData?.eventDate || eData?.eventDate || null,
      ticketId: relayTeamRegistration.ticketId,
      ticketName: tData.ticketName,
      ticketStatus: 'Active',
      bibNumber: relayTeamRegistration.teamBib,
      raceCategory: tData.ticketName,

      // Relay-specific info
      isRelay: true,
      relayTeamId,
      relayTeamName: relayTeamRegistration.teamName,
      relayTeamBib: relayTeamRegistration.teamBib,
      relayParticipantCount: relayParticipants.length,
      relayParticipants,
      relayConfiguration: relayTeamRegistration.relayConfiguration || null,

      // Primary contact snapshot
      dob: primaryParticipant.dob || null,
      gender: primaryParticipant.gender || null,
      bloodGroup: primaryParticipant.bloodGroup || null,
      tshirtSize: primaryParticipant.tshirtSize || null,
      emergencyContactNumber: primaryParticipant.emergencyContactNumber || null,
      address: primaryParticipant.address || null,
      city: primaryParticipant.city || null,
      state: primaryParticipant.state || null,
      country: primaryParticipant.country || null,
      pincode: primaryParticipant.pincode || null,
      idProofUrl: primaryParticipant.idProofUrl || null,
      agreedRules: relayTeamRegistration.agreedRules ?? true,
      agreedWaiver: relayTeamRegistration.agreedWaiver ?? true,
      agreedCutoff: relayTeamRegistration.agreedCutoff ?? true,
      consentPromotions: relayTeamRegistration.consentPromotions ?? false,

      // Registration metadata
      registeredAt: new Date().toISOString(),
      createdByUid: relayTeamRegistration.createdByUid,
      createdByName: relayTeamRegistration.createdByName,
      createdByEmail: relayTeamRegistration.createdByEmail,
      clubId: relayTeamRegistration.clubId || null,
      couponCode: relayTeamRegistration.couponCode || null,
      amountPaidPaisa: relayTeamRegistration.amountPaidPaisa || 0,
      basePricePaisa: Number(relayTeamRegistration.pricingBreakdown?.base || tData?.price || 0),
      couponDiscountPaisa: Number(relayTeamRegistration.pricingBreakdown?.discount || 0),
      pricingBreakdown: relayTeamRegistration.pricingBreakdown || null,
      transactionId: relayTeamRegistration.transactionId || null,
      razorpayOrderId: relayTeamRegistration.razorpayOrderId || null,
      paymentMethod: relayTeamRegistration.transactionId ? 'Online' : null,
      zohoSynced: false,

      // Timestamps
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Execute batch write
    await batch.commit();

    // Create Zoho/relay invoice on the first participant record (invoice owner)
    let relayInvoiceNumber: string | null = null;
    const shouldCreateInvoice =
      !!relayTeamRegistration.pricingBreakdown &&
      (Number(relayTeamRegistration.amountPaidPaisa || 0) > 0 || Number(relayTeamRegistration.pricingBreakdown?.totalPayable || 0) === 0);

    if (shouldCreateInvoice) {
      try {
        const relayPricing = relayTeamRegistration.pricingBreakdown;
        if (!relayPricing) {
          throw new Error('Relay pricing breakdown missing for invoice creation');
        }
        const primarySnap = await primaryParticipantRef.get();
        if (primarySnap.exists) {
          const primaryData = primarySnap.data() as any;
          const customerId = await resolveRelayZohoCustomer(primaryData, primaryParticipantRef);
          const currency = String(relayPricing.currency || eData?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR';
          const createdInvoice = await createServiceFeeInvoiceAction({
            customerId,
            reference: bookingId,
            date: format(new Date(), 'yyyy-MM-dd'),
            pricing: relayPricing,
            serviceType: 'Relay Registration',
            eventName: relayTeamRegistration.eventName || eData?.eventName || 'Event',
            userState: primaryData.state || 'Maharashtra',
            currency,
          });

          await markInvoiceAsSent(createdInvoice.invoice_id);

          await primaryParticipantRef.update({
            invoiceId: createdInvoice.invoice_id,
            invoiceNumber: createdInvoice.invoiceNumber || createdInvoice.invoice_id,
            zohoSynced: true,
            zohoSyncError: null,
            updatedAt: new Date().toISOString(),
          });
          relayInvoiceNumber = createdInvoice.invoiceNumber || createdInvoice.invoice_id;

          await adminDb.collection('relayTeamRegistrations').doc(relayTeamId).update({
            invoiceId: createdInvoice.invoice_id,
            invoiceNumber: createdInvoice.invoiceNumber || createdInvoice.invoice_id,
            invoiceParticipantId: primaryParticipantRef.id,
            updatedAt: new Date().toISOString(),
          });

          if (primaryData.email) {
            sendInvoiceEmailBrevoAction({
              invoiceId: createdInvoice.invoice_id,
              invoiceNumber: createdInvoice.invoiceNumber || createdInvoice.invoice_id,
              recipientEmail: String(primaryData.email).toLowerCase(),
              name: primaryData.name || 'Athlete',
              eventName: relayTeamRegistration.eventName || eData?.eventName || '',
              category: relayTeamRegistration.ticketName || tData?.ticketName || 'Relay Registration',
              eventDate: primaryData.eventDate || null,
              amountPaisa: Number(relayPricing.totalPayable || 0),
            }).catch((err) => console.warn('[Relay Invoice] Email failed:', err?.message || err));
          }

          if (primaryData.mobile) {
            sendWhatsAppInvoiceAction(eventId, primaryParticipantRef.id).catch((err) => {
              console.warn('[Relay Invoice] WhatsApp failed:', err?.message || err);
            });
          }
        }
      } catch (invoiceError: any) {
        console.warn('Relay invoice creation failed:', invoiceError?.message || invoiceError);
      }
    }

    try {
      const roleLabelMap: Record<string, string> = { swim: 'Swim', bike: 'Bike', run: 'Run' };
      const relayAthleteSummary = relayTeamRegistration.participants
        .map((participant) => `${roleLabelMap[participant.role] || participant.role}: ${participant.name}`)
        .join(' | ');

      await sendAdminTicketSaleNotificationEmail(
        relayTeamRegistration.teamName || primaryParticipant.name || 'Relay Team',
        relayTeamRegistration.eventName || eData?.eventName || 'Event',
        bookingId,
        new Date(),
        `${relayTeamRegistration.ticketName || tData?.ticketName || 'Relay Registration'} | Team Members: ${relayAthleteSummary}`,
        eData?.venueName || eData?.address || null,
        (tData?.eventDate || eData?.eventDate || null),
        primaryParticipant.address || null,
        primaryParticipant.mobile || null,
        primaryParticipant.emergencyContactNumber || null,
        (primaryParticipant.email || '').toLowerCase() || null,
        relayInvoiceNumber,
        relayTeamRegistration.teamBib || null,
        eData?.organizerName || null,
        eData?.organizerAddress || null,
        eData?.organizerCompanyDescription || null,
        primaryParticipant.country || 'India',
        String(relayTeamRegistration.pricingBreakdown?.currency || eData?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR'
      );
    } catch (adminNotifyError: any) {
      console.warn('[Relay Admin Notification] Failed:', adminNotifyError?.message || adminNotifyError);
    }

    // Ensure users collection is created/updated for each relay participant
    try {
      await upsertRelayParticipantUsers(
        relayTeamRegistration.participants,
        relayTeamRegistration.clubId || null
      );
    } catch (syncError: any) {
      console.warn('Relay participant user upsert failed:', syncError?.message || syncError);
    }

    try {
      const updatedPrimarySnap = await primaryParticipantRef.get();
      if (updatedPrimarySnap.exists) {
        await _mirrorParticipantToKV(serializeParticipantData(updatedPrimarySnap));
      }
    } catch (kvError: any) {
      console.warn('Relay participant KV mirror failed:', kvError?.message || kvError);
    }

    revalidatePath(`/admin/dashboard`);

    return { success: true, message: 'Relay team participants created successfully' };
  } catch (e: any) {
    console.error('createRelayTeamParticipantsAction error:', e);
    return { success: false, message: `Failed to create relay team participants: ${e.message}` };
  }
}
