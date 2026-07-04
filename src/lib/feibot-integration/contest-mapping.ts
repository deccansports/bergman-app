/**
 * Contest Mapping Firestore Operations (Phase 3)
 * 
 * Manages CRUD operations for contest mappings in Firestore
 * Firestore path: events/{eventId}/feibotContestMappings/{mappingId}
 */

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { FeibotContestMapping, ContestMappingRequest, ContestMappingSummary } from './contest-mapping-types';

const MAPPINGS_COLLECTION = 'feibotContestMappings';

/**
 * Create a new contest mapping
 */
export async function createContestMapping(
  eventId: string,
  connectionId: string,
  request: ContestMappingRequest,
  userId: string
): Promise<FeibotContestMapping> {
  const db = getFirestoreInstance();
  const eventRef = db.collection('events').doc(eventId);
  const mappingId = `${request.feibotContestUuid}`;
  
  const now = new Date().toISOString();
  
  const mapping: FeibotContestMapping = {
    mappingId,
    eventId,
    connectionId,
    feibotContestUuid: request.feibotContestUuid,
    feibotContestName: request.feibotContestName,
    feibotProvider: 'feibot', // Default, can be enhanced
    mappingType: request.mappingType,
    bergmanEventId: request.bergmanEventId,
    bergmanTicketId: request.bergmanTicketId,
    bergmanSubCategoryId: request.bergmanSubCategoryId,
    status: 'active',
    matchConfidence: request.matchConfidence || 100,
    matchMethod: 'manual',
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    notes: request.notes,
    validated: false,
    validationErrors: [],
  };

  await eventRef.collection(MAPPINGS_COLLECTION).doc(mappingId).set(mapping);
  return mapping;
}

/**
 * Get single mapping
 */
export async function getContestMapping(
  eventId: string,
  mappingId: string
): Promise<FeibotContestMapping | null> {
  const db = getFirestoreInstance();
  const doc = await db
    .collection('events')
    .doc(eventId)
    .collection(MAPPINGS_COLLECTION)
    .doc(mappingId)
    .get();

  return (doc.data() as FeibotContestMapping) || null;
}

/**
 * Get all mappings for event
 */
export async function listContestMappings(
  eventId: string,
  options?: { activeOnly?: boolean }
): Promise<FeibotContestMapping[]> {
  const db = getFirestoreInstance();
  let query = db
    .collection('events')
    .doc(eventId)
    .collection(MAPPINGS_COLLECTION);

  if (options?.activeOnly) {
    query = query.where('status', '==', 'active') as any;
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data() as FeibotContestMapping);
}

/**
 * Update mapping
 */
export async function updateContestMapping(
  eventId: string,
  mappingId: string,
  updates: Partial<FeibotContestMapping>
): Promise<FeibotContestMapping> {
  const db = getFirestoreInstance();
  const ref = db
    .collection('events')
    .doc(eventId)
    .collection(MAPPINGS_COLLECTION)
    .doc(mappingId);

  const updated = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await ref.update(updated);
  const doc = await ref.get();
  return (doc.data() as FeibotContestMapping);
}

/**
 * Delete mapping
 */
export async function deleteContestMapping(
  eventId: string,
  mappingId: string
): Promise<void> {
  const db = getFirestoreInstance();
  await db
    .collection('events')
    .doc(eventId)
    .collection(MAPPINGS_COLLECTION)
    .doc(mappingId)
    .delete();
}

/**
 * Get mapping summary for event
 */
export async function getContestMappingSummary(
  eventId: string
): Promise<ContestMappingSummary> {
  const db = getFirestoreInstance();
  const mappings = await listContestMappings(eventId);

  const active = mappings.filter((m) => m.status === 'active').length;
  const inactive = mappings.filter((m) => m.status === 'inactive').length;
  const pendingReview = mappings.filter((m) => m.status === 'pending-review').length;
  const total = mappings.length;

  return {
    total,
    active,
    inactive,
    pendingReview,
    mappedPercentage: total > 0 ? Math.round((active / total) * 100) : 0,
  };
}

/**
 * Batch create/update mappings
 */
export async function batchUpdateContestMappings(
  eventId: string,
  connectionId: string,
  mappings: Array<FeibotContestMapping & { delete?: boolean }>,
  userId: string
): Promise<{ created: number; updated: number; deleted: number }> {
  const db = getFirestoreInstance();
  const batch = db.batch();
  let created = 0,
    updated = 0,
    deleted = 0;

  const now = new Date().toISOString();

  for (const mapping of mappings) {
    const ref = db
      .collection('events')
      .doc(eventId)
      .collection(MAPPINGS_COLLECTION)
      .doc(mapping.mappingId);

    if (mapping.delete) {
      batch.delete(ref);
      deleted++;
    } else if (mapping.createdAt) {
      // Existing mapping
      batch.set(ref, { ...mapping, updatedAt: now }, { merge: true });
      updated++;
    } else {
      // New mapping
      batch.set(ref, {
        ...mapping,
        connectionId,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
      created++;
    }
  }

  await batch.commit();
  return { created, updated, deleted };
}

/**
 * Get mappings by connection
 */
export async function listContestMappingsByConnection(
  eventId: string,
  connectionId: string
): Promise<FeibotContestMapping[]> {
  const db = getFirestoreInstance();
  const snapshot = await db
    .collection('events')
    .doc(eventId)
    .collection(MAPPINGS_COLLECTION)
    .where('connectionId', '==', connectionId)
    .get();

  return snapshot.docs.map((doc) => doc.data() as FeibotContestMapping);
}

/**
 * Validate mapping (check 1:1 relationship)
 */
export async function validateContestMapping(
  eventId: string,
  mapping: FeibotContestMapping
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check 1:1 for Feibot contest
  const existing = await db
    .collection('events')
    .doc(eventId)
    .collection(MAPPINGS_COLLECTION)
    .where('feibotContestUuid', '==', mapping.feibotContestUuid)
    .where('status', '==', 'active')
    .get();

  if (existing.docs.length > 0 && existing.docs[0].id !== mapping.mappingId) {
    errors.push(
      `Feibot contest ${mapping.feibotContestName} already mapped to another Bergman event`
    );
  }

  // Check 1:1 for Bergman target
  if (mapping.bergmanTicketId && mapping.bergmanSubCategoryId) {
    const dupCheck = await db
      .collection('events')
      .doc(eventId)
      .collection(MAPPINGS_COLLECTION)
      .where('bergmanTicketId', '==', mapping.bergmanTicketId)
      .where('bergmanSubCategoryId', '==', mapping.bergmanSubCategoryId)
      .where('status', '==', 'active')
      .get();

    if (dupCheck.docs.length > 0 && dupCheck.docs[0].id !== mapping.mappingId) {
      errors.push(
        `Bergman ticket/subcategory already mapped to another Feibot contest`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

const db = getFirestoreInstance();
