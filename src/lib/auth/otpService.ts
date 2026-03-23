// src/lib/auth/otpService.ts
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import crypto from 'crypto';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10; // OTP valid for 10 minutes
const OTP_COLLECTION = 'otp_attempts';

function generateOtp(): string {
  return crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH - 1).toString();
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

export async function storeOtp(
  email: string
): Promise<{ plainOtp?: string; success: boolean; message: string }> {
  const actionName = '[otpService API Route storeOtp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
  } catch (error: any) {
    console.error(`${actionName} Firebase Admin SDK error: ${error.message}`);
    return { success: false, message: `Server error: ${error.message}` };
  }

  const lowerCaseEmail = email.toLowerCase();
  const plainOtp = generateOtp();
  const hashedOtp = hashOtp(plainOtp);
  const expiryDate = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const expiryTimestamp = Timestamp.fromDate(expiryDate); // Use Admin SDK Timestamp

  try {
    const otpDocRef = adminDb.collection(OTP_COLLECTION).doc(lowerCaseEmail);
    await otpDocRef.set({
      otpHash: hashedOtp,
      expiresAt: expiryTimestamp,
      createdAt: FieldValue.serverTimestamp(), // Use Admin SDK FieldValue
      verified: false,
    });
    console.info(`${actionName} OTP hash stored successfully for ${lowerCaseEmail}. Expiry: ${expiryDate.toISOString()}`);
    return { plainOtp, success: true, message: "OTP generated and stored." };
  } catch (error: any) {
    console.error(`${actionName} Error storing OTP for ${lowerCaseEmail}: ${error.message}`, { stack: error.stack });
    return { success: false, message: `Failed to store OTP: ${error.message}` };
  }
}

export async function verifyOtp(
  email: string,
  submittedOtp: string
): Promise<{ success: boolean; message: string }> {
  const actionName = '[otpService API Route verifyOtp]';
  let adminDb;
  try {
    adminDb = getFirestoreInstance();
  } catch (error: any) {
    console.error(`${actionName} Firebase Admin SDK error: ${error.message}`);
    return { success: false, message: `Server error: ${error.message}` };
  }

  const lowerCaseEmail = email.toLowerCase();
  const submittedOtpHash = hashOtp(submittedOtp);

  try {
    const otpDocRef = adminDb.collection(OTP_COLLECTION).doc(lowerCaseEmail);
    const otpDoc = await otpDocRef.get();

    if (!otpDoc.exists) {
      console.warn(`${actionName} OTP entry not found for ${lowerCaseEmail}.`);
      return { success: false, message: 'OTP not found or already used. Please request a new one.' };
    }

    const otpData = otpDoc.data();
    if (!otpData) {
      console.error(`${actionName} OTP data is undefined for existing document: ${lowerCaseEmail}.`);
      return { success: false, message: 'Internal error: Could not retrieve OTP data.' };
    }

    const storedOtpHash = otpData.otpHash;
    const expiresAt = otpData.expiresAt as Timestamp | undefined; // Firestore Admin Timestamp

    if (!expiresAt || expiresAt.toDate() < new Date()) {
      console.warn(`${actionName} OTP expired for ${lowerCaseEmail}. Deleting entry.`);
      await otpDocRef.delete();
      return { success: false, message: 'OTP has expired. Please request a new one.' };
    }

    if (otpData.verified === true) {
      console.warn(`${actionName} OTP for ${lowerCaseEmail} has already been verified and used.`);
      return { success: false, message: 'This OTP has already been used. Please request a new one.' };
    }

    if (!storedOtpHash || storedOtpHash !== submittedOtpHash) {
      console.warn(`${actionName} Incorrect OTP entered for ${lowerCaseEmail}.`);
      return { success: false, message: 'Incorrect OTP entered. Please check and try again.' };
    }

    await otpDocRef.delete();
    console.info(`${actionName} OTP successfully verified and deleted for ${lowerCaseEmail}.`);
    return { success: true, message: 'OTP verified successfully.' };

  } catch (error: any) {
    console.error(`${actionName} Error during OTP verification for ${lowerCaseEmail}: ${error.message}`, { stack: error.stack });
    return { success: false, message: `An error occurred during OTP verification: ${error.message}` };
  }
}
