// src/app/api/live/admin/timing-correction/route.ts
// POST  → write a raw timing correction for an athlete into Firestore
// The correction writes a new split into liveAthletes/{bib}/corrections/{id}
// and also merges the split time directly into the athlete document

import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

const DEFAULT_SPLIT_POINTS = new Set([
  'START', 'SWIM_EXIT', 'BIKE_START',
  'BIKE_20', 'BIKE_40', 'BIKE_60', 'BIKE_80',
  'BIKE_END', 'RUN_START',
  'RUN_5', 'RUN_10', 'RUN_15', 'RUN_20', 'RUN_21',
  'FINISH',
]);

// ─── POST /api/live/admin/timing-correction ──────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { eventId, bib, splitPoint, timestamp, adminKey, splitMeta, elapsedSeconds: rawElapsedSeconds } = body;

    // ── Basic validation ──────────────────────────────────────────────────
    if (!eventId || !bib || !splitPoint || !timestamp) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: eventId, bib, splitPoint, timestamp' },
        { status: 400 }
      );
    }

    const normalizedSplitPoint = String(splitPoint).trim().toUpperCase();
    const isDefault = DEFAULT_SPLIT_POINTS.has(normalizedSplitPoint);
    const isValidCustomFormat = /^[A-Z0-9_:-]{2,80}$/.test(normalizedSplitPoint);

    if (!isDefault && !isValidCustomFormat) {
      return NextResponse.json(
        { success: false, error: `Invalid split point: ${splitPoint}` },
        { status: 400 }
      );
    }

    // ── Soft admin key check (env variable) ──────────────────────────────
    const envKey = process.env.ADMIN_TIMING_KEY;
    if (envKey && adminKey !== envKey) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: invalid admin key' },
        { status: 403 }
      );
    }

    // ── Parse timestamp ───────────────────────────────────────────────────
    const ts = new Date(timestamp);
    if (isNaN(ts.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid timestamp format' },
        { status: 400 }
      );
    }

    const tsSeconds = ts.getTime() / 1000;
    const db = getFirestoreInstance();

    // ── Find athlete document by BIB ──────────────────────────────────────
    const athletesRef = db
      .collection('events')
      .doc(eventId)
      .collection('liveAthletes');

    // Try exact BIB match (case-insensitive)
    const exactQuery = await athletesRef
      .where('bib', '==', bib)
      .limit(1)
      .get();

    let athleteDocRef = exactQuery.empty
      ? athletesRef.doc(bib)  // fallback: create doc with BIB as ID
      : exactQuery.docs[0].ref;

    const athleteFirestoreData = exactQuery.empty ? null : (exactQuery.docs[0].data() as any);
    const athleteStartTime: number = athleteFirestoreData?.startTime ?? 0;
    const currentAthleteStatus: string = athleteFirestoreData?.status ?? 'Not Started';

    // ── Write correction record ───────────────────────────────────────────
    const correctionPayload = {
      bib,
      splitPoint: normalizedSplitPoint,
      splitMeta: splitMeta || null,
      timestampISO: ts.toISOString(),
      timestampSeconds: tsSeconds,
      submittedAt: new Date().toISOString(),
      source: 'admin_correction',
    };

    // Sub-collection: corrections/{autoId}
    await athleteDocRef
      .collection('corrections')
      .add(correctionPayload);

    // ── Merge raw split into the athlete document ─────────────────────────
    // rawSplitLabel → maps to the athlete's splits[] array
    // We merge a Firestore FieldValue.arrayUnion style update:
    // The Cloud Function will pick up corrections and re-process,
    // but we also write directly so the UI reflects the change immediately.
    const splitSegmentMap: Record<string, string> = {
      START:      'START',
      SWIM_EXIT:  'SWIM',
      BIKE_START: 'T1',
      BIKE_END:   'BIKE',
      RUN_START:  'T2',
      FINISH:     'RUN',
      // Sub-splits — stored in splits array with rawSplitLabel
    };

    const legForPoint = (splitMeta?.segment as string | undefined) || splitSegmentMap[normalizedSplitPoint];

    // Build the split entry to merge
    // ── Compute elapsed seconds ──────────────────────────────────────────
    // Priority: 1) provided elapsedSeconds, 2) computed from athlete startTime, 3) 0
    const providedElapsed = rawElapsedSeconds !== undefined && rawElapsedSeconds !== null
      ? Number(rawElapsedSeconds)
      : null;
    let elapsedForStore: number;
    if (providedElapsed !== null && !isNaN(providedElapsed) && providedElapsed >= 0) {
      elapsedForStore = providedElapsed;
    } else if (athleteStartTime > 0) {
      elapsedForStore = Math.max(0, tsSeconds - athleteStartTime);
    } else {
      elapsedForStore = 0;
    }

    const newSplitEntry = {
      segment: legForPoint ?? splitPoint,
      distance: Number(splitMeta?.distanceKm || 0),
      time: elapsedForStore,
      name: splitMeta?.label || normalizedSplitPoint,
      rawSplitLabel: normalizedSplitPoint,
      absoluteTimestamp: tsSeconds,
      source: 'admin_correction',
      correctedAt: new Date().toISOString(),
    };

    // Use FieldValue to append without reading the full array
    const { FieldValue } = await import('firebase-admin/firestore');

    // Build update payload — also update summary and status for immediate UI reflection
    const updatePayload: Record<string, any> = {
      splits: FieldValue.arrayUnion(newSplitEntry),
      lastCorrectionAt: new Date().toISOString(),
    };

    // Update the summary field for the leg segment
    const summarySegment = legForPoint as string | undefined;
    if (summarySegment && elapsedForStore > 0) {
      updatePayload[`summary.${summarySegment}`] = elapsedForStore;
      if (summarySegment === 'FINISH' || normalizedSplitPoint === 'FINISH') {
        updatePayload['summary.FINISHED'] = elapsedForStore;
      }
    }

    // Update athlete status (Not Started / Not Yet → On Course; FINISH → Finished)
    if (!['Finished', 'DNF'].includes(currentAthleteStatus)) {
      updatePayload.status = (normalizedSplitPoint === 'FINISH') ? 'Finished' : 'On Course';
    }

    // Set startTime when the START split is recorded and no startTime exists
    if (normalizedSplitPoint === 'START' && (!athleteStartTime || athleteStartTime === 0)) {
      updatePayload.startTime = tsSeconds;
    }

    await athleteDocRef.set(updatePayload, { merge: true });

    return NextResponse.json({
      success: true,
      message: `Correction recorded: BIB ${bib} — ${normalizedSplitPoint} @ ${ts.toISOString()}`,
      athleteId: athleteDocRef.id,
    });

  } catch (err: any) {
    console.error('[timing-correction] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── GET /api/live/admin/timing-correction ────────────────────────────────────
// Returns recent corrections for an event

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const bib = searchParams.get('bib');

    if (!eventId) {
      return NextResponse.json(
        { success: false, error: 'eventId is required' },
        { status: 400 }
      );
    }

    const db = getFirestoreInstance();
    const athletesRef = db
      .collection('events')
      .doc(eventId)
      .collection('liveAthletes');

    let docsToQuery = bib
      ? (await athletesRef.where('bib', '==', bib).limit(1).get()).docs
      : (await athletesRef.limit(200).get()).docs;

    const corrections: any[] = [];
    for (const doc of docsToQuery) {
      const corrSnap = await doc.ref
        .collection('corrections')
        .orderBy('submittedAt', 'desc')
        .limit(20)
        .get();
      corrSnap.forEach(c => {
        corrections.push({ id: c.id, athleteId: doc.id, ...c.data() });
      });
    }

    corrections.sort((a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

    return NextResponse.json({ success: true, corrections: corrections.slice(0, 100) });

  } catch (err: any) {
    console.error('[timing-correction GET] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}
