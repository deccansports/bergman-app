// src/lib/actions/bibActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import type { BibAssignmentRule, EventParticipant, TicketDefinition } from '@/lib/types';
import { FieldValue, type CollectionReference } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { serializeParticipantData, toIsoStringSafe, calculateAgeGroup, serializeValue } from '../utils';
import { _mirrorParticipantToKV } from './dataSyncActions';
import { getEventParticipants } from '@/lib/dataLayerOptimized';

/**
 * CORE LOGIC: Finds the next available BIB number for an athlete.
 * Respects sub-categories for specific multi-distance events (like Swimathon).
 */
export async function assignNextAvailableBib(
  eventId: string,
  ticketId: string,
  ageCategory: string | null,
  gender: string | null,
  allEventBibs?: Set<string>,
  selectedSubCategory?: string | null
): Promise<string | null> {
  const adminDb = getFirestoreInstance();
  const eventRef = adminDb.collection('events').doc(eventId);
  let candidateRanges: Array<{ startBib: number; endBib: number }> = [];
  
  let normalizedGender: 'Male' | 'Female' | 'Any' | null = null;
  if (gender) {
    const lowerGender = gender.trim().toLowerCase();
    if (lowerGender === 'male') normalizedGender = 'Male';
    else if (lowerGender === 'female') normalizedGender = 'Female';
    else normalizedGender = 'Any';
  }

  // Normalize sub-category ID
  const finalSubCategory = (selectedSubCategory === "NONE" || !selectedSubCategory) ? null : selectedSubCategory;

  const scoreAndSelectRules = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    const scored = docs
      .map((doc) => {
        const d = doc.data() as any;
        const ageMatch = d.ageGroup === 'Any' || d.ageGroup === ageCategory;
        const genderMatch = d.gender === 'Any' || d.gender === normalizedGender;
        if (!ageMatch || !genderMatch) return null;

        const ageScore = d.ageGroup === ageCategory ? 2 : 1;
        const genderScore = d.gender === normalizedGender ? 2 : 1;
        const score = ageScore + genderScore;

        const startBib = Number(d.startBib);
        const endBib = Number(d.endBib);
        if (!Number.isFinite(startBib) || !Number.isFinite(endBib)) return null;

        return { score, startBib, endBib };
      })
      .filter(Boolean) as Array<{ score: number; startBib: number; endBib: number }>;

    if (scored.length === 0) return [] as Array<{ startBib: number; endBib: number }>;
    const bestScore = Math.max(...scored.map((r) => r.score));
    return scored
      .filter((r) => r.score === bestScore)
      .map(({ startBib, endBib }) => ({ startBib, endBib }))
      .sort((a, b) => a.startBib - b.startBib);
  };

  // 1. Try to find a rule that matches the specific Sub-Category
  if (finalSubCategory) {
    const subQuery = await eventRef.collection('bibAssignments')
        .where('ticketId', '==', ticketId)
        .where('selectedSubCategory', '==', finalSubCategory)
        .get();
    
    if (!subQuery.empty) {
        candidateRanges = scoreAndSelectRules(subQuery.docs);
    }
  }

  // 2. Fallback: Check Ticket-Wide Rules (where subcategory is not explicitly set)
  if (candidateRanges.length === 0) {
    const ticketQuery = await eventRef.collection('bibAssignments')
        .where('ticketId', '==', ticketId)
        .get();
    
    if (!ticketQuery.empty) {
        // Find rules that don't have a subcategory or match the general pool
        const validRules = ticketQuery.docs.filter(doc => {
            const d = doc.data();
            return !d.selectedSubCategory || d.selectedSubCategory === "NONE";
        });
        candidateRanges = scoreAndSelectRules(validRules);
    }
  }

      if (candidateRanges.length === 0) {
      console.warn(`[assignNextAvailableBib] No BIB rule found for Event:${eventId}, Ticket:${ticketId}, SubCat:${finalSubCategory}, Age:${ageCategory}, Gender:${normalizedGender}`);
      return null;
  }

  const isTerminalStatus = (participant: any) => {
    const combined = [
      participant?.ticketStatus,
      participant?.registrationStatus,
      participant?.status,
      participant?.paymentStatus,
    ]
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');

    return (
      combined.includes('cancel') ||
      combined.includes('defer') ||
      combined.includes('refund') ||
      combined.includes('inactive')
    );
  };
  
  const assignedNumbers = allEventBibs ?? new Set(
    (await getEventParticipants(eventId))
      .filter((participant) => !isTerminalStatus(participant))
      .map((participant) => participant?.bibNumber)
      .filter(Boolean)
      .map(String)
  );

  let bibNumber: number | null = null;
  for (const range of candidateRanges) {
    for (let i = range.startBib; i <= range.endBib; i++) {
      if (!assignedNumbers.has(String(i))) {
        bibNumber = i;
        break;
      }
    }
    if (bibNumber !== null) break;
  }

  if (!bibNumber) {
    const rangeText = candidateRanges.map((r) => `${r.startBib}-${r.endBib}`).join(', ');
    const occupiedInRange = Array.from(assignedNumbers).filter((b) => {
      const n = Number(b);
      return Number.isFinite(n) && candidateRanges.some((r) => n >= r.startBib && n <= r.endBib);
    }).length;
    console.warn(
      `[assignNextAvailableBib] Range exhausted for Event:${eventId}, Ticket:${ticketId}, SubCat:${finalSubCategory}, Range:${rangeText}, OccupiedInRange:${occupiedInRange}`
    );
  }

  return bibNumber ? bibNumber.toString() : null;
}

