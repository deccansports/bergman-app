// src/lib/actions/ingestActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { EventCalendarEntry, TicketDefinition, LiveAthlete, Split, Leg, Status, RaceResult } from '@/lib/types';
import { hmsToSeconds, toIsoStringSafe, isDuathlonEvent, serializeValue, normalizeStatus, formatSecondsToHMS } from '@/lib/utils';
import { _internal_fetchAllRaceDataFromFirestore } from '@/lib/actions/publicResultActions';
import { fetchCloudflareLiveAthletes, getLiveTrackingEdgeBaseUrl } from '@/lib/live-tracking/cloudflareApi';
import { getKV } from '@/lib/cloudflare/kv';
import { getParticipantRowsFromIndex, loadParticipantIndex } from '@/lib/liveTrackingParticipantStore';

const LEG_ORDER: (Leg | 'NOT_STARTED')[] = ['NOT_STARTED', 'SWIM', 'RUN1', 'T1', 'BIKE', 'T2', 'RUN', 'RUN2', 'FINISH', 'FINISHED'];

function isCancelledOrInactiveStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return false;
  return (
    status.includes('cancel')
    || status.includes('refund')
    || status.includes('void')
    || status.includes('inactive')
    || status.includes('rejected')
  );
}

function mapLiveTimingAthlete(row: any): LiveAthlete {
  const fullName = String(
    row?.fullName
    || row?.name
    || [row?.firstName, row?.lastName].filter(Boolean).join(' ')
    || 'Unknown Athlete',
  ).trim() || 'Unknown Athlete';

  const genderRaw = String(row?.gender || row?.registration?.gender || row?.provider?.gender || '').trim().toLowerCase();
  const gender = (genderRaw.startsWith('f') ? 'Female' : genderRaw.startsWith('m') ? 'Male' : (row?.gender || 'Male')) as 'Male' | 'Female';
  const status = normalizeStatus(row?.status || row?.registrationStatus || 'Not Started') as Status;

  return {
    id: String(row?.bookingId || row?.id || row?.participantId || row?.participantUuid || row?.athleteUid || ''),
    bib: String(row?.bib || row?.bibNumber || '—'),
    name: fullName,
    fullName,
    firstName: row?.firstName || null,
    lastName: row?.lastName || null,
    initials: String(row?.initials || fullName)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0])
      .join('')
      .toUpperCase() || 'AT',
    category: String(row?.category || row?.contestName || row?.raceCategory || 'N/A'),
    ageGroup: String(row?.ageGroup || row?.ageGroupName || row?.category || null),
    ageGroupName: String(row?.ageGroupName || row?.ageGroup || row?.category || null),
    gender,
    ticketId: row?.ticketId || null,
    ticketName: row?.ticketName || row?.raceCategory || null,
    status,
    leg: (row?.leg || 'NOT_STARTED') as Leg,
    summary: row?.summary || {},
    splits: row?.splits || [],
    startTime: Number(row?.startTime || 0),
    lastUpdateTime: Number(row?.lastUpdateTime || Date.now()),
    country: row?.country || row?.registration?.country || null,
    courseProgress: Number(row?.courseProgress || 0),
    registrationStatus: row?.registrationStatus || row?.status || null,
    ticketStatus: row?.ticketStatus || null,
  } as LiveAthlete;
}


/**
 * Normalizes a timestamp string into a full ISO 8601 string.
 */
function iso(ts: string) { return new Date(ts).toISOString(); }

// Helper function to extract distance from split name
const extractDistanceFromName = (name: string): number => {
    if (!name) return 0;
    const match = name.match(/(\d+(\.\d+)?)\s*KM/i);
    if (match && match[1]) {
        return parseFloat(match[1]);
    }
    return 0;
};

function isPastCutoff(cutoffTime: string, timezone: string, eventDate: string) {
    const now = new Date();
    
    // Create the cutoff date object based on the event's date and timezone
    const eventDay = new Date(eventDate + 'T00:00:00'); // Start of the event day
    const [h, m, s] = cutoffTime.split(":").map(Number);
    
    // This is a simplification; a robust solution would use a library like `date-fns-tz`.
    // For now, we assume server and event are in a similar-enough timezone for the cutoff logic to work for the race day.
    const cutoffDateTime = new Date(eventDay);
    cutoffDateTime.setHours(h, m, s, 0);

    return now > cutoffDateTime;
}


