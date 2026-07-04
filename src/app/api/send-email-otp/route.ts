
// src/app/api/send-email-otp/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { storeOtp } from '@/lib/auth/otpService';
import { sendOtpEmailViaBrevo } from '@/lib/auth/brevoService';
import { sendOtpViaWhatsApp } from '@/lib/auth/aisensyService';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { User } from '@/lib/types';

const SendOtpInputSchema = z.object({
  email: z.string().email('Invalid email address.'),
  name: z.string().optional(),
});

const maskMobile = (mobile?: string | null): string | null => {
  if (!mobile) return null;
  const cleaned = mobile.replace(/\s+/g, '');
  if (!cleaned) return null;

  const last4 = cleaned.slice(-4);
  const prefixLength = Math.max(0, cleaned.length - 4);
  const prefixMasked = cleaned.slice(0, prefixLength).replace(/\d/g, '•');
  return `${prefixMasked}${last4}`;
};

/**
 * API Route: Send OTP
 * 
 * Flow:
 * 1. Generate and store a hashed OTP in 'otp_attempts'.
 * 2. Send plain OTP via Email (Brevo).
 * 3. If user exists and has a mobile number, also send via WhatsApp (AiSensy).
 */
export async function POST(request: Request) {
  const actionName = '[API /send-email-otp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
  } catch (e: any) {
    console.error(`${actionName} DB init error:`, e.message);
    return NextResponse.json({ success: false, message: "Server configuration error." }, { status: 500 });
  }

  try {
    const body = await request.json();
    const validation = SendOtpInputSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ success: false, message: "Invalid input." }, { status: 400 });
    }

    const { email, name: nameFromClient } = validation.data;
    const lowerEmail = email.toLowerCase();

    // Check if user exists to personalize and potentially send WhatsApp
    const userQuery = await adminDb.collection('users').where('email', '==', lowerEmail).limit(1).get();
    const userProfile = userQuery.empty ? null : userQuery.docs[0].data() as User;
    const maskedMobile = maskMobile(userProfile?.mobile);
    
    const storeResult = await storeOtp(lowerEmail);
    if (!storeResult.success || !storeResult.plainOtp) {
      return NextResponse.json({ success: false, message: "Failed to generate OTP." }, { status: 500 });
    }
    
    const plainOtp = storeResult.plainOtp;
    const effectiveName = userProfile?.name || nameFromClient || "Athlete";

    // 1. Send Email OTP (Primary)
    const emailSent = await sendOtpEmailViaBrevo(lowerEmail, plainOtp, effectiveName);
    
    // 2. Send WhatsApp OTP (Secondary, only for existing users with mobile)
    let whatsappSent = false;
    if (userProfile?.mobile && userProfile.mobile.trim() !== "") {
      try {
        const whatsappResult = await sendOtpViaWhatsApp(userProfile.mobile, plainOtp, effectiveName);
        whatsappSent = whatsappResult.success;
      } catch (wsError: any) {
        console.warn(`${actionName} WhatsApp trigger exception:`, wsError.message);
      }
    }

    if (emailSent || whatsappSent) {
      return NextResponse.json({
        success: true,
        message: "OTP sent successfully.",
        maskedMobile,
        whatsappSent,
      });
    } else {
      return NextResponse.json({ success: false, message: "Failed to deliver OTP. Service unavailable." }, { status: 500 });
    }

  } catch (error: any) {
    console.error(`${actionName} Unhandled error:`, error.message);
    return NextResponse.json({ success: false, message: "An unexpected error occurred." }, { status: 500 });
  }
}
