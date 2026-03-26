// src/lib/actions/participantActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { EventParticipant, TicketDefinition, User } from '@/lib/types';
import { serializeParticipantData, calculateAgeGroup, serializeValue } from '@/lib/utils';
import { _mirrorParticipantToKV, _deleteParticipantFromKV } from './dataSyncActions';
import { assignNextAvailableBib } from './bibActions';
import { revalidatePath } from 'next/cache';
import { sendAthleteCategoryChangeEmail, sendAdminCategoryChangeNotificationEmail } from '../auth/brevoService';
import { sendCategoryChangeNoticeWhatsApp } from '../auth/aisensyService';

export async function getParticipantsForEventAction(eventId: string): Promise<{ success: boolean; message: string; participants?: EventParticipant[] }> {
  try {
    const adminDb = getFirestoreInstance();
    const participantsSnap = await adminDb.collection('events').doc(eventId).collection('participants').get();
    const participants = participantsSnap.docs.map(doc => serializeParticipantData(doc));
    return { success: true, message: 'Participants fetched.', participants };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function createEventTicketOrderAction(data: any): Promise<{ success: boolean; message: string; orderId?: string }> {
  try {
    const adminDb = getFirestoreInstance();
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
  lastId: string | null = null
): Promise<{ success: boolean; message: string; participants?: any[]; lastId?: string; totalCount?: number }> {
  try {
    const db = getFirestoreInstance();
    const colRef = db.collection('events').doc(eventId).collection('participants');
    
    const totalSnap = await colRef.count().get();
    let query = colRef.orderBy('registeredAt', 'desc').limit(pageSize);

    if (lastId) {
      const lastDoc = await colRef.doc(lastId).get();
      if (lastDoc.exists) {
        query = query.startAfter(lastDoc);
      }
    }

    const snapshot = await query.get();
    const participants = snapshot.docs.map(doc => serializeParticipantData(doc));
    
    return {
      success: true,
      message: 'Fetched.',
      participants: serializeValue(participants),
      lastId: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : undefined,
      totalCount: totalSnap.data().count
    };
  } catch (e: any) {
    console.error("[getParticipantsPaginatedAction] Error:", e.message);
    return { success: false, message: e.message, participants: [] }; 
  }
}

export async function updateParticipantInEventAction(
  eventId: string,
  participantId: string,
  data: any
): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const ref = db.collection('events').doc(eventId).collection('participants').doc(participantId);
    
    const cleanData = { ...data };
    if (cleanData.updatedAt) delete cleanData.updatedAt;

    await ref.update({
      ...cleanData,
      updatedAt: FieldValue.serverTimestamp()
    });

    const updated = await ref.get();
    await _mirrorParticipantToKV(serializeParticipantData(updated));
    
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
    const ref = db.collection('events').doc(eventId).collection('participants').doc(participantId);
    await ref.update({ ticketStatus: status, updatedAt: FieldValue.serverTimestamp() });
    
    const updated = await ref.get();
    await _mirrorParticipantToKV(serializeParticipantData(updated));
    
    return { success: true, message: 'Status updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteParticipantFromEventAction(eventId: string, id: string) {
  try {
    const db = getFirestoreInstance();
    const ref = db.collection('events').doc(eventId).collection('participants').doc(id);
    const snap = await ref.get();
    
    if (snap.exists) {
        const p = snap.data()!;
        const bookingId = p.bookingId || id;
        const athleteUid = p.athleteUid || null;
        
        await ref.delete();
        
        // 🔥 SYNC CLEANUP (GHOST REGISTRATION FIX)
        await _deleteParticipantFromKV(eventId, bookingId, athleteUid);
    }

    revalidatePath('/admin/dashboard');
    revalidatePath('/dashboard');
    return { success: true, message: 'Deleted.' };
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
    const participantRef = eventRef.collection('participants').doc(id);
    
    const [pSnap, eventSnap, tSnap] = await Promise.all([
        participantRef.get(),
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

export async function checkParticipantRegistrationByEmail(eventId: string, email: string): Promise<{ success: boolean; isRegistered: boolean; registeredDates?: string[] }> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('events').doc(eventId).collection('participants')
      .where('email', '==', email.toLowerCase())
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

        const res = await eventRef.collection('participants').add({
            ...pData,
            ticketName: tData.ticketName,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
        
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

        const res = await eventRef.collection('participants').add({
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
        });

        const updated = await res.get();
        await _mirrorParticipantToKV(serializeParticipantData(updated));

        return { success: true, id: res.id };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