/**
 * Processes a single raw read from the timing hardware.
 * This is the core of the background job.
 */
export async function processRawRead(eventId: string, ingestId: string) {
  const db = getFirestoreInstance();
  const rawRef = db.doc(`/rawReads/${eventId}/reads/${ingestId}`); // UPDATED PATH
  const snap = await rawRef.get();
  if (!snap.exists) {
      console.warn(`[ingestActions.processRawRead] Raw read doc not found: ${ingestId}`);
      return;
  }
  const data = snap.data()! as any;

  const bib = data.bibNumber ? String(data.bibNumber) : null;
  const splitCode = data.splitCode;
  const splitName = data.SplitName || splitCode; // Use the original name from the payload
  const timestamp = data.lastUpdateTime;
  const lat = data.lat || null;
  const lng = data.lon || null; // Corrected from lon to lng
  const raceTimeStr = data.raceTime || null;

  if (!bib) {
    await rawRef.update({ processingStatus: "error_no_bib" });
    console.warn(`[ingestActions.processRawRead] Ingest ID ${ingestId} has no BIB number. Cannot process.`);
    return;
  }
  
  // 1. Fetch event and participant data
  const [eventSnap, participantSnap] = await Promise.all([
      db.doc(`events/${eventId}`).get(),
      db.collection('events').doc(eventId).collection('participants').where('bibNumber', '==', bib).limit(1).get()
  ]);
  
  if (!eventSnap.exists) {
    console.warn(`[ingestActions.processRawRead] Event doc not found for eventId: ${eventId}`);
    return;
  }
  
  const eventData = eventSnap.data() as EventCalendarEntry;
  const participantDoc = participantSnap.empty ? null : participantSnap.docs[0];
  const participantData = participantDoc?.data();
  
  const ticketId = participantData?.ticketId;
  const ticketDef = ticketId ? eventData.ticketDefinitions?.find(td => td.id === ticketId) : null;
  const cutoffs = ticketDef?.cutoffs;
  
  // 2. Define the split
  const isDua = isDuathlonEvent(ticketDef?.ticketName || '');
  const config = eventData?.liveTimingConfig;
  const splitDefs = config?.jsonMapping ? JSON.parse(config.jsonMapping).splits : [];
  const matchedSplit = splitDefs.find((s: any) => s.code === splitCode);
  const leg = (matchedSplit?.leg || splitCode) as Leg;
  const legIndex = LEG_ORDER.indexOf(leg);

  const raceTimeSeconds = hmsToSeconds(raceTimeStr);
  const distance = matchedSplit?.distanceKm || extractDistanceFromName(splitName) || 0;

  const newSplit: Split = {
    segment: leg,
    name: matchedSplit?.label || splitName,
    time: raceTimeSeconds,
    distance: distance,
    absoluteTimestamp: new Date(timestamp).getTime() / 1000,
  };
  
  // 3. Update liveAthletes state in a transaction
  const athleteStateRef = db.doc(`events/${eventId}/liveAthletes/${bib}`);
  
  await db.runTransaction(async (transaction) => {
    const athleteDoc = await transaction.get(athleteStateRef);
    const existingData = athleteDoc.exists ? athleteDoc.data() as LiveAthlete : null;

    if (existingData?.status === 'Finished' || existingData?.status === 'DNF') {
        console.log(`[ingestActions.processRawRead] Athlete ${bib} already finished or DNF. Skipping update.`);
        return;
    }

    let existingSplits: Split[] = existingData?.splits || [];
    const isDuplicate = existingSplits.some(s => s.segment === newSplit.segment && s.time === newSplit.time);
    if (!isDuplicate) {
      existingSplits.push(newSplit);
      existingSplits.sort((a, b) => a.time - b.time);
    }
    
    let status: Status = leg === 'FINISH' || leg === 'FINISHED' ? 'Finished' : 'On Course';
    let cutoffReason: string | null = null;
    
    if (cutoffs?.mode === 'segment' && eventData.eventDate) {
        const tz = 'Asia/Kolkata'; // Or get from event settings
        if (leg === (isDua ? 'RUN1' : 'SWIM') && cutoffs.swim && isPastCutoff(cutoffs.swim, tz, eventData.eventDate)) { status = 'DNF'; cutoffReason = "Swim/Run1 cutoff missed."; }
        if (leg === 'BIKE' && cutoffs.bike && isPastCutoff(cutoffs.bike, tz, eventData.eventDate)) { status = 'DNF'; cutoffReason = "Bike cutoff missed."; }
        if (leg === (isDua ? 'RUN2' : 'RUN') && cutoffs.run && isPastCutoff(cutoffs.run, tz, eventData.eventDate)) { status = 'DNF'; cutoffReason = "Run cutoff missed."; }
    }


    const updateData: Partial<LiveAthlete> & { [key: string]: any; } = {
        bib: bib,
        name: participantData?.name || 'Unknown Athlete',
        ticketName: participantData?.ticketName || 'N/A',
        ticketId: participantData?.ticketId || null,
        gender: participantData?.gender || null,
        ageGroup: participantData?.ageCategory || null,
        lastCheckpoint: splitName,
        lastSeenAt: new Date(timestamp).getTime(),
        lastUpdateTime: new Date().getTime(),
        leg: leg,
        completedLegIndex: legIndex > -1 ? legIndex : existingData?.completedLegIndex || 0,
        status: status,
        cutoffReason: cutoffReason,
        predictedLocation: { lat, lng },
        splits: existingSplits,
    };
    
    if (!existingData) {
        updateData.startTime = newSplit.time; // Set start time on first read
    }
    
    // Clean undefined values before setting
    Object.keys(updateData).forEach(key => updateData[key as keyof typeof updateData] === undefined && delete updateData[key as keyof typeof updateData]);

    transaction.set(athleteStateRef, updateData, { merge: true });
  });

  // Mark the raw read as processed
  await rawRef.update({ processingStatus: "processed", processedAt: new Date() });
  console.log(`[processRawRead] Successfully processed read ${ingestId} for BIB ${bib}.`);
}

