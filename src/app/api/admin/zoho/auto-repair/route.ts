// src/app/api/admin/zoho/auto-repair/route.ts
import { NextResponse } from 'next/server';
import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import { syncPaymentToZohoAction } from '@/lib/actions/invoiceActions';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 🛠 ZOHO AUTO-REPAIR ROUTE
 * Scans for active participants missing invoices and triggers the healable sync logic.
 */
export async function POST(req: Request) {
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    // 1. Admin Security Check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const decodedToken = await getAuthInstance().verifyIdToken(token);
    const db = getFirestoreInstance();
    const adminDoc = await db.collection('users').doc(decodedToken.uid).get();
    
    if (!adminDoc.exists || !adminDoc.data()?.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { limit = 10 } = await req.json().catch(() => ({}));

    // 2. Scan for candidates (Active but not synced)
    const snapshot = await db
      .collectionGroup('participants')
      .where('ticketStatus', '==', 'Active')
      .where('zohoSynced', '==', false)
      .limit(limit)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ success: true, repaired: 0, message: "No broken records found." });
    }

    const results: any[] = [];
    let repairedCount = 0;

    for (const doc of snapshot.docs) {
      const p = doc.data();
      try {
        const res = await syncPaymentToZohoAction(p.eventId, doc.id);
        results.push({
          name: p.name,
          email: p.email,
          status: res.success ? 'fixed' : 'failed',
          detail: res.message
        });
        if (res.success) repairedCount++;
      } catch (err: any) {
        results.push({ name: p.name, status: 'error', error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      repaired: repairedCount,
      results
    });

  } catch (error: any) {
    console.error("[Auto-Repair] Fatal Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
