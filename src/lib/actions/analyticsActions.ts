'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { Timestamp, type Firestore, FieldPath, type Query } from 'firebase-admin/firestore';
import type { AdminAthleteAnalytics, User, OverviewMetrics, EventParticipant, CancellationEntry, RetentionStats, CrossEventComparison } from '@/lib/types';
import { serializeParticipantData, serializeValue, normalizeStatus } from '@/lib/utils';
import type { AdminOnly } from '@/lib/types/admin';
import { format, parseISO, isAfter, isEqual, startOfDay, subYears } from 'date-fns';
import { getKV, putKV } from '../cloudflare/kv';

/**
 * SCALE-FIRST: Uses aggregation queries (count) instead of full collection scans.
 */
export async function _computeAdminAthleteAnalytics(): Promise<{
  success: boolean;
  message: string;
  analytics?: AdminAthleteAnalytics;
  recentSignups?: any[];
}> {
  const actionName = '_computeAdminAthleteAnalytics';
  try {
    const adminDb = getFirestoreInstance();
    
    const totalAthletesSnap = await adminDb.collection('users').count().get();
    const totalAthletes = totalAthletesSnap.data().count;

    const clubIdsSnap = await adminDb.collection('users').select('clubId').get();
    const clubIds = new Set(clubIdsSnap.docs.map(d => d.data().clubId).filter(Boolean));

    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfDay(new Date(now.setDate(now.getDate() - 7)));

    const todayCountSnap = await adminDb.collection('users').where('createdAt', '>=', todayStart).count().get();
    const weekCountSnap = await adminDb.collection('users').where('createdAt', '>=', weekStart).count().get();

    const recentSignupsSnap = await adminDb.collection('users')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

    const recentSignups = recentSignupsSnap.docs.map(d => {
        const u = d.data();
        return {
            uid: d.id,
            name: u.name,
            email: u.email,
            createdAt: toIsoStringSafe(u.createdAt)
        };
    });

    const analytics: AdminAthleteAnalytics = { 
        totalAthletes, 
        totalClubsWithAthletes: clubIds.size, 
        signupsToday: todayCountSnap.data().count, 
        signupsThisWeek: weekCountSnap.data().count, 
        uniqueAthletesInRaceResults: 0
    };

    const res = { analytics, recentSignups };
    await putKV('analytics:admin_athlete_snapshot', res, actionName);

    return { 
        success: true, 
        message: "Analytics computed efficiently.", 
        analytics: serializeValue(analytics), 
        recentSignups: serializeValue(recentSignups) 
    };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: e.message };
  }
}

export async function getAdminAthleteAnalyticsAction(): Promise<{ success: boolean; message: string; analytics?: AdminAthleteAnalytics; recentSignups?: any[] }> {
  const actionName = 'getAdminAthleteAnalyticsAction';
  try {
    const cachedData = await getKV<any>('analytics:admin_athlete_snapshot', actionName);
    if (cachedData) {
        return { success: true, message: 'Analytics fetched from cache.', ...cachedData };
    }
    return { success: true, message: 'Sync required.', analytics: { totalAthletes: 0, totalClubsWithAthletes: 0, signupsToday: 0, signupsThisWeek: 0, uniqueAthletesInRaceResults: 0 }, recentSignups: [] };
  } catch (e: any) {
    return { success: false, message: `Analytics error: ${e.message}` };
  }
}

/**
 * CROSS-EVENT PARTICIPATION ANALYSIS
 */
