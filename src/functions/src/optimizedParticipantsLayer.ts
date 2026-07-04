// src/functions/src/optimizedParticipantsLayer.ts
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const MEMORY_CACHE: {
  tickets: Record<string, unknown[]>;
  expiry: Record<string, number>;
} = {
  tickets: {},
  expiry: {},
};

function getCache<T>(key: string): T | null {
  if (MEMORY_CACHE.expiry[key] && MEMORY_CACHE.expiry[key] > Date.now()) {
    return MEMORY_CACHE.tickets[key] as T;
  }
  return null;
}

function setCache<T>(key: string, value: T, ttlMs = 5 * 60 * 1000): void {
  MEMORY_CACHE.tickets[key] = value as unknown[];
  MEMORY_CACHE.expiry[key] = Date.now() + ttlMs;
}

function parseLimit(input: unknown, fallback = 50, max = 200): number {
  const n = Number(input ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

function globalParticipantId(eventId: string, participantId: string): string {
  return `${eventId}_${participantId}`;
}

/**
 * Sync event participant docs into participants_global.
 * Removes collectionGroup dependency for read-heavy flows.
 */
export const syncParticipantGlobal = onDocumentWritten(
  'events/{eventId}/participants/{participantId}',
  async (event) => {
    const eventId = String(event.params.eventId || '');
    const participantId = String(event.params.participantId || '');
    if (!eventId || !participantId) return;

    const globalId = globalParticipantId(eventId, participantId);
    const globalRef = db.collection('participants_global').doc(globalId);

    if (!event.data?.after.exists) {
      await globalRef.delete().catch(() => null);
      return;
    }

    const data = event.data.after.data() || {};
    await globalRef.set(
      {
        eventId,
        participantId,
        email: String(data.email || '').toLowerCase(),
        emailLower: String(data.email || '').toLowerCase(),
        ticketId: String(data.ticketId || ''),
        ticketStatus: String(data.ticketStatus || ''),
        bibNumber: data.bibNumber ? String(data.bibNumber) : null,
        bookingId: data.bookingId ? String(data.bookingId) : null,
        transactionId: data.transactionId ? String(data.transactionId) : null,
        createdAt: data.createdAt || FieldValue.serverTimestamp(),
        updatedAt: data.updatedAt || FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);

/**
 * Optional counter maintenance (no count scans).
 */
export const incrementParticipantCount = onDocumentCreated(
  'participants_global/{id}',
  async (event) => {
    const data = event.data?.data();
    if (!data?.eventId) return;
    await db
      .collection('events')
      .doc(String(data.eventId))
      .set(
        { totalParticipants: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
  }
);

/**
 * Read participants from global collection (indexed + limited).
 */
export const getParticipants = onRequest({ cors: true }, async (req, res) => {
  try {
    const eventId = String(req.query.eventId || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = parseLimit(req.query.limit, 50, 200);

    if (!eventId) {
      res.status(400).send({ success: false, message: 'eventId is required.' });
      return;
    }

    let q: FirebaseFirestore.Query = db
      .collection('participants_global')
      .where('eventId', '==', eventId)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (status) {
      q = db
        .collection('participants_global')
        .where('eventId', '==', eventId)
        .where('ticketStatus', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(limit);
    }

    const snap = await q.get();
    const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.send({ success: true, data });
  } catch (error: any) {
    res.status(500).send({ success: false, message: error.message || 'Failed to fetch participants.' });
  }
});

/**
 * Ticket definitions with lightweight in-memory cache.
 */
export const getTicketDefinitions = onRequest({ cors: true }, async (req, res) => {
  try {
    const eventId = String(req.query.eventId || '').trim();
    if (!eventId) {
      res.status(400).send({ success: false, message: 'eventId is required.' });
      return;
    }

    const cacheKey = `tickets_${eventId}`;
    const cached = getCache<unknown[]>(cacheKey);
    if (cached) {
      res.send({ success: true, source: 'cache', data: cached });
      return;
    }

    const snap = await db.collection('events').doc(eventId).collection('ticketDefinitions').get();
    const tickets = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    setCache(cacheKey, tickets);
    res.send({ success: true, source: 'firestore', data: tickets });
  } catch (error: any) {
    res.status(500).send({ success: false, message: error.message || 'Failed to fetch tickets.' });
  }
});

/**
 * Optimized race result lookup.
 */
export const getRaceResult = onRequest({ cors: true }, async (req, res) => {
  try {
    const year = String(req.query.year || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();

    if (!year || !email) {
      res.status(400).send({ success: false, message: 'year and email are required.' });
      return;
    }

    const snap = await db
      .collection('raceResults')
      .where('raceYear', '==', year)
      .where('emailLower', '==', email)
      .limit(1)
      .get();

    if (snap.empty) {
      res.send({ success: true, found: false });
      return;
    }

    res.send({ success: true, found: true, data: snap.docs[0].data() });
  } catch (error: any) {
    res.status(500).send({ success: false, message: error.message || 'Failed to fetch race result.' });
  }
});

/**
 * Duplicate-safe registration write into participants_global.
 */
export const createRegistration = onRequest({ cors: true }, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const eventId = String(req.body?.eventId || '').trim();
    const ticketId = String(req.body?.ticketId || '').trim();

    if (!email || !eventId) {
      res.status(400).send({ success: false, message: 'email and eventId are required.' });
      return;
    }

    const existing = await db
      .collection('participants_global')
      .where('eventId', '==', eventId)
      .where('emailLower', '==', email)
      .limit(1)
      .get();

    if (!existing.empty) {
      res.send({ success: true, message: 'Already registered', id: existing.docs[0].id });
      return;
    }

    const docRef = await db.collection('participants_global').add({
      eventId,
      email,
      emailLower: email,
      ticketId: ticketId || '',
      ticketStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.send({ success: true, id: docRef.id });
  } catch (error: any) {
    res.status(500).send({ success: false, message: error.message || 'Failed to create registration.' });
  }
});
