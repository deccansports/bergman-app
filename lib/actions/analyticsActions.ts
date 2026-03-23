
// src/lib/actions/analyticsActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { Timestamp, type Firestore, FieldPath } from 'firebase-admin/firestore';
import type { AdminAthleteAnalytics, User, OverviewMetrics, EventParticipant, CancellationEntry } from '@/lib/types';
import { serializeParticipantDataUtil } from '@/lib/utils';
import type { AdminOnly } from '@/lib/types/admin';


export async function getAdminAthleteAnalyticsAction(): Promise<{ success: boolean; message: string; analytics?: AdminAthleteAnalytics; recentSignups?: Array<{ uid: string; name: string | null; email: string | null; createdAt: string | null; emailVerified: boolean; }> }> {
  const actionName = 'getAdminAthleteAnalyticsAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
  } catch (e: any) {
    return { success: false, message: `DB error: ${e.message}` };
  }
  try {
    const usersSnap = await adminDb.collection('users').get();
    const totalAthletes = usersSnap.size;
    const clubIds = new Set<string>();
    let signupsToday = 0;
    let signupsThisWeek = 0;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - todayStart.getDay() + (todayStart.getDay() === 0 ? -6 : 1));

    const signupPromises = usersSnap.docs.map(async (d) => {
      const uData = d.data();
      let cDate: Date | null = null;
      const cField = uData.createdAt;
      if (cField instanceof Timestamp) cDate = cField.toDate();
      else if (typeof cField === 'string') cDate = new Date(cField);
      else if (cField && typeof cField.seconds === 'number') cDate = new Date(cField.seconds * 1000 + (cField.nanoseconds || 0) / 1000000);

      if (uData.clubId) clubIds.add(uData.clubId);
      if (cDate && !isNaN(cDate.getTime())) {
        if (cDate >= todayStart) signupsToday++;
        if (cDate >= weekStart) signupsThisWeek++;
        return { uid: d.id, name: uData.name, email: uData.email, emailVerified: true, createdAt: cDate.toISOString() };
      }
      return { uid: d.id, name: uData.name, email: uData.email, emailVerified: true, createdAt: null };
    });
    
    const allSignups = (await Promise.all(signupPromises)).filter(s => s.createdAt !== null).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

    const raceResultsSnap = await adminDb.collection('raceResults').select('email').get();
    const uniqueRaceEmails = new Set<string>();
    raceResultsSnap.forEach(d => {
      const e = d.data().email as string | undefined;
      if (e && typeof e === 'string') uniqueRaceEmails.add(e.toLowerCase());
    });
    
    const analytics: AdminAthleteAnalytics = { totalAthletes, totalClubsWithAthletes: clubIds.size, signupsToday, signupsThisWeek, uniqueAthletesInRaceResults: uniqueRaceEmails.size };
    return { success: true, message: "Analytics fetched.", analytics, recentSignups: allSignups.slice(0, 5) };
  } catch (e: any) {
    return { success: false, message: `Analytics error: ${e.message}` };
  }
}

export async function compareEventParticipantsAction(
  eventAId: string,
  eventBId: string
): Promise<{
  success: boolean;
  message: string;
  stats?: {
    repeatedAthletesCount: number;
    totalInEventA: number;
    totalInEventB: number;
    percentageRepeat: number;
  };
  repeatedAthletes?: { name: string; email: string; bibEventA: string | null; bibEventB: string | null; }[];
}> {
  const actionName = 'compareEventParticipantsAction';
  if (!eventAId || !eventBId) {
    return { success: false, message: 'Two event IDs are required for comparison.' };
  }
  
  try {
    const adminDb = getFirestoreInstance();
    const [snapA, snapB] = await Promise.all([
      adminDb.collection('events').doc(eventAId).collection('participants').get(),
      adminDb.collection('events').doc(eventBId).collection('participants').get(),
    ]);

    const participantsA = new Map<string, { name: string; bibNumber: string | null }>();
    snapA.forEach(doc => {
      const data = doc.data();
      if (data.email) {
        participantsA.set(data.email.toLowerCase(), { name: data.name, bibNumber: data.bibNumber || null });
      }
    });

    const participantsB = new Map<string, { name: string; bibNumber: string | null }>();
    snapB.forEach(doc => {
      const data = doc.data();
      if (data.email) {
        participantsB.set(data.email.toLowerCase(), { name: data.name, bibNumber: data.bibNumber || null });
      }
    });

    const repeatedAthletes: { name: string; email: string; bibEventA: string | null; bibEventB: string | null; }[] = [];
    participantsA.forEach((dataA, email) => {
      if (participantsB.has(email)) {
        const dataB = participantsB.get(email)!;
        repeatedAthletes.push({
          name: dataA.name,
          email,
          bibEventA: dataA.bibNumber,
          bibEventB: dataB.bibNumber,
        });
      }
    });

    const totalA = participantsA.size;
    const totalB = participantsB.size;
    const largerTotal = Math.max(totalA, totalB);

    const stats = {
      repeatedAthletesCount: repeatedAthletes.length,
      totalInEventA: totalA,
      totalInEventB: totalB,
      percentageRepeat: largerTotal > 0 ? (repeatedAthletes.length / largerTotal) * 100 : 0,
    };
    
    return { success: true, message: 'Comparison complete.', stats, repeatedAthletes };

  } catch (e: any) {
    return { success: false, message: `Error comparing participants: ${e.message}` };
  }
}