export async function compareEventParticipantsAction(
  eventAId: string,
  eventBId: string
): Promise<{
  success: boolean;
  message: string;
  stats?: CrossEventComparison;
}> {
  try {
    const adminDb = getFirestoreInstance();
    const [snapA, snapB] = await Promise.all([
      adminDb.collection('events').doc(eventAId).collection('participants').select('email', 'name', 'bibNumber').get(),
      adminDb.collection('events').doc(eventBId).collection('participants').select('email', 'bibNumber').get(),
    ]);

    const participantsA = new Map<string, { name: string; bibNumber: string | null }>();
    snapA.forEach(doc => {
      const data = doc.data();
      if (data.email) participantsA.set(data.email.toLowerCase(), { name: data.name, bibNumber: data.bibNumber || null });
    });

    const participantsB = new Map<string, string | null>();
    snapB.forEach(doc => {
      const data = doc.data();
      if (data.email) participantsB.set(data.email.toLowerCase(), data.bibNumber || null);
    });

    const repeated: any[] = [];
    participantsA.forEach((dataA, email) => {
      if (participantsB.has(email)) {
        repeated.push({
          name: dataA.name,
          email,
          bibA: dataA.bibNumber,
          bibB: participantsB.get(email),
        });
      }
    });

    const stats: CrossEventComparison = {
      eventAId,
      eventBId,
      totalA: snapA.size,
      totalB: snapB.size,
      overlapCount: repeated.length,
      overlapPercentage: snapA.size > 0 ? (repeated.length / snapA.size) * 100 : 0,
      repeatedAthletes: repeated
    };
    
    return { success: true, message: 'Comparison complete.', stats: serializeValue(stats) };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * ATHLETE RETENTION ANALYTICS
 */
export async function _computeRetentionStats(targetYear: number): Promise<{ success: boolean; message: string; stats?: RetentionStats }> {
    const actionName = '_computeRetentionStats';
    try {
        const adminDb = getFirestoreInstance();
        const prevYear = targetYear - 1;

        // Fetch all unique emails from results for prev and target years
        const prevSnap = await adminDb.collection('raceResults').where('raceYear', '==', prevYear).select('emailLower').get();
        const targetSnap = await adminDb.collection('raceResults').where('raceYear', '==', targetYear).select('emailLower').get();

        const prevEmails = new Set(prevSnap.docs.map(d => d.data().emailLower).filter(Boolean));
        const targetEmails = new Set(targetSnap.docs.map(d => d.data().emailLower).filter(Boolean));

        let returning = 0;
        prevEmails.forEach(email => {
            if (targetEmails.has(email)) returning++;
        });

        const stats: RetentionStats = {
            year: targetYear,
            totalAthletesPrevious: prevEmails.size,
            returningAthletes: returning,
            dropOffAthletes: prevEmails.size - returning,
            retentionRate: prevEmails.size > 0 ? (returning / prevEmails.size) * 100 : 0
        };

        await putKV(`analytics:retention:${targetYear}`, stats, actionName);
        return { success: true, message: 'Retention computed.', stats: serializeValue(stats) };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function _computeGlobalParticipantStats(): Promise<{ success: boolean; message: string; stats?: any }> {
    return await getGlobalParticipantStatsAction();
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
    const today = startOfDay(new Date());

    const totalAthletesSnap = await adminDb.collection('users').count().get();
    const clubAthletesSnap = await adminDb.collection('users').where('clubId', '!=', null).count().get();
    
    // For upcoming events athletes, we check participants in active upcoming races
    const upcomingEventsSnap = await adminDb.collection('events').where('eventDate', '>=', today.toISOString().split('T')[0]).get();
    const upcomingEventIds = upcomingEventsSnap.docs.map(d => d.id);
    
    let athletesInUpcoming = 0;
    if (upcomingEventIds.length > 0) {
        const activeParticipantsSnap = await adminDb.collectionGroup('participants')
            .where('eventId', 'in', upcomingEventIds)
            .where('ticketStatus', '==', 'Active')
            .select('athleteUid')
            .get();
        const uniqueUids = new Set(activeParticipantsSnap.docs.map(d => d.data().athleteUid).filter(Boolean));
        athletesInUpcoming = uniqueUids.size;
    }

    const stats = {
        totalAthletes: totalAthletesSnap.data().count,
        clubAffiliatedAthletes: clubAthletesSnap.data().count,
        athletesInUpcomingEvents: athletesInUpcoming
    };

    await putKV('analytics:global_participant_snapshot', stats, actionName);

    return {
      success: true,
      message: 'Global stats fetched.',
      stats: serializeValue(stats)
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
    const startOfToday = startOfDay(now);
    
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

    let allParticipants = allParticipantsSnap.docs.map(doc => serializeParticipantData(doc));
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

    return { success: true, message: "Registration metrics fetched.", metrics: serializeValue(metrics) };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action '${actionName}' failed: ${e.message}` };
  }
}

const toIsoStringSafe = (dateField: any): string | null => {
  if (!dateField) return null;
  if (dateField instanceof Timestamp) return dateField.toDate().toISOString();
  if (dateField instanceof Date) return dateField.toISOString();
  if (typeof dateField === 'string') return new Date(dateField).toISOString();
  return null;
};
