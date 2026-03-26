
// src/app/api/verify-email-otp/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyOtp } from '@/lib/auth/otpService';
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { User as AppUser } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { sendWelcomeEmail } from '@/lib/auth/brevoService';

const VerifyOtpInputSchema = z.object({
  email: z.string().email('Invalid email address.'),
  otp: z.string().length(6, 'OTP must be 6 digits.').regex(/^\d+$/, 'OTP must contain only digits.'),
});

/**
 * API Route: Verify OTP & Sign In
 * 
 * Flow:
 * 1. Validate hashed OTP from 'otp_attempts'.
 * 2. Ensure Firebase Auth user exists (create if new).
 * 3. Return a custom token for client-side signInWithCustomToken.
 * 
 * NOTE: Firestore user document creation is now moved to the signup step 
 * to ensure account is only created after form completion.
 */
export async function POST(request: Request) {
  const actionName = '[API /verify-email-otp]';
  let adminDb;
  let adminAuth;

  try {
    adminDb = getFirestoreInstance();
    adminAuth = getAuthInstance();
  } catch (sdkError: any) {
    console.error(`${actionName} Firebase Admin SDK error:`, sdkError.message);
    return NextResponse.json({ success: false, message: "Server configuration error." }, { status: 500 });
  }

  try {
    const body = await request.json();
    const validation = VerifyOtpInputSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ success: false, message: "Invalid input." }, { status: 400 });
    }

    const { email, otp } = validation.data;
    const lowerCaseEmail = email.toLowerCase();

    // 1. Verify OTP
    const verificationResult = await verifyOtp(lowerCaseEmail, otp);
    if (!verificationResult.success) {
      return NextResponse.json({ success: false, message: verificationResult.message }, { status: 400 });
    }

    // 2. Resolve Auth User
    const userQuery = await adminDb.collection('users').where('email', '==', lowerCaseEmail).limit(1).get();
    const existingFirestoreData = userQuery.empty ? null : userQuery.docs[0].data();

    let firebaseUserRecord;
    let isNewUser = false;
    
    try {
      firebaseUserRecord = await adminAuth.getUserByEmail(lowerCaseEmail);
      if (!firebaseUserRecord.emailVerified) {
        await adminAuth.updateUser(firebaseUserRecord.uid, { emailVerified: true });
      }
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Create new identity in Auth only
        firebaseUserRecord = await adminAuth.createUser({
          email: lowerCaseEmail,
          emailVerified: true,
          displayName: 'Athlete', 
        });
        isNewUser = true;
      } else {
        throw error;
      }
    }

    // Ensure Firestore doc is also marked as verified if it exists
    if (!userQuery.empty && !existingFirestoreData?.emailVerified) {
        await adminDb.collection('users').doc(userQuery.docs[0].id).update({ 
            emailVerified: true,
            updatedAt: FieldValue.serverTimestamp()
        });
    }

    const customToken = await adminAuth.createCustomToken(firebaseUserRecord.uid);

    return NextResponse.json({
      success: true,
      message: "OTP verified successfully.",
      token: customToken,
      isNewUser: isNewUser || !existingFirestoreData?.mobile, // Mobile check as proxy for complete profile
    });

  } catch (error: any) {
    console.error(`${actionName} Error:`, error.message);
    return NextResponse.json({ success: false, message: "Server error during verification." }, { status: 500 });
  }
}
