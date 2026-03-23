// src/app/api/volunteer-checkin/verify-otp/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyOtp } from '@/lib/auth/otpService';
import { sendWaiverCheckedInEmail } from '@/lib/auth/brevoService';
import { sendWaiverCheckInConfirmationWhatsApp } from '@/lib/auth/aisensyService';
import type { EventParticipant } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { updateInventoryStockAction } from '@/lib/actions/inventoryActions';

const VerifyWaiverOtpSchema = z.object({
  eventId: z.string().min(1),
  participantId: z.string().min(1),
  otp: z.string().length(6),
  volunteerId: z.string().min(1),
  volunteerName: z.string().min(1),
  clientTimestamp: z.string().datetime().optional(), // ISO 8601 string from client
  checkInCounter: z.string().min(1),
  remarks: z.string().optional().nullable(),
  handedOverTo: z.object({
      name: z.string(),
      mobile: z.string(),
  }).optional().nullable(),
});

export async function POST(request: Request) {
  const actionName = '[API /volunteer-checkin/verify-otp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    const body = await request.json();
    const validation = VerifyWaiverOtpSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ success: false, message: 'Invalid input.', errors: validation.error.flatten() }, { status: 400 });
    }

    const { eventId, participantId, otp, volunteerId, volunteerName, clientTimestamp, checkInCounter, remarks, handedOverTo } = validation.data;
    
    const participantSnap = await adminDb.collection('events').doc(eventId).collection('participants').doc(participantId).get();
    if (!participantSnap.exists) {
      return NextResponse.json({ success: false, message: 'Participant not found.' }, { status: 404 });
    }
    const participant = participantSnap.data() as EventParticipant;

    if (!participant.email) {
      return NextResponse.json({ success: false, message: "Participant doesn't have an email for OTP verification." }, { status: 400 });
    }
    
    const otpVerifyResult = await verifyOtp(participant.email, otp);
    if (!otpVerifyResult.success) {
      return NextResponse.json({ success: false, message: otpVerifyResult.message }, { status: 400 });
    }
    
    // OTP is correct, update participant doc
    await participantSnap.ref.update({
      checkInStatus: 'CheckedIn',
      checkedInAt: clientTimestamp || FieldValue.serverTimestamp(),
      checkedInByVolunteerId: volunteerId,
      checkedInByVolunteerName: volunteerName,
      checkInCounter: checkInCounter,
      checkInDetails: {
          remarks: remarks || null,
          handedOverTo: handedOverTo || null,
      }
    });
    
    // Automatically deduct T-shirt and Bag from inventory
    if (participant.tshirtSize && participant.gender) {
        await updateInventoryStockAction(eventId, 'T-Shirt', participant.tshirtSize, -1, 'issued', 'increment', participant.gender as 'Male' | 'Female' | 'Other');
    }
    await updateInventoryStockAction(eventId, 'Bag', 'EventBag', -1, 'issued', 'increment');
    
    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    const eventName = eventSnap.data()?.eventName || 'the event';
    const eventDate = eventSnap.data()?.eventDate || 'TBD';

    // Pass all required params to the email function
    await sendWaiverCheckedInEmail(
        participant.email,
        participant.name,
        eventName,
        participant.ticketName || 'N/A',
        eventDate,
        participant.address,
        participant.mobile,
        participant.emergencyContactNumber
    );
    if (participant.mobile) {
      await sendWaiverCheckInConfirmationWhatsApp(participant.mobile, participant.name, eventName, participant.ticketName || 'N/A');
    }
    
    revalidatePath(`/admin/dashboard`);
    revalidatePath(`/volunteer/dashboard`);
    return NextResponse.json({ success: true, message: `Participant ${participant.name} checked in successfully.` });
    
  } catch (error: any) {
    console.error(`${actionName} Error: ${error.message}`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
