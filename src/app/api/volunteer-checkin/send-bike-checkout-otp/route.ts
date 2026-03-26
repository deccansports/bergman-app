// src/app/api/volunteer-checkin/send-bike-checkout-otp/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { storeOtp } from '@/lib/auth/otpService';
import { sendBikeCheckoutOtpEmail } from '@/lib/auth/brevoService'; 
import { sendOtpViaWhatsApp } from '@/lib/auth/aisensyService'; 
import type { EventParticipant } from '@/lib/types';

const SendBikeCheckoutOtpSchema = z.object({
  eventId: z.string().min(1),
  participantId: z.string().min(1),
});

export async function POST(request: Request) {
  const actionName = '[API /send-bike-checkout-otp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    const body = await request.json();
    const validation = SendBikeCheckoutOtpSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ success: false, message: 'Invalid input.', errors: validation.error.flatten() }, { status: 400 });
    }
    const { eventId, participantId } = validation.data;
    
    const participantSnap = await adminDb.collection('events').doc(eventId).collection('participants').doc(participantId).get();

    if (!participantSnap.exists) {
      return NextResponse.json({ success: false, message: 'Participant not found.' }, { status: 404 });
    }
    
    const participant = participantSnap.data() as EventParticipant;

    if (participant.checkInStatus !== 'CheckedIn') {
        return NextResponse.json({ success: false, message: 'Participant has not completed waiver check-in.' }, { status: 400 });
    }
    if (participant.bikeCheckInStatus !== 'CheckedIn') {
        return NextResponse.json({ success: false, message: 'Bike has not been checked in yet.' }, { status: 400 });
    }
    if (participant.bikeCheckOutStatus === 'CheckedOut') {
        return NextResponse.json({ success: false, message: 'Bike has already been checked out.' }, { status: 400 });
    }
    if (!participant.email) {
      return NextResponse.json({ success: false, message: 'Participant does not have an email address for OTP.' }, { status: 400 });
    }
    
    const otpStoreResult = await storeOtp(participant.email);
    if (!otpStoreResult.success || !otpStoreResult.plainOtp) {
      return NextResponse.json({ success: false, message: otpStoreResult.message }, { status: 500 });
    }
    
    const emailSent = await sendBikeCheckoutOtpEmail(participant.email, otpStoreResult.plainOtp, participant.name);
    
    let whatsappSent = false;
    if (participant.mobile) {
      const whatsappResult = await sendOtpViaWhatsApp(participant.mobile, otpStoreResult.plainOtp, participant.name);
      whatsappSent = whatsappResult.success;
    }
    
    if (emailSent || whatsappSent) {
      return NextResponse.json({ success: true, message: 'OTP sent to participant for bike check-out.' });
    } else {
      return NextResponse.json({ success: false, message: 'Failed to send OTP via all channels. Check service configurations.' }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error(`[${actionName}] Error: ${error.message}`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
