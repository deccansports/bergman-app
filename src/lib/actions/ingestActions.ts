// src/lib/actions/ingestActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { EventCalendarEntry, TicketDefinition, LiveAthlete, Split, Leg, Status, RaceResult } from '@/lib/types';
import { hmsToSeconds, toIsoStringSafe, isDuathlonEvent, serializeValue, normalizeStatus, formatSecondsToHMS } from '@/lib/utils';
import { _internal_fetchAllRaceDataFromFirestore } from '@/lib/actions/publicResultActions';

const LEG_ORDER: (Leg | 'NOT_STARTED')[] = ['NOT_STARTED', 'SWIM', 'RUN1', 'T1', 'BIKE', 'T2', 'RUN', 'RUN2', 'FINISH', 'FINISHED'];


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
            const adminDb = getFirestoreInstance();
            const liveAthletesSnapshot = await adminDb.collection('events').doc(eventId).collection('liveAthletes').get();
            if (!liveAthletesSnapshot.empty) {
                participants = liveAthletesSnapshot.docs.map(doc => serializeValue({ id: doc.id, ...doc.data() }) as LiveAthlete);
            }
        } else { // 'history'
             const { races } = await _internal_fetchAllRaceDataFromFirestore({ eventId });
             if(races && races.length > 0) {
                participants = races.map((raceData: RaceResult) => {
                    return {
                        id: raceData.docId || raceData.bibNumber,
                        bib: raceData.bibNumber,
                        name: raceData.name,
                        status: normalizeStatus(raceData.status),
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
