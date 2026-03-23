// src/app/api/volunteer-checkin/verify-bike-checkout-otp/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyOtp } from '@/lib/auth/otpService';
import { sendBikeCheckOutConfirmationWhatsApp } from '@/lib/auth/aisensyService';
import type { EventParticipant } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { format as formatDateFns } from 'date-fns';

const VerifyBikeCheckoutOtpSchema = z.object({
  eventId: z.string().min(1),
  participantId: z.string().min(1),
  otp: z.string().length(6),
  volunteerId: z.string().min(1),
  volunteerName: z.string().min(1),
  clientTimestamp: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const actionName = '[API /verify-bike-checkout-otp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    const body = await request.json();
    const validation = VerifyBikeCheckoutOtpSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ success: false, message: 'Invalid input.', errors: validation.error.flatten() }, { status: 400 });
    }

    const { eventId, participantId, otp, volunteerId, volunteerName, clientTimestamp } = validation.data;
    
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
    
    const checkedOutAt = clientTimestamp ? new Date(clientTimestamp) : new Date();

    await participantSnap.ref.update({
      bikeCheckOutStatus: 'CheckedOut',
      bikeCheckedOutAt: FieldValue.serverTimestamp(), // Store server time for consistency
    });

    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    const eventName = eventSnap.data()?.eventName || 'the event';
    
    // Format time in IST for notification
    const istCheckedOutAt = new Date(checkedOutAt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    if (participant.mobile) {
      await sendBikeCheckOutConfirmationWhatsApp(
        participant.mobile, 
        participant.name, 
        formatDateFns(istCheckedOutAt, 'MMM dd, yyyy'),
        formatDateFns(istCheckedOutAt, 'p'),
        eventName
      );
    }
    
    revalidatePath('/volunteer/dashboard');
    return NextResponse.json({ success: true, message: `Bike for ${participant.name} checked out successfully.` });
    
  } catch (error: any) {
    console.error(`[${actionName}] Error: ${error.message}`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
