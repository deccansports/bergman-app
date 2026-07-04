'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { Timestamp, type Firestore, FieldPath, type Query } from 'firebase-admin/firestore';
import type { AdminAthleteAnalytics, User, OverviewMetrics, EventParticipant, CancellationEntry, RetentionStats, CrossEventComparison } from '@/lib/types';
import { serializeParticipantData, serializeValue, normalizeStatus } from '@/lib/utils';
import type { AdminOnly } from '@/lib/types/admin';
import { format, parseISO, isAfter, isEqual, startOfDay, subYears, isBefore } from 'date-fns';
import { getKV, putKV } from '../cloudflare/kv';
import { getCachedServerValue } from '@/lib/serverCache';

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
    return await getCachedServerValue('analytics:global-participant-stats', 60_000, async () => {
      const adminDb = getFirestoreInstance();
      const today = startOfDay(new Date());

      const totalAthletesSnap = await adminDb.collection('users').count().get();
      const clubAthletesSnap = await adminDb.collection('users').where('clubId', '!=', null).count().get();
      
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
    });
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Compute and cache country/event-level registration metrics to KV
 * This should be called periodically (via a scheduled job) to keep KV caches fresh
 * KV Keys:
 * - analytics:country:{IN|US}:metrics -> {totalRegs, todaysRegs, totalSales, totalFree, totalRefunds, recentTx}
 * - analytics:event:{eventId}:metrics -> same structure
 */
export async function computeCountryRegistrationMetricsAction(country: 'IN' | 'US'): Promise<{
  success: boolean;
  message: string;
}> {
  const actionName = `computeCountryRegistrationMetricsAction:${country}`;
  try {
    const adminDb = getFirestoreInstance();
    const now = new Date();
    const startOfToday = startOfDay(now);

    const normalizeCountryCode = (eventCountry?: string | null, eventCurrency?: string | null): 'IN' | 'US' | null => {
      const c = (eventCountry || '').trim().toLowerCase();
      const curr = (eventCurrency || '').trim().toUpperCase();
      if (c === 'in' || c === 'india' || curr === 'INR') return 'IN';
      if (c === 'us' || c === 'usa' || c === 'united states' || c === 'united states of america' || curr === 'USD') return 'US';
      return null;
    };

    const parseEventDateSafe = (value: any): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return value;
      if (typeof value?.toDate === 'function') return value.toDate();
      if (typeof value === 'string') {
        const parsed = parseISO(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      return null;
    };

    // Use all events and filter in memory (works even when country format is 'India' / 'USA')
    const eventsSnap = await adminDb
      .collection('events')
      .select('country', 'currency', 'eventDate')
      .get();

    const eventIds = eventsSnap.docs
      .filter((doc) => {
        const data = doc.data() as any;
        const mappedCountry = normalizeCountryCode(data?.country, data?.currency);
        if (mappedCountry !== country) return false;

        // Keep only upcoming events for overview scope
        const eventDate = parseEventDateSafe(data?.eventDate);
        return !!eventDate && !isBefore(startOfDay(eventDate), startOfDay(now));
      })
      .map((doc) => doc.id);
    
    if (eventIds.length === 0) {
      return { success: true, message: `No events found for country ${country}` };
    }
    
    const allParticipants: EventParticipant[] = [];
    const allCancellations: CancellationEntry[] = [];

    // Read per-event subcollections to avoid collectionGroup index constraints
    for (const eid of eventIds) {
      const participantsSnap = await adminDb
        .collection('events')
        .doc(eid)
        .collection('participants')
        .select('name', 'email', 'registeredAt', 'amountPaidPaisa', 'ticketStatus', 'eventName')
        .get();

      allParticipants.push(...participantsSnap.docs.map(doc => serializeParticipantData(doc)));

      const cancellationsSnap = await adminDb
        .collection('events')
        .doc(eid)
        .collection('cancellations')
        .select('calculatedRefundAmountPaisa')
        .get();

      allCancellations.push(...cancellationsSnap.docs.map(doc => doc.data() as CancellationEntry));
    }
    
    // Compute aggregated metrics
    const sortedParticipants = allParticipants.sort((a, b) => {
      const dateA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
      const dateB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
      return dateB - dateA;
    });

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

    // Extract only latest 5 registrations with minimal fields
    const latest5Registrations = sortedParticipants.slice(0, 5).map(p => ({
      id: p.id,
      name: p.name,
      email: p.email,
      eventName: p.eventName,
      registeredAt: p.registeredAt,
      amountPaidPaisa: p.amountPaidPaisa,
      ticketStatus: p.ticketStatus,
    }));

    // Store only numbers + latest 5 registrations in KV
    const metrics = {
      totalRegistrations,
      todaysRegistrations,
      totalSales,
      totalFreeRegistrations,
      totalRefunds,
      recentTransactions: latest5Registrations,
      lastUpdated: now.toISOString(),
    };

    await putKV(`analytics:overview_metrics:${country === 'IN' ? 'all-in' : 'all-us'}`, metrics, actionName);
    
    return { success: true, message: `Country metrics cached for ${country}` };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: e.message };
  }
}

/**
 * Compute and cache event-level registration metrics to KV
 */
