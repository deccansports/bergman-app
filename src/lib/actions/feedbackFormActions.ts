// src/lib/actions/feedbackFormActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { serializeValue } from '@/lib/utils';
import { _syncCouponsToKV } from '@/lib/actions/dataSyncActions';
import { sendDynamicTemplateEmail } from '@/lib/auth/brevoService';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';
import { getKV, putKV } from '@/lib/cloudflare/kv';

const FIRST_SYNC_RECENT_ROWS = 100;
const FEEDBACK_COUPON_DISPATCHES_KV_KEY = 'feedback:coupon-dispatches:recent';
const FEEDBACK_COUPON_DISPATCHES_KV_LIMIT = 1000;

function isAlreadyExistsError(error: any): boolean {
  return error?.code === 6 || error?.code === 'already-exists' || String(error?.message || '').toLowerCase().includes('already exists');
}

export interface FeedbackFormMapping {
  id: string;
  eventId: string;
  eventName: string;
  formUrl: string;
  sheetUrl: string;
  sheetId: string;
  coupon: {
    type: 'flat' | 'percentage';
    value: number;
    expiryDays?: number | null;
  };
  lastSyncedRow: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FeedbackCouponAthleteRecord {
  id: string;
  mappingId: string;
  eventId: string | null;
  eventName: string | null;
  rowNumber: number | null;
  name: string | null;
  email: string | null;
  mobile: string | null;
  couponCode: string | null;
  emailSent: boolean;
  whatsappSent: boolean;
  status: string;
  error?: string | null;
  createdAt: string | null;
}

async function _syncFeedbackCouponDispatchesToKV(limit = FEEDBACK_COUPON_DISPATCHES_KV_LIMIT): Promise<{ count: number }> {
  const actionName = '_syncFeedbackCouponDispatchesToKV';
  const db = getFirestoreInstance();
  const safeLimit = Math.min(2000, Math.max(100, Number.isFinite(Number(limit)) ? Number(limit) : FEEDBACK_COUPON_DISPATCHES_KV_LIMIT));

  const snap = await db
    .collection('feedbackCouponDispatches')
    .orderBy('createdAt', 'desc')
    .limit(safeLimit)
    .get();

  const records: FeedbackCouponAthleteRecord[] = snap.docs.map((doc) => {
    const d = serializeValue(doc.data()) as any;
    return {
      id: doc.id,
      mappingId: String(d.mappingId || ''),
      eventId: d.eventId ? String(d.eventId) : null,
      eventName: d.eventName ? String(d.eventName) : null,
      rowNumber: Number.isFinite(Number(d.rowNumber)) ? Number(d.rowNumber) : null,
      name: d.name ? String(d.name) : null,
      email: d.email ? String(d.email) : null,
      mobile: d.mobile ? String(d.mobile) : null,
      couponCode: d.couponCode ? String(d.couponCode) : null,
      emailSent: !!d.emailSent,
      whatsappSent: !!d.whatsappSent,
      status: String(d.status || 'unknown'),
      error: d.error ? String(d.error) : null,
      createdAt: d.createdAt ? String(d.createdAt) : null,
    };
  });

  await putKV(FEEDBACK_COUPON_DISPATCHES_KV_KEY, records, actionName);
  return { count: records.length };
}

export async function syncFeedbackCouponAthletesToKVAction(options?: { limit?: number }): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const res = await _syncFeedbackCouponDispatchesToKV(Number(options?.limit || FEEDBACK_COUPON_DISPATCHES_KV_LIMIT));
    return { success: true, count: res.count };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to sync feedback athletes to KV.' };
  }
}

export type FeedbackFormMappingInput = Omit<FeedbackFormMapping, 'id' | 'createdAt' | 'updatedAt'>;

function extractSheetIdFromUrl(input: string): string {
  const raw = String(input || '').trim();
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (match) return match[1];
  return raw;
}

function extractSheetGidFromUrl(input: string): string | null {
  const raw = String(input || '').trim();
  const queryMatch = raw.match(/[?&]gid=(\d+)/i);
  if (queryMatch) return queryMatch[1];
  const hashMatch = raw.match(/#gid=(\d+)/i);
  if (hashMatch) return hashMatch[1];
  return null;
}

function isValidGoogleFormUrl(input: string): boolean {
  return /^https:\/\/docs\.google\.com\/forms\//i.test(String(input || '').trim());
}

function isValidGoogleSheetUrl(input: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(String(input || '').trim());
}

function normalizeHeaderKey(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function splitCsvRecords(csvText: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];

    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      if (current.trim().length > 0) records.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) records.push(current);
  return records;
}

