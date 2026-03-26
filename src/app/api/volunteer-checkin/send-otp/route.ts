// src/app/api/volunteer-checkin/send-otp/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { storeOtp } from '@/lib/auth/otpService';
import { sendWaiverOtpEmail } from '@/lib/auth/brevoService'; 
import { sendVolunteerCheckinOtpWhatsApp } from '@/lib/auth/aisensyService'; 
import type { EventParticipant, EventCalendarEntry } from '@/lib/types';

const SendWaiverOtpSchema = z.object({
  eventId: z.string().min(1),
  participantId: z.string().min(1),
});

export async function POST(request: Request) {
  const actionName = '[API /volunteer-checkin/send-otp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
    const body = await request.json();
    const validation = SendWaiverOtpSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ success: false, message: 'Invalid input.', errors: validation.error.flatten() }, { status: 400 });
    }
    const { eventId, participantId } = validation.data;
    
    const participantSnap = await adminDb.collection('events').doc(eventId).collection('participants').doc(participantId).get();
    const eventSnap = await adminDb.collection('events').doc(eventId).get();

    if (!participantSnap.exists || !eventSnap.exists) {
      return NextResponse.json({ success: false, message: 'Participant or Event not found.' }, { status: 404 });
    }
    
    const participant = participantSnap.data() as EventParticipant;
    const event = eventSnap.data() as EventCalendarEntry;

    if (!participant.email) {
      return NextResponse.json({ success: false, message: 'Participant does not have an email address.' }, { status: 400 });
    }
    
    const otpStoreResult = await storeOtp(participant.email);
    if (!otpStoreResult.success || !otpStoreResult.plainOtp) {
      return NextResponse.json({ success: false, message: otpStoreResult.message }, { status: 500 });
    }
    
    // Using specific function for waiver/check-in OTP
    const emailSent = await sendWaiverOtpEmail(participant.email, otpStoreResult.plainOtp, participant.name);
    
    let whatsappSent = false;
    if (participant.mobile) {
      const whatsappResult = await sendVolunteerCheckinOtpWhatsApp(
        participant.mobile,
        otpStoreResult.plainOtp,
        participant.name
      );
      whatsappSent = whatsappResult.success;
    }
    
    if (emailSent || whatsappSent) {
      return NextResponse.json({ success: true, message: 'OTP sent to participant.' });
    } else {
      return NextResponse.json({ success: false, message: 'Failed to send OTP via all channels. Check Brevo/AiSensy config.' }, { status: 500 });
    }
    
  } catch (error: any) {
    console.error(`${actionName} Error: ${error.message}`, error);
    return NextResponse.json({ success: false, message: `Server error: ${error.message}` }, { status: 500 });
  }
}
