import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function pickEvent(payload: any): string {
  return asString(
    payload?.event ||
    payload?.type ||
    payload?.status ||
    payload?.data?.event ||
    payload?.data?.type ||
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  const actionName = '[BergTechno Webhook]';

  try {
    const rawBody = await req.text();
    let payload: any = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = { rawBody };
    }

    const event = pickEvent(payload);
    const messageId = asString(
      payload?.messageId ||
      payload?.message_id ||
      payload?.id ||
      payload?.data?.messageId ||
      payload?.data?.id ||
      req.headers.get('x-webhook-id')
    ) || `evt_${Date.now()}`;

    const recipient = asString(
      payload?.recipient ||
      payload?.to ||
      payload?.email ||
      payload?.data?.to ||
      payload?.data?.email
    ) || 'N/A';

    const db = getFirestoreInstance();
    await db.collection('bergtechnoWebhookLogs').add({
      source: 'bergtecno',
      event,
      status: asString(payload?.status || event) || 'received',
      recipient,
      messageId,
      payload,
      headers: {
        userAgent: req.headers.get('user-agent') || null,
        contentType: req.headers.get('content-type') || null,
        webhookId: req.headers.get('x-webhook-id') || null,
      },
      createdAt: FieldValue.serverTimestamp(),
      receivedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message: 'Webhook accepted.' });
  } catch (error: any) {
    console.error(`${actionName} Failed:`, error?.message || error);
    return NextResponse.json({ success: false, message: error?.message || 'Webhook processing failed.' }, { status: 500 });
  }
}