async function fetchSheetCsv(sheetId: string, gid?: string | null): Promise<string> {
  const urls = [
    gid ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}` : '',
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`,
  ].filter(Boolean);

  for (const url of urls) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text && text.trim().length > 0) return text;
    } catch {
      // continue next url
    }
  }

  return '';
}

function toDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function generateFeedbackCouponCode(): string {
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BERG-${ts}${rnd}`;
}

function validateInput(data: FeedbackFormMappingInput): string | null {
  if (!data.eventId) return 'Event is required.';
  if (!data.formUrl || !isValidGoogleFormUrl(data.formUrl)) return 'Valid Google Form URL is required.';
  if (!data.sheetUrl || !isValidGoogleSheetUrl(data.sheetUrl)) return 'Valid Google Sheet URL is required.';
  if (!data.sheetId) return 'Could not extract Sheet ID from Sheet URL.';
  if (!data.coupon?.type) return 'Coupon type is required.';
  if (!Number.isFinite(Number(data.coupon?.value)) || Number(data.coupon?.value) <= 0) return 'Coupon value must be greater than 0.';
  return null;
}

export async function getFeedbackFormMappingsAction(): Promise<{ success: boolean; mappings?: FeedbackFormMapping[]; error?: string }> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('feedbackFormMappings').orderBy('createdAt', 'desc').get();
    const mappings = snap.docs.map((doc) => ({
      id: doc.id,
      ...(serializeValue(doc.data()) as Omit<FeedbackFormMapping, 'id'>),
    } as FeedbackFormMapping));
    return { success: true, mappings };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch mappings.' };
  }
}

export async function createFeedbackFormMappingAction(input: FeedbackFormMappingInput): Promise<{ success: boolean; mapping?: FeedbackFormMapping; error?: string }> {
  try {
    const db = getFirestoreInstance();

    const payload: FeedbackFormMappingInput = {
      ...input,
      formUrl: String(input.formUrl || '').trim(),
      sheetUrl: String(input.sheetUrl || '').trim(),
      sheetId: extractSheetIdFromUrl(String(input.sheetUrl || input.sheetId || '')),
      eventId: String(input.eventId || '').trim(),
      eventName: String(input.eventName || '').trim(),
      coupon: {
        type: input.coupon?.type === 'percentage' ? 'percentage' : 'flat',
        value: Math.max(0, Number(input.coupon?.value || 0)),
        expiryDays: input.coupon?.expiryDays == null ? 30 : Math.max(0, Math.round(Number(input.coupon.expiryDays))),
      },
      lastSyncedRow: Number(input.lastSyncedRow || 1),
      active: input.active !== false,
    };

    const error = validateInput(payload);
    if (error) return { success: false, error };

    const ref = db.collection('feedbackFormMappings').doc();
    await ref.set({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const snap = await ref.get();
    const mapping = { id: ref.id, ...(serializeValue(snap.data()) as Omit<FeedbackFormMapping, 'id'>) } as FeedbackFormMapping;
    revalidatePath('/admin/dashboard');
    return { success: true, mapping };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create mapping.' };
  }
}

export async function updateFeedbackFormMappingAction(id: string, input: Partial<FeedbackFormMappingInput>): Promise<{ success: boolean; mapping?: FeedbackFormMapping; error?: string }> {
  try {
    const db = getFirestoreInstance();
    const ref = db.collection('feedbackFormMappings').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { success: false, error: 'Mapping not found.' };

    const current = serializeValue(snap.data()) as FeedbackFormMapping;
    const payload: FeedbackFormMappingInput = {
      eventId: String(input.eventId ?? current.eventId ?? '').trim(),
      eventName: String(input.eventName ?? current.eventName ?? '').trim(),
      formUrl: String(input.formUrl ?? current.formUrl ?? '').trim(),
      sheetUrl: String(input.sheetUrl ?? current.sheetUrl ?? '').trim(),
      sheetId: extractSheetIdFromUrl(String(input.sheetUrl ?? current.sheetUrl ?? current.sheetId ?? '')),
      coupon: {
        type: (input.coupon?.type ?? current.coupon?.type ?? 'flat') === 'percentage' ? 'percentage' : 'flat',
        value: Math.max(0, Number(input.coupon?.value ?? current.coupon?.value ?? 0)),
        expiryDays: input.coupon?.expiryDays ?? current.coupon?.expiryDays ?? 30,
      },
      lastSyncedRow: Number(input.lastSyncedRow ?? current.lastSyncedRow ?? 1),
      active: input.active ?? current.active ?? true,
    };

    const error = validateInput(payload);
    if (error) return { success: false, error };

    await ref.update({
      ...payload,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const updated = await ref.get();
    const mapping = { id: ref.id, ...(serializeValue(updated.data()) as Omit<FeedbackFormMapping, 'id'>) } as FeedbackFormMapping;
    revalidatePath('/admin/dashboard');
    return { success: true, mapping };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update mapping.' };
  }
}

export async function deleteFeedbackFormMappingAction(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestoreInstance();
    await db.collection('feedbackFormMappings').doc(id).delete();
    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete mapping.' };
  }
}

export async function toggleFeedbackFormMappingActiveAction(id: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getFirestoreInstance();
    await db.collection('feedbackFormMappings').doc(id).update({
      active,
      updatedAt: FieldValue.serverTimestamp(),
    });
    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update status.' };
  }
}

export async function syncFeedbackFormMappingAction(
  mappingId: string,
  options?: { forceResync?: boolean }
): Promise<{ success: boolean; created?: number; sentEmail?: number; sentWhatsApp?: number; skipped?: number; lastSyncedRow?: number; error?: string }> {
  try {
    const db = getFirestoreInstance();
    const mappingRef = db.collection('feedbackFormMappings').doc(mappingId);
    const mappingSnap = await mappingRef.get();
    if (!mappingSnap.exists) return { success: false, error: 'Mapping not found.' };

    const mapping = { id: mappingSnap.id, ...(serializeValue(mappingSnap.data() || {}) as Omit<FeedbackFormMapping, 'id'>) } as FeedbackFormMapping;
    if (!mapping.active) return { success: false, error: 'Mapping is inactive.' };

    // Read event once and skip sync for past events to reduce unnecessary reads/writes.
    const eventSnap = await db.collection('events').doc(mapping.eventId).get();
    const eventDateRaw = String((eventSnap.data() as any)?.eventDate || '').trim();
    if (eventDateRaw && eventDateRaw.toUpperCase() !== 'TBD') {
      const eventDate = new Date(eventDateRaw);
      if (!Number.isNaN(eventDate.getTime())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (eventDate < today) {
          return {
            success: true,
            created: 0,
            sentEmail: 0,
            sentWhatsApp: 0,
            skipped: 0,
            lastSyncedRow: Number(mapping.lastSyncedRow || 1),
          };
        }
      }
    }

    const sheetId = extractSheetIdFromUrl(String(mapping.sheetId || mapping.sheetUrl || ''));
    const gid = extractSheetGidFromUrl(String(mapping.sheetUrl || ''));
    if (!sheetId) return { success: false, error: 'Missing Sheet ID.' };

    const csvText = await fetchSheetCsv(sheetId, gid);
    if (!csvText) return { success: false, error: 'Unable to read sheet CSV.' };

    const records = splitCsvRecords(csvText);
    if (records.length <= 1) {
      return { success: true, created: 0, sentEmail: 0, sentWhatsApp: 0, skipped: 0, lastSyncedRow: Number(mapping.lastSyncedRow || 1) };
    }

    const header = parseCsvLine(records[0]).map((h) => h.trim());
    const normalized = header.map((h) => normalizeHeaderKey(h));
    const findCol = (candidates: string[]) => normalized.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

    const col = {
      name: findCol(['name', 'full name']),
      email: findCol(['email id', 'email address', 'email']),
      mobile: findCol(['mobile', 'phone', 'contact number', 'whatsapp number']),
    };

    if (col.email < 0) return { success: false, error: 'Email column not found in sheet.' };

    const lastSynced = Number.isFinite(Number(mapping.lastSyncedRow)) ? Number(mapping.lastSyncedRow) : 1;
    const recentWindowStart = Math.max(2, records.length - FIRST_SYNC_RECENT_ROWS + 1);
    const startLineNumber = options?.forceResync
      ? recentWindowStart
      : (lastSynced <= 1 ? recentWindowStart : Math.max(2, lastSynced + 1));

    let created = 0;
    let sentEmail = 0;
    let sentWhatsApp = 0;
    let skipped = 0;
    let newDispatches = 0;

    const today = new Date();
    const startDate = toDateYmd(today);
    const expiryDays = Math.max(0, Number(mapping.coupon?.expiryDays ?? 30));
    const expiryDate = expiryDays > 0 ? toDateYmd(addDays(today, expiryDays)) : null;

    for (let lineNo = startLineNumber; lineNo <= records.length; lineNo++) {
      const row = parseCsvLine(records[lineNo - 1] || '');
      if (!row || row.length === 0) {
        skipped++;
        continue;
      }

      const email = String(row[col.email] || '').trim().toLowerCase();
      if (!email) {
        skipped++;
        continue;
      }

      const name = col.name >= 0 ? String(row[col.name] || '').trim() : '';
      const mobile = col.mobile >= 0 ? String(row[col.mobile] || '').trim() : '';

      const dispatchId = `fb_${mapping.id}_${lineNo}`;
      const dispatchRef = db.collection('feedbackCouponDispatches').doc(dispatchId);
      try {
        await dispatchRef.create({
          mappingId: mapping.id,
          eventId: mapping.eventId,
          rowNumber: lineNo,
          status: 'processing',
          createdAt: FieldValue.serverTimestamp(),
        });
        newDispatches++;
      } catch (err: any) {
        if (isAlreadyExistsError(err)) {
          skipped++;
          continue;
        }
        throw err;
      }

      let couponCode = '';
      let couponCreated = false;
      for (let attempt = 0; attempt < 5 && !couponCreated; attempt++) {
        couponCode = generateFeedbackCouponCode();
        try {
          await db.collection('coupons').doc(couponCode).create({
            code: couponCode,
            couponType: 'Feedback Coupon',
            discountType: mapping.coupon?.type === 'percentage' ? 'percentage' : 'fixed',
            discountValue: Number(mapping.coupon?.value || 0),
            usageLimit: 1,
            usageCount: 0,
            startDate,
            expiryDate,
            isActive: true,
            applicableEventIds: [mapping.eventId],
            sourceEventIds: [],
            applicableTicketIds: [],
            applicableClubIds: [],
            minCartValue: null,
            email,
            used: false,
            source: 'feedback_form',
            feedbackMappingId: mapping.id,
            feedbackSheetRow: lineNo,
            createdAt: FieldValue.serverTimestamp(),
          });
          couponCreated = true;
        } catch (err: any) {
          if (!isAlreadyExistsError(err)) throw err;
        }
      }

      if (!couponCreated) {
        skipped++;
        await dispatchRef.set({ status: 'failed', error: 'Failed to generate unique coupon code.' }, { merge: true });
        continue;
      }

      const templateParams = {
        name: name || 'Athlete',
        eventname: mapping.eventName || 'the event',
        couponCode,
        discount: mapping.coupon?.type === 'percentage'
          ? `${Number(mapping.coupon?.value || 0)}%`
          : `₹${Number(mapping.coupon?.value || 0)}`,
        validity: expiryDays > 0 ? `${expiryDays} days` : 'Limited period',
      };

      let emailSuccess = false;
      let whatsappSuccess = false;

      try {
        emailSuccess = await sendDynamicTemplateEmail(250, email, templateParams, 'sendFeedbackCouponEmail');
      } catch {
        emailSuccess = false;
      }

      try {
        if (mobile) {
          const wa = await sendAiSensyMessage(
            mobile,
            'feedback_coupon',
            [name || 'Athlete', mapping.eventName || 'the event', couponCode],
            'Bergman Feedback Coupon',
            'sendFeedbackCouponWhatsApp',
            name || 'Athlete'
          );
          whatsappSuccess = wa.success;
        }
      } catch {
        whatsappSuccess = false;
      }

      await dispatchRef.set({
        mappingId: mapping.id,
        eventId: mapping.eventId,
        eventName: mapping.eventName,
        rowNumber: lineNo,
        name: name || null,
        email,
        mobile: mobile || null,
        couponCode,
        emailSent: emailSuccess,
        whatsappSent: whatsappSuccess,
        status: 'sent',
        createdAt: FieldValue.serverTimestamp(),
      });

      created++;
      if (emailSuccess) sentEmail++;
      if (whatsappSuccess) sentWhatsApp++;
    }

    const newLastSyncedRow = Math.max(Number(mapping.lastSyncedRow || 1), records.length);
    await mappingRef.update({
      lastSyncedRow: newLastSyncedRow,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (created > 0) {
      await _syncCouponsToKV();
    }

    if (newDispatches > 0) {
      await _syncFeedbackCouponDispatchesToKV();
    }

    revalidatePath('/admin/dashboard');

    return { success: true, created, sentEmail, sentWhatsApp, skipped, lastSyncedRow: newLastSyncedRow };
  } catch (error: any) {
    return { success: false, error: error.message || 'Sync failed.' };
  }
}

export async function autoSyncFeedbackFormsAction(options?: { forceResync?: boolean }): Promise<{ success: boolean; synced?: number; created?: number; sentEmail?: number; sentWhatsApp?: number; skipped?: number; failures?: Array<{ mappingId: string; error: string }>; error?: string }> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('feedbackFormMappings').where('active', '==', true).get();

    if (snap.empty) {
      return { success: true, synced: 0, created: 0, sentEmail: 0, sentWhatsApp: 0, skipped: 0, failures: [] };
    }

    let synced = 0;
    let created = 0;
    let sentEmail = 0;
    let sentWhatsApp = 0;
    let skipped = 0;
    const failures: Array<{ mappingId: string; error: string }> = [];

    for (const doc of snap.docs) {
      const res = await syncFeedbackFormMappingAction(doc.id, { forceResync: !!options?.forceResync });
      if (res.success) {
        synced++;
        created += Number(res.created || 0);
        sentEmail += Number(res.sentEmail || 0);
        sentWhatsApp += Number(res.sentWhatsApp || 0);
        skipped += Number(res.skipped || 0);
      } else {
        failures.push({ mappingId: doc.id, error: res.error || 'Sync failed.' });
      }
    }

    revalidatePath('/admin/dashboard');
    return { success: true, synced, created, sentEmail, sentWhatsApp, skipped, failures };
  } catch (error: any) {
    return { success: false, error: error.message || 'Auto sync failed.' };
  }
}

export async function getFeedbackSyncDebugMetricsAction(): Promise<{
  success: boolean;
  metrics?: {
    mappings: {
      total: number;
      active: number;
      inactive: number;
    };
    dispatch: {
      totalRecentSample: number;
      last24h: number;
      sent: number;
      failed: number;
      emailSent: number;
      whatsappSent: number;
    };
    coupons: {
      feedbackCouponsSample: number;
      feedbackCouponsLast24h: number;
    };
    estimatedReads: {
      perMappingSyncBaseReads: number;
      perAutoSyncCycleReads: number;
      notes: string[];
    };
    recentDispatches: Array<{
      id: string;
      eventName: string | null;
      email: string | null;
      mobile: string | null;
      couponCode: string | null;
      emailSent: boolean;
      whatsappSent: boolean;
      status: string;
      rowNumber: number | null;
      createdAt: string | null;
      error?: string | null;
    }>;
  };
  error?: string;
}> {
  try {
    const db = getFirestoreInstance();
    const now = Date.now();
    const last24hMs = now - 24 * 60 * 60 * 1000;

    const [mappingsSnap, dispatchSnap, feedbackCouponsSnap] = await Promise.all([
      db.collection('feedbackFormMappings').limit(500).get(),
      db.collection('feedbackCouponDispatches').orderBy('createdAt', 'desc').limit(300).get(),
      db.collection('coupons').where('source', '==', 'feedback_form').limit(300).get(),
    ]);

    const mappings = mappingsSnap.docs.map((d) => serializeValue(d.data()) as any);
    const dispatches = dispatchSnap.docs.map((d) => ({ id: d.id, ...(serializeValue(d.data()) as any) }));
    const feedbackCoupons = feedbackCouponsSnap.docs.map((d) => serializeValue(d.data()) as any);

    const toTs = (value: unknown): number => {
      if (!value) return 0;
      const t = new Date(String(value)).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    const activeMappings = mappings.filter((m) => !!m.active).length;
    const inactiveMappings = mappings.length - activeMappings;

    const dispatchLast24h = dispatches.filter((d) => toTs(d.createdAt) >= last24hMs);
    const couponsLast24h = feedbackCoupons.filter((c) => toTs(c.createdAt) >= last24hMs);

    const sentCount = dispatches.filter((d) => String(d.status || '').toLowerCase() === 'sent').length;
    const failedCount = dispatches.filter((d) => String(d.status || '').toLowerCase() === 'failed').length;
    const emailSentCount = dispatches.filter((d) => !!d.emailSent).length;
    const whatsappSentCount = dispatches.filter((d) => !!d.whatsappSent).length;

    // Current optimized feedback sync base reads:
    // - 1 read: mapping doc
    // - 1 read: event doc
    // Per-row dedupe checks are removed (create-only pattern).
    const perMappingSyncBaseReads = 2;
    const perAutoSyncCycleReads = activeMappings * perMappingSyncBaseReads;

    const recentDispatches = dispatches.slice(0, 100).map((d) => ({
      id: String(d.id || ''),
      eventName: d.eventName ? String(d.eventName) : null,
      email: d.email ? String(d.email) : null,
      mobile: d.mobile ? String(d.mobile) : null,
      couponCode: d.couponCode ? String(d.couponCode) : null,
      emailSent: !!d.emailSent,
      whatsappSent: !!d.whatsappSent,
      status: String(d.status || 'unknown'),
      rowNumber: Number.isFinite(Number(d.rowNumber)) ? Number(d.rowNumber) : null,
      createdAt: d.createdAt ? String(d.createdAt) : null,
      error: d.error ? String(d.error) : null,
    }));

    return {
      success: true,
      metrics: {
        mappings: {
          total: mappings.length,
          active: activeMappings,
          inactive: inactiveMappings,
        },
        dispatch: {
          totalRecentSample: dispatches.length,
          last24h: dispatchLast24h.length,
          sent: sentCount,
          failed: failedCount,
          emailSent: emailSentCount,
          whatsappSent: whatsappSentCount,
        },
        coupons: {
          feedbackCouponsSample: feedbackCoupons.length,
          feedbackCouponsLast24h: couponsLast24h.length,
        },
        estimatedReads: {
          perMappingSyncBaseReads,
          perAutoSyncCycleReads,
          notes: [
            'Estimate counts Firestore document reads in optimized feedback sync path only.',
            'Sheet CSV fetches are external HTTP calls (not Firestore reads).',
            'Per-row dedupe reads were removed using create-only idempotency.',
            'Coupons KV sync only runs when new coupons are created.',
          ],
        },
        recentDispatches,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch Firestore debug metrics.' };
  }
}

export async function getFeedbackCouponAthletesAction(options?: {
  mappingId?: string;
  limit?: number;
}): Promise<{ success: boolean; athletes?: FeedbackCouponAthleteRecord[]; error?: string }> {
  try {
    const actionName = 'getFeedbackCouponAthletesAction';
    const rawLimit = Number(options?.limit || 300);
    const safeLimit = Math.min(1000, Math.max(50, Number.isFinite(rawLimit) ? rawLimit : 300));
    const mappingId = String(options?.mappingId || '').trim();

    const dispatches = (await getKV<FeedbackCouponAthleteRecord[]>(FEEDBACK_COUPON_DISPATCHES_KV_KEY, actionName)) || [];

    const filtered = mappingId
      ? dispatches.filter((d) => String((d as any)?.mappingId || '') === mappingId)
      : dispatches;

    const athletes: FeedbackCouponAthleteRecord[] = filtered
      .slice(0, safeLimit)
      .map((d: any) => ({
        id: String(d.id || ''),
        mappingId: String(d.mappingId || ''),
        eventId: d.eventId ? String(d.eventId) : null,
        eventName: d.eventName ? String(d.eventName) : null,
        rowNumber: Number.isFinite(Number(d.rowNumber)) ? Number(d.rowNumber) : null,
        name: d.name ? String(d.name) : null,
        email: d.email ? String(d.email) : null,
        mobile: d.mobile ? String(d.mobile) : null,
        couponCode: d.couponCode ? String(d.couponCode) : null,
        emailSent: !!d.emailSent,
        whatsappSent: !!d.whatsappSent,
        status: String(d.status || 'unknown'),
        error: d.error ? String(d.error) : null,
        createdAt: d.createdAt ? String(d.createdAt) : null,
      }));

    return { success: true, athletes };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch feedback athletes list.' };
  }
}
