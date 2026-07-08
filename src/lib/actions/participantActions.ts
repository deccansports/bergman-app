// src/lib/actions/participantActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { EventParticipant, TicketDefinition, User } from '@/lib/types';
import { serializeParticipantData, calculateAgeGroup, serializeValue } from '@/lib/utils';
import { _mirrorParticipantToKV, _deleteParticipantFromKV, _syncClubUpcomingAthletes } from './dataSyncActions';
import { assignNextAvailableBib } from './bibActions';
import { revalidatePath } from 'next/cache';
import { getKV, putKV } from '../cloudflare/kv';
import {
  sendAthleteCategoryChangeEmail,
  sendAdminCategoryChangeNotificationEmail,
  sendRegistrationConfirmationEmail,
} from '../auth/brevoService';
import {
  sendCategoryChangeNoticeWhatsApp,
  sendRegistrationConfirmationViaWhatsApp,
} from '../auth/aisensyService';
import { GST_PERCENTAGE } from '@/lib/constants';
import { NO_CLUB_SELECTED_VALUE } from '@/lib/constants';
import { getRegistrationsCollectionRef } from '@/lib/eventDataPaths';

function generateAdminBookingId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  for (let i = 0; i < 5; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BMIN${rand}`;
}

async function getParticipantsFromKv(eventId: string): Promise<EventParticipant[] | null> {
  const normalizedEventId = String(eventId || '').trim();
  if (!normalizedEventId) return null;

  const canonicalKey = `event:${normalizedEventId}:participants:index`;
  const legacyKey = `event:${normalizedEventId}:participant:index`;

  const [canonical, legacy] = await Promise.all([
    getKV<EventParticipant[]>(canonicalKey, 'participantActions').catch(() => null),
    getKV<EventParticipant[]>(legacyKey, 'participantActions').catch(() => null),
  ]);

  if (Array.isArray(canonical) && canonical.length > 0) return canonical;
  if (Array.isArray(legacy) && legacy.length > 0) return legacy;
  if (Array.isArray(canonical)) return canonical;
  if (Array.isArray(legacy)) return legacy;
  return null;
}

function getParticipantDedupKey(participant: any, fallbackIndex: number): string {
  const normalize = (value: any) => String(value || '').trim().toLowerCase();
  const registrationId = normalize(participant?.registrationId);
  if (registrationId) return `registration:${registrationId}`;

  const bookingId = normalize(participant?.bookingId);
  if (bookingId) return `booking:${bookingId}`;

  const participantId = normalize(participant?.participantId || participant?.id);
  if (participantId) return `participant:${participantId}`;

  const bibNumber = normalize(participant?.bibNumber);
  if (bibNumber) return `bib:${bibNumber}`;

  return `fallback:${fallbackIndex}`;
}

function dedupeParticipants<T extends Record<string, any>>(participants: T[]): T[] {
  const mergedByKey = new Map<string, T>();

  participants.forEach((participant, index) => {
    const key = getParticipantDedupKey(participant, index);
    const existing = mergedByKey.get(key);
    if (existing) {
      mergedByKey.set(key, {
        ...existing,
        ...participant,
      });
      return;
    }
    mergedByKey.set(key, participant);
  });

  return Array.from(mergedByKey.values());
}

function isTimingOnlyParticipantRecord(participant: any): boolean {
  const bookingId = String(participant?.bookingId || '').trim().toLowerCase();
  const registrationSource = String(participant?.registration?.source || '').trim().toLowerCase();
  const provider = String(participant?.provider || '').trim().toLowerCase();
  const hasTicketSignals = Boolean(
    participant?.ticketId ||
    participant?.ticketName ||
    participant?.ticketStatus ||
    participant?.amountPaidPaisa ||
    participant?.pricingBreakdown
  );

  if (provider === 'feibot' && !hasTicketSignals) return true;
  return false;
}

function collapseRelayParticipantRecords(participants: EventParticipant[]): EventParticipant[] {
  const relayGroups = new Map<string, EventParticipant[]>();
  const standalone: EventParticipant[] = [];
  const roleOrder = { swim: 0, bike: 1, run: 2 } as const;

  for (const participant of participants) {
    const relayKey = participant.isRelay ? (participant.relayTeamId || participant.bookingId || participant.id) : null;
    if (!relayKey) {
      standalone.push(participant);
      continue;
    }

    const existing = relayGroups.get(relayKey) || [];
    existing.push(participant);
    relayGroups.set(relayKey, existing);
  }

  const collapsedRelayTeams = Array.from(relayGroups.values()).map((group) => {
    const preferred =
      group.find((participant) => Array.isArray(participant.relayParticipants) && participant.relayParticipants.length > 0) ||
      group.find((participant) => Number(participant.amountPaidPaisa || 0) > 0 || !!participant.invoiceId) ||
      group[0];

    const nestedParticipants = Array.isArray(preferred.relayParticipants) && preferred.relayParticipants.length > 0
      ? preferred.relayParticipants
      : group
          .filter((participant) => !!(participant.relayRole || participant.relayBib || participant.name))
          .map((participant) => ({
            role: ((participant.relayRole || 'run') as 'swim' | 'bike' | 'run'),
            name: participant.buyerName && participant.name === preferred.relayTeamName
              ? participant.buyerName
              : participant.name,
            email: participant.email || '',
            mobile: participant.mobile || undefined,
            dob: participant.dob || undefined,
            gender: (participant.gender as any) || undefined,
            bloodGroup: participant.bloodGroup || undefined,
            tshirtSize: participant.tshirtSize || undefined,
            emergencyContactNumber: participant.emergencyContactNumber || undefined,
            address: participant.address || undefined,
            city: participant.city || undefined,
            state: participant.state || undefined,
            country: participant.country || undefined,
            pincode: participant.pincode || undefined,
            idProofUrl: participant.idProofUrl || null,
            bib: participant.relayBib || participant.bibNumber || undefined,
            bibNumber: participant.relayBib || participant.bibNumber || undefined,
            athleteUid: participant.athleteUid || null,
          }))
          .sort((a, b) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99));

    return {
      ...preferred,
      name: preferred.relayTeamName || preferred.name,
      email: preferred.buyerEmail || preferred.email,
      mobile: preferred.mobile || null,
      buyerName: preferred.buyerName || nestedParticipants[0]?.name || preferred.name,
      buyerEmail: preferred.buyerEmail || nestedParticipants[0]?.email || preferred.email,
      bibNumber: preferred.relayTeamBib || preferred.bibNumber,
      relayTeamName: preferred.relayTeamName || preferred.name,
      relayTeamBib: preferred.relayTeamBib || preferred.bibNumber,
      relayParticipants: nestedParticipants,
      relayParticipantCount: nestedParticipants.length,
    } as EventParticipant;
  });

  return [...standalone, ...collapsedRelayTeams];
}

export async function resolveCanonicalParticipantRef(
  db: FirebaseFirestore.Firestore,
  eventId: string,
  payload: any,
  preferredDocId?: string | null,
): Promise<FirebaseFirestore.DocumentReference> {
  const participantsRef = getRegistrationsCollectionRef(db, eventId);
  const normalizedEmail = String(payload?.email || payload?.buyerEmail || '').trim().toLowerCase();
  const athleteUid = String(payload?.athleteUid || payload?.userId || '').trim();
  const bookingId = String(payload?.bookingId || '').trim();
  const registrationAttemptId = String(payload?.registrationAttemptId || payload?.registrationId || '').trim();
  const transactionId = String(payload?.transactionId || payload?.paymentId || '').trim();
  const razorpayOrderId = String(payload?.razorpayOrderId || '').trim();

  const normalizeSubCategory = (value: any) => {
    const raw = String(value || '').trim();
    return raw && raw !== 'NONE' ? raw : null;
  };

  const ticketId = String(payload?.ticketId || '').trim();
  const selectedSubCategory = normalizeSubCategory(payload?.selectedSubCategory);

  const matchesTicketScope = (docData: any) => {
    if (!ticketId) return false;
    const docTicketId = String(docData?.ticketId || '').trim();
    const docSubCategory = normalizeSubCategory(docData?.selectedSubCategory);
    return docTicketId === ticketId && docSubCategory === selectedSubCategory;
  };

  const queries: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];
  if (registrationAttemptId) queries.push(participantsRef.where('registrationAttemptId', '==', registrationAttemptId).limit(1).get());
  if (bookingId) queries.push(participantsRef.where('bookingId', '==', bookingId).limit(1).get());
  if (transactionId) {
    queries.push(participantsRef.where('transactionId', '==', transactionId).limit(1).get());
    queries.push(participantsRef.where('paymentId', '==', transactionId).limit(1).get());
  }
  if (razorpayOrderId) queries.push(participantsRef.where('razorpayOrderId', '==', razorpayOrderId).limit(1).get());

  for (const snap of await Promise.all(queries)) {
    if (!snap.empty) return snap.docs[0].ref;
  }

  // Weak identity fallback: only reuse athlete/email records when they match the same
  // ticket + sub-category scope. This prevents accidental overwrite of an existing
  // different registration by the same athlete/email.
  if (ticketId && athleteUid) {
    const byAthlete = await participantsRef.where('athleteUid', '==', athleteUid).limit(20).get();
    const scoped = byAthlete.docs.find((doc) => matchesTicketScope(doc.data()));
    if (scoped) return scoped.ref;
  }

  if (ticketId && normalizedEmail) {
    const byEmail = await participantsRef.where('email', '==', normalizedEmail).limit(20).get();
    const scoped = byEmail.docs.find((doc) => matchesTicketScope(doc.data()));
    if (scoped) return scoped.ref;
  }

  const docId = String(
    preferredDocId
    || registrationAttemptId
    || bookingId
    || transactionId
    || razorpayOrderId
    || athleteUid
    || normalizedEmail
    || payload?.id
    || ''
  ).trim() || participantsRef.doc().id;

  return participantsRef.doc(docId);
}

export async function writeCanonicalParticipant(
  db: FirebaseFirestore.Firestore,
  eventId: string,
  payload: any,
  preferredDocId?: string | null,
) {
  const ref = await resolveCanonicalParticipantRef(db, eventId, payload, preferredDocId);
  await ref.set(payload, { merge: true });

  // Backward-compatibility mirror: keep the legacy registrations collection populated
  // while the canonical source of truth is events/{eventId}/participants.
  const legacyRef = db.collection('events').doc(eventId).collection('registrations').doc(ref.id);
  await legacyRef.set({
    ...payload,
    mirroredFromParticipants: true,
    mirroredAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return ref;
}

function enrichParticipantContestFields(participant: any, fallbackEventId?: string | null) {
  const contestUuid = String(participant?.contestUuid || participant?.contest_uuid || participant?.liveTracking?.contestUuid || '').trim() || null;
  const contestName = String(participant?.contestName || participant?.contest_name || participant?.liveTracking?.contestName || '').trim() || null;
  const providerParticipantUuid = String(participant?.providerParticipantUuid || participant?.participantUuid || participant?.providerUuid || participant?.liveTracking?.participantUuid || '').trim() || null;
  const providerContestUuid = String(participant?.providerContestUuid || participant?.contestUuid || participant?.contest_uuid || '').trim() || null;

  return {
    ...participant,
    eventId: participant?.eventId || fallbackEventId || null,
    contestUuid,
    contestName,
    contestId: participant?.contestId || contestUuid,
    providerParticipantUuid,
    providerContestUuid,
  };
}

async function resolveParticipantRef(eventId: string, participantIdOrBookingId: string) {
  const db = getFirestoreInstance();
  const eventRef = db.collection('events').doc((eventId || '').trim());
  const participantsRef = getRegistrationsCollectionRef(db, eventId);
  const legacyParticipantsRef = eventRef.collection('registrations');
  const rawId = String(participantIdOrBookingId || '').trim();

  if (!rawId) {
    throw new Error('Participant identifier is required.');
  }

  // 1) Try direct document id first.
  const byDocIdRef = participantsRef.doc(rawId);
  const byDocIdSnap = await byDocIdRef.get();
  if (byDocIdSnap.exists) {
    return { ref: byDocIdRef, snap: byDocIdSnap };
  }

  // 2) Fallback to bookingId for legacy / KV-derived rows that may not carry Firestore doc id.
  const byBookingId = await participantsRef.where('bookingId', '==', rawId).limit(1).get();
  if (!byBookingId.empty) {
    return { ref: byBookingId.docs[0].ref, snap: byBookingId.docs[0] };
  }

  const legacyByDocIdSnap = await legacyParticipantsRef.doc(rawId).get();
  if (legacyByDocIdSnap.exists) {
    return { ref: legacyByDocIdSnap.ref, snap: legacyByDocIdSnap };
  }

  const legacyByBookingId = await legacyParticipantsRef.where('bookingId', '==', rawId).limit(1).get();
  if (!legacyByBookingId.empty) {
    return { ref: legacyByBookingId.docs[0].ref, snap: legacyByBookingId.docs[0] };
  }

  throw new Error('Participant not found.');
}

export async function getParticipantsForEventAction(eventId: string): Promise<{ success: boolean; message: string; participants?: EventParticipant[] }> {
  try {
    const cachedParticipants = await getParticipantsFromKv(eventId);
    if (cachedParticipants) {
      const normalized = cachedParticipants.map((p: any) => ({
        ...enrichParticipantContestFields(p, eventId),
        id: p?.id || p?.bookingId || null,
      }));
      return { success: true, message: 'Participants fetched from cache.', participants: serializeValue(normalized) };
    }

    const adminDb = getFirestoreInstance();
    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    const eventCurrency = String(eventSnap.data()?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR';
    const participantsSnap = await getRegistrationsCollectionRef(adminDb, eventId).get();
    const participants = participantsSnap.docs.map(doc => {
      const participant = serializeParticipantData(doc) as EventParticipant;
      return {
        ...enrichParticipantContestFields(participant, eventId),
        id: (participant as any)?.id || doc.id,
        currency: String((participant as any)?.currency || participant.pricingBreakdown?.currency || eventCurrency).toUpperCase() === 'USD' ? 'USD' : 'INR',
      };
    });
    await putKV(`event:${eventId}:participants:index`, participants, 'getParticipantsForEventAction');
    return { success: true, message: 'Participants fetched.', participants };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getParticipantForEventByEmailAction(
  eventId: string,
  email: string
): Promise<{ success: boolean; message: string; participant?: EventParticipant | null }> {
  try {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!eventId || !normalizedEmail) {
      return { success: false, message: 'Event ID and email are required.', participant: null };
    }

    const cachedParticipants = await getParticipantsFromKv(eventId);
    if (cachedParticipants) {
      const fromCache = cachedParticipants.find((p: any) => String(p?.email || '').trim().toLowerCase() === normalizedEmail) || null;
      if (!fromCache) {
        return { success: false, message: 'Participant not found.', participant: null };
      }

      const normalized = {
        ...enrichParticipantContestFields(fromCache, eventId),
        id: (fromCache as any)?.id || (fromCache as any)?.bookingId || null,
      } as EventParticipant;

      return { success: true, message: 'Participant fetched from cache.', participant: serializeValue(normalized) };
    }

    const adminDb = getFirestoreInstance();
    const participantSnap = await adminDb
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (participantSnap.empty) {
      return { success: false, message: 'Participant not found.', participant: null };
    }

    const doc = participantSnap.docs[0];
    const participant = serializeParticipantData(doc) as EventParticipant;
    return {
      success: true,
      message: 'Participant fetched.',
      participant: {
        ...enrichParticipantContestFields(participant, eventId),
        id: (participant as any)?.id || doc.id,
      },
    };
  } catch (e: any) {
    return { success: false, message: e.message, participant: null };
  }
}

export async function createEventTicketOrderAction(data: any): Promise<{ success: boolean; message: string; orderId?: string }> {
  try {
    const adminDb = getFirestoreInstance();

    if (!data?.eventId || !data?.ticketId) {
      return { success: false, message: 'Event ID and Ticket ID are required.' };
    }

    const ticketSnap = await adminDb
      .collection('events')
      .doc(data.eventId)
      .collection('ticketDefinitions')
      .doc(data.ticketId)
      .get();

    if (!ticketSnap.exists) {
      return { success: false, message: 'Ticket definition not found.' };
    }

    const ticketData = ticketSnap.data() as TicketDefinition;
    const ticketRegistrationType =
      ticketData.registrationType ||
      (/\brelay\b/i.test(ticketData.ticketName || '') || /\brelay\b/i.test(ticketData.description || '')
        ? 'relay'
        : 'individual');

    if (ticketRegistrationType === 'relay') {
      return {
        success: false,
        message: 'Relay ticket selected. Please complete registration using the dedicated relay form.',
      };
    }

    const orderRef = adminDb.collection('registrationAttempts').doc();
    
    const participantPayload: any = {
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      ticketId: data.ticketId,
      eventId: data.eventId,
      eventName: data.eventName,
      ticketName: data.ticketName,
      bookingId: orderRef.id,
      ticketStatus: 'Pending',
      amountPaidPaisa: data.amountPaidPaisa,
      registeredAt: new Date().toISOString(),
      clubId: data.clubId || null,
      athleteUid: data.userId || data.athleteUid || null,
      age: data.age || null,
      ageCategory: data.ageCategory || null,
      bibNumber: data.bibNumber || null,
      gender: data.gender,
      dob: data.dob,
      bloodGroup: data.bloodGroup,
      tshirtSize: data.tshirtSize,
      emergencyContactNumber: data.emergencyContactNumber,
      address: data.address,
      city: data.city,
      state: data.state,
      country: data.country,
      pincode: data.pincode,
      consentPromotions: !!data.consentPromotions,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await orderRef.set({
      ...participantPayload,
      status: 'pending',
    });

    return { success: true, message: 'Order created.', orderId: orderRef.id };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getParticipantsPaginatedAction(
  eventId: string,
  pageSize: number = 50,
  lastId: string | null = null,
  forceRefresh: boolean = false
): Promise<{
  success: boolean;
  message: string;
  participants?: any[];
  lastId?: string;
  totalCount?: number;
  source?: 'kv' | 'firestore';
  rawTotalCount?: number;
  dedupedTotalCount?: number;
}> {
  try {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) {
      return { success: false, message: 'Event ID is required.', participants: [] };
    }

    console.log(`[getParticipantsPaginatedAction] Fetching participant dataset from KV (forceRefresh=${forceRefresh})...`);
    const kvParticipants = await getParticipantsFromKv(normalizedEventId);
    const kvRows = Array.isArray(kvParticipants) ? kvParticipants : [];

    const normalizedKv = collapseRelayParticipantRecords(
      kvRows.map((p: any) => ({
        ...p,
        id: p?.id || p?.bookingId || null,
      }))
    );

    const registrationParticipants = normalizedKv.filter((participant: any) => !isTimingOnlyParticipantRecord(participant));
    const dedupedAll = dedupeParticipants(registrationParticipants as any[]);

    const sorted = [...dedupedAll].sort((a: any, b: any) => {
      const aDate = new Date((a as any)?.registeredAt || 0).getTime();
      const bDate = new Date((b as any)?.registeredAt || 0).getTime();
      return bDate - aDate;
    });

    const startIndex = lastId
      ? Math.max(0, sorted.findIndex((participant: any) => participant.id === lastId) + 1)
      : 0;
    const pageParticipants = sorted.slice(startIndex, startIndex + pageSize);
    const totalCount = sorted.length;
    const rawTotalCount = normalizedKv.length;

    console.log('[getParticipantsPaginatedAction] participant-source-breakdown', {
      eventId: normalizedEventId,
      rawKvRows: normalizedKv.length,
      afterRegistrationFilter: registrationParticipants.length,
      dedupedRegistrationParticipants: totalCount,
      pageSizeReturned: pageParticipants.length,
      excludedTimingOnlyRows: Math.max(0, normalizedKv.length - registrationParticipants.length),
      isPaginatedRequest: Boolean(lastId),
    });

    return {
      success: true,
      message: forceRefresh ? 'Fetched from KV (forced refresh).' : 'Fetched from KV.',
      participants: serializeValue(pageParticipants),
      lastId: pageParticipants.length > 0 ? String((pageParticipants[pageParticipants.length - 1] as any).id || '') || undefined : undefined,
      totalCount,
      source: 'kv',
      rawTotalCount,
      dedupedTotalCount: totalCount,
    };
  } catch (e: any) {
    console.error("[getParticipantsPaginatedAction] Error:", e.message);
    return { success: false, message: e.message, participants: [] }; 
  }
}

export async function verifyParticipantIntegrityAction(
  eventId: string,
  sampleLimit: number = 25,
): Promise<{
  success: boolean;
  message: string;
  eventId?: string;
  firestoreCount?: number;
  kvCount?: number;
  firestoreUniqueKeys?: number;
  kvUniqueKeys?: number;
  duplicateGroupsInFirestore?: number;
  duplicateGroupsInKv?: number;
  missingInFirestoreCount?: number;
  missingInKvCount?: number;
  missingInFirestoreSample?: string[];
  missingInKvSample?: string[];
}> {
  try {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) {
      return { success: false, message: 'Event ID is required.' };
    }

    const db = getFirestoreInstance();
    const registrationsRef = getRegistrationsCollectionRef(db, normalizedEventId);
    const [registrationsSnap, kvParticipants] = await Promise.all([
      registrationsRef.get(),
      getParticipantsFromKv(normalizedEventId),
    ]);

    const firestoreParticipants = registrationsSnap.docs.map((doc, index) => {
      const participant = serializeParticipantData(doc) as EventParticipant;
      return {
        ...participant,
        id: (participant as any)?.id || doc.id,
        bookingId: String((participant as any)?.bookingId || doc.id || '').trim(),
        __dedupKey: getParticipantDedupKey({
          ...participant,
          id: (participant as any)?.id || doc.id,
          bookingId: String((participant as any)?.bookingId || doc.id || '').trim(),
        }, index),
      } as any;
    });

    const kvRows = Array.isArray(kvParticipants) ? kvParticipants : [];
    const kvNormalized = kvRows.map((participant: any, index: number) => ({
      ...participant,
      id: participant?.id || participant?.bookingId || null,
      __dedupKey: getParticipantDedupKey(participant, index),
    }));

    const fsGroup = new Map<string, number>();
    const kvGroup = new Map<string, number>();

    firestoreParticipants.forEach((p: any) => fsGroup.set(p.__dedupKey, (fsGroup.get(p.__dedupKey) || 0) + 1));
    kvNormalized.forEach((p: any) => kvGroup.set(p.__dedupKey, (kvGroup.get(p.__dedupKey) || 0) + 1));

    const fsUnique = new Set(Array.from(fsGroup.keys()));
    const kvUnique = new Set(Array.from(kvGroup.keys()));

    const missingInFirestore = Array.from(kvUnique).filter((key) => !fsUnique.has(key));
    const missingInKv = Array.from(fsUnique).filter((key) => !kvUnique.has(key));

    const duplicateGroupsInFirestore = Array.from(fsGroup.values()).filter((count) => count > 1).length;
    const duplicateGroupsInKv = Array.from(kvGroup.values()).filter((count) => count > 1).length;

    const summary = {
      eventId: normalizedEventId,
      firestoreCount: firestoreParticipants.length,
      kvCount: kvNormalized.length,
      firestoreUniqueKeys: fsUnique.size,
      kvUniqueKeys: kvUnique.size,
      duplicateGroupsInFirestore,
      duplicateGroupsInKv,
      missingInFirestoreCount: missingInFirestore.length,
      missingInKvCount: missingInKv.length,
      missingInFirestoreSample: missingInFirestore.slice(0, Math.max(1, sampleLimit)),
      missingInKvSample: missingInKv.slice(0, Math.max(1, sampleLimit)),
    };

    console.log('[verifyParticipantIntegrityAction] summary', summary);

    return {
      success: true,
      message: 'Participant integrity check completed.',
      ...summary,
    };
  } catch (e: any) {
    console.error('[verifyParticipantIntegrityAction] failed', {
      eventId,
      error: e?.message || String(e),
    });
    return { success: false, message: e?.message || 'Failed to verify participant integrity.' };
  }
}

export async function repairLegacyParticipantsMirrorAction(
  eventId: string,
): Promise<{ success: boolean; message: string; repairedCount?: number; skippedCount?: number }> {
  try {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return { success: false, message: 'Event ID is required.' };

    const db = getFirestoreInstance();
    const registrationsRef = getRegistrationsCollectionRef(db, normalizedEventId);
    const legacyRef = db.collection('events').doc(normalizedEventId).collection('participants');

    const registrationsSnap = await registrationsRef.get();
    if (registrationsSnap.empty) {
      return { success: true, message: 'No registrations found to mirror.', repairedCount: 0, skippedCount: 0 };
    }

    let repairedCount = 0;
    let skippedCount = 0;

    for (const doc of registrationsSnap.docs) {
      const payload = serializeParticipantData(doc) as EventParticipant;
      if (isTimingOnlyParticipantRecord(payload)) {
        skippedCount++;
        continue;
      }

      await legacyRef.doc(doc.id).set(
        {
          ...payload,
          id: String((payload as any)?.id || doc.id),
          mirroredFromRegistrations: true,
          mirroredAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      repairedCount++;
    }

    console.log('[repairLegacyParticipantsMirrorAction] complete', {
      eventId: normalizedEventId,
      repairedCount,
      skippedCount,
    });

    return {
      success: true,
      message: `Legacy participants mirror repaired (${repairedCount} docs).`,
      repairedCount,
      skippedCount,
    };
  } catch (e: any) {
    console.error('[repairLegacyParticipantsMirrorAction] failed', {
      eventId,
      error: e?.message || String(e),
    });
    return { success: false, message: e?.message || 'Failed to repair legacy participants mirror.' };
  }
}

export async function updateParticipantInEventAction(
  eventId: string,
  participantId: string,
  data: any
): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const { ref, snap: snapBefore } = await resolveParticipantRef(eventId, participantId);
    const participantBefore = snapBefore.data() as any;
    const athleteUid = participantBefore.athleteUid;
    
    const cleanData = { ...data };
    if (cleanData.updatedAt) delete cleanData.updatedAt;

    const incomingEmail = typeof cleanData.email === 'string' ? cleanData.email.trim() : '';
    if (incomingEmail) {
      cleanData.email = incomingEmail;
      cleanData.buyerEmail = incomingEmail;
    }

    if (Object.prototype.hasOwnProperty.call(cleanData, 'clubId')) {
      const rawClubId = String(cleanData.clubId || '').trim();
      if (!rawClubId || rawClubId === NO_CLUB_SELECTED_VALUE) {
        cleanData.clubId = null;
        cleanData.clubName = null;
      } else {
        cleanData.clubId = rawClubId;
        try {
          const clubDoc = await db.collection('clubs').doc(rawClubId).get();
          if (clubDoc.exists) {
            const clubName = String(clubDoc.data()?.name || '').trim();
            cleanData.clubName = clubName || null;
          } else {
            cleanData.clubName = null;
          }
        } catch {
          cleanData.clubName = cleanData.clubName || participantBefore?.clubName || null;
        }
      }
    }

    await ref.update({
      ...cleanData,
      updatedAt: FieldValue.serverTimestamp()
    });

    const updated = await ref.get();
    const serializedUpdatedParticipant = serializeParticipantData(updated);
    await _mirrorParticipantToKV(serializedUpdatedParticipant);

    // Sync participant edits back to user profile (e.g. idProofUrl, address, emergency contact).
    try {
      const { _updateUserFromParticipantData } = await import('./userActions');
      await _updateUserFromParticipantData(serializedUpdatedParticipant);
    } catch (syncErr) {
      console.warn('[updateParticipantInEventAction] User profile sync failed:', syncErr);
    }
    
    // 🔥 Sync club if athlete is affiliated
    if (athleteUid) {
      const userSnap = await db.collection('users').doc(athleteUid).get();
      if (userSnap.exists) {
        const userData = userSnap.data() as any;
        if (userData.clubId) {
          await _syncClubUpcomingAthletes(userData.clubId);
        }
      }
    }
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateParticipantStatusAction(
  eventId: string,
  participantId: string,
  status: string
): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const { ref, snap: snapBefore } = await resolveParticipantRef(eventId, participantId);
    const participantBefore = snapBefore.data() as any;
    const athleteUid = participantBefore.athleteUid;
    
    await ref.update({ ticketStatus: status, updatedAt: FieldValue.serverTimestamp() });
    
    const updated = await ref.get();
    await _mirrorParticipantToKV(serializeParticipantData(updated));
    
    // 🔥 Sync club if athlete is affiliated (status changes affect upcoming availability)
    if (athleteUid) {
      const userSnap = await db.collection('users').doc(athleteUid).get();
      if (userSnap.exists) {
        const userData = userSnap.data() as any;
        if (userData.clubId) {
          await _syncClubUpcomingAthletes(userData.clubId);
        }
      }
    }
    
    return { success: true, message: 'Status updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteParticipantFromEventAction(eventId: string, id: string) {
  let lockRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const db = getFirestoreInstance();

    // Idempotency lock: prevents duplicate delete writes from rapid double-submit.
    lockRef = db.collection('adminOperationLocks').doc(`deleteParticipant_${eventId}_${id}`);
    try {
      await lockRef.create({
        eventId,
        targetId: id,
        action: 'deleteParticipantFromEventAction',
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch {
      return { success: true, message: 'Delete already in progress.' };
    }

    const { ref, snap } = await resolveParticipantRef(eventId, id);
    
    if (snap.exists) {
        const p = snap.data()!;
        const participantsCol = getRegistrationsCollectionRef(db, eventId);

        const seedBookingId = String((p as any).bookingId || id || '').trim();
        const seedAttemptId = String((p as any).registrationAttemptId || '').trim();
        const seedTransactionId = String((p as any).transactionId || (p as any).paymentId || '').trim();
        const seedRazorpayOrderId = String((p as any).razorpayOrderId || '').trim();

        const docsToDelete = new Map<string, FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot>();
        docsToDelete.set(ref.id, snap);

        if (seedBookingId) {
          const byBooking = await participantsCol.where('bookingId', '==', seedBookingId).get();
          byBooking.docs.forEach((d) => docsToDelete.set(d.id, d));
        }

        if (seedAttemptId) {
          const byAttempt = await participantsCol.where('registrationAttemptId', '==', seedAttemptId).get();
          byAttempt.docs.forEach((d) => docsToDelete.set(d.id, d));
        }

        if (seedTransactionId) {
          const byTransaction = await participantsCol.where('transactionId', '==', seedTransactionId).get();
          byTransaction.docs.forEach((d) => docsToDelete.set(d.id, d));

          const byPaymentId = await participantsCol.where('paymentId', '==', seedTransactionId).get();
          byPaymentId.docs.forEach((d) => docsToDelete.set(d.id, d));
        }

        if (seedRazorpayOrderId) {
          const byOrder = await participantsCol.where('razorpayOrderId', '==', seedRazorpayOrderId).get();
          byOrder.docs.forEach((d) => docsToDelete.set(d.id, d));
        }

        const bookingIds = new Set<string>();
        const participantRefIds = new Set<string>();
        const attemptIds = new Set<string>();
        const transactionIds = new Set<string>();
        const razorpayOrderIds = new Set<string>();
        const normalizedEmails = new Set<string>();
        let athleteUid: string | null = null;
        let participantName = '';
        let ticketId = '';

        docsToDelete.forEach((docSnap) => {
          const data = (docSnap.data() || {}) as any;
          const bid = String(data?.bookingId || '').trim();
          if (bid) bookingIds.add(bid);
          participantRefIds.add(docSnap.id);

          const aid = String(data?.registrationAttemptId || '').trim();
          if (aid) attemptIds.add(aid);

          const tx = String(data?.transactionId || data?.paymentId || '').trim();
          if (tx) transactionIds.add(tx);

          const ord = String(data?.razorpayOrderId || '').trim();
          if (ord) razorpayOrderIds.add(ord);

          const em = String(data?.email || '').toLowerCase().trim();
          if (em) normalizedEmails.add(em);

          if (!athleteUid) athleteUid = String(data?.athleteUid || '').trim() || null;
          if (!participantName) participantName = String(data?.name || '');
          if (!ticketId) ticketId = String(data?.ticketId || '');
        });

        const representativeBookingId = seedBookingId || Array.from(bookingIds)[0] || id;
        const representativeRefId = ref.id;
        const representativeEmail = Array.from(normalizedEmails)[0] || String((p as any).email || '').toLowerCase().trim();

        const deletionGuardPayload = {
          eventId,
          bookingId: representativeBookingId,
          participantRefId: representativeRefId,
          participantName,
          participantEmail: representativeEmail,
          ticketId,
          deletedBy: 'admin',
          deletedAt: FieldValue.serverTimestamp(),
          deletedSourceCount: docsToDelete.size,
        };

        await Promise.all(
          Array.from(attemptIds).map((attemptId) =>
            db.collection('registrationAttempts').doc(String(attemptId)).set({
              status: 'RegistrationFailed',
              participantDeletedByAdmin: true,
              participantDeletedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true })
          )
        );

        await Promise.all(
          Array.from(transactionIds).map((tx) =>
            db.collection('registrationDeletionGuards').doc(`tx_${tx}`).set({
              ...deletionGuardPayload,
              transactionId: tx,
            }, { merge: true })
          )
        );

        await Promise.all(
          Array.from(razorpayOrderIds).map((ord) =>
            db.collection('registrationDeletionGuards').doc(`order_${ord}`).set({
              ...deletionGuardPayload,
              razorpayOrderId: ord,
            }, { merge: true })
          )
        );

        await Promise.all(
          Array.from(normalizedEmails).map((emailVal) =>
            db.collection('registrationDeletionGuards').doc(`athlete_${emailVal}_event_${eventId}`).set({
              ...deletionGuardPayload,
              email: emailVal,
              guardType: 'athlete_event',
              manualBlock: false,
            }, { merge: true })
          )
        );

        await Promise.all(Array.from(docsToDelete.values()).map((d) => d.ref.delete()));
        
        // 🔥 SYNC CLEANUP (GHOST REGISTRATION FIX)
        const cleanupBookingIds = bookingIds.size > 0 ? Array.from(bookingIds) : [representativeBookingId];
        const cleanupRefIds = participantRefIds.size > 0 ? Array.from(participantRefIds) : [representativeRefId];
        await Promise.all(
          cleanupBookingIds.flatMap((bid) =>
            cleanupRefIds.map((rid) => _deleteParticipantFromKV(eventId, bid, athleteUid, rid))
          )
        );
        
        // 🔥 Sync club if athlete is affiliated
        if (athleteUid) {
          const userSnap = await db.collection('users').doc(athleteUid).get();
          if (userSnap.exists) {
            const userData = userSnap.data() as any;
            if (userData.clubId) {
              await _syncClubUpcomingAthletes(userData.clubId);
            }
          }
        }
    }

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');
    return { success: true, message: 'Deleted.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  } finally {
    if (lockRef) {
      try { await lockRef.delete(); } catch {}
    }
  }
}

/**
 * Admin action: write or remove an athlete+event deletion guard.
 * Use to retroactively block re-registration for athletes deleted before the guard system existed.
 */
export async function setAthleteEventRegistrationBlockAction(
  eventId: string,
  email: string,
  block: boolean
): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail || !eventId) return { success: false, message: 'Email and eventId are required.' };
    const guardRef = db.collection('registrationDeletionGuards').doc(`athlete_${normalizedEmail}_event_${eventId}`);
    if (block) {
      await guardRef.set({
        email: normalizedEmail,
        eventId,
        guardType: 'athlete_event',
        manualBlock: true,
        deletedBy: 'admin-manual',
        deletedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      await guardRef.delete();
    }
    revalidatePath('/admin/dashboard');
    return { success: true, message: block ? `Registration blocked for ${normalizedEmail} on event ${eventId}.` : `Block removed for ${normalizedEmail} on event ${eventId}.` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateCategoryForParticipantAction(
  eventId: string, 
  id: string, 
  ticketId: string,
  subCategoryId?: string | null
): Promise<{ success: boolean; message: string; bibNumber?: string | null }> {
  try {
    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    const participantResolved = await resolveParticipantRef(eventId, id);
    const participantRef = participantResolved.ref;
    
    const [pSnap, eventSnap, tSnap] = await Promise.all([
        Promise.resolve(participantResolved.snap),
        eventRef.get(),
        eventRef.collection('ticketDefinitions').doc(ticketId).get()
    ]);

    if (!pSnap.exists) throw new Error("Participant not found");
    if (!eventSnap.exists) throw new Error("Event not found");
    if (!tSnap.exists) throw new Error("New Ticket not found");

    const pData = pSnap.data() as EventParticipant;
    const eventData = eventSnap.data() as any;
    const tData = tSnap.data() as TicketDefinition;

    const oldTicketName = pData.ticketName || 'N/A';

    // 1. Calculate Age Group for new BIB assignment
    const ageGroups = tData.applicableAgeGroups?.length ? tData.applicableAgeGroups : eventData.ageCategories;
    const { ageCategory } = calculateAgeGroup(pData.dob, eventData.eventName, ageGroups, tData.eventDate || eventData.eventDate);

    // 2. Assign New BIB based on new category rules
    const newBib = await assignNextAvailableBib(eventId, ticketId, ageCategory, pData.gender || null, undefined, subCategoryId || pData.selectedSubCategory);

    // 3. Update main record
    const updateData: any = {
      ticketId,
      ticketName: tData.ticketName,
      bibNumber: newBib,
      updatedAt: FieldValue.serverTimestamp()
    };

    if (subCategoryId !== undefined) {
      updateData.selectedSubCategory = subCategoryId;
      if (subCategoryId && tData.subCategories) {
        const sub = tData.subCategories.find(s => s.id === subCategoryId);
        if (sub) {
          updateData.ticketName = `${tData.ticketName} - ${sub.name}`;
        }
      }
    }

    await participantRef.update(updateData);

    const updated = await participantRef.get();
    // 4. 🔥 AUTO SYNC TO KV
    await _mirrorParticipantToKV(serializeParticipantData(updated));
    
    // 4.5. 🔥 Sync club if athlete is affiliated
    if (pData.athleteUid) {
      const userSnap = await db.collection('users').doc(pData.athleteUid).get();
      if (userSnap.exists) {
        const userData = userSnap.data() as any;
        if (userData.clubId) {
          await _syncClubUpcomingAthletes(userData.clubId);
        }
      }
    }

    // 5. SEND NOTIFICATIONS
    if (pData.email) {
        sendAthleteCategoryChangeEmail(pData.email, pData.name, eventData.eventName, oldTicketName, updateData.ticketName).catch(() => {});
        sendAdminCategoryChangeNotificationEmail(pData.name, eventData.eventName, oldTicketName, updateData.ticketName).catch(() => {});
    }
    if (pData.mobile) {
        sendCategoryChangeNoticeWhatsApp(pData.mobile, pData.name, eventData.eventName, oldTicketName, updateData.ticketName).catch(() => {});
    }

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');

    return { success: true, message: `Category changed. New BIB: ${newBib || 'TBD'}`, bibNumber: newBib };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function transferParticipantToEventAction(input: {
  sourceEventId: string;
  sourceParticipantId: string;
  targetEventId: string;
  targetTicketId: string;
  targetSubCategoryId?: string | null;
  adminNote?: string | null;
  confirmPaymentReceived?: boolean;
  sendConfirmation?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  requiresPayment?: boolean;
  amountDifferencePaisa?: number;
  transferRequestId?: string;
  newParticipantId?: string;
}> {
  try {
    const db = getFirestoreInstance();

    const sourceEventId = String(input.sourceEventId || '').trim();
    const sourceParticipantId = String(input.sourceParticipantId || '').trim();
    const targetEventId = String(input.targetEventId || '').trim();
    const targetTicketId = String(input.targetTicketId || '').trim();
    const targetSubCategoryId = input.targetSubCategoryId || null;
    const adminNote = String(input.adminNote || '').trim() || null;
    const confirmPaymentReceived = !!input.confirmPaymentReceived;
    const sendConfirmation = input.sendConfirmation !== false;

    if (!sourceEventId || !sourceParticipantId || !targetEventId || !targetTicketId) {
      return { success: false, message: 'Source event, participant, target event, and target ticket are required.' };
    }

    const sourceResolved = await resolveParticipantRef(sourceEventId, sourceParticipantId);
    const sourceParticipantRef = sourceResolved.ref;
    const sourceParticipantSnap = sourceResolved.snap;

    if (!sourceParticipantSnap.exists) {
      return { success: false, message: 'Source participant not found.' };
    }

    const sourceParticipant = sourceParticipantSnap.data() as EventParticipant;
    const sourceStatus = String(sourceParticipant.ticketStatus || '').toLowerCase();
    if (!sourceStatus || ['cancelled', 'refunded', 'inactive', 'deferred'].includes(sourceStatus)) {
      return { success: false, message: 'Only active registrations can be transferred.' };
    }

    if (sourceParticipant.isRelay) {
      return { success: false, message: 'Relay registrations are not supported in event transfer.' };
    }

    const [sourceEventSnap, targetEventSnap, targetTicketSnap] = await Promise.all([
      db.collection('events').doc(sourceEventId).get(),
      db.collection('events').doc(targetEventId).get(),
      db.collection('events').doc(targetEventId).collection('ticketDefinitions').doc(targetTicketId).get(),
    ]);

    if (!sourceEventSnap.exists) return { success: false, message: 'Source event not found.' };
    if (!targetEventSnap.exists) return { success: false, message: 'Target event not found.' };
    if (!targetTicketSnap.exists) return { success: false, message: 'Target ticket not found.' };

    const sourceEventData = sourceEventSnap.data() as any;
    const targetEventData = targetEventSnap.data() as any;
    const targetTicketData = targetTicketSnap.data() as TicketDefinition;
    const normalizeEventDate = (value: unknown): string => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      return raw.includes('T') ? raw.split('T')[0] : raw;
    };
    const sourceResolvedEventDate = normalizeEventDate(sourceParticipant.eventDate || sourceEventData?.eventDate || null);
    const targetResolvedEventDate = normalizeEventDate(targetTicketData.eventDate || targetEventData.eventDate || null);

    if (sourceEventId === targetEventId && sourceResolvedEventDate === targetResolvedEventDate) {
      return { success: false, message: 'Use category change for registrations on the same event date. Transfer is allowed only when the target category is on a different date.' };
    }

    const targetRegistrationType =
      targetTicketData.registrationType ||
      (/\brelay\b/i.test(targetTicketData.ticketName || '') || /\brelay\b/i.test(targetTicketData.description || '')
        ? 'relay'
        : 'individual');
    if (targetRegistrationType === 'relay') {
      return { success: false, message: 'Relay tickets are not supported for this transfer flow.' };
    }

    const normalizedEmail = String(sourceParticipant.email || '').trim().toLowerCase();
    const athleteUid = String(sourceParticipant.athleteUid || '').trim();

    if (!normalizedEmail && !athleteUid) {
      return { success: false, message: 'Participant identity is incomplete (missing email/UID).' };
    }

    const targetParticipantsRef = db.collection('events').doc(targetEventId).collection('participants');
    const duplicateChecks: FirebaseFirestore.QuerySnapshot[] = await Promise.all([
      athleteUid ? targetParticipantsRef.where('athleteUid', '==', athleteUid).limit(5).get() : Promise.resolve({ docs: [] } as any),
      normalizedEmail ? targetParticipantsRef.where('email', '==', normalizedEmail).limit(5).get() : Promise.resolve({ docs: [] } as any),
    ]);

    const hasActiveInTarget = duplicateChecks.some((snap: any) =>
      (snap.docs || []).some((doc: any) => {
        if (sourceEventId === targetEventId && String(doc.id || '') === sourceParticipantRef.id) {
          return false;
        }
        const data = (doc.data?.() || {}) as any;
        const status = String(data.ticketStatus || '').toLowerCase();
        if (['cancelled', 'refunded', 'inactive', 'deferred'].includes(status)) {
          return false;
        }

        const existingTargetDate = normalizeEventDate(data.eventDate || targetEventData?.eventDate || null);
        const existingTicketId = String(data.ticketId || '').trim();
        const existingSubCategoryId = String(data.selectedSubCategory || '').trim();
        const normalizedTargetSubCategoryId = String(targetSubCategoryId || '').trim();
        const sameTargetDate = existingTargetDate === targetResolvedEventDate;
        const sameTargetCategory =
          existingTicketId === targetTicketId &&
          existingSubCategoryId === normalizedTargetSubCategoryId;

        if (sourceEventId === targetEventId) {
          return sameTargetDate && sameTargetCategory;
        }

        return sameTargetDate && sameTargetCategory;
      })
    );

    if (hasActiveInTarget) {
      return { success: false, message: 'Participant already has an active registration for the same target category/date.' };
    }

    const selectedSubCategory = targetSubCategoryId
      ? (targetTicketData.subCategories || []).find((s) => s.id === targetSubCategoryId) || null
      : null;

    if (targetSubCategoryId && !selectedSubCategory) {
      return { success: false, message: 'Selected target sub-category was not found.' };
    }

    const targetBasePricePaisa = selectedSubCategory?.pricePaisa ?? targetTicketData.price ?? 0;
    const targetCurrency = String(targetEventData?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR';
    const configuredTaxPercent = Number(targetTicketData?.gstPercent);
    const effectiveTaxPercent = targetCurrency === 'USD'
      ? 0
      : (Number.isFinite(configuredTaxPercent) && configuredTaxPercent > 0 ? configuredTaxPercent : GST_PERCENTAGE);
    const targetGstPaisa = effectiveTaxPercent > 0
      ? Math.round(targetBasePricePaisa * (effectiveTaxPercent / 100))
      : 0;
    const targetPriceIncludingGstPaisa = targetBasePricePaisa + targetGstPaisa;
    const alreadyPaidPaisa = Number(
      sourceParticipant.amountPaidPaisa ??
      sourceParticipant.originalAmountPaidAtFirstRegistrationPaisa ??
      sourceParticipant.basePricePaisa ??
      0
    );
    const amountDifferencePaisa = Math.max(0, Math.round(targetPriceIncludingGstPaisa - alreadyPaidPaisa));

    const transferRequestRef = db.collection('eventTransferRequests').doc();
    const transferRequestId = transferRequestRef.id;

    await transferRequestRef.set({
      transferRequestId,
      status: amountDifferencePaisa > 0 && !confirmPaymentReceived ? 'PaymentPending' : 'Processing',
      sourceEventId,
      sourceEventName: sourceEventData?.eventName || null,
      sourceParticipantId: sourceParticipantRef.id,
      targetEventId,
      targetEventName: targetEventData?.eventName || null,
      targetTicketId,
      targetSubCategoryId: targetSubCategoryId || null,
      sourceTicketId: sourceParticipant.ticketId || null,
      sourceTicketName: sourceParticipant.ticketName || null,
      targetTicketName: selectedSubCategory ? `${targetTicketData.ticketName} - ${selectedSubCategory.name}` : targetTicketData.ticketName,
      athleteUid: athleteUid || null,
      athleteEmail: normalizedEmail || null,
      athleteName: sourceParticipant.name || null,
      alreadyPaidPaisa,
      targetBasePricePaisa,
      targetGstPaisa,
      targetTaxPercent: effectiveTaxPercent,
      targetPricePaisa: targetPriceIncludingGstPaisa,
      amountDifferencePaisa,
      confirmPaymentReceived,
      adminNote,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (amountDifferencePaisa > 0 && !confirmPaymentReceived) {
      return {
        success: true,
        requiresPayment: true,
        amountDifferencePaisa,
        transferRequestId,
        message: 'Transfer request created in Payment Pending state. Collect the difference amount and confirm transfer.',
      };
    }

    const ageGroups =
      selectedSubCategory?.applicableAgeGroups ||
      targetTicketData.applicableAgeGroups ||
      targetEventData.ageCategories;

    const { age, ageCategory } = calculateAgeGroup(
      sourceParticipant.dob,
      targetEventData.eventName,
      ageGroups,
      targetTicketData.eventDate || targetEventData.eventDate
    );

    const newBib = await assignNextAvailableBib(
      targetEventId,
      targetTicketId,
      ageCategory,
      sourceParticipant.gender || null,
      undefined,
      targetSubCategoryId || undefined
    );

    const nowIso = new Date().toISOString();
    const targetTicketName = selectedSubCategory ? `${targetTicketData.ticketName} - ${selectedSubCategory.name}` : targetTicketData.ticketName;
    const sourceEventDate = sourceParticipant.eventDate || sourceEventData?.eventDate || null;
    const targetEventDate = targetTicketData.eventDate || targetEventData.eventDate || null;
    const finalAmountPaidPaisa = Math.max(alreadyPaidPaisa + amountDifferencePaisa, targetPriceIncludingGstPaisa);

    await sourceParticipantRef.update({
      ticketStatus: 'Transferred',
      status: 'Transferred',
      registrationStatus: 'Transferred',
      transferRequestId,
      transferredAt: nowIso,
      transferredToEventId: targetEventId,
      transferredToEventName: targetEventData?.eventName || null,
      transferredToTicketId: targetTicketId,
      transferredToTicketName: targetTicketName,
      updatedAt: FieldValue.serverTimestamp(),
    } as any);

    const targetParticipantPayload: any = {
      ...sourceParticipant,
      eventId: targetEventId,
      eventName: targetEventData?.eventName || sourceParticipant.eventName || null,
      eventDate: targetEventDate,
      ticketId: targetTicketId,
      ticketName: targetTicketName,
      selectedSubCategory: targetSubCategoryId || null,
      ticketStatus: 'Active',
      status: 'Active',
      registrationStatus: 'Completed',
      bibNumber: newBib || null,
      age,
      ageCategory,
      basePricePaisa: targetBasePricePaisa,
      amountPaidPaisa: finalAmountPaidPaisa,
      gstPaid: finalAmountPaidPaisa > targetBasePricePaisa ? 'Yes' : 'No',
      registeredAt: nowIso,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      bookingId: generateAdminBookingId(),
      transferRequestId,
      transferredFromEventId: sourceEventId,
      transferredFromEventName: sourceEventData?.eventName || null,
      transferredFromEventDate: sourceEventDate,
      transferredFromParticipantId: sourceParticipantRef.id,
      transferredFromTicketId: sourceParticipant.ticketId || null,
      transferredFromTicketName: sourceParticipant.ticketName || null,
      transferPriceDifferencePaisa: amountDifferencePaisa,
      transferTargetBasePricePaisa: targetBasePricePaisa,
      transferTargetGstPaisa: targetGstPaisa,
      transferTargetTaxPercent: effectiveTaxPercent,
      transferTargetTotalPricePaisa: targetPriceIncludingGstPaisa,
      transferConfirmedByAdmin: true,
      transferConfirmedAt: nowIso,
      transferAdminNote: adminNote,
      paymentMethod: amountDifferencePaisa > 0
        ? `${sourceParticipant.paymentMethod || 'Offline'} + Admin Transfer Adjustment`
        : (sourceParticipant.paymentMethod || 'Transferred'),
      transactionId: amountDifferencePaisa > 0
        ? `ADMIN_TRANSFER_${Date.now()}`
        : sourceParticipant.transactionId || null,
      isDeferral: false,
      deferralId: null,
      cancellationDetails: null,
    };

    delete targetParticipantPayload.id;
    delete targetParticipantPayload.checkInStatus;
    delete targetParticipantPayload.checkedInAt;
    delete targetParticipantPayload.checkedInByVolunteerId;
    delete targetParticipantPayload.checkedInByVolunteerName;
    delete targetParticipantPayload.checkInCounter;
    delete targetParticipantPayload.checkInDetails;
    delete targetParticipantPayload.bikeCheckInStatus;
    delete targetParticipantPayload.bikeCheckedInAt;
    delete targetParticipantPayload.bikeCheckOutStatus;
    delete targetParticipantPayload.bikeCheckedOutAt;
    delete targetParticipantPayload.bikeCheckInDetails;
    delete targetParticipantPayload.bikeCheckedOutManuallyBy;
    delete targetParticipantPayload.bikeCheckedOutManuallyTo;
    delete targetParticipantPayload.lockerNumber;
    delete targetParticipantPayload.lockerReturnedAt;
    delete targetParticipantPayload.notificationsSent;
    delete targetParticipantPayload.medalIssued;
    delete targetParticipantPayload.finisherJerseyIssued;
    delete targetParticipantPayload.foodIssued;
    delete targetParticipantPayload.breakfastIssued;
    delete targetParticipantPayload.lunchIssued;

    Object.keys(targetParticipantPayload).forEach((key) => {
      if (targetParticipantPayload[key] === undefined) delete targetParticipantPayload[key];
    });

    const newParticipantRef = await writeCanonicalParticipant(
      db,
      targetEventId,
      targetParticipantPayload,
      targetParticipantPayload.bookingId,
    );

    const [updatedSourceSnap, updatedTargetSnap] = await Promise.all([
      sourceParticipantRef.get(),
      newParticipantRef.get(),
    ]);

    await Promise.all([
      _mirrorParticipantToKV(serializeParticipantData(updatedSourceSnap)),
      _mirrorParticipantToKV(serializeParticipantData(updatedTargetSnap)),
    ]);

    if (athleteUid) {
      const userSnap = await db.collection('users').doc(athleteUid).get();
      const userClubId = String(userSnap.data()?.clubId || '').trim();
      if (userClubId) {
        await _syncClubUpcomingAthletes(userClubId);
      }
    }

    if (sendConfirmation && normalizedEmail) {
      sendRegistrationConfirmationEmail(
        normalizedEmail,
        targetParticipantPayload.name || 'Athlete',
        targetEventData?.eventName || 'Event',
        targetParticipantPayload.bookingId,
        nowIso,
        targetParticipantPayload.ticketName,
        targetEventData?.venueName || null,
        targetEventDate,
        targetParticipantPayload.address,
        targetParticipantPayload.mobile,
        targetParticipantPayload.emergencyContactNumber,
        null,
        targetParticipantPayload.bibNumber,
        targetEventData?.organizerName || null,
        targetEventData?.organizerAddress || null,
        targetEventData?.organizerCompanyDescription || null,
        targetParticipantPayload.country,
        (String(targetEventData?.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR') as 'INR' | 'USD'
      ).catch(() => {});
    }

    await transferRequestRef.set({
      status: 'Completed',
      completedAt: FieldValue.serverTimestamp(),
      newParticipantId: newParticipantRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');

    return {
      success: true,
      message: amountDifferencePaisa > 0
        ? `Transfer completed. Additional ${(amountDifferencePaisa / 100).toFixed(2)} recorded (incl. GST).`
        : 'Transfer completed successfully.',
      amountDifferencePaisa,
      transferRequestId,
      newParticipantId: newParticipantRef.id,
    };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to transfer participant.' };
  }
}

export async function checkParticipantRegistrationByEmail(eventId: string, email: string): Promise<{ success: boolean; isRegistered: boolean; registeredDates?: string[]; blockedByAdmin?: boolean }> {
  try {
    const db = getFirestoreInstance();
    const normalizedEmail = email.toLowerCase().trim();

    // Honor only explicit manual admin blocks here.
    // Auto guards created during admin delete should not block a fresh new registration.
    const guardSnap = await db.collection('registrationDeletionGuards')
      .doc(`athlete_${normalizedEmail}_event_${eventId}`)
      .get();
    const guardData = guardSnap.data() as Record<string, any> | undefined;
    const deletedBy = String(guardData?.deletedBy || '').trim().toLowerCase();
    const isAdminBlock = guardSnap.exists && (
      guardData?.manualBlock === true || deletedBy === 'admin-manual'
    );
    if (isAdminBlock) {
      return { success: true, isRegistered: true, blockedByAdmin: true, registeredDates: [] };
    }

    const snap = await getRegistrationsCollectionRef(db, eventId)
      .where('email', '==', normalizedEmail)
      .where('ticketStatus', '==', 'Active')
      .get();
    
    if (snap.empty) return { success: true, isRegistered: false };
    const dates = snap.docs.map(doc => doc.data().eventDate).filter(Boolean);
    return { success: true, isRegistered: true, registeredDates: dates };
  } catch (e: any) {
    return { success: false, isRegistered: false };
  }
}

export async function addParticipantToEventAction(eventId: string, pData: any) {
    try {
        const db = getFirestoreInstance();
        const eventRef = db.collection('events').doc(eventId);
        const eventSnap = await eventRef.get();
        if(!eventSnap.exists) throw new Error("Event not found");

        const ticketSnap = await eventRef.collection('ticketDefinitions').doc(pData.ticketId).get();
        if(!ticketSnap.exists) throw new Error("Ticket not found");
        const tData = ticketSnap.data() as TicketDefinition;

        const participantPayload = {
            ...pData,
          agreedPolicyChangeFlow: true,
            ticketName: tData.ticketName,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        const res = await writeCanonicalParticipant(db, eventId, participantPayload, String(pData?.bookingId || pData?.id || '').trim());
        
        const updated = await res.get();
        await _mirrorParticipantToKV(serializeParticipantData(updated));
        
        return { success: true, id: res.id };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function addParticipantFromUserAction(eventId: string, uid: string, ticketId: string) {
    try {
        const db = getFirestoreInstance();
        const userSnap = await db.collection('users').doc(uid).get();
        if(!userSnap.exists) throw new Error("User not found");
        const userData = userSnap.data() as User;

        const eventRef = db.collection('events').doc(eventId);
        const ticketSnap = await eventRef.collection('ticketDefinitions').doc(ticketId).get();
        const tData = ticketSnap.data() as TicketDefinition;

        const res = await writeCanonicalParticipant(db, eventId, {
            athleteUid: uid,
            name: userData.name,
            email: userData.email?.toLowerCase(),
            mobile: userData.mobile,
            ticketId,
            ticketName: tData.ticketName,
            ticketStatus: 'Active',
            registeredAt: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }, `uid:${uid}:${ticketId}`);

        const updated = await res.get();
        await _mirrorParticipantToKV(serializeParticipantData(updated));
        
        // 🔥 Sync club's upcoming athletes if user is affiliated with a club
        if (userData.clubId) {
            await _syncClubUpcomingAthletes(userData.clubId);
        }

        return { success: true, id: res.id };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function findUserForParticipantRegistrationAction(email: string): Promise<{
  success: boolean;
  message: string;
  user?: {
    uid: string;
    name: string;
    email: string;
    mobile?: string | null;
    dob?: string | null;
    gender?: string | null;
    bloodGroup?: string | null;
    tshirtSize?: string | null;
    idProofUrl?: string | null;
    emergencyContactNumber?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pincode?: string | null;
    clubId?: string | null;
    clubName?: string | null;
  };
}> {
  try {
    const lowerEmail = (email || '').trim().toLowerCase();
    if (!lowerEmail) {
      return { success: false, message: 'Email is required.' };
    }

    const db = getFirestoreInstance();
    let snap = await db.collection('users').where('email', '==', lowerEmail).limit(1).get();
    if (snap.empty) {
      const rawEmail = (email || '').trim();
      if (rawEmail && rawEmail !== lowerEmail) {
        snap = await db.collection('users').where('email', '==', rawEmail).limit(1).get();
      }
    }
    if (snap.empty) {
      return { success: false, message: 'No user found with this email.' };
    }

    const u = snap.docs[0].data() as User;
    const pick = (...vals: any[]) => {
      for (const v of vals) {
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return null;
    };
    const normalizeDob = (value: any): string | null => {
      if (!value) return null;
      if (typeof value === 'string') return value;
      if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
      if (typeof value?.toDate === 'function') {
        const d = value.toDate();
        if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      return String(value);
    };
    const normalizeCountry = (value: any): string | null => {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return null;
      if (['india', 'in'].includes(raw)) return 'India';
      if (['usa', 'us', 'united states', 'united states of america'].includes(raw)) return 'USA';
      return String(value).trim();
    };

    const latestParticipantFields = {
      mobile: null as any,
      dob: null as any,
      gender: null as any,
      bloodGroup: null as any,
      tshirtSize: null as any,
      idProofUrl: null as any,
      emergencyContactNumber: null as any,
      address: null as any,
      city: null as any,
      state: null as any,
      country: null as any,
      pincode: null as any,
      clubId: null as any,
      clubName: null as any,
    };

    try {
      const participantSnap = await db
        .collectionGroup('participants')
        .where('email', '==', lowerEmail)
        .limit(20)
        .get();

      if (!participantSnap.empty) {
        const sortedParticipants = participantSnap.docs
          .map((doc) => doc.data() as any)
          .sort((a, b) => {
            const aTime = new Date(a.updatedAt?.toDate?.() || a.registeredAt || a.createdAt?.toDate?.() || 0).getTime();
            const bTime = new Date(b.updatedAt?.toDate?.() || b.registeredAt || b.createdAt?.toDate?.() || 0).getTime();
            return bTime - aTime;
          });

        const bestParticipant = sortedParticipants.find((p) =>
          p.mobile || p.dob || p.gender || p.bloodGroup || p.tshirtSize || p.idProofUrl || p.emergencyContactNumber || p.address
        );

        if (bestParticipant) {
          latestParticipantFields.mobile = pick(bestParticipant.mobile, bestParticipant.phone);
          latestParticipantFields.dob = normalizeDob(pick(bestParticipant.dob, bestParticipant.dateOfBirth));
          latestParticipantFields.gender = pick(bestParticipant.gender);
          latestParticipantFields.bloodGroup = pick(bestParticipant.bloodGroup, bestParticipant.blood_group);
          latestParticipantFields.tshirtSize = pick(bestParticipant.tshirtSize, bestParticipant.tshirt, bestParticipant.shirtSize);
          latestParticipantFields.idProofUrl = pick(bestParticipant.idProofUrl, bestParticipant.idProof, bestParticipant.identityProof);
          latestParticipantFields.emergencyContactNumber = pick(bestParticipant.emergencyContactNumber, bestParticipant.emergencyContactPhone, bestParticipant.emergencyPhone);
          latestParticipantFields.address = pick(bestParticipant.address, bestParticipant.businessAddress);
          latestParticipantFields.city = pick(bestParticipant.city);
          latestParticipantFields.state = pick(bestParticipant.state);
          latestParticipantFields.country = normalizeCountry(pick(bestParticipant.country));
          latestParticipantFields.pincode = pick(bestParticipant.pincode, bestParticipant.postalCode);
          latestParticipantFields.clubId = pick(bestParticipant.clubId);
          latestParticipantFields.clubName = pick(bestParticipant.clubName);
        }
      }
    } catch (participantLookupErr) {
      console.warn('[findUserForParticipantRegistrationAction] participant fallback lookup failed:', participantLookupErr);
    }

    return {
      success: true,
      message: 'User found.',
      user: {
        uid: u.uid || snap.docs[0].id,
        name: pick(u.name, (u as any).fullName, `${(u as any).firstName || ''} ${(u as any).lastName || ''}`.trim(), 'Athlete') as string,
        email: (u.email || lowerEmail).toLowerCase(),
        mobile: pick(u.mobile, (u as any).phone, (u as any).phoneNumber, latestParticipantFields.mobile),
        dob: normalizeDob(pick(u.dob, (u as any).dateOfBirth, latestParticipantFields.dob)),
        gender: pick(u.gender, latestParticipantFields.gender),
        bloodGroup: pick(u.bloodGroup, (u as any).blood_group, latestParticipantFields.bloodGroup),
        tshirtSize: pick(u.tshirtSize, (u as any).tshirt, (u as any).shirtSize, latestParticipantFields.tshirtSize),
        idProofUrl: pick((u as any).idProofUrl, (u as any).idProof, (u as any).identityProof, latestParticipantFields.idProofUrl),
        emergencyContactNumber: pick((u as any).emergencyContactNumber, (u as any).emergencyContactPhone, (u as any).emergencyPhone, latestParticipantFields.emergencyContactNumber),
        address: pick(u.address, (u as any).businessAddress, latestParticipantFields.address),
        city: pick(u.city, latestParticipantFields.city),
        state: pick(u.state, latestParticipantFields.state),
        country: normalizeCountry(pick(u.country, latestParticipantFields.country)),
        pincode: pick(u.pincode, (u as any).postalCode, latestParticipantFields.pincode),
        clubId: pick(u.clubId, (u as any).ownedClubId, latestParticipantFields.clubId),
        clubName: pick(u.clubName, (u as any).ownedClubName, latestParticipantFields.clubName),
      },
    };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to search user.' };
  }
}

export async function registerParticipantFromDatabaseAction(input: {
  eventId: string;
  email: string;
  ticketId: string;
  selectedSubCategory?: string | null;
  amountPaidInr?: number | null;
  paymentMethod?: string | null;
  transactionId?: string | null;
  sendConfirmations?: boolean;
  participantOverrides?: {
    name?: string | null;
    mobile?: string | null;
    dob?: string | null;
    gender?: string | null;
    bloodGroup?: string | null;
    tshirtSize?: string | null;
    idProofUrl?: string | null;
    emergencyContactNumber?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    pincode?: string | null;
  };
}): Promise<{ success: boolean; message: string; participantId?: string }> {
  try {
    const db = getFirestoreInstance();

    const eventId = (input.eventId || '').trim();
    const email = (input.email || '').trim().toLowerCase();
    const ticketId = (input.ticketId || '').trim();
    const selectedSubCategory = input.selectedSubCategory || null;
    const sendConfirmations = !!input.sendConfirmations;

    if (!eventId || !email || !ticketId) {
      return { success: false, message: 'Event, email, and ticket are required.' };
    }

    const [eventSnap, userSnap, ticketSnap] = await Promise.all([
      db.collection('events').doc(eventId).get(),
      db.collection('users').where('email', '==', email).limit(1).get(),
      db.collection('events').doc(eventId).collection('ticketDefinitions').doc(ticketId).get(),
    ]);

    if (!eventSnap.exists) return { success: false, message: 'Event not found.' };
    if (!ticketSnap.exists) return { success: false, message: 'Ticket not found.' };

    const eventData = eventSnap.data() as any;
    const userDoc = userSnap.empty ? null : userSnap.docs[0];
    const existingUserData = userDoc ? (userDoc.data() as User) : null;
    const ticketData = ticketSnap.data() as TicketDefinition;
    const overrides = input.participantOverrides || {};

    const norm = (value: any): string | null => {
      if (value === null || value === undefined) return null;
      const cleaned = String(value).trim();
      return cleaned ? cleaned : null;
    };

    const finalName = norm(overrides.name) || norm(existingUserData?.name) || 'Athlete';
    const finalMobile = norm(overrides.mobile) || norm(existingUserData?.mobile);
    const finalDob = norm(overrides.dob) || norm(existingUserData?.dob);
    const finalGender = norm(overrides.gender) || norm(existingUserData?.gender);
    const finalBloodGroup = norm(overrides.bloodGroup) || norm(existingUserData?.bloodGroup);
    const finalTshirtSize = norm(overrides.tshirtSize) || norm(existingUserData?.tshirtSize);
    const finalEmergencyContact = norm(overrides.emergencyContactNumber) || norm(existingUserData?.emergencyContactNumber);
    const finalAddress = norm(overrides.address) || norm(existingUserData?.address);
    const finalCity = norm(overrides.city) || norm(existingUserData?.city);
    const finalState = norm(overrides.state) || norm(existingUserData?.state);
    const finalCountry = norm(overrides.country) || norm(existingUserData?.country);
    const finalPincode = norm(overrides.pincode) || norm(existingUserData?.pincode);
    const finalIdProofUrl = norm(overrides.idProofUrl) || norm(existingUserData?.idProofUrl);

    let userData: User;
    let userId: string;

    if (existingUserData && userDoc) {
      userData = existingUserData;
      userId = userDoc.id;
    } else {
      const newUserRef = db.collection('users').doc();
      userId = newUserRef.id;
      userData = {
        uid: userId,
        id: userId,
        name: finalName,
        email,
        mobile: finalMobile || undefined,
        dob: finalDob || undefined,
        gender: finalGender || undefined,
        bloodGroup: finalBloodGroup || undefined,
        tshirtSize: finalTshirtSize || undefined,
        emergencyContactNumber: finalEmergencyContact || undefined,
        address: finalAddress || undefined,
        city: finalCity || undefined,
        state: finalState || undefined,
        country: finalCountry || undefined,
        pincode: finalPincode || undefined,
        idProofUrl: finalIdProofUrl || undefined,
        role: 'athlete' as any,
        isAdmin: false,
        isVolunteer: false,
      } as User;

      await newUserRef.set({
        ...userData,
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await putKV(`user:${userId}:profile`, serializeValue(userData), 'registerParticipantFromDatabaseAction');
    }

    const participantByEmail = await getRegistrationsCollectionRef(db, eventId)
      .where('email', '==', email)
      .get();

    const normSub = (value: unknown) => {
      const raw = String(value || '').trim();
      return raw && raw !== 'NONE' ? raw : null;
    };
    const requestedSub = normSub(selectedSubCategory);

    const hasActiveSameCategoryRegistration = participantByEmail.docs.some((d) => {
      const data = d.data() as any;
      const status = String(data?.ticketStatus || 'Active').trim().toLowerCase();
      const isActive = status !== 'cancelled' && status !== 'refunded' && status !== 'inactive';
      if (!isActive) return false;

      const existingTicketId = String(data?.ticketId || '').trim();
      const existingSub = normSub(data?.selectedSubCategory);

      return existingTicketId === ticketId && existingSub === requestedSub;
    });
    if (hasActiveSameCategoryRegistration) {
      return { success: false, message: 'This user is already registered for this category.' };
    }

    const subCategoryData = selectedSubCategory
      ? (ticketData.subCategories || []).find((s) => s.id === selectedSubCategory) || null
      : null;

    const basePricePaisa = subCategoryData?.pricePaisa ?? ticketData.price ?? 0;
    const amountPaidPaisa =
      input.amountPaidInr === null || input.amountPaidInr === undefined
        ? basePricePaisa
        : Math.max(0, Math.round(Number(input.amountPaidInr) * 100));

    const ageGroupsRaw =
      subCategoryData?.applicableAgeGroups || ticketData.applicableAgeGroups || eventData.ageCategories;
    const ageGroups = Array.isArray(ageGroupsRaw)
      ? ageGroupsRaw
      : typeof ageGroupsRaw === 'string'
        ? ageGroupsRaw.split(',').map((s) => s.trim())
        : [];
    const { age, ageCategory } = calculateAgeGroup(
      finalDob,
      eventData.eventName,
      ageGroups,
      ticketData.eventDate || eventData.eventDate
    );

    const bibNumber = await assignNextAvailableBib(
      eventId,
      ticketId,
      ageCategory,
      finalGender,
      undefined,
      selectedSubCategory
    );

    const bookingId = generateAdminBookingId();
    const registrationTime = new Date();
    const finalTicketName = subCategoryData ? `${ticketData.ticketName} - ${subCategoryData.name}` : ticketData.ticketName;
    const finalEventDate = ticketData.eventDate || eventData.eventDate || null;

    const participantPayload: any = {
      athleteUid: userData.uid || userId,
      name: finalName,
      email,
      mobile: finalMobile,
      gender: finalGender,
      dob: finalDob,
      bloodGroup: finalBloodGroup,
      tshirtSize: finalTshirtSize,
      emergencyContactNumber: finalEmergencyContact,
      address: finalAddress,
      city: finalCity,
      state: finalState,
      country: finalCountry,
      pincode: finalPincode,
      idProofUrl: finalIdProofUrl,
      eventId,
      eventName: eventData.eventName,
      eventDate: finalEventDate,
      bookingId,
      ticketId,
      selectedSubCategory,
      ticketName: finalTicketName,
      ticketStatus: 'Active',
      registeredAt: registrationTime.toISOString(),
      transactionId: input.transactionId?.trim() || `ADMIN_MANUAL_${Date.now()}`,
      paymentMethod: input.paymentMethod?.trim() || 'Offline/Admin Manual',
      buyerName: finalName,
      buyerEmail: email,
      amountPaidPaisa,
      originalAmountPaidAtFirstRegistrationPaisa: amountPaidPaisa,
      basePricePaisa,
      gstPaid: amountPaidPaisa > basePricePaisa ? 'Yes' : 'No',
      age,
      ageCategory,
      bibNumber: bibNumber || null,
      consentPromotions: true,
      agreedRules: true,
      agreedWaiver: true,
      agreedCutoff: true,
      agreedPolicyChangeFlow: true,
      digitalSignatureName: finalName,
      billingType: 'personal',
      clubId: userData.clubId || userData.ownedClubId || null,
      clubName: userData.clubName || userData.ownedClubName || null,
      pricingBreakdown: {
        base: basePricePaisa,
        discount: 0,
        eventGST: Math.round(basePricePaisa * (GST_PERCENTAGE / 100)),
        platformFeeBase: 0,
        platformGST: 0,
        processingFeeBase: 0,
        processingGST: 0,
        roundingAdjustment: 0,
        totalPayable: amountPaidPaisa,
        currency: (eventData.currency as any) || 'INR',
        gstRate: GST_PERCENTAGE / 100,
        version: 'v3.0.0',
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    Object.keys(participantPayload).forEach((k) => participantPayload[k] === undefined && delete participantPayload[k]);

    const participantRef = await writeCanonicalParticipant(db, eventId, participantPayload, bookingId);
    console.log('[registerParticipantFromDatabaseAction] canonical-write', {
      eventId,
      path: participantRef.path,
      participantId: participantRef.id,
      bookingId,
    });
    const participantSnap = await participantRef.get();
    const serializedParticipant = serializeParticipantData(participantSnap) as EventParticipant;

    // Persist normalized/latest profile details back to user for future registrations.
    const userProfilePatch: any = {
      uid: userData.uid || userId,
      id: userData.id || userId,
      email,
      name: finalName,
      mobile: finalMobile || null,
      dob: finalDob || null,
      gender: finalGender || null,
      bloodGroup: finalBloodGroup || null,
      tshirtSize: finalTshirtSize || null,
      emergencyContactNumber: finalEmergencyContact || null,
      address: finalAddress || null,
      city: finalCity || null,
      state: finalState || null,
      country: finalCountry || null,
      pincode: finalPincode || null,
      idProofUrl: finalIdProofUrl || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection('users').doc(userId).set(userProfilePatch, { merge: true });

    const kvUserProfile = {
      ...(userData as any),
      ...Object.fromEntries(Object.entries(userProfilePatch).filter(([, v]) => v !== undefined)),
      updatedAt: new Date().toISOString(),
    };
    await putKV(`user:${userId}:profile`, serializeValue(kvUserProfile), 'registerParticipantFromDatabaseAction:updateUserProfile');

    await _mirrorParticipantToKV(serializedParticipant);

    try {
      const { _updateUserFromParticipantData } = await import('./userActions');
      await _updateUserFromParticipantData(serializedParticipant);
    } catch (syncErr) {
      console.warn('[registerParticipantFromDatabaseAction] user sync helper failed:', syncErr);
    }

    if (userData.clubId) {
      await _syncClubUpcomingAthletes(userData.clubId);
    }

    if (sendConfirmations) {
      const participantName = participantPayload.name || 'Athlete';
      const actualBib = participantPayload.bibNumber || 'TBD';
      if (participantPayload.mobile) {
        await sendRegistrationConfirmationViaWhatsApp(
          participantPayload.mobile,
          participantName,
          eventData.eventName,
          bookingId,
          registrationTime,
          finalTicketName,
          actualBib,
          eventData.venueName ?? eventData.address ?? null,
          finalEventDate
        );
      }

      await sendRegistrationConfirmationEmail(
        email,
        participantName,
        eventData.eventName,
        bookingId,
        registrationTime,
        finalTicketName,
        eventData.venueName,
        finalEventDate,
        participantPayload.address,
        participantPayload.mobile,
        participantPayload.emergencyContactNumber,
        null,
        actualBib,
        eventData.organizerName,
        eventData.organizerAddress,
        eventData.organizerCompanyDescription,
        participantPayload.country
      );
    }

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');

    return { success: true, message: 'Participant added successfully from database user.', participantId: participantRef.id };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to add participant.' };
  }
}