export async function computeEventRegistrationMetricsAction(eventId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const actionName = `computeEventRegistrationMetricsAction:${eventId}`;
  try {
    const adminDb = getFirestoreInstance();
    const now = new Date();
    const startOfToday = startOfDay(now);
    
    // Fetch only necessary fields: registration metrics and latest 5 registrations
    const participantsSnap = await adminDb.collection('events').doc(eventId).collection('participants')
      .select('name', 'email', 'registeredAt', 'amountPaidPaisa', 'ticketStatus', 'eventName')
      .get();
    const allParticipants = participantsSnap.docs.map(doc => serializeParticipantData(doc));
    
    const cancellationsSnap = await adminDb.collection('events').doc(eventId).collection('cancellations')
      .select('calculatedRefundAmountPaisa')
      .get();
    const allCancellations = cancellationsSnap.docs.map(doc => doc.data() as CancellationEntry);
    
    // Compute aggregated metrics
    const sortedParticipants = allParticipants.sort((a, b) => {
      const dateA = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
      const dateB = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
      return dateB - dateA;
    });

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

    // Extract only latest 5 registrations with minimal fields
    const latest5Registrations = sortedParticipants.slice(0, 5).map(p => ({
      id: p.id,
      name: p.name,
      email: p.email,
      eventName: p.eventName,
      registeredAt: p.registeredAt,
      amountPaidPaisa: p.amountPaidPaisa,
      ticketStatus: p.ticketStatus,
    }));

    // Store only numbers + latest 5 registrations in KV
    const metrics = {
      totalRegistrations,
      todaysRegistrations,
      totalSales,
      totalFreeRegistrations,
      totalRefunds,
      recentTransactions: latest5Registrations,
      lastUpdated: now.toISOString(),
    };

    await putKV(`analytics:overview_metrics:${eventId}`, metrics, actionName);
    
    return { success: true, message: `Event metrics cached for ${eventId}` };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: e.message };
  }
}

export async function getEventRegistrationOverviewMetricsAction(adminContext: AdminOnly, eventId?: string, country?: 'IN' | 'US'): Promise<{
  success: boolean;
  message: string;
  metrics?: OverviewMetrics;
}> {
  const actionName = 'getEventRegistrationOverviewMetricsAction';
  try {
    let metrics: any = null;
    let kvKey = '';

    // Determine the KV key based on parameters
    if (eventId) {
      kvKey = `analytics:overview_metrics:${eventId}`;
    } else if (country) {
      kvKey = `analytics:overview_metrics:${country === 'IN' ? 'all-in' : 'all-us'}`;
    } else {
      // Global view: aggregate IN + US overview metrics from KV
      const [inMetrics, usMetrics] = await Promise.all([
        getKV<any>('analytics:overview_metrics:all-in', actionName),
        getKV<any>('analytics:overview_metrics:all-us', actionName),
      ]);

      if (!inMetrics) {
        computeCountryRegistrationMetricsAction('IN').catch(e =>
          console.error(`[${actionName}] Background sync failed for country IN:`, e)
        );
      }

      if (!usMetrics) {
        computeCountryRegistrationMetricsAction('US').catch(e =>
          console.error(`[${actionName}] Background sync failed for country US:`, e)
        );
      }

      const combinedRecent = [
        ...(inMetrics?.recentTransactions || []),
        ...(usMetrics?.recentTransactions || []),
      ]
        .sort((a: any, b: any) => {
          const dateA = a?.registeredAt ? new Date(a.registeredAt).getTime() : 0;
          const dateB = b?.registeredAt ? new Date(b.registeredAt).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, 5);

      const globalMetrics = {
        totalRegistrations: (inMetrics?.totalRegistrations || 0) + (usMetrics?.totalRegistrations || 0),
        todaysRegistrations: (inMetrics?.todaysRegistrations || 0) + (usMetrics?.todaysRegistrations || 0),
        totalSales: (inMetrics?.totalSales || 0) + (usMetrics?.totalSales || 0),
        todaysRefunds: 0,
        totalFreeRegistrations: (inMetrics?.totalFreeRegistrations || 0) + (usMetrics?.totalFreeRegistrations || 0),
        totalRefunds: (inMetrics?.totalRefunds || 0) + (usMetrics?.totalRefunds || 0),
        recentTransactions: combinedRecent,
      };

      return {
        success: true,
        message: 'Global registration metrics fetched from cache.',
        metrics: serializeValue(globalMetrics),
      };
    }

    // Try to fetch metrics from KV
    metrics = await getKV<any>(kvKey, actionName);

    // If not in KV, compute it on-demand and cache it (without blocking)
    if (!metrics) {
      console.log(`[${actionName}] Metrics not found in KV (${kvKey}), computing on-demand...`);
      
      // Compute in background (don't await)
      if (eventId) {
        computeEventRegistrationMetricsAction(eventId).catch(e => 
          console.error(`[${actionName}] Background sync failed for event ${eventId}:`, e)
        );
      } else if (country) {
        computeCountryRegistrationMetricsAction(country).catch(e =>
          console.error(`[${actionName}] Background sync failed for country ${country}:`, e)
        );
      }

      // Return empty metrics while async computation runs
      metrics = {
        totalRegistrations: 0,
        todaysRegistrations: 0,
        totalSales: 0,
        todaysRefunds: 0,
        totalFreeRegistrations: 0,
        totalRefunds: 0,
        recentTransactions: [],
        message: 'Loading...',
      };
    }

    return { 
      success: true, 
      message: "Registration metrics fetched from cache.", 
      metrics: serializeValue(metrics) 
    };
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
