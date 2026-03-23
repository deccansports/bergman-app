// src/app/api/timing/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getFirestoreInstance } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { validateApiKey } from "@/lib/apiAuth";

// This function normalizes a single read from the FEIBOT payload
const normalizeFeibotRead = (read: any, eventIdFromParent?: string) => {
  const eventId = read.eventId || eventIdFromParent || read.event_id;
  if (!eventId || !read.tag?.bibNumber || !read.timing?.timestamp) {
    return null; // Invalid read, missing essential data
  }
  return {
    eventId: eventId,
    bibNumber: String(read.tag.bibNumber),
    chipId: read.tag.epc || null,
    antennaId: read.reader?.antennaId || null,
    antennaName: read.reader?.location || null,
    timestamp: new Date(read.timing.timestamp),
    source: "FEIBOT_RFID",
    receivedAt: FieldValue.serverTimestamp(),
    valid: true,
    processingStatus: 'pending',
    // Include extra metadata if available
    meta: read.meta || null,
    rawPayload: read, // Store the original payload for debugging
  };
};

export async function POST(req: NextRequest) {
  try {
    const authResult = await validateApiKey(req);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.message }, { status: authResult.status });
    }
    
    const webhookBody = await req.json();
    if (!webhookBody) {
      return NextResponse.json({ ok: true, message: "Webhook received but no data entries to process." });
    }

    const eventIdFromPayload = webhookBody.eventId || webhookBody.event_id;
    const readsToProcess = Array.isArray(webhookBody.batch) ? webhookBody.batch : [webhookBody];

    if (readsToProcess.length === 0) {
      return NextResponse.json({ ok: true, message: "Read batch is empty." });
    }

    const db = getFirestoreInstance();
    const batch = db.batch();
    let processedCount = 0;

    for (const rawRead of readsToProcess) {
      const normalizedRead = normalizeFeibotRead(rawRead, eventIdFromPayload);
      if (normalizedRead) {
        const docId = `${normalizedRead.eventId}_${normalizedRead.bibNumber}_${normalizedRead.timestamp.getTime()}`;
        // CORRECTED PATH: Writing to the new root collection structure
        const rawRef = db.collection("rawReads").doc(normalizedRead.eventId).collection("reads").doc(docId);
        
        // Use set with merge:false to ensure it's a new write
        batch.set(rawRef, normalizedRead, { merge: false });
        processedCount++;
      }
    }
    
    if (processedCount > 0) {
        await batch.commit();
    }

    return NextResponse.json({ ok: true, message: `${processedCount} reads ingested and queued for processing.` });

  } catch (err: any) {
    console.error("Timing webhook error:", err);
    return NextResponse.json({ error: "Internal server error", details: err?.message }, { status: 500 });
  }
}
