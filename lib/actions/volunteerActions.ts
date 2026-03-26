
// src/lib/actions/volunteerActions.ts
'use server';

import { getFirestoreInstance, getAuthInstance } from '@/lib/firebaseAdmin';
import type { EventParticipant, User, VolunteerStats, EventCalendarEntry, TicketDefinition, PaidFoodCoupon, PaidFoodOrder, ParticipantWithProfile, LoopLog } from '@/lib/types';
import { serializeValue, serializeParticipantDataUtil } from '@/lib/utils';
import { FieldValue, Timestamp, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { format as formatDateFns, parseISO } from 'date-fns';
import { sendBikeCheckInConfirmationWhatsApp, sendLockerAssignmentWhatsApp, sendLockerReturnConfirmationWhatsApp, sendBikeCheckOutConfirmationWhatsApp, sendBikeCheckoutReminderWhatsApp } from '../auth/aisensyService';
import { CreateVolunteerUserActionSchema, type CreateVolunteerUserActionInput } from '@/lib/schemas';
import { updateInventoryStockAction } from '@/lib/actions/inventoryActions';
import { sendLockerAssignmentEmail, sendLockerReturnConfirmationEmail } from '@/lib/auth/brevoService';
import { resetFoodCouponAction } from './paidFoodActions';


export async function searchParticipantsForCheckInAction(
    eventId: string,
    searchTerm: string,
    searchBy: 'bibNumber' | 'mobile' | 'email' | 'name'
): Promise<{ success: boolean; message: string; participant?: ParticipantWithProfile, participants?: ParticipantWithProfile[] }> {
    const actionName = 'searchParticipantsForCheckInAction';
    let adminDb: Firestore;
    try {
        adminDb = getFirestoreInstance();
        const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
        
        let query: FirebaseFirestore.Query;
        
        switch (searchBy) {
            case 'bibNumber':
                query = participantsRef.where('bibNumber', '==', searchTerm).limit(1);
                break;
            case 'mobile':
                query = participantsRef.where('mobile', '==', searchTerm).limit(1);
                break;
            case 'email':
                query = participantsRef.where('email', '==', searchTerm.toLowerCase()).limit(1);
                break;
            case 'name':
                const searchTermCapitalized = searchTerm.charAt(0).toUpperCase() + searchTerm.slice(1).toLowerCase();
                query = participantsRef.where('nameLower', '>=', searchTerm.toLowerCase()).where('nameLower', '<=', searchTerm.toLowerCase() + '\uf8ff').limit(10);
                break;
            default:
                return { success: false, message: "Invalid search field." };
        }
    
        const snapshot = await query.get();
        
        if (snapshot.empty) {
             return { success: false, message: `No participant found for ${searchBy}: ${searchTerm}.` };
        }
        
        const participantsDataPromises = snapshot.docs.map(async (doc: DocumentSnapshot) => {
            let participantData = serializeParticipantDataUtil(doc);
            if (participantData.athleteUid) {
                const userSnap = await adminDb.collection('users').doc(participantData.athleteUid).get();
                if(userSnap.exists) {
                    participantData.userProfile = serializeValue(userSnap.data()) as User; // Serialize the user profile
                }
            }
             if (participantData.ticketId) {
                const ticketRef = adminDb.collection('events').doc(eventId).collection('ticketDefinitions').doc(participantData.ticketId);
                const ticketSnap = await ticketRef.get();
                if (ticketSnap.exists) {
                    const ticketData = ticketSnap.data() as TicketDefinition;
                    participantData.isEligibleForFinisherJersey = ticketData.hasFinisherJersey || false;
                }
            }
            return participantData as ParticipantWithProfile;
        });

        const participantsData = await Promise.all(participantsDataPromises);

        if (searchBy === 'name' && participantsData.length > 1) {
             return { success: true, message: `Found ${participantsData.length} participants.`, participants: participantsData };
        }
        
        return { success: true, message: "Participant found.", participant: participantsData[0] };

    } catch (e: any) {
        console.error(`[${actionName}] Error: ${e.message}`, e);
        if (e.code === 'FAILED_PRECONDITION') {
            return { success: false, message: `Search failed. A database index is required for this query. Please check your Firestore indexes configuration.` };
        }
        return { success: false, message: `Search failed: ${e.message}` };
    }
}


export async function searchParticipantForBikeAction(
    eventId: string,
    searchTerm: string,
    searchBy: 'bibNumber' | 'mobile' | 'email'
): Promise<{ success: boolean; message: string; participant?: EventParticipant }> {
    const actionName = 'searchParticipantForBikeAction';
    let adminDb: Firestore;
    try {
        adminDb = getFirestoreInstance();
        const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
        let query;

        switch (searchBy) {
            case 'bibNumber':
                query = participantsRef.where('bibNumber', '==', searchTerm);
                break;
            case 'mobile':
                query = participantsRef.where('mobile', '==', searchTerm);
                break;
            case 'email':
                query = participantsRef.where('email', '==', searchTerm.toLowerCase());
                break;
            default:
                return { success: false, message: "Invalid search field for bike check-in." };
        }
        
        const snapshot = await query.limit(1).get();
        if (snapshot.empty) {
            return { success: false, message: `No participant found for ${searchBy}: ${searchTerm}.` };
        }
        
        const participantDoc = snapshot.docs[0];
        const participantData = serializeParticipantDataUtil(participantDoc);

        return { success: true, message: "Participant found.", participant: participantData };
    } catch (e: any) {
        return { success: false, message: `Search failed: ${e.message}` };
    }
}

export async function bikeCheckInAction(eventId: string, participantId: string, clientTimestamp?: string, remarks?: string, helmetChecked?: boolean, pumpChecked?: boolean): Promise<{ success: boolean; message: string }> {
  const actionName = 'bikeCheckInAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
    
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
        return { success: false, message: "Participant not found." };
    }
    const participantData = participantSnap.data() as EventParticipant;
    if (participantData.checkInStatus !== 'CheckedIn') {
        return { success: false, message: "Waiver check-in must be completed first." };
    }
    if (participantData.bikeCheckInStatus === 'CheckedIn') {
        return { success: false, message: "This bike has already been checked in." };
    }

    const checkInTime = clientTimestamp ? new Date(clientTimestamp) : new Date();
    await participantRef.update({
      bikeCheckInStatus: 'CheckedIn',
      bikeCheckedInAt: checkInTime,
      bikeCheckInDetails: {
        remarks: remarks || null,
        helmetChecked: helmetChecked || false,
        pumpChecked: false, // Field removed from UI, hardcode to false
      }
    });
    
    const istCheckInTime = new Date(checkInTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    if (participantData.mobile && participantData.eventName) {
        try {
            await sendBikeCheckInConfirmationWhatsApp(
                participantData.mobile,
                participantData.name,
                formatDateFns(istCheckInTime, 'MMM dd, yyyy'),
                formatDateFns(istCheckInTime, 'p'),
                participantData.eventName
            );
        } catch (notificationError: any) {
            console.warn(`[${actionName}] Bike check-in was successful, but WhatsApp notification failed: ${notificationError.message}`);
        }
    }
    
    revalidatePath('/volunteer/dashboard');
    return { success: true, message: "Bike checked in successfully." };
  } catch (e: any) {
    return { success: false, message: `Bike check-in failed: ${e.message}` };
  }
}

