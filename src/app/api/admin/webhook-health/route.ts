// src/app/api/admin/webhook-health/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import { toIsoStringSafe } from "@/lib/utils";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    const sourceFilter = (req.nextUrl.searchParams.get('source') || '').trim().toLowerCase();
    const db = getFirestoreInstance();
    // UNIFIED: Pointing to 'webhookLogs' (camelCase) consistent with both webhooks
    let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("webhookLogs");

    if (sourceFilter === 'stripe' || sourceFilter === 'razorpay') {
      query = query.where('source', '==', sourceFilter);
    }

    let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;

    try {
      snap = await query
        .orderBy("receivedAt", "desc")
        .limit(100)
        .get();
    } catch (e: any) {
      const code = String((e as any)?.code || '').toUpperCase();
      const message = String(e?.message || '');
      const isIndexError = code === 'FAILED_PRECONDITION' || message.includes('index');

      if (!isIndexError) {
        throw e;
      }

      // Fallback path for source-filtered query without composite index.
      // Fetch by source only, then sort in memory by receivedAt.
      const fallbackQuery = (sourceFilter === 'stripe' || sourceFilter === 'razorpay')
        ? db.collection('webhookLogs').where('source', '==', sourceFilter).limit(200)
        : db.collection('webhookLogs').limit(200);

      snap = await fallbackQuery.get();
    }

    if (snap.empty) {
      return NextResponse.json([]);
    }

    const data = snap.docs.map(d => {
        const logData = d.data();
        return {
            id: d.id,
            ...logData,
            receivedAt: toIsoStringSafe(logData.receivedAt)
        }
    }).sort((a: any, b: any) => {
      const aTime = a?.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const bTime = b?.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return bTime - aTime;
    }).slice(0, 100);

    return NextResponse.json(data);
  } catch (e: any) {
    if ((e as any).code === 'FAILED_PRECONDITION') {
      return NextResponse.json(
        { error: "A database index is required for this query. Please create one on the 'webhookLogs' collection for 'receivedAt' descending." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: `Failed to fetch webhook health: ${e.message}` }, { status: 500 });
  }
}
