// src/app/api/admin/webhook-health/route.ts
import { NextResponse } from "next/server";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import { toIsoStringSafe } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getFirestoreInstance();
    // UNIFIED: Pointing to 'webhookLogs' (camelCase) consistent with both webhooks
    const snap = await db
      .collection("webhookLogs")
      .orderBy("receivedAt", "desc")
      .limit(50)
      .get();

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
    });

    return NextResponse.json(data);
  } catch (e: any) {
     if ((e as any).code === 'FAILED_PRECONDITION') {
        return { error: "A database index is required for this query. Please create one on the 'webhookLogs' collection for 'receivedAt' descending." };
    }
    return NextResponse.json({ error: `Failed to fetch webhook health: ${e.message}` }, { status: 500 });
  }
}
