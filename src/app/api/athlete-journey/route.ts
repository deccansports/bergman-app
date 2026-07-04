import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV } from '@/lib/cloudflare/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type TimingBreakdown = {
  swim: string | null;
  t1: string | null;
  bike: string | null;
  t2: string | null;
  run: string | null;
  chipTime: string | null;
};

function normalizeBib(value: unknown): string {
  return String(value || '').trim();
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeMobile(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeText(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function extractFirstNumberNear(text: string, keyword: string): number | null {
  if (!text) return null;
  const patternA = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:km|k)\\s*${keyword}`, 'i');
  const patternB = new RegExp(`${keyword}\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:km|k)?`, 'i');
  const a = text.match(patternA);
  if (a?.[1]) return Number(a[1]);
  const b = text.match(patternB);
  if (b?.[1]) return Number(b[1]);
  return null;
}

function hmsToSeconds(value?: string | null): number | null {
  if (!value) return null;
  const parts = String(value).split(':').map((x) => Number(x.trim()));
  if (parts.some((x) => Number.isNaN(x))) return null;
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return null;
}

function secondsToHms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function normalizeCode(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function toDisplayTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Assume numeric values are seconds when sourced from raw timing reads.
    if (value <= 0) return null;
    return secondsToHms(value);
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    // Normalize mm:ss and hh:mm:ss.
    const sec = hmsToSeconds(raw);
    return sec !== null ? secondsToHms(sec) : raw;
  }
  return raw;
}

function pickBibRecords(input: any, bibNumber: string): any[] {
  const bib = normalizeBib(bibNumber);
  const rows = Array.isArray(input)
    ? input
    : Array.isArray(input?.reads)
      ? input.reads
      : Array.isArray(input?.items)
        ? input.items
        : Array.isArray(input?.data)
          ? input.data
          : [];

  return rows.filter((r: any) => {
    const b1 = normalizeBib(r?.bibNumber);
    const b2 = normalizeBib(r?.bib);
    const b3 = normalizeBib(r?.startNumber);
    return b1 === bib || b2 === bib || b3 === bib;
  });
}

function applyRawReadToTiming(target: TimingBreakdown, row: any): TimingBreakdown {
  const next = { ...target };

  // Direct split fields (if KV row already contains computed split values).
  next.swim = next.swim || toDisplayTime(row?.swim || row?.swimTime || row?.splitSwim);
  next.t1 = next.t1 || toDisplayTime(row?.t1 || row?.transition1 || row?.splitT1);
  next.bike = next.bike || toDisplayTime(row?.bike || row?.bikeTime || row?.splitBike);
  next.t2 = next.t2 || toDisplayTime(row?.t2 || row?.transition2 || row?.splitT2);
  next.run = next.run || toDisplayTime(row?.run || row?.runTime || row?.splitRun);
  next.chipTime = next.chipTime || toDisplayTime(row?.chipTime || row?.finishTime || row?.totalTime);

  // Raw split signal (splitCode + split value).
  const code = normalizeCode(row?.splitCode || row?.segment || row?.name || row?.splitName);
  const splitValue = toDisplayTime(
    row?.splitTime ?? row?.elapsedTime ?? row?.elapsed ?? row?.time ?? row?.value ?? row?.absoluteTimestamp
  );

  if (code && splitValue) {
    if (!next.swim && code.includes('swim')) next.swim = splitValue;
    if (!next.t1 && (code === 't1' || code.includes('transition1') || code.includes('tran1'))) next.t1 = splitValue;
    if (!next.bike && (code.includes('bike') || code.includes('cycle'))) next.bike = splitValue;
    if (!next.t2 && (code === 't2' || code.includes('transition2') || code.includes('tran2'))) next.t2 = splitValue;
    if (!next.run && code.includes('run')) next.run = splitValue;
    if (!next.chipTime && (code.includes('finish') || code.includes('chip') || code.includes('total'))) next.chipTime = splitValue;
  }

  return next;
}

async function getRawReadTimingFromKV(eventId: string, bibNumber: string): Promise<TimingBreakdown> {
  const empty: TimingBreakdown = { swim: null, t1: null, bike: null, t2: null, run: null, chipTime: null };
  const bib = normalizeBib(bibNumber);
  if (!eventId || !bib) return empty;

  const candidateKeys = [
    `rawReads:${eventId}:${bib}`,
    `rawReads:${eventId}:bib:${bib}`,
    `rawreads:${eventId}:${bib}`,
    `rawreads:${eventId}:bib:${bib}`,
    `event:${eventId}:rawReads:${bib}`,
    `event:${eventId}:rawreads:${bib}`,
    `rawReads:${eventId}`,
    `rawreads:${eventId}`,
    `event:${eventId}:rawReads`,
    `event:${eventId}:rawreads`,
  ];

  let timing = { ...empty };

  for (const key of candidateKeys) {
    const kvVal = await getKV<any>(key, 'athlete-journey');
    if (!kvVal) continue;

    const scopedRows = pickBibRecords(kvVal, bib);
    if (scopedRows.length > 0) {
      for (const row of scopedRows) timing = applyRawReadToTiming(timing, row);
    } else {
      timing = applyRawReadToTiming(timing, kvVal);
    }

    if (timing.swim && timing.t1 && timing.bike && timing.t2 && timing.run && timing.chipTime) break;
  }

  return timing;
}

function dateValue(input: any): string | null {
  if (!input) return null;
  if (typeof input === 'string') return input;
  if (typeof input?.toDate === 'function') {
    try { return input.toDate().toISOString(); } catch { return null; }
  }
  return null;
}

function statusMessageByRaceCount(count: number, postRace = false): string {
  if (!postRace) {
    if (count <= 1) return 'Your journey begins today. One race can change everything.';
    if (count < 5) return 'You’ve come a long way. Stronger, faster, unstoppable.';
    return 'Years of grit. Countless miles. You define Bergman.';
  }
  if (count <= 1) return 'You did what many dream of. Welcome to the finishers club.';
  if (count < 5) return 'Another finish. Another milestone unlocked.';
  return 'You are not just racing. You are building a legacy.';
}

function legacyLabel(finishedCount: number): string {
  if (finishedCount >= 10) return '🏆 You are a TRUE BERGMAN LEGEND';
  if (finishedCount >= 5) return 'Elite Bergman Athlete';
  if (finishedCount >= 3) return 'Consistent Finisher';
  return 'Rising Bergman Athlete';
}

function belStatus(finishedCount: number): 'Active' | 'Returning' | 'New Athlete' {
  if (finishedCount >= 5) return 'Active';
  if (finishedCount >= 1) return 'Returning';
  return 'New Athlete';
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    const db = getFirestoreInstance();

    if (action === 'events') {
      const snap = await db.collection('events').get();
      const events = snap.docs
        .map((doc) => {
          const data = doc.data() || {};
          return {
            id: doc.id,
            eventName: String(data.eventName || 'Untitled Event'),
            eventDate: String(data.eventDate || ''),
            customSlug: String(data.customSlug || ''),
          };
        })
        .sort((a, b) => new Date(b.eventDate || 0).getTime() - new Date(a.eventDate || 0).getTime());

      return NextResponse.json({ success: true, events });
    }

    const eventId = String(searchParams.get('eventId') || '').trim();
    const bibNumber = normalizeBib(searchParams.get('bibNumber'));

    if (!eventId || !bibNumber) {
      return NextResponse.json({ success: false, message: 'Missing eventId or bibNumber' }, { status: 400 });
    }

    const [eventSnap, participantsFromKv, resultsFromKv] = await Promise.all([
      db.collection('events').doc(eventId).get(),
      getKV<any[]>(`event:${eventId}:participants:index`, 'athlete-journey'),
      getKV<any[]>(`results:${eventId}`, 'athlete-journey'),
    ]);

    const eventData = eventSnap.exists ? (eventSnap.data() || {}) : {};
    const sponsorsSnap = await db
      .collection('events')
      .doc(eventId)
      .collection('sponsors')
      .orderBy('order', 'asc')
      .get()
      .catch(async () => db.collection('events').doc(eventId).collection('sponsors').get());

    const sponsors = sponsorsSnap.docs
      .map((doc) => ({
        id: doc.id,
        name: String(doc.data()?.name || '').trim(),
        logoUrl: String(doc.data()?.logoUrl || '').trim(),
        order: Number(doc.data()?.order ?? 9999),
      }))
      .filter((s) => s.name || s.logoUrl)
      .sort((a, b) => a.order - b.order);

    const participant = (Array.isArray(participantsFromKv) ? participantsFromKv : [])
      .find((p) => normalizeBib(p?.bibNumber) === bibNumber) || null;

    const result = (Array.isArray(resultsFromKv) ? resultsFromKv : [])
      .find((r) => normalizeBib(r?.bibNumber) === bibNumber) || null;

    if (!participant && !result) {
      return NextResponse.json({ success: false, message: 'Athlete not found for this BIB in selected event.' }, { status: 404 });
    }

    const athleteUid = String(participant?.athleteUid || result?.athleteUid || '').trim();
    const athleteEmail = normalizeEmail(participant?.email || result?.email || '');
    const athleteMobile = normalizeMobile(participant?.mobile || result?.mobile || '');

    const deduped = new Map<string, any>();
    const pushRace = (row: any, idHint?: string) => {
      const key = String(row?.docId || idHint || `${row?.eventId || ''}:${row?.bibNumber || ''}:${row?.raceDate || ''}`);
      if (!key) return;
      deduped.set(key, {
        ...row,
        raceDate: dateValue(row?.raceDate),
        uploadedAt: dateValue(row?.uploadedAt),
      });
    };

    const queries: Array<Promise<any>> = [];

    if (athleteUid) queries.push(db.collection('raceResults').where('athleteUid', '==', athleteUid).limit(80).get());
    if (athleteEmail) {
      queries.push(db.collection('raceResults').where('emailLower', '==', athleteEmail).limit(80).get());
      queries.push(db.collection('raceResults').where('email', '==', athleteEmail).limit(80).get());
    }
    if (athleteMobile) {
      queries.push(db.collection('raceResults').where('mobile', '==', athleteMobile).limit(80).get());
      if (athleteMobile.length >= 10) {
        queries.push(db.collection('raceResults').where('mobile', '==', athleteMobile.slice(-10)).limit(80).get());
      }
    }

    const snaps = await Promise.all(queries);
    snaps.forEach((snap: any) => {
      snap?.docs?.forEach((doc: any) => pushRace({ ...doc.data(), docId: doc.id }, doc.id));
    });

    if (result) pushRace(result, `${eventId}:${bibNumber}`);

    const history = Array.from(deduped.values()).sort((a, b) => {
      const ad = new Date(a?.raceDate || 0).getTime();
      const bd = new Date(b?.raceDate || 0).getTime();
      return bd - ad;
    });

    const finishedHistory = history.filter((h) => String(h?.statusNormalized || h?.status || '').toLowerCase() === 'finished');
    const finishedCount = finishedHistory.length;

    const currentResult = result || history[0] || null;

    const previousEdition = finishedHistory.find((h) => String(h?.eventId || '') !== String(currentResult?.eventId || '')) || null;
    const currentChipSec = hmsToSeconds(currentResult?.chipTime || currentResult?.finishTime || null);
    const previousChipSec = hmsToSeconds(previousEdition?.chipTime || previousEdition?.finishTime || null);
    const improvementSec = (currentChipSec !== null && previousChipSec !== null) ? (previousChipSec - currentChipSec) : null;

    const currentRunSec = hmsToSeconds(currentResult?.run || null);
    const previousRunSec = hmsToSeconds(previousEdition?.run || null);
    const runImprovementPct = (currentRunSec && previousRunSec && previousRunSec > 0)
      ? Number((((previousRunSec - currentRunSec) / previousRunSec) * 100).toFixed(1))
      : null;

    const pbSec = finishedHistory
      .map((h) => hmsToSeconds(h?.chipTime || h?.finishTime || null))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)[0] ?? null;

    const clubName = String(participant?.clubName || participant?.clubNameAtRace || result?.clubNameAtRace || 'Independent Athlete');
    const clubAthletesRacing = clubName && Array.isArray(participantsFromKv)
      ? participantsFromKv.filter((p) => String(p?.clubName || '').trim().toLowerCase() === clubName.trim().toLowerCase()).length
      : 0;

    const ticketName = String(participant?.ticketName || participant?.raceCategory || result?.ticketName || result?.raceCategory || result?.category || 'Race Category');
    const ticketDefinitions = Array.isArray(eventData?.ticketDefinitions) ? eventData.ticketDefinitions : [];
    const participantTicketId = String(participant?.ticketId || result?.ticketId || '').trim();
    const normalizedTicketName = normalizeText(ticketName);

    const ticketDef = ticketDefinitions.find((t: any) => String(t?.id || '').trim() === participantTicketId)
      || ticketDefinitions.find((t: any) => normalizeText(t?.ticketName) === normalizedTicketName)
      || ticketDefinitions.find((t: any) => {
        const a = normalizeText(t?.ticketName);
        return a.includes(normalizedTicketName) || normalizedTicketName.includes(a);
      })
      || null;

    const descriptionText = String(ticketDef?.description || '').trim();
    const ticketTextBlob = `${ticketName} ${descriptionText}`;

    const extractedSwim = extractFirstNumberNear(ticketTextBlob, 'swim');
    const extractedBike = extractFirstNumberNear(ticketTextBlob, 'bike|cycle|cycling');
    const extractedRun = extractFirstNumberNear(ticketTextBlob, 'run');

    const inferredByCategory = (() => {
      const cat = normalizeText(ticketName);
      if (cat.includes('sprint')) return { swimKm: 0.75, bikeKm: 20, runKm: 5 };
      if (cat.includes('102')) return { swimKm: 2, bikeKm: 80, runKm: 20 };
      if (cat.includes('olympic')) return { swimKm: 1.5, bikeKm: 40, runKm: 10 };
      if (cat.includes('half') || cat.includes('70.3')) return { swimKm: 1.9, bikeKm: 90, runKm: 21.1 };
      if (cat.includes('full') || cat.includes('140.6')) return { swimKm: 3.8, bikeKm: 180, runKm: 42.2 };
      return { swimKm: 1.5, bikeKm: 40, runKm: 10 };
    })();

    const swimDistance = Number(ticketDef?.courseMaps?.swimDistance || extractedSwim || inferredByCategory.swimKm);
    const bikeDistance = Number(ticketDef?.courseMaps?.bikeDistance || extractedBike || inferredByCategory.bikeKm);
    const runDistance = Number(ticketDef?.courseMaps?.runDistance || extractedRun || inferredByCategory.runKm);

    const eventDate = String(eventData?.eventDate || participant?.eventDate || currentResult?.raceDate || '');
    const countdownDays = eventDate ? Math.ceil((new Date(eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    const status = String(currentResult?.statusNormalized || currentResult?.status || '').toLowerCase();
    const rawReadTiming = await getRawReadTimingFromKV(eventId, bibNumber);

    const payload = {
      athlete: {
        name: String(participant?.name || currentResult?.name || 'Athlete'),
        bibNumber,
        raceCategory: `${String(ticketDef?.ticketName || ticketName)}${participant?.ageCategory ? ` – ${participant.ageCategory}` : currentResult?.ageCategory ? ` – ${currentResult.ageCategory}` : ''}`,
        clubName,
        clubAthletesRacing,
        email: athleteEmail,
        mobile: athleteMobile,
      },
      branding: {
        eventName: String(eventData?.eventName || currentResult?.eventName || 'Bergman Event'),
        logoUrl: String(eventData?.finishLedLogoUrl || '').trim() || '/Bmlogowhite.png',
        sponsors,
      },
      preRace: {
        eventName: String(eventData?.eventName || currentResult?.eventName || 'Bergman Event'),
        triVector: {
          swimKm: swimDistance,
          bikeKm: bikeDistance,
          runKm: runDistance,
        },
        countdownDays,
        emotionalLine: countdownDays !== null && countdownDays > 0
          ? `${countdownDays} day${countdownDays === 1 ? '' : 's'} to race day`
          : 'Race day energy is here. Trust your preparation.',
        bel: {
          status: belStatus(finishedCount),
          totalRacesCompleted: finishedCount,
          currentSeasonRanking: Number(currentResult?.ranks?.overall?.rank || currentResult?.oRank || 0) || null,
        },
        legacyRecognition: legacyLabel(finishedCount),
        smartMessage: statusMessageByRaceCount(finishedCount, false),
      },
      postRace: {
        status: status.includes('dnf') ? 'DNF' : status.includes('dns') ? 'DNS' : 'Finisher',
        finishHero: status.includes('dnf') || status.includes('dns') ? 'RACE DAY STORY CONTINUES' : 'YOU ARE A FINISHER',
        timingBreakdown: {
          swim: currentResult?.swim || rawReadTiming.swim || null,
          t1: currentResult?.t1 || rawReadTiming.t1 || null,
          bike: currentResult?.bike || rawReadTiming.bike || null,
          t2: currentResult?.t2 || rawReadTiming.t2 || null,
          run: currentResult?.run || rawReadTiming.run || null,
          chipTime: currentResult?.chipTime || currentResult?.finishTime || rawReadTiming.chipTime || null,
        },
        comparison: {
          previousTime: previousEdition?.chipTime || previousEdition?.finishTime || null,
          currentTime: currentResult?.chipTime || currentResult?.finishTime || null,
          improvement: improvementSec !== null ? (improvementSec >= 0 ? `Improved by ${secondsToHms(improvementSec)}` : `Slower by ${secondsToHms(Math.abs(improvementSec))}`) : 'No comparable prior edition yet',
          personalBest: pbSec !== null ? secondsToHms(pbSec) : null,
        },
        ranks: {
          categoryRank: currentResult?.ranks?.ageGroup?.rank || currentResult?.cRank || null,
          genderRank: currentResult?.ranks?.gender?.rank || currentResult?.gRank || null,
          overallRank: currentResult?.ranks?.overall?.rank || currentResult?.oRank || null,
        },
        evolutionInsight: runImprovementPct !== null
          ? `You improved your run by ${runImprovementPct}% compared to your previous comparable race.`
          : 'Keep stacking race day data—your evolution insight will get sharper with every finish.',
        emotionalMessage: statusMessageByRaceCount(finishedCount, true),
      },
      history: history.slice(0, 20).map((h) => ({
        eventName: String(h?.eventName || 'Bergman Event'),
        year: h?.raceDate ? new Date(h.raceDate).getFullYear() : null,
        category: String(h?.ticketName || h?.raceCategory || h?.category || ''),
        finishTime: h?.chipTime || h?.finishTime || null,
        position: h?.oRank || h?.ranks?.overall?.rank || null,
        status: String(h?.statusNormalized || h?.status || ''),
      })),
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error: any) {
    console.error('[athlete-journey] error', error);
    return NextResponse.json({ success: false, message: error?.message || 'Failed to load athlete journey' }, { status: 500 });
  }
}
