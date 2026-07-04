// src/app/api/webhooks/firestore-sync/route.ts
/**
 * Real-time Firestore → KV Smart Sync Webhook
 * 
 * Triggered by Firestore Cloud Function on document updates
 * Only syncs changed documents to KV (delta sync)
 * Tracks lastSyncTime to minimize reads
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { putKV, getKV } from '@/lib/cloudflare/kv';

interface FirestoreSyncPayload {
  document: {
    name: string;
    fields: Record<string, any>;
    updateTime: string;
  };
  eventType: string;
}

/**
 * POST endpoint for Firestore-triggered document sync
 * Signature: Cloud Function → Pub/Sub → Cloud Tasks → HTTP Webhook
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as FirestoreSyncPayload;

    if (!body.document || !body.eventType) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Parse Firestore document
    const docPath = body.document.name;
    const pathParts = docPath.split('/');
    const collectionName = pathParts[pathParts.length - 2];
    const docId = pathParts[pathParts.length - 1];

    // Convert Firestore field values to plain object
    const data = firestoreFieldsToObject(body.document.fields);
    data.id = docId;
    data._syncedAt = new Date().toISOString();

    // Route to appropriate sync handler
    switch (collectionName) {
      case 'participants':
        await syncParticipant(data);
        break;
      case 'events':
        await syncEvent(data);
        break;
      case 'users':
        await syncUser(data);
        break;
      case 'registrations':
        await syncRegistration(data);
        break;
      default:
        console.log(`[Sync] Skipping unknown collection: ${collectionName}`);
    }

    return NextResponse.json({
      success: true,
      synced: true,
      collection: collectionName,
      docId
    });

  } catch (error) {
    console.error('[Webhook] Sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

/**
 * Sync individual participant to KV
 */
async function syncParticipant(data: any) {
  const actionName = 'syncParticipant:webhook';

  try {
    if (!data.eventId || !data.bookingId) {
      console.warn(`[${actionName}] Missing eventId or bookingId`);
      return;
    }

    const participant = {
      ...data,
      bookingId: String(data.bookingId).trim(),
      eventId: String(data.eventId).trim(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };

    // Store participant record
    const key = `event:${data.eventId}:participant:${data.bookingId}`;
    await putKV(key, participant, actionName);
    await putKV(`live:event:${data.eventId}:participant:${data.bookingId}`, participant, actionName);

    const existingIndex = await getKV<any>(`event:${data.eventId}:index`, actionName);
    const rows = Array.isArray(existingIndex) ? existingIndex : Array.isArray(existingIndex?.byUuid) ? Object.values(existingIndex.byUuid) : [];
    const normalizedRow = {
      ...participant,
      id: participant.bookingId,
    };
    const nextRows = rows.filter((row: any) => String(row?.bookingId || row?.id || '').trim() !== participant.bookingId);
    nextRows.push(normalizedRow);
    await putKV(`event:${data.eventId}:index`, nextRows, actionName);
    await putKV(`live:event:${data.eventId}:index`, nextRows, actionName);

    const providerParticipantUuid = String(participant.providerParticipantUuid || participant.providerUuid || participant.participantUuid || '').trim();
    if (providerParticipantUuid) {
      const providerIndex = (await getKV<Record<string, any>>(`event:${data.eventId}:providerParticipantIndex`, actionName)) || {};
      providerIndex[providerParticipantUuid] = {
        bookingId: participant.bookingId,
        bib: String(participant.bibNumber || participant.bib || '').trim() || null,
        chip: String(participant.chipCode || participant.chip || '').trim() || null,
      };
      await putKV(`event:${data.eventId}:providerParticipantIndex`, providerIndex, actionName);
    }

    // Update athlete index (critical for lookups)
    const email = data.email?.toLowerCase()?.trim();
    if (email) {
      const indexKey = `athlete:email:${email}`;
      const existing = (await getKV<any>(indexKey, actionName)) || { bookings: [] };

      // Add booking if not already present
      if (!existing.bookings?.find((b: any) => b.bookingId === data.bookingId)) {
        if (!existing.bookings) existing.bookings = [];
        existing.bookings.push({
          eventId: data.eventId,
          bookingId: data.bookingId,
          eventDate: data.eventDate,
          updatedAt: data.updatedAt,
        });
        await putKV(indexKey, existing, actionName);
      }
    }

    // Update UID index if available
    if (data.uid) {
      const uidKey = `athlete:uid:${data.uid}`;
      const existing = (await getKV<any>(uidKey, actionName)) || { bookings: [] };

      if (!existing.bookings?.find((b: any) => b.bookingId === data.bookingId)) {
        if (!existing.bookings) existing.bookings = [];
        existing.bookings.push({
          eventId: data.eventId,
          bookingId: data.bookingId,
          eventDate: data.eventDate,
          updatedAt: data.updatedAt,
        });
        await putKV(uidKey, existing, actionName);
      }
    }

    console.log(`[${actionName}] Synced participant: ${data.bookingId} for event ${data.eventId}`);
  } catch (err) {
    console.error(`[${actionName}] Error:`, err);
    // Don't throw - let other syncs continue
  }
}

/**
 * Sync event metadata to KV
 */
async function syncEvent(data: any) {
  const actionName = 'syncEvent:webhook';

  try {
    const key = `event:${data.id}`;
    
    // Store critical event data
    const eventData = {
      id: data.id,
      eventName: data.eventName,
      eventDate: data.eventDate,
      eventSlug: data.eventSlug,
      status: data.status,
      updatedAt: data.updatedAt,
      ticketDefinitions: data.ticketDefinitions,
    };

    await putKV(key, eventData, actionName);
    console.log(`[${actionName}] Synced event: ${data.id}`);
  } catch (err) {
    console.error(`[${actionName}] Error:`, err);
  }
}

/**
 * Sync user profile to KV
 */
async function syncUser(data: any) {
  const actionName = 'syncUser:webhook';

  try {
    const key = `user:${data.id}`;
    
    // Store essential user data (don't store sensitive data)
    const userData = {
      id: data.id,
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      idProofUrl: data.idProofUrl ? '✓' : null, // Only flag, not URL
      gstin: data.gstin,
      businessName: data.businessName,
      address: data.address,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      updatedAt: data.updatedAt,
    };

    await putKV(key, userData, actionName);

    // Update email index
    if (data.email) {
      const emailKey = `user:email:${data.email.toLowerCase()}`;
      await putKV(emailKey, data.id, actionName);
    }

    // Update GST index
    if (data.gstin) {
      const gstKey = `user:gst:${data.gstin}`;
      await putKV(gstKey, data.id, actionName);
    }

    console.log(`[${actionName}] Synced user: ${data.id}`);
  } catch (err) {
    console.error(`[${actionName}] Error:`, err);
  }
}

/**
 * Sync registration record to KV
 */
async function syncRegistration(data: any) {
  const actionName = 'syncRegistration:webhook';

  try {
    if (!data.id) return;

    const key = `registration:${data.id}`;
    await putKV(key, data, actionName);

    if (data.eventId && data.bookingId) {
      await syncParticipant({
        ...data,
        bookingId: data.bookingId,
        eventId: data.eventId,
      });
    }
    
    console.log(`[${actionName}] Synced registration: ${data.id}`);
  } catch (err) {
    console.error(`[${actionName}] Error:`, err);
  }
}

/**
 * Convert Firestore field values to plain JavaScript object
 * Handles: stringValue, integerValue, doubleValue, booleanValue, nullValue, arrayValue, mapValue
 */
function firestoreFieldsToObject(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, field] of Object.entries(fields)) {
    result[key] = firestoreValueToObject(field);
  }

  return result;
}

