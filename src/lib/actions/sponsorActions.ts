// src/lib/actions/sponsorActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import type { Sponsor } from '@/lib/types';
import { serializeValue } from '@/lib/utils';

export async function addSponsorAction(
  eventId: string,
  data: Omit<Sponsor, 'id' | 'createdAt'>
): Promise<{ success: boolean; message: string; sponsorId?: string }> {
  const actionName = 'addSponsorAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  if (!data.name || !data.logoUrl) {
    return { success: false, message: 'Sponsor name and logo URL are required.' };
  }

  try {
    const adminDb = getFirestoreInstance();
    const newDocRef = await adminDb.collection('events').doc(eventId).collection('sponsors').add({
      ...data,
      createdAt: FieldValue.serverTimestamp(),
    });
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Sponsor added.', sponsorId: newDocRef.id };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getSponsorsAction(eventId: string): Promise<{ success: boolean; message: string; sponsors?: Sponsor[] }> {
  const actionName = 'getSponsorsAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection('events').doc(eventId).collection('sponsors').orderBy('order', 'asc').orderBy('createdAt', 'desc').get();
    if (snapshot.empty) {
      return { success: true, message: 'No sponsors found for this event.', sponsors: [] };
    }
    const sponsors = snapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as Sponsor);
    return { success: true, message: 'Sponsors fetched.', sponsors };
  } catch (e: any) {
    if ((e as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: 'Firestore index required. Please create a composite index on the `sponsors` sub-collection.' };
    }
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function deleteSponsorAction(eventId: string, id: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteSponsorAction';
  if (!eventId || !id) {
    return { success: false, message: 'Event ID and Sponsor ID are required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    await adminDb.collection('events').doc(eventId).collection('sponsors').doc(id).delete();
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Sponsor deleted.' };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updateSponsorOrderAction(eventId: string, sponsors: { id: string; order: number }[]): Promise<{ success: boolean; message: string }> {
  const actionName = 'updateSponsorOrderAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const batch = adminDb.batch();
    sponsors.forEach(sponsor => {
        const docRef = adminDb.collection('events').doc(eventId).collection('sponsors').doc(sponsor.id);
        batch.update(docRef, { order: sponsor.order });
    });
    await batch.commit();
    revalidatePath('/admin/dashboard');
    return { success: true, message: 'Sponsor order updated.' };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updateSponsorAction(eventId: string, sponsorId: string, data: Partial<Pick<Sponsor, 'name' | 'logoUrl' | 'website' | 'type'>>): Promise<{ success: boolean, message: string }> {
    const actionName = 'updateSponsorAction';
    if (!eventId || !sponsorId) {
        return { success: false, message: "Event and Sponsor ID are required." };
    }
    try {
        const adminDb = getFirestoreInstance();
        const sponsorRef = adminDb.collection('events').doc(eventId).collection('sponsors').doc(sponsorId);
        
        const updateData: { [key: string]: any } = { ...data, updatedAt: FieldValue.serverTimestamp() };
        
        // Ensure that if a value is an empty string, it's converted to null for consistency
        (Object.keys(data) as Array<keyof typeof data>).forEach(key => {
            if (data[key] === '') {
                updateData[key] = null;
            }
        });
        
        await sponsorRef.update(updateData);

        revalidatePath('/admin/dashboard');
        const eventDoc = await adminDb.collection('events').doc(eventId).get();
        if(eventDoc.exists && eventDoc.data()?.customSlug) {
            revalidatePath(`/races/${eventDoc.data()?.customSlug}`);
        }
        
        return { success: true, message: "Sponsor details updated." };
    } catch (e: any) {
        return { success: false, message: `Failed to update sponsor: ${e.message}` };
    }
}