/**
 * ADMIN TOOL: Scans for active participants missing a BIB and re-assigns them.
 */
export async function assignMissingBibsAction(eventId: string): Promise<{ success: boolean; message: string }> {
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection('events').doc(eventId);
    
    try {
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) return { success: false, message: 'Event not found.' };
        const eventData = eventSnap.data()! as any;

        const participantsSnap = await eventRef.collection('participants').where('ticketStatus', 'in', ['Active', 'Confirmed']).get();
        const withoutBib = participantsSnap.docs.filter(doc => !doc.data().bibNumber);

        if (withoutBib.length === 0) return { success: true, message: 'All active participants already have BIB numbers.' };

        const allAssignedBibs = new Set<string>(participantsSnap.docs.map(doc => doc.data().bibNumber).filter(Boolean).map(String));
        let count = 0;

        for (const doc of withoutBib) {
            const p = doc.data() as EventParticipant;
            const ticketSnap = await eventRef.collection('ticketDefinitions').doc(p.ticketId!).get();
            const ticketData = ticketSnap.exists ? ticketSnap.data() as TicketDefinition : null;
            
            const ageGroups = ticketData?.applicableAgeGroups?.length ? ticketData.applicableAgeGroups : eventData.ageCategories;
            const { ageCategory } = calculateAgeGroup(p.dob, eventData.eventName, ageGroups);

            const newBib = await assignNextAvailableBib(eventId, p.ticketId!, ageCategory, p.gender || null, allAssignedBibs, p.selectedSubCategory);
            if (newBib) {
                await doc.ref.update({ bibNumber: newBib, updatedAt: FieldValue.serverTimestamp() });
                allAssignedBibs.add(newBib);
                const updatedSnap = await doc.ref.get();
                await _mirrorParticipantToKV(serializeParticipantData(updatedSnap));
                count++;
            }
        }

        revalidatePath('/admin/dashboard');
        return { success: true, message: `Successfully assigned ${count} missing BIB numbers.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

/**
 * ADMIN TOOL: Resolves BIB conflicts.
 */
export async function reassignDuplicateBibsAction(eventId: string): Promise<{ success: boolean; message: string }> {
    const adminDb = getFirestoreInstance();
    const eventRef = adminDb.collection('events').doc(eventId);
    
    try {
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) return { success: false, message: 'Event not found.' };
        const eventData = eventSnap.data()! as any;

        const participantsSnap = await eventRef.collection('participants').where('ticketStatus', 'in', ['Active', 'Confirmed']).get();
        const bibMap = new Map<string, string[]>();

        participantsSnap.forEach(doc => {
            const bib = doc.data().bibNumber;
            if (bib) {
                if (!bibMap.has(bib)) bibMap.set(bib, []);
                bibMap.get(bib)!.push(doc.id);
            }
        });

        let count = 0;
        const allAssignedBibs = new Set<string>(participantsSnap.docs.map(doc => doc.data().bibNumber).filter(Boolean).map(String));

        for (const [bib, docIds] of Array.from(bibMap.entries())) {
            if (docIds.length > 1) {
                const duplicates = docIds.slice(1);
                for (const id of duplicates) {
                    const doc = participantsSnap.docs.find(d => d.id === id)!;
                    const p = doc.data() as EventParticipant;
                    const ticketSnap = await eventRef.collection('ticketDefinitions').doc(p.ticketId!).get();
                    const ticketData = ticketSnap.exists ? ticketSnap.data() as TicketDefinition : null;
                    const ageGroups = ticketData?.applicableAgeGroups?.length ? ticketData.applicableAgeGroups : eventData.ageCategories;
                    const { ageCategory } = calculateAgeGroup(p.dob, eventData.eventName, ageGroups);

                    const newBib = await assignNextAvailableBib(eventId, p.ticketId!, ageCategory, p.gender || null, allAssignedBibs, p.selectedSubCategory);
                    if (newBib) {
                        await doc.ref.update({ bibNumber: newBib, updatedAt: FieldValue.serverTimestamp() });
                        allAssignedBibs.add(newBib);
                        const updatedSnap = await doc.ref.get();
                        await _mirrorParticipantToKV(serializeParticipantData(updatedSnap));
                        count++;
                    }
                }
            }
        }

        revalidatePath('/admin/dashboard');
        return { success: true, message: `Successfully resolved ${count} duplicate BIB numbers.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function getBibAssignmentsForTicketAction(
  eventId: string,
  ticketId: string,
  selectedSubCategory?: string | null
): Promise<{ success: boolean; message: string; assignments?: BibAssignmentRule[] }> {
  const adminDb = getFirestoreInstance();
  const finalSubId = (selectedSubCategory === "NONE" || !selectedSubCategory) ? null : selectedSubCategory;
  try {
    const snapshot = await adminDb.collection('events').doc(eventId).collection('bibAssignments')
      .where('ticketId', '==', ticketId)
      .where('selectedSubCategory', '==', finalSubId)
      .get();
    
    const assignments: BibAssignmentRule[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: toIsoStringSafe(doc.data().createdAt) || undefined,
    } as BibAssignmentRule));

    assignments.sort((a,b) => a.startBib - b.startBib);

    return serializeValue({ success: true, message: 'Fetched', assignments });
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * UPDATED: Process saves and deletions in one batch.
 */
export async function saveBibAssignmentsAction(
  eventId: string,
  ticketId: string,
  selectedSubCategory: string | null,
  assignments: Partial<BibAssignmentRule>[]
): Promise<{ success: boolean; message: string; assignments?: BibAssignmentRule[] }> {
  const adminDb = getFirestoreInstance();
  const batch = adminDb.batch();
  const colRef = adminDb.collection('events').doc(eventId).collection('bibAssignments');
  const finalSubId = (selectedSubCategory === "NONE" || !selectedSubCategory) ? null : selectedSubCategory;
  
  try {
    // 1. Fetch current rules to identify deletions
    const currentSnap = await colRef
      .where('ticketId', '==', ticketId)
      .where('selectedSubCategory', '==', finalSubId)
      .get();

    const incomingIds = new Set(assignments.map(a => a.id).filter(Boolean));

    // 2. Queue deletions for records no longer present
    currentSnap.forEach(doc => {
      if (!incomingIds.has(doc.id)) {
        batch.delete(doc.ref);
      }
    });

    // 3. Process additions and updates
    for (const a of assignments) {
      const { id, ...data } = a;
      if (id) {
        batch.update(colRef.doc(id), { 
          ...data, 
          ticketId, 
          selectedSubCategory: finalSubId, 
          updatedAt: FieldValue.serverTimestamp() 
        });
      } else {
        batch.set(colRef.doc(), { 
          ...data, 
          ticketId, 
          selectedSubCategory: finalSubId, 
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp() 
        });
      }
    }

    await batch.commit();
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'BIB Rules updated successfully.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function cloneBibAssignmentsAction(
  sE: string, 
  sT: string, 
  tE: string, 
  tT: string, 
  targetSubCategoryId?: string | null
) {
    const db = getFirestoreInstance();
    const batch = db.batch();
    const finalSubId = (targetSubCategoryId === "NONE" || !targetSubCategoryId) ? null : targetSubCategoryId;

    try {
        const snap = await db.collection('events').doc(sE).collection('bibAssignments').where('ticketId', '==', sT).get();
        if (snap.empty) return { success: false, message: 'Source ticket has no BIB rules to clone.' };

        snap.docs.forEach(doc => {
            const data = doc.data();
            // Map the cloned rule to the target ticket and the CURRENT target sub-category context
            const newRule = {
                ...data,
                ticketId: tT,
                selectedSubCategory: finalSubId,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            };
            batch.set(db.collection('events').doc(tE).collection('bibAssignments').doc(), newRule);
        });
        await batch.commit();
        revalidatePath('/admin/dashboard');
        return { success: true, message: `Cloned ${snap.size} rules successfully.` };
    } catch (e: any) { 
        return { success: false, message: e.message }; 
    }
}