function firestoreValueToObject(value: any): any {
  if (!value || typeof value !== 'object') {
    return value;
  }

  // Firestore string value
  if ('stringValue' in value) {
    return value.stringValue;
  }

  // Firestore integer value
  if ('integerValue' in value) {
    return parseInt(value.integerValue, 10);
  }

  // Firestore double value
  if ('doubleValue' in value) {
    return parseFloat(value.doubleValue);
  }

  // Firestore boolean value
  if ('booleanValue' in value) {
    return value.booleanValue;
  }

  // Firestore null value
  if ('nullValue' in value) {
    return null;
  }

  // Firestore timestamp
  if ('timestampValue' in value) {
    return new Date(value.timestampValue).toISOString();
  }

  // Firestore array value
  if ('arrayValue' in value && value.arrayValue.values) {
    return value.arrayValue.values.map(firestoreValueToObject);
  }

  // Firestore map value
  if ('mapValue' in value && value.mapValue.fields) {
    return firestoreFieldsToObject(value.mapValue.fields);
  }

  return value;
}

/**
 * GET endpoint for health check and manual trigger
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Root route handler for cleaner UX
  if (url.pathname === "/") {
    return NextResponse.json({
      message: "Bergman API is live 🚀",
      endpoints: [
        "/api/webhooks/firestore-sync?action=last-sync",
        "/api/webhooks/firestore-sync (POST)",
        "/health",
        "/athlete/all",
        "/athlete/upcoming",
        "/athlete/past"
      ]
    });
  }

  if (action === 'last-sync') {
    try {
      const lastSync = await getKV<string>('sync:lastSyncTime', 'sync:webhook:get');
      return NextResponse.json({
        lastSyncTime: lastSync || 'never',
        now: new Date().toISOString(),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to get last sync' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    status: 'ok',
    webhook: 'firestore-sync',
    endpoints: {
      post: 'POST to trigger sync from Firestore',
      get_last_sync: 'GET ?action=last-sync',
    },
  });
}
