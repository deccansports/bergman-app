// src/app/api/admin/retry-registration/route.ts
import { NextResponse } from "next/server";
import { FieldValue } from 'firebase-admin/firestore';
import { finalizeRegistration } from "@/lib/registrationEngine/finalizeRegistration";
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { success: false, message: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    // Admin check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Missing token.' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const adminAuth = getAuthInstance();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const adminDb = getFirestoreInstance();
    const adminUserDoc = await adminDb.collection('users').doc(decodedToken.uid).get();
    if (!adminUserDoc.exists || !adminUserDoc.data()?.isAdmin) {
      return NextResponse.json({ success: false, message: 'Unauthorized: Not an admin.' }, { status: 403 });
    }

    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json({ success: false, message: "Order ID required" }, { status: 400 });
    }

    const attemptRef = adminDb.collection('registrationAttempts').doc(orderId);
    const attemptSnap = await attemptRef.get();
    if (!attemptSnap.exists) {
      return NextResponse.json({ success: false, message: 'Registration attempt not found.' }, { status: 404 });
    }

    const attempt = attemptSnap.data() as any;
    const amountPaidPaisa = Number(attempt?.amountPaidPaisa || 0);
    const hasCapturedPaymentRef = !!String(attempt?.transactionId || '').trim();
    const currentStatus = String(attempt?.status || '').trim();
    const isPaymentCapturedStatus = currentStatus === 'PaymentCaptured' || currentStatus === 'Completed';

    // Safety: for paid attempts, do not allow manual finalization retry without captured payment evidence.
    if (amountPaidPaisa > 0 && !hasCapturedPaymentRef && !isPaymentCapturedStatus) {
      return NextResponse.json(
        {
          success: false,
          message: 'Retry blocked: paid attempt has no captured payment reference. Use payment verification first.',
        },
        { status: 400 }
      );
    }

    // If admin is retrying a previously failed attempt that already has a payment ID,
    // restore the attempt to PaymentCaptured before calling finalization. This lets the
    // normal duplicate/manual participant cross-check inside finalizeRegistration run.
    if (hasCapturedPaymentRef && currentStatus !== 'Completed') {
      await attemptRef.set({
        status: 'PaymentCaptured',
        specificPaymentMethod: String(attempt?.specificPaymentMethod || '').trim() || 'Online',
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        adminRetryPreparedAt: FieldValue.serverTimestamp(),
        adminRetryPreparedBy: decodedToken.uid,
      }, { merge: true });
    }

    const result = await finalizeRegistration(orderId, 'admin.retry-registration');

    return NextResponse.json(result);
  } catch (error: any) {
    let message = 'An unexpected server error occurred.';
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
      message = 'Authentication error. Please log in again.';
      return NextResponse.json({ success: false, message }, { status: 401 });
    }
     if (error.message) {
        message = error.message;
     }
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