export async function getGlobalParticipantStatsAction(): Promise<{
  success: boolean;
  message: string;
  stats?: {
    totalAthletes: number;
    clubAffiliatedAthletes: number;
    athletesInUpcomingEvents: number;
  };
}> {
  const actionName = 'getGlobalParticipantStatsAction';
  try {
    const adminDb = getFirestoreInstance();
    
    const [usersSnapshot, allUpcomingEvents, allParticipantsInUpcoming] = await Promise.all([
        adminDb.collection('users').get(),
        adminDb.collection('events').where('eventDate', '>=', new Date().toISOString().split('T')[0]).get(),
        adminDb.collectionGroup('participants').where('ticketStatus', '==', 'Active').get()
    ]);
    
    const totalAthletes = usersSnapshot.size;
    const clubAffiliatedAthletes = usersSnapshot.docs.filter(doc => !!doc.data().clubId).length;

    const upcomingEventIds = new Set(allUpcomingEvents.docs.map(doc => doc.id));
    const uniqueAthletesInUpcoming = new Set<string>();

    allParticipantsInUpcoming.forEach(doc => {
      const pData = doc.data();
      if (upcomingEventIds.has(pData.eventId) && pData.athleteUid) {
        uniqueAthletesInUpcoming.add(pData.athleteUid);
      }
    });

    return {
      success: true,
      message: 'Global stats fetched.',
      stats: {
        totalAthletes,
        clubAffiliatedAthletes,
        athletesInUpcomingEvents: uniqueAthletesInUpcoming.size
      }
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getEventRegistrationOverviewMetricsAction(adminContext: AdminOnly, eventId?: string, country?: 'IN' | 'US'): Promise<{
  success: boolean;
  message: string;
  metrics?: OverviewMetrics;
}> {
  const actionName = 'getEventRegistrationOverviewMetricsAction';
  let adminDb: Firestore;
  try {
    adminDb = getFirestoreInstance();
    
    const now = new Date();
    // Correctly get the start of the day in the server's local timezone.
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let eventIdsToConsider: string[] | undefined = undefined;
    if (eventId) {
        eventIdsToConsider = [eventId];
    } else if (country) {
        const eventsSnap = await adminDb.collection('events').where('country', '==', country).get();
        eventIdsToConsider = eventsSnap.docs.map(doc => doc.id);
        if (eventIdsToConsider.length === 0) {
            return {
                success: true,
                message: "No events found for the selected country.",
                metrics: { todaysRegistrations: 0, totalRegistrations: 0, totalSales: 0, todaysRefunds: 0, totalFreeRegistrations: 0, recentTransactions: [], totalRefunds: 0 }
            };
        }
    }
    
    // Fetch all participants and cancellations broadly first
    const allParticipantsSnap = await adminDb.collectionGroup('participants').get();
    const allCancellationsSnap = await adminDb.collectionGroup('cancellations').get();

    let allParticipants = allParticipantsSnap.docs.map(doc => serializeParticipantDataUtil(doc));
    let allCancellations = allCancellationsSnap.docs.map(doc => doc.data() as CancellationEntry);

    // Filter in-memory if eventIds are specified
    if (eventIdsToConsider) {
        allParticipants = allParticipants.filter(p => p.eventId && eventIdsToConsider!.includes(p.eventId));
        allCancellations = allCancellations.filter(c => c.eventId && eventIdsToConsider!.includes(c.eventId));
    }
    
    const sortedParticipants = allParticipants.sort((a, b) => {
        const dateA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
        const dateB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
        return dateB - dateA; // Descending
    });

    const recentTransactions: Array<EventParticipant> = sortedParticipants.slice(0, 5);

    let totalRegistrations = allParticipants.length;
    let todaysRegistrations = 0;
    let totalSales = 0;
    let totalFreeRegistrations = 0;

    allParticipants.forEach(participant => {
      const amount = participant.amountPaidPaisa;
      if (typeof amount === 'number' && amount > 0) {
        totalSales += amount;
      } else {
        totalFreeRegistrations++;
      }
      
      if (participant.registeredAt) {
        const registeredDate = new Date(participant.registeredAt);
        if (registeredDate >= startOfToday) {
          todaysRegistrations++;
        }
      }
    });

    let totalRefunds = 0;
    allCancellations.forEach(cancellation => {
      totalRefunds += cancellation.calculatedRefundAmountPaisa || 0;
    });

    const metrics: OverviewMetrics = {
      todaysRegistrations,
      totalRegistrations,
      totalSales,
      todaysRefunds: 0, 
      totalFreeRegistrations,
      recentTransactions: recentTransactions, 
      totalRefunds,
    };

    return { success: true, message: "Registration metrics fetched.", metrics };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
  }
}