export async function getRawReadsForEventAction(eventId: string): Promise<{ success: boolean; message: string; logs?: any[] }> {
  const actionName = 'getRawReadsForEventAction';
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  try {
    const adminDb = getFirestoreInstance();
    const snapshot = await adminDb.collection('rawReads').doc(eventId).collection('reads')
      .orderBy('receivedAt', 'desc')
      .limit(100)
      .get();
      
    if (snapshot.empty) {
      return { success: true, message: 'No raw reads found for this event.', logs: [] };
    }
    
    const logs = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        receivedAt: toIsoStringSafe(data.receivedAt)!,
      };
    });

    return { success: true, message: 'Logs fetched.', logs: serializeValue(logs) };
  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getDebugDataForBibAction(
  eventId: string,
  bib: string
): Promise<{ success: boolean; message: string; rawReads?: any[]; liveAthlete?: LiveAthlete | null }> {
  const actionName = 'getDebugDataForBibAction';
  if (!eventId || !bib) {
    return { success: false, message: 'Event ID and BIB are required.' };
  }
  try {
    const adminDb = getFirestoreInstance();

    // 1. Get Live Athlete Data
    const liveAthleteRef = adminDb.collection('events').doc(eventId).collection('liveAthletes').doc(bib);
    const liveAthleteSnap = await liveAthleteRef.get();
    const liveAthlete = liveAthleteSnap.exists ? serializeValue({ id: liveAthleteSnap.id, ...liveAthleteSnap.data() }) as LiveAthlete : null;

    // 2. Get Raw Reads Data
    const rawReadsSnap = await adminDb.collection('rawReads').doc(eventId).collection('reads')
      .where('bibNumber', '==', bib)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
      
    const rawReads = rawReadsSnap.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }));

    return {
      success: true,
      message: 'Debug data fetched.',
      rawReads,
      liveAthlete
    };

  } catch (e: any) {
    console.error(`[${actionName}] Error:`, e);
     if ((e as any).code === 'FAILED_PRECONDITION') {
        return { success: false, message: `A database index is required for this query. Please check your Firestore indexes configuration.` };
    }
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getLiveTimingDataAction(
    eventId: string,
    source: 'live' | 'history'
): Promise<{ success: boolean; message: string; participants?: LiveAthlete[] }> {
    const actionName = 'getLiveTimingDataAction';
    try {
        if (!eventId) return { success: false, message: "Event ID is required." };
        
        let participants: LiveAthlete[] = [];

        if (source === 'live') {
      const edgeBaseUrl = getLiveTrackingEdgeBaseUrl();
      if (edgeBaseUrl) {
        try {
          participants = await fetchCloudflareLiveAthletes(eventId, 'live');
          if (participants.length > 0) {
            return { success: true, message: 'Live data fetched from Cloudflare edge API.', participants };
          }
        } catch (edgeError) {
          console.warn(`[${actionName}] Cloudflare edge API fallback triggered:`, edgeError);
        }
      }

            const [liveResults, participantIndex] = await Promise.all([
              getKV<any[]>(`event:${eventId}:liveResults`, actionName),
              loadParticipantIndex(eventId),
            ]);

            const indexRows = getParticipantRowsFromIndex(participantIndex);

            if (indexRows.length > 0) {
              const liveByBib = new Map<string, any>();
              const liveByProviderUuid = new Map<string, any>();
              const liveByAthleteUid = new Map<string, any>();

              for (const row of Array.isArray(liveResults) ? liveResults : []) {
                const bib = String(row?.bib || row?.bibNumber || '').trim();
                const providerUuid = String(row?.participantUuid || row?.participant_uuid || row?.providerUuid || row?.id || '').trim();
                const athleteUid = String(row?.athleteUid || row?.bergmanAthleteId || row?.bergmanAthleteUid || '').trim();
                if (bib) liveByBib.set(bib, row);
                if (providerUuid) liveByProviderUuid.set(providerUuid, row);
                if (athleteUid) liveByAthleteUid.set(athleteUid, row);
              }

              participants = indexRows
                .map((row: any) => {
                  const bib = String(row?.bib || row?.bibNumber || '').trim();
                  const providerUuid = String(row?.provider?.providerUuid || row?.participantUuid || row?.participant_uuid || row?.providerUuid || '').trim();
                  const athleteUid = String(row?.bergmanAthleteId || row?.athleteUid || '').trim();
                  const liveMatch = (providerUuid && liveByProviderUuid.get(providerUuid)) || (bib && liveByBib.get(bib)) || (athleteUid && liveByAthleteUid.get(athleteUid)) || null;
                  return mapLiveTimingAthlete({
                    ...(row || {}),
                    ...(liveMatch || {}),
                    country: liveMatch?.country || row?.country || row?.registration?.country || null,
                  });
                })
                .filter((athlete: any) => !isCancelledOrInactiveStatus(athlete.registrationStatus || athlete.ticketStatus || athlete.status));

              if (participants.length > 0) {
                return { success: true, message: 'Live data from canonical participant index merged with live timing data.', participants };
              }
            }

            const liveRows = Array.isArray(liveResults) ? liveResults : [];

            if (liveRows.length > 0) {
              participants = liveRows
                .map((row: any) => mapLiveTimingAthlete({
                  ...row,
                  name: row?.name || row?.fullName,
                  fullName: row?.fullName || row?.name,
                  leg: row?.leg || row?.currentSplit || 'NOT_STARTED',
                  status: row?.status || 'Not Started',
                  registrationStatus: row?.registrationStatus || row?.status || null,
                  country: row?.country || row?.registration?.country || null,
                }))
                .filter((athlete: any) => !isCancelledOrInactiveStatus(athlete.registrationStatus || athlete.ticketStatus || athlete.status));
              return { success: true, message: 'Live data from KV liveResults.', participants };
            }

            const participantIndexLegacy = await getKV<any>(`event:${eventId}:index`, actionName);
            const indexRowsLegacy = Array.isArray(participantIndexLegacy)
              ? participantIndexLegacy
              : Array.isArray(participantIndexLegacy?.byUuid)
                ? Object.values(participantIndexLegacy.byUuid)
                : [];

            if (indexRowsLegacy.length > 0) {
              participants = indexRowsLegacy
                .map((row: any) => mapLiveTimingAthlete({
                  ...row,
                  status: 'Not Started',
                  leg: 'NOT_STARTED',
                  summary: {},
                  splits: [],
                  startTime: 0,
                  lastUpdateTime: Date.now(),
                  courseProgress: 0,
                }))
                .filter((athlete: any) => !isCancelledOrInactiveStatus(athlete.registrationStatus || athlete.ticketStatus || athlete.status));
              if (participants.length > 0) {
                return { success: true, message: 'Athletes loaded from KV registrations (no live data yet).', participants };
              }
            }
        } else { // 'history'
           const edgeBaseUrl = getLiveTrackingEdgeBaseUrl();
           if (edgeBaseUrl) {
            try {
              participants = await fetchCloudflareLiveAthletes(eventId, 'history');
              if (participants.length > 0) {
                return { success: true, message: 'History data fetched from Cloudflare edge API.', participants };
              }
            } catch (edgeError) {
              console.warn(`[${actionName}] Cloudflare edge API history fallback triggered:`, edgeError);
            }
           }

             const results = await getKV<RaceResult[]>(`results:${eventId}`, actionName);
             if(Array.isArray(results) && results.length > 0) {
                participants = results.map((raceData: RaceResult) => {
              const chipTimeSeconds = raceData.chipTime ? hmsToSeconds(raceData.chipTime) : null;
              const isFinishedFromData = !!(chipTimeSeconds && chipTimeSeconds > 0 && chipTimeSeconds !== Infinity);
              const normalized = normalizeStatus(raceData.status) as Status;
              const finalStatus: Status = isFinishedFromData ? 'Finished' : normalized;

              const summary: LiveAthlete['summary'] = {
                SWIM: raceData.swim ? hmsToSeconds(raceData.swim) : null,
                T1: raceData.t1 ? hmsToSeconds(raceData.t1) : null,
                BIKE: raceData.bike ? hmsToSeconds(raceData.bike) : null,
                T2: raceData.t2 ? hmsToSeconds(raceData.t2) : null,
                RUN: raceData.run ? hmsToSeconds(raceData.run) : null,
                RUN1: raceData.run1 ? hmsToSeconds(raceData.run1) : null,
                RUN2: raceData.run2 ? hmsToSeconds(raceData.run2) : null,
                FINISHED: chipTimeSeconds,
              };

              let finalLeg: Leg | 'NOT_STARTED' = 'NOT_STARTED';
              if (summary.SWIM) finalLeg = 'SWIM';
              if (summary.RUN1) finalLeg = 'RUN1';
              if (summary.T1) finalLeg = 'T1';
              if (summary.BIKE) finalLeg = 'BIKE';
              if (summary.T2) finalLeg = 'T2';
              if (summary.RUN) finalLeg = 'RUN';
              if (summary.RUN2) finalLeg = 'RUN2';
              if (finalStatus === 'Finished') finalLeg = 'FINISHED';

                    return {
                        id: raceData.docId || raceData.bibNumber,
                        bib: raceData.bibNumber,
                        name: raceData.name,
                category: raceData.category || raceData.raceCategory || 'N/A',
                ageGroup: raceData.category || null,
                gender: (raceData.gender as 'Male' | 'Female') || 'Male',
                ticketId: raceData.ticketId || null,
                ticketName: raceData.ticketName || raceData.raceCategory || null,
                status: finalStatus,
                leg: finalLeg,
                summary,
                splits: [],
                startTime: 0,
                lastUpdateTime: Date.now(),
                    } as LiveAthlete;
                });
            }
        }

        return { success: true, message: `Live data from ${source} fetched.`, participants: participants };

    } catch (e: any) {
        console.error(`[${actionName}] Error:`, e);
        return { success: false, message: `Server action failed: ${e.message}` };
    }
}
