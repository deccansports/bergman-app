// src/lib/dataLayerOptimized.ts
'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { getCachedServerValue } from '@/lib/serverCache';

const SOURCE = 'dataLayerOptimized';

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

// -------------------------------
// 🏁 GET EVENT PARTICIPANTS (KV FIRST)
// -------------------------------
export async function getEventParticipants(eventId: string): Promise<any[]> {
  return getCachedServerValue(`participants:${eventId}`, 60_000, async () => {
    const key = `event:${eventId}:participants:index`;

    const cached = await getKV<any[]>(key, SOURCE);
    if (cached && Array.isArray(cached)) {
      return cached;
    }

    const db = getFirestoreInstance();
    const snap = await db.collection('events').doc(eventId).collection('participants').get();
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    await putKV(key, data, SOURCE);
    return data;
  });
}

// -------------------------------
// 👤 GET USER PROFILE (KV FIRST)
// -------------------------------
export async function getUserProfile(userId: string): Promise<Record<string, any> | null> {
  return getCachedServerValue(`user-profile:${userId}`, 60_000, async () => {
    const key = `user:${userId}:profile`;

    const cached = await getKV<Record<string, any>>(key, SOURCE);
    if (cached) return cached;

    const db = getFirestoreInstance();
    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return null;

    const data = { uid: snap.id, ...snap.data() };
    await putKV(key, data, SOURCE);
    await putKV(`user:${userId}`, data, SOURCE);
    return data;
  });
}

// -------------------------------
// 🎫 GET TICKETS (KV FIRST)
// -------------------------------
export async function getEventTickets(eventId: string): Promise<any[]> {
  return getCachedServerValue(`tickets:${eventId}`, 60_000, async () => {
    const key = `event:${eventId}:tickets`;

    const cached = await getKV<any[]>(key, SOURCE);
    if (cached && Array.isArray(cached)) return cached;

    const db = getFirestoreInstance();

    // Prefer dedicated ticketDefinitions subcollection if available.
    const subSnap = await db.collection('events').doc(eventId).collection('ticketDefinitions').get();
    let data = subSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Backward compatibility: some events may still keep ticketDefinitions on event doc.
    if (data.length === 0) {
      const eventSnap = await db.collection('events').doc(eventId).get();
      const eventData = eventSnap.data() || {};
      data = safeArray<any>(eventData.ticketDefinitions).map((t) => ({ ...t }));
    }

    await putKV(key, data, SOURCE);
    return data;
  });
}

// -------------------------------
// 📊 GET ANALYTICS (KV ONLY, SAFE FALLBACK)
// -------------------------------
export async function getEventAnalytics(eventId: string): Promise<{ totalRegistrations: number; totalRevenue: number }> {
  const key = `analytics:event:${eventId}`;
  const cached = await getKV<{ totalRegistrations: number; totalRevenue: number }>(key, SOURCE);

  if (cached) return cached;

  return {
    totalRegistrations: 0,
    totalRevenue: 0,
  };
}

// -------------------------------
// 🔄 MANUAL/CRON SYNC
// -------------------------------
export async function syncEventToKV(eventId: string): Promise<{ success: boolean; message: string; participants: number; tickets: number }> {
  try {
    const [participants, tickets] = await Promise.all([
      getEventParticipants(eventId),
      getEventTickets(eventId),
    ]);

    await putKV(`event:${eventId}:participants:index`, participants, SOURCE);
    await putKV(`event:${eventId}:tickets`, tickets, SOURCE);

    return {
      success: true,
      message: 'Sync complete.',
      participants: participants.length,
      tickets: tickets.length,
    };
  } catch (e: any) {
    return {
      success: false,
      message: e?.message || 'Sync failed.',
      participants: 0,
      tickets: 0,
    };
  }
}

// -------------------------------
// 🚀 CREATE PARTICIPANT (DUAL WRITE)
// -------------------------------
export async function createParticipant(eventId: string, participantId: string, data: Record<string, any>): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const ref = db.collection('events').doc(eventId).collection('participants').doc(participantId);

    await ref.set({
      ...data,
      eventId,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: data.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });

    // Update KV index immediately
    const key = `event:${eventId}:participants:index`;
    const existing = safeArray<Record<string, any>>(await getKV<any[]>(key, SOURCE));
    const idx = existing.findIndex((p) => String(p.id || '') === participantId);
    const payload = { id: participantId, ...data, eventId };

    if (idx >= 0) existing[idx] = payload;
    else existing.push(payload);

    await putKV(key, existing, SOURCE);

    return { success: true, message: 'Participant created and KV synced.' };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to create participant.' };
  }
}

// -------------------------------
// 🧪 DEBUG
// -------------------------------
export async function debugKV(eventId: string): Promise<{ participantsInKv: number }> {
  const data = await getKV<any[]>(`event:${eventId}:participants:index`, SOURCE);
  return { participantsInKv: Array.isArray(data) ? data.length : 0 };
}