export async function manualBikeCheckOutAction(
    eventId: string,
    participantId: string,
    volunteerId: string,
    volunteerName: string,
    receiverName: string | null,
    receiverMobile: string | null
): Promise<{ success: boolean; message: string }> {
    const actionName = 'manualBikeCheckOutAction';
    let adminDb: Firestore;
    try {
        adminDb = getFirestoreInstance();
        const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
        const participantSnap = await participantRef.get();
        if (!participantSnap.exists) {
            return { success: false, message: "Participant not found." };
        }
        
        const participantData = participantSnap.data() as EventParticipant;
        const eventSnap = await adminDb.collection('events').doc(eventId).get();
        const eventName = eventSnap.data()?.eventName || 'the event';
        const checkedOutAt = new Date();

        const updatePayload: any = {
            bikeCheckOutStatus: 'CheckedOut',
            bikeCheckedOutAt: checkedOutAt,
            bikeCheckedOutManuallyBy: {
                uid: volunteerId,
                name: volunteerName,
            },
        };
        
        if (receiverName && receiverMobile) {
            updatePayload.bikeCheckedOutManuallyTo = {
                name: receiverName,
                mobile: receiverMobile,
            };
        } else {
            // If collected by athlete, we don't need to store 'to' details
            updatePayload.bikeCheckedOutManuallyTo = null;
        }

        await participantRef.update(updatePayload);
        
        // Send WhatsApp notification
        if (participantData.mobile) {
            const istCheckedOutAt = new Date(checkedOutAt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            await sendBikeCheckOutConfirmationWhatsApp(
                participantData.mobile,
                participantData.name,
                formatDateFns(istCheckedOutAt, 'MMM dd, yyyy'),
                formatDateFns(istCheckedOutAt, 'p'),
                eventName
            );
        }
        
        revalidatePath('/volunteer/dashboard');
        return { success: true, message: "Bike manually checked out successfully and notification sent." };

    } catch (e: any) {
        console.error(`[${actionName}] Error manually checking out bike for participant ${participantId}: ${e.message}`);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}

export async function sendBikeCheckoutReminderAction(
  participantId: string,
  eventId: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'sendBikeCheckoutReminderAction';
  if (!participantId || !eventId) {
    return { success: false, message: 'Participant and Event ID are required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return { success: false, message: 'Participant not found.' };
    }
    const participant = participantSnap.data() as EventParticipant;

    if (!participant.mobile) {
      return { success: false, message: 'Participant has no mobile number for reminder.' };
    }
    if (!participant.bibNumber) {
        return { success: false, message: 'Participant has no BIB number.'};
    }
    
    const result = await sendBikeCheckoutReminderWhatsApp(participant.mobile, participant.name, participant.bibNumber);
    if (result.success) {
      // Also update notification count
      await participantRef.update({
        'notificationsSent.bikeCheckoutReminder.count': FieldValue.increment(1),
        'notificationsSent.bikeCheckoutReminder.dates': FieldValue.arrayUnion(new Date().toISOString()),
      });
      return { success: true, message: 'Reminder sent.' };
    } else {
      return { success: false, message: result.message || 'Failed to send reminder.' };
    }
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getCheckInStatsForEventAction(
  eventId: string
): Promise<{ success: boolean; message: string; stats?: { totalParticipants: number, checkedInCount: number, remainingCount: number } }> {
  const actionName = 'getCheckInStatsForEventAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    if (!eventId) return { success: false, message: "Event ID is required." };
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    const totalSnapshot = await participantsRef.where('ticketStatus', '==', 'Active').count().get();
    const checkedInSnapshot = await participantsRef.where('checkInStatus', '==', 'CheckedIn').count().get();
    const totalParticipants = totalSnapshot.data().count;
    const checkedInCount = checkedInSnapshot.data().count;
    const remainingCount = totalParticipants - checkedInCount;
    return { success: true, message: "Stats fetched.", stats: { totalParticipants, checkedInCount, remainingCount } };
  } catch (e: any) {
    console.error(`[${actionName}] Error fetching stats for event ${eventId}: ${e.message}`, e);
    return { success: false, message: `Failed to fetch check-in stats: ${e.message}` };
  }
}

export async function getVolunteerStatsAction(): Promise<{ success: boolean; message: string; stats?: VolunteerStats }> {
    const actionName = 'getVolunteerStatsAction';
    let adminDb: Firestore;
    try {
      adminDb = getFirestoreInstance();
      const volunteersSnapshot = await adminDb.collection('users').where('isVolunteer', '==', true).get();
  
      if (volunteersSnapshot.empty) {
        return { success: true, message: "No volunteers found.", stats: { totalVolunteers: 0, volunteersAssignedToAnyEvent: 0, volunteersCurrentlyUnassigned: 0 } };
      }
  
      const totalVolunteers = volunteersSnapshot.size;
      let volunteersAssignedToAnyEvent = 0;
  
      volunteersSnapshot.forEach(doc => {
        if (doc.data().assignedEventId) {
          volunteersAssignedToAnyEvent++;
        }
      });
  
      const volunteersCurrentlyUnassigned = totalVolunteers - volunteersAssignedToAnyEvent;
  
      return { success: true, message: "Volunteer stats fetched.", stats: { totalVolunteers, volunteersAssignedToAnyEvent, volunteersCurrentlyUnassigned } };
    } catch (e: any) {
      console.error(`[${actionName}] Error: ${e.message}`, e);
      return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
    }
}
  
export async function getAllVolunteersAction(): Promise<{ success: boolean; message: string; volunteers?: User[] }> {
    const actionName = 'getAllVolunteersAction';
    try {
        const adminDb = getFirestoreInstance();
        const snapshot = await adminDb.collection('users').where('isVolunteer', '==', true).orderBy('name', 'asc').get();
        if (snapshot.empty) {
            return { success: true, message: "No volunteers found.", volunteers: [] };
        }
        const volunteers = snapshot.docs.map(doc => {
            const data = doc.data();
            // Create a plain object to avoid passing non-serializable data
            const plainData: any = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    const value = data[key];
                    if (value instanceof Timestamp) {
                        plainData[key] = value.toDate().toISOString();
                    } else if (value !== undefined) {
                        plainData[key] = value;
                    }
                }
            }
            return { ...plainData, uid: doc.id } as User;
        });
        return { success: true, message: "Volunteers fetched.", volunteers: volunteers };
    } catch (e: any) {
        if ((e as any).code === 'FAILED_PRECONDITION') {
            return { success: false, message: "A database index is required for this query. Please check your Firestore indexes configuration." };
        }
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}
  
export async function assignVolunteerToEventAction(userId: string, isVolunteer: boolean, eventId: string | null, eventName: string | null, eventDate: string | null, assignedCounters: string[] | null): Promise<{ success: boolean; message: string }> {
    const actionName = 'assignVolunteerToEventAction';
    try {
        const adminDb = getFirestoreInstance();
        const userRef = adminDb.collection('users').doc(userId);
        await userRef.update({
            isVolunteer: isVolunteer,
            assignedEventId: eventId || null,
            assignedEventName: eventName || null,
            assignedEventDate: eventDate || null,
            assignedCounter: assignedCounters || null,
            updatedAt: FieldValue.serverTimestamp(),
        });
        revalidatePath('/admin/dashboard');
        return { success: true, message: "Volunteer assignment updated successfully." };
    } catch (e: any) {
        return { success: false, message: `Assignment failed: ${e.message}` };
    }
}
  
export async function removeVolunteerAssignmentAction(userId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'removeVolunteerAssignmentAction';
    try {
        const adminDb = getFirestoreInstance();
        await adminDb.collection('users').doc(userId).update({
            isVolunteer: false,
            assignedEventId: FieldValue.delete(),
            assignedEventName: FieldValue.delete(),
            assignedEventDate: FieldValue.delete(),
            assignedCounter: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        revalidatePath('/admin/dashboard');
        return { success: true, message: "Volunteer role and assignments removed." };
    } catch (e: any) {
        return { success: false, message: `Removal failed: ${e.message}` };
    }
}
  
export async function createAndAssignVolunteerAction(data: CreateVolunteerUserActionInput): Promise<{ success: boolean; message: string; userId?: string }> {
    const actionName = 'createAndAssignVolunteerAction';
    try {
        const validation = CreateVolunteerUserActionSchema.safeParse(data);
        if (!validation.success) {
            return { success: false, message: validation.error.errors[0]?.message || "Invalid input." };
        }
        const { name, email, mobile, password, assignedEventId, assignedCounter } = validation.data;

        const e164MobileRegex = /^\+[1-9]\d{1,14}$/;
        if (!e164MobileRegex.test(mobile)) {
          return { success: false, message: "Mobile number must be a valid E.164 string (e.g., +919876543210)." };
        }

        const adminAuth = getAuthInstance();
        const adminDb = getFirestoreInstance();
        const newUserRecord = await adminAuth.createUser({ email, password, displayName: name, phoneNumber: mobile });
        const assignedEventSnap = assignedEventId ? await adminDb.collection('events').doc(assignedEventId).get() : null;
        await adminDb.collection('users').doc(newUserRecord.uid).set({
            uid: newUserRecord.uid, name, email, mobile, isVolunteer: true,
            assignedEventId: assignedEventId || null,
            assignedEventName: assignedEventSnap?.data()?.eventName || null,
            assignedEventDate: assignedEventSnap?.data()?.eventDate || null,
            assignedCounter: assignedCounter || null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        revalidatePath('/admin/dashboard');
        return { success: true, message: `Volunteer ${name} created and assigned.`, userId: newUserRecord.uid };
    } catch (e: any) {
        if ((e as any).code === 'auth/email-already-exists') {
            return { success: false, message: "A user with this email already exists." };
        }
        if (String(e).toLowerCase().includes('phone number')) {
           return { success: false, message: "Volunteer creation failed: The phone number must be a non-empty E.164 standard compliant string (e.g., +919876543210)." };
        }
        return { success: false, message: `Volunteer creation failed: ${e.message}` };
    }
}


export async function getCheckedInParticipantsForEventAction(
    eventId: string,
    filter: { counter?: string, searchTerm?: string, searchBy?: 'name' | 'bibNumber' | 'email' }
): Promise<{ success: boolean, message: string, participants?: EventParticipant[] }> {
    const actionName = 'getCheckedInParticipantsForEventAction';
    let adminDb: Firestore;
    try {
        adminDb = getFirestoreInstance();
        if (!eventId) return { success: false, message: "Event ID is required." };

        let baseQuery: FirebaseFirestore.Query = adminDb.collection('events').doc(eventId).collection('participants')
            .where('checkInStatus', '==', 'CheckedIn')
            .orderBy('checkedInAt', 'desc');

        const snapshot = await baseQuery.get();

        if (snapshot.empty) {
            return { success: true, message: "No checked-in participants found for this event.", participants: [] };
        }
        
        let participantsData = snapshot.docs.map(doc => serializeParticipantDataUtil(doc));

        // Apply filters in memory
        if (filter.counter) {
            participantsData = participantsData.filter(p => p.checkInCounter === filter.counter);
        }
        
        if (filter.searchTerm && filter.searchBy) {
            const lowerSearchTerm = filter.searchTerm.toLowerCase();
            participantsData = participantsData.filter(p => {
                const searchFieldValue = p[filter.searchBy as keyof EventParticipant];
                if (typeof searchFieldValue === 'string') {
                    return searchFieldValue.toLowerCase().includes(lowerSearchTerm);
                } else if (searchFieldValue !== null && searchFieldValue !== undefined) {
                    return String(searchFieldValue).toLowerCase().includes(lowerSearchTerm);
                }
                return false;
            });
        }
        
        return { success: true, message: "Checked-in participants fetched.", participants: participantsData };
    } catch (e: any) {
         if ((e as any).code === 'FAILED_PRECONDITION') {
            return { success: false, message: `Search failed. A database index is required for this query. Please check your Firestore indexes configuration.` };
        }
        return { success: false, message: `Failed to fetch log: ${e.message}` };
    }
}

export async function resetParticipantCheckInStatusAction(
    eventId: string,
    participantId: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'resetParticipantCheckInStatusAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
        
        await participantRef.update({
            checkInStatus: FieldValue.delete(),
            checkedInAt: FieldValue.delete(),
            checkedInByVolunteerId: FieldValue.delete(),
            checkedInByVolunteerName: FieldValue.delete(),
            checkInCounter: FieldValue.delete(),
            bikeCheckInStatus: FieldValue.delete(),
            bikeCheckedInAt: FieldValue.delete(),
            bikeCheckOutStatus: FieldValue.delete(),
            bikeCheckedOutAt: FieldValue.delete(),
            bikeCheckedOutManuallyBy: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        revalidatePath('/admin/dashboard');
        return { success: true, message: "Participant check-in status has been reset." };

    } catch (e: any) {
        return { success: false, message: `Failed to reset status: ${e.message}` };
    }
}

export async function resetBikeCheckInAction(
    eventId: string,
    participantId: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'resetBikeCheckInAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
        await participantRef.update({
            bikeCheckInStatus: FieldValue.delete(),
            bikeCheckedInAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        revalidatePath('/admin/dashboard');
        revalidatePath('/volunteer/dashboard');
        return { success: true, message: "Bike check-in has been reset." };
    } catch (e: any) {
        return { success: false, message: `Failed to reset bike check-in: ${e.message}` };
    }
}

export async function markItemIssuedAction(
  eventId: string,
  participantId: string,
  itemType: 'Medal' | 'Finisher Jersey' | 'Food' | 'Breakfast' | 'Lunch'
): Promise<{ success: boolean; message: string }> {
  const actionName = 'markItemIssuedAction';
  let adminDb: Firestore;
  try {
    const adminDb = getFirestoreInstance();
    const participantRef = adminDb
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return { success: false, message: 'Participant not found.' };
    }
    const participant = serializeParticipantDataUtil(participantSnap);

    const updatePayload: { [key: string]: any } = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    let inventoryKey: string | null = null;
    let inventoryItemType: 'Medal' | 'Finisher Jersey' | 'T-Shirt' | 'Breakfast' | 'Lunch' | null = null;
    let genderForInventory: 'Male' | 'Female' | 'Other' | undefined = undefined;

    switch (itemType) {
      case 'Medal':
        if (participant.medalIssued) return { success: false, message: 'Medal already marked as issued.' };
        if (!participant.ticketName) return { success: false, message: 'Participant ticket category not found for inventory.' };
        updatePayload.medalIssued = true;
        inventoryItemType = 'Medal'; inventoryKey = participant.ticketName;
        break;
      case 'Finisher Jersey':
        if (participant.finisherJerseyIssued) return { success: false, message: 'Finisher Jersey already marked as issued.' };
        if (!participant.tshirtSize || !participant.gender || !participant.ticketName) return { success: false, message: 'Participant T-Shirt size, gender, or ticket category is missing.' };
        updatePayload.finisherJerseyIssued = true;
        inventoryItemType = 'Finisher Jersey'; inventoryKey = `${participant.ticketName}_${participant.tshirtSize}_${participant.gender}`;
        genderForInventory = participant.gender as 'Male' | 'Female' | 'Other';
        break;
      case 'Breakfast':
        if (participant.breakfastIssued || participant.lunchIssued) return { success: false, message: 'A meal has already been issued to this participant.' };
        updatePayload.breakfastIssued = true;
        break;
      case 'Lunch':
        if (participant.breakfastIssued || participant.lunchIssued) return { success: false, message: 'A meal has already been issued to this participant.' };
        updatePayload.lunchIssued = true;
        break;
      case 'Food': // Kept for backward compatibility
        if (participant.foodIssued) return { success: false, message: 'Food plate already marked as issued.' };
        updatePayload.foodIssued = true;
        break;
    }

    // Update participant doc
    await participantRef.update(updatePayload);

    // Update inventory if applicable
    if (inventoryItemType && inventoryKey && (inventoryItemType === 'Medal' || inventoryItemType === 'Finisher Jersey')) {
      await updateInventoryStockAction(eventId, inventoryItemType, inventoryKey, 1, 'issued', 'increment', genderForInventory);
    }
    
    revalidatePath('/volunteer/dashboard');
    revalidatePath('/admin/dashboard');
    return {
      success: true,
      message: `${itemType} marked as issued for ${participant.name}.`,
    };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}


export async function updateParticipantTshirtSizeAction(
  eventId: string,
  participantId: string,
  newSize: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'updateParticipantTshirtSizeAction';
  try {
    const adminDb = getFirestoreInstance();
    const participantRef = adminDb
      .collection('events')
      .doc(eventId)
      .collection('participants')
      .doc(participantId);
    
    await participantRef.update({
      tshirtSize: newSize,
      updatedAt: FieldValue.serverTimestamp(),
    });
    
    revalidatePath(`/volunteer/dashboard`);
    revalidatePath(`/admin/dashboard`);
    return { success: true, message: 'T-Shirt size updated successfully.' };

  } catch (error: any) {
    console.error(`[${actionName}] Failed to update T-shirt size:`, error);
    return { success: false, message: `Failed to update T-shirt size: ${error.message}` };
  }
}

export async function resetIssuedItemStatusAction(
  eventId: string,
  participantId: string,
  itemType: 'Medal' | 'Finisher Jersey' | 'Food' | 'Breakfast' | 'Lunch'
): Promise<{ success: boolean; message: string }> {
  const actionName = 'resetIssuedItemStatusAction';
  if (!eventId || !participantId || !itemType) {
    return { success: false, message: "Event, Participant, and Item Type are required." };
  }

  try {
    const adminDb = getFirestoreInstance();
    const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return { success: false, message: "Participant not found." };
    }
    const participant = serializeParticipantDataUtil(participantSnap);

    const updatePayload: { [key: string]: any } = { updatedAt: FieldValue.serverTimestamp() };
    let inventoryKey: string | null = null;
    let inventoryItemType: 'Medal' | 'Finisher Jersey' | 'Breakfast' | 'Lunch' | null = null;
    let genderForInventory: 'Male' | 'Female' | 'Other' | undefined = undefined;

    switch (itemType) {
      case 'Medal':
        if (!participant.medalIssued) return { success: true, message: "Medal was not marked as issued." };
        updatePayload.medalIssued = FieldValue.delete();
        if (participant.ticketName) {
          inventoryItemType = 'Medal'; inventoryKey = participant.ticketName;
        }
        break;
      case 'Finisher Jersey':
        if (!participant.finisherJerseyIssued) return { success: true, message: "Jersey was not marked as issued." };
        updatePayload.finisherJerseyIssued = FieldValue.delete();
        if (participant.tshirtSize && participant.gender && participant.ticketName) {
          inventoryItemType = 'Finisher Jersey'; inventoryKey = `${participant.ticketName}_${participant.tshirtSize}_${participant.gender}`;
          genderForInventory = participant.gender as any;
        }
        break;
      case 'Breakfast':
          if (!participant.breakfastIssued) return { success: true, message: "Breakfast was not issued." };
          updatePayload.breakfastIssued = FieldValue.delete();
          break;
      case 'Lunch':
          if (!participant.lunchIssued) return { success: true, message: "Lunch was not issued." };
          updatePayload.lunchIssued = FieldValue.delete();
          break;
      default:
        // Handle 'Food' for backward compatibility
        if (!participant.foodIssued) return { success: true, message: "Food was not marked as issued." };
        updatePayload.foodIssued = FieldValue.delete();
        break;
    }

    await participantRef.update(updatePayload);

    if (inventoryItemType && inventoryKey && (inventoryItemType === 'Medal' || inventoryItemType === 'Finisher Jersey')) {
      await updateInventoryStockAction(eventId, inventoryItemType, inventoryKey, -1, 'issued', 'increment', genderForInventory);
    }
    
    revalidatePath('/admin/dashboard');
    revalidatePath('/volunteer/dashboard');
    return { success: true, message: `${itemType} status has been reset for ${participant.name}.` };

  } catch (e: any) {
    console.error(`[${actionName}] Error resetting item status:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function assignLockerAction(eventId: string, participantId: string): Promise<{ success: boolean; message: string }> {
    const actionName = 'assignLockerAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
        const participantSnap = await participantRef.get();
        if (!participantSnap.exists) {
            return { success: false, message: 'Participant not found.' };
        }
        const participantData = participantSnap.data() as EventParticipant;

        if (participantData.checkInStatus !== 'CheckedIn') {
            return { success: false, message: 'Participant must complete waiver check-in first.' };
        }
        if (participantData.lockerNumber) {
            return { success: false, message: `Locker ${participantData.lockerNumber} already assigned.` };
        }

        let lockerNumber: string;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 20;

        do {
            lockerNumber = Math.floor(1000 + Math.random() * 9000).toString();
            const existingLockerQuery = await adminDb.collection('events').doc(eventId).collection('participants').where('lockerNumber', '==', lockerNumber).limit(1).get();
            if (existingLockerQuery.empty) {
                isUnique = true;
            }
            attempts++;
        } while (!isUnique && attempts < maxAttempts);
        
        if(!isUnique) {
            return { success: false, message: 'Could not generate a unique locker number. Please try again.' };
        }

        await participantRef.update({ lockerNumber: lockerNumber, updatedAt: FieldValue.serverTimestamp() });

        // Send notifications
        if (participantData.email) {
            await sendLockerAssignmentEmail(participantData.email, participantData.name, participantData.bibNumber || 'N/A', lockerNumber);
        }
        if (participantData.mobile) {
            await sendLockerAssignmentWhatsApp(participantData.mobile, participantData.name, participantData.bibNumber || 'N/A', lockerNumber);
        }

        revalidatePath('/volunteer/dashboard');
        return { success: true, message: `Locker assigned to ${participantData.name}. Athlete has been notified.` };

    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}


export async function returnLockerAction(
  eventId: string,
  lockerNumber: string
): Promise<{ success: boolean; message: string }> {
  const actionName = 'returnLockerAction';
  try {
    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    
    // Find the participant with the given locker number
    const query = participantsRef.where('lockerNumber', '==', lockerNumber).limit(1);
    const snapshot = await query.get();

    if (snapshot.empty) {
      return { success: false, message: `Locker number ${lockerNumber} not found.` };
    }

    const participantDoc = snapshot.docs[0];
    const participantData = serializeParticipantDataUtil(participantDoc);

    // Clear the locker number and add a return timestamp
    await participantDoc.ref.update({
      lockerNumber: FieldValue.delete(),
      lockerReturnedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (participantData.email) {
        await sendLockerReturnConfirmationEmail(participantData.email, participantData.name, lockerNumber);
    }
    if (participantData.mobile) {
        await sendLockerReturnConfirmationWhatsApp(participantData.mobile, participantData.name, lockerNumber);
    }


    revalidatePath('/volunteer/dashboard');
    return { success: true, message: `Locker ${lockerNumber} (BIB: ${participantData.bibNumber}) returned successfully.` };

  } catch (e: any) {
    console.error(`[${actionName}] Error returning locker:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function resetLockerAction(
    eventId: string,
    participantId: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'resetLockerAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
        
        await participantRef.update({
            lockerNumber: FieldValue.delete(),
            lockerReturnedAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        revalidatePath('/admin/dashboard');
        revalidatePath('/volunteer/dashboard');
        return { success: true, message: "Locker assignment has been reset." };
    } catch (e: any) {
        return { success: false, message: `Failed to reset locker: ${e.message}` };
    }
}


export async function resetBikeCheckOutAction(
    eventId: string,
    participantId: string
): Promise<{ success: boolean; message: string }> {
    const actionName = 'resetBikeCheckOutAction';
    try {
        const adminDb = getFirestoreInstance();
        const participantRef = adminDb.collection('events').doc(eventId).collection('participants').doc(participantId);
        await participantRef.update({
            bikeCheckOutStatus: FieldValue.delete(),
            bikeCheckedOutAt: FieldValue.delete(),
            bikeCheckedOutManuallyBy: FieldValue.delete(),
            bikeCheckedOutManuallyTo: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        revalidatePath('/admin/dashboard');
        revalidatePath('/volunteer/dashboard');
        return { success: true, message: "Bike check-out has been reset." };
    } catch (e: any) {
        return { success: false, message: `Failed to reset bike check-out: ${e.message}` };
    }
}


export async function recordLoopAction(input: {
  eventId: string;
  bibNumber: string;
  segment: 'SWIM' | 'BIKE' | 'RUN';
  volunteerId: string;
  volunteerName: string;
  increment: boolean;
}): Promise<{ success: boolean; message: string; participant?: EventParticipant; }> {
  const actionName = 'recordLoopAction';
  const { eventId, bibNumber, segment, volunteerId, volunteerName, increment } = input;
  try {
    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');
    const snapshot = await participantsRef.where('bibNumber', '==', bibNumber).limit(1).get();

    if (snapshot.empty) {
      return { success: false, message: `Participant with BIB ${bibNumber} not found.` };
    }

    const participantDoc = snapshot.docs[0];
    const participantRef = participantDoc.ref;
    
    let loopField: 'swimLoopsCompleted' | 'bikeLoopsCompleted' | 'runLoopsCompleted';
    switch (segment) {
      case 'SWIM': loopField = 'swimLoopsCompleted'; break;
      case 'BIKE': loopField = 'bikeLoopsCompleted'; break;
      case 'RUN': loopField = 'runLoopsCompleted'; break;
      default: return { success: false, message: 'Invalid segment.' };
    }

    await adminDb.runTransaction(async (transaction) => {
      const pDoc = await transaction.get(participantRef);
      if (!pDoc.exists) throw new Error('Participant not found during transaction.');
      const currentLoops = pDoc.data()?.[loopField] || 0;
      const newLoopCount = increment ? currentLoops + 1 : Math.max(0, currentLoops - 1);
      
      transaction.update(participantRef, { [loopField]: newLoopCount, updatedAt: FieldValue.serverTimestamp() });

      const logRef = participantRef.collection('loopLogs').doc();
      transaction.set(logRef, {
        eventId, bibNumber, segment,
        timestamp: FieldValue.serverTimestamp(),
        loopNumber: newLoopCount,
        action: increment ? 'increment' : 'decrement',
        volunteerId, volunteerName,
      });
    });

    const updatedParticipantDoc = await participantRef.get();
    const updatedParticipant = serializeParticipantDataUtil(updatedParticipantDoc);
    
    revalidatePath('/volunteer/dashboard');
    revalidatePath('/admin/dashboard');

    return { success: true, message: `Loop count updated to ${updatedParticipant[loopField]}.`, participant: updatedParticipant };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getLoopLogsForEventAction(
  eventId: string
): Promise<{ success: boolean; message: string; logs?: LoopLog[] }> {
  const actionName = 'getLoopLogsForEventAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const logsSnapshot = await adminDb.collectionGroup('loopLogs')
      .where('eventId', '==', eventId)
      .orderBy('timestamp', 'desc')
      .get();
      
    if (logsSnapshot.empty) {
      return { success: true, message: "No loop logs found.", logs: [] };
    }
    
    const logs = logsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: toIsoStringSafe(data.timestamp)!,
      } as LoopLog;
    });

    return { success: true, message: 'Logs fetched.', logs };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}


export async function deleteLoopLogsForEventAction(eventId: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteLoopLogsForEventAction';
  try {
    const adminDb = getFirestoreInstance();
    // Delete from collection group
    const logsSnapshot = await adminDb.collectionGroup('loopLogs').where('eventId', '==', eventId).get();
    if (logsSnapshot.empty) return { success: true, message: "No logs to delete." };

    const batch = adminDb.batch();
    logsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Reset counts on participants
    const participantsSnapshot = await adminDb.collection('events').doc(eventId).collection('participants').get();
    const participantBatch = adminDb.batch();
    participantsSnapshot.docs.forEach(doc => {
        participantBatch.update(doc.ref, {
            swimLoopsCompleted: FieldValue.delete(),
            bikeLoopsCompleted: FieldValue.delete(),
            runLoopsCompleted: FieldValue.delete(),
        });
    });
    await participantBatch.commit();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `All loop logs and counts for the event have been reset.` };
  } catch (e: any) {
    return { success: false, message: `Failed to reset logs: ${e.message}` };
  }
}

export async function deleteAthleteLoopLogsAction(eventId: string, bibNumber: string): Promise<{ success: boolean; message: string }> {
  const actionName = 'deleteAthleteLoopLogsAction';
  try {
    const adminDb = getFirestoreInstance();
    const participantsSnapshot = await adminDb.collection('events').doc(eventId).collection('participants').where('bibNumber', '==', bibNumber).get();
    if (participantsSnapshot.empty) return { success: false, message: `Participant with BIB ${bibNumber} not found.` };
    
    const participantDoc = participantsSnapshot.docs[0];
    
    // Delete subcollection logs
    const logsSnapshot = await participantDoc.ref.collection('loopLogs').get();
    const batch = adminDb.batch();
    logsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    
    // Reset counts on the main participant doc
    batch.update(participantDoc.ref, {
        swimLoopsCompleted: FieldValue.delete(),
        bikeLoopsCompleted: FieldValue.delete(),
        runLoopsCompleted: FieldValue.delete(),
    });
    
    await batch.commit();
    
    revalidatePath('/admin/dashboard');
    return { success: true, message: `Loop logs for BIB ${bibNumber} have been reset.` };
  } catch (e: any) {
    return { success: false, message: `Failed to reset logs: ${e.message}` };
  }
}
