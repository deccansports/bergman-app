// src/app/api/admin/bulk-upload-final-results/route.ts
import { NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import * as XLSX from 'xlsx';
import type { EventCalendarEntry, RaceResult, EventParticipant, AthleteStats } from '@/lib/types';
import { startJob, updateJobProgress } from '@/lib/jobManager';
import { toDateStringSafe, normalizeStatus, isDuathlonEvent, isTriathlonEvent, serializeValue } from '@/lib/utils';
import { calculatePointsForResult } from '@/lib/pointsCalculator';
import { putKV } from '@/lib/cloudflare/kv';
import { runDataSyncAction } from '@/lib/actions/dataSyncActions';
import { _syncUserToKV } from '@/lib/actions/dataSyncActions';
import { _syncClubDataToKV } from '@/lib/actions/clubActions';
import { computeLegacyStatus } from '@/lib/actions/athleteRankingActions';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';

export const dynamic = "force-dynamic";
export const runtime = 'nodejs';

const getVal = (row: any, primaryHeader: string, altHeaders: string[] = []): string | null => {
    const lowerPrimary = primaryHeader.toLowerCase().replace(/\s+/g, '');
    const lowerAlts = altHeaders.map(h => h.toLowerCase().replace(/\s+/g, ''));
    
    for (const key in row) {
        const lowerKey = key.toLowerCase().replace(/\s+/g, '');
        if (lowerKey === lowerPrimary || lowerAlts.includes(lowerKey)) {
            const value = row[key];
            return value !== null && value !== undefined ? String(value).trim() : null;
        }
    }
    return null;
};


async function processUploadJob(jobId: string, eventId: string, fileBuffer: Buffer) {
  const actionName = '[API /bulk-upload-final-results BG Job]';
  let successCount = 0;
  let errorCount = 0;
  let results: Array<{ row: number; bib: string; name: string; status: 'success' | 'error' | 'warning'; detail: string }> = [];
  const affectedClubIds = new Set<string>();
  const affectedUserUids = new Set<string>();
  
  const checkpoint = async (progress: number, message: string) => {
    await updateJobProgress(jobId, { status: 'processing', progress, message, results: serializeValue(results) });
  };

  try {
    const adminDb = getFirestoreInstance();
    const eventSnap = await adminDb.collection('events').doc(eventId).get();
    if (!eventSnap.exists) throw new Error("Event not found.");
    const eventData = eventSnap.data() as EventCalendarEntry;

    await checkpoint(5, 'Loading participants and user profiles...');

    const participantsSnap = await adminDb.collection('events').doc(eventId).collection('participants').get();
    const participantsByBib = new Map<string, EventParticipant>();
    participantsSnap.forEach(doc => {
        const p = { id: doc.id, ...doc.data() } as EventParticipant;
        if(p.bibNumber) participantsByBib.set(String(p.bibNumber), p);
    });
    
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { raw: false, defval: null });
    const totalRows = jsonData.length;
    
    const raceDate = toDateStringSafe(eventData.eventDate);
    const raceYear = raceDate ? new Date(raceDate).getFullYear() : new Date().getFullYear();

    const batch = adminDb.batch();
    const raceResultsCol = adminDb.collection('raceResults');

    for (let i = 0; i < totalRows; i++) {
        const row = jsonData[i];
        const rowIndex = i + 2;
        
        const bib = getVal(row, 'Bib Number', ['bibno', 'bib']);
        const name = getVal(row, 'Name', ['athlete name', 'participant name']);

        if (!bib) {
            results.push({ row: rowIndex, bib: 'N/A', name: name || 'N/A', status: 'error', detail: 'Skipped: Row is missing a BIB Number.' });
            errorCount++;
            continue;
        }
        
        const participantRecord = participantsByBib.get(bib);
        if (!participantRecord) {
            results.push({ row: rowIndex, bib: bib, name: name || 'N/A', status: 'warning', detail: `Warning: No registration found for BIB ${bib}. Club attribution might fail.` });
        }

        try {
            const finalUpdate: Partial<RaceResult> = {};
            
            const rawStatus = getVal(row, 'status') ?? 'Finished';
            const finalStatus = normalizeStatus(rawStatus);
            const eventCategoryRaw = getVal(row, 'RACE CAT', ['racecat']) || eventData.eventName;
            const eventCategory = isDuathlonEvent(eventCategoryRaw) ? 'DUATHLON' : (isTriathlonEvent(eventCategoryRaw) ? 'TRIATHLON' : 'OTHER');

            Object.assign(finalUpdate, {
              bibNumber: bib, name, email: participantRecord?.email || getVal(row, 'E-mail', ['emailaddress', 'emailid'])?.toLowerCase(),
              emailLower: participantRecord?.email?.toLowerCase() || getVal(row, 'E-mail', ['emailaddress', 'emailid'])?.toLowerCase(),
              status: rawStatus, statusNormalized: finalStatus,
              category: getVal(row, 'Category', ['cat']) ?? '',
              gender: (getVal(row, 'Gender', ['gen']) as 'Male' | 'Female' | null) ?? 'Unknown',
              swim: eventCategory === 'TRIATHLON' ? getVal(row, 'Swim') : null,
              run1: eventCategory === 'DUATHLON' ? getVal(row, 'RUN 1') : null,
              t1: getVal(row, 'T1'), bike: getVal(row, 'Bike'), t2: getVal(row, 'T2'),
              run: eventCategory === 'TRIATHLON' ? getVal(row, 'Run') : null,
              run2: eventCategory === 'DUATHLON' ? getVal(row, 'RUN 2') : null,
              chipTime: getVal(row, 'Chip Time'), cRank: getVal(row, 'C Rank'),
              oRank: getVal(row, 'O Rank'), gRank: getVal(row, 'G Rank'),
              raceCategory: eventCategoryRaw, location: getVal(row, 'LOCATION') ?? eventData.venueName ?? '',
              eventId, eventName: eventData.eventName, raceDate, raceYear, eventCategory,
              ticketId: participantRecord?.ticketId || null,
              ticketName: participantRecord?.ticketName || null,
              docId: `${eventId}:${bib}`,
              athleteUid: participantRecord?.athleteUid || null,
              clubIdAtRace: participantRecord?.clubId || null,
              clubNameAtRace: participantRecord?.clubName || null,
              countryAtRace: participantRecord?.country || 'India',
              uploadedAt: new Date().toISOString(),
            });
            
            if (normalizeStatus(finalUpdate.status) === 'Finished') {
                const points = calculatePointsForResult(finalUpdate as RaceResult);
                if (points > 0) finalUpdate.pointsAwarded = points;
            }

            const docId = `${eventId}:${bib}`;
            batch.set(raceResultsCol.doc(docId), {
                ...finalUpdate,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            if (finalUpdate.clubIdAtRace) affectedClubIds.add(finalUpdate.clubIdAtRace);
            if (finalUpdate.athleteUid) affectedUserUids.add(finalUpdate.athleteUid);

            results.push({ row: rowIndex, bib: bib!, name: name!, status: 'success', detail: 'Processed result.' });
            successCount++;

        } catch (innerError: any) {
            results.push({ row: rowIndex, bib: bib || 'N/A', name: name || 'N/A', status: 'error', detail: `Error: ${innerError.message}` });
            errorCount++;
        }

        if (i > 0 && i % 10 === 0) {
            await checkpoint(((i + 1) / totalRows) * 100, `Processed ${i + 1} of ${totalRows} results...`);
        }
    }
    
    await batch.commit();

    await checkpoint(90, "Syncing rankings and dashboards...");
    // 🔥 AUTOMATIC SYNC TRIGGER
    await runDataSyncAction('results', eventId);
    await runDataSyncAction('athleteRankings', undefined, raceYear);
    await runDataSyncAction('clubRankings', undefined, raceYear);
    
    // Background sync individual club dashboards for affected clubs
    for (const clubId of Array.from(affectedClubIds)) {
        await _syncClubDataToKV(clubId, raceYear);
    }
    const currentActualYear = new Date().getFullYear();
    for (const uid of Array.from(affectedUserUids)) {
        await _syncUserToKV(uid);
        
        // Re-compute legacy status for updated athletes
        const userResultsSnap = await adminDb.collection('raceResults')
            .where('athleteUid', '==', uid)
            .where('statusNormalized', '==', 'Finished')
            .select('raceYear')
            .get();
        
        const yearsFinished = Array.from(new Set(userResultsSnap.docs.map(d => Number(d.data().raceYear)).filter(Boolean)));
        const stats: AthleteStats = {
            yearsFinished,
            consecutiveStreak: 0,
            lastFinishedYear: null,
            isLegacy: false,
            legacyValidTill: null,
        };
        
        const updatedStats = await computeLegacyStatus(stats, currentActualYear);
        await putKV(`athlete:${uid}:stats`, updatedStats, 'bulk-upload-legacy-sync');
    }
    
    await runDataSyncAction('legacy');

    await updateJobProgress(jobId, { status: 'completed', progress: 100, results: serializeValue(results), message: `Processing complete. ${successCount} results written. Affected Clubs: ${affectedClubIds.size}` });

  } catch (error: any) {
    console.error(`[${actionName}] Critical error for job ${jobId}:`, error);
    await updateJobProgress(jobId, { status: 'failed', progress: 100, results: serializeValue(results), message: `Critical error: ${error.message}` });
  }
}


export async function POST(request: Request) {
  const actionName = '[API /bulk-upload-final-results]';
  
  // Safety check for Firebase configuration
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Firebase not configured', status: 'unavailable' },
      { status: 503 }
    );
  }
  
  try {
    const formData = await request.formData();
    const eventId = formData.get('eventId') as string;
    const file = formData.get('raceDataFile') as File | null;

    if (!file || !eventId) {
      return NextResponse.json({ success: false, message: "Event ID and file are required." }, { status: 400 });
    }
    
    const bytes = await file.arrayBuffer();
    const fileBuffer = Buffer.from(bytes);
    
    const { jobId } = await startJob();
    
    setTimeout(() => {
        processUploadJob(jobId, eventId, fileBuffer);
    }, 0);

    return NextResponse.json({ success: true, message: "Upload started.", jobId });

  } catch (error: any) {
    console.error(`[${actionName}] Critical error during initial upload handling:`, error);
    return NextResponse.json({ success: false, message: `Critical upload error: ${error.message}.` }, { status: 500 });
  }
}
