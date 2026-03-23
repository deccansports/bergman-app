// src/app/api/admin/zoho/payment/route.ts
import { NextResponse } from "next/server";
import { getAuthInstance, getFirestoreInstance } from '@/lib/firebaseAdmin';
import { findPaymentByReference } from "@/lib/zoho/fetch";

export const dynamic = "force-dynamic";

/**
 * API Route: Search Zoho Payments by Reference
 * 
 * Secure endpoint for admins to verify if a payment exists in Zoho Books.
 */
export async function GET(req: Request) {
  try {
    // 🔐 Admin Security Check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = await getAuthInstance().verifyIdToken(token);
    const db = getFirestoreInstance();
    const user = await db.collection('users').doc(decodedToken.uid).get();
    
    if (!user.exists || !user.data()?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const reference = searchParams.get("reference");

    if (!reference) {
      return NextResponse.json({ error: "Missing reference parameter" }, { status: 400 });
    }

    // 🔎 Search Zoho
    const payment = await findPaymentByReference(reference);
    
    if (!payment) {
        return NextResponse.json({ message: "No payment found in Zoho for this reference.", success: true, payment: null });
    }

    return NextResponse.json({ success: true, ...payment });
  } catch (error: any) {
    console.error("[API Zoho Payment Search] Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
