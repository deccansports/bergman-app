// src/app/api/admin/retry-registration/route.ts
import { NextResponse } from "next/server";
import { finalizeRegistration } from "@/lib/registrationEngine/finalizeRegistration";
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';

export async function POST(req: Request) {
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

    const result = await finalizeRegistration(orderId);

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
