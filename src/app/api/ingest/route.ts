// src/app/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

function iso(ts: string) { return new Date(ts).toISOString(); }
function idempotencyKey(eid: string, split: string, bib: string, ts: string) {
  return `${eid}_${split}_${bib}_${iso(ts)}`;
}

const INGEST_SECRET = process.env.INGEST_SECRET || "SUPER_SECRET_STATIC_KEY_FOR_DEMO";

async function verifyAuth(req: NextRequest) {
    const hdr = req.headers.get("Authorization") || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!INGEST_SECRET || token !== INGEST_SECRET) {
        throw new Error("Bad token");
    }
}

export async function POST(request: NextRequest) {
  const actionName = '[API /ingest]';
  try {
    if (request.method !== "POST") {
        return new NextResponse("Only POST method is allowed", { status: 405 });
    }
    
    await verifyAuth(request);

    const payload = await request.json();
    const required = ["eventId", "splitCode", "lastUpdateTime", "bibNumber"];
    for (const k of required) {
        if (!payload[k]) return NextResponse.json({ error: `Missing required field: ${k}` }, { status: 400 });
    }

    const adminDb = getFirestoreInstance();
    const eventId = String(payload.eventId);
    const bibNumber = String(payload.bibNumber);
    const splitCode = String(payload.splitCode);
    const timestamp = iso(payload.lastUpdateTime);
    
    const ingestId = idempotencyKey(eventId, splitCode, bibNumber, timestamp);

    const rawRef = adminDb.doc(`/rawReads/${eventId}/reads/${ingestId}`);
    const doc = await rawRef.get();

    if (doc.exists) {
        return NextResponse.json({ status: "ok", message: "Duplicate read, already processed.", ingestId });
    }

    // Save the raw data with all fields it came with
    await rawRef.create({
      ...payload,
      receivedAt: FieldValue.serverTimestamp(),
      processingStatus: 'pending',
    });
    
    return NextResponse.json({ status: "ok", message: "Read ingested and queued for processing.", ingestId });

  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    if (e.message === 'Bad token') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: e.message || "ingest error" }, { status: 500 });
  }
}
