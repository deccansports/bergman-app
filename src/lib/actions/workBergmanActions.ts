'use server';

import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import {
  Worker,
  OpenRole,
  Application,
  WorkerAssignment,
  Payment,
  Certification,
  DocumentReference,
  Communication,
  CommunicationTemplate,
  WorkBergmanSettings,
} from '@/lib/types/workWithBergman';
import { FieldValue } from 'firebase-admin/firestore';
import { sendDynamicTemplateEmail, sendRawHtmlEmail } from '@/lib/auth/brevoService';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';
import { sendNotification } from '@/lib/services/templateService';

// Initialize Firebase Admin if not already done
const apps = getApps();
const app = apps.length > 0 ? apps[0] : initializeApp();
const adminDb = getFirestore(app);

const DEFAULT_CAREERS_DOMAIN =
  (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '') || 'localhost:3000';
const CAREERS_PATH = '/work-with-bergman';

function compactFirestoreData<T>(value: T): T {
  if (value === undefined) {
    return null as T;
  }

  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => compactFirestoreData(item)) as T;
  }

  if (value && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[key] = compactFirestoreData(val);
    }
    return out as T;
  }

  return value;
}

function extractSheetIdFromUrl(input: string): string {
  const raw = String(input || '').trim();
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (match) return match[1];
  return raw;
}

function buildPublicCareersUrl(input?: string): string {
  const raw = String(input || '').trim();

  const inferProtocolForHost = (host: string, fallback: 'http:' | 'https:' = 'https:') => {
    const lowerHost = String(host || '').toLowerCase();
    if (lowerHost.includes('localhost') || lowerHost.startsWith('127.0.0.1')) return 'http:';
    return fallback;
  };

  const withProtocol = raw
    ? (/^https?:\/\//i.test(raw) ? raw : `${inferProtocolForHost(raw)}//${raw}`)
    : `${inferProtocolForHost(DEFAULT_CAREERS_DOMAIN)}//${DEFAULT_CAREERS_DOMAIN}`;

  try {
    const parsed = new URL(withProtocol);
    const host = parsed.host || DEFAULT_CAREERS_DOMAIN;
    const protocol = parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.protocol
      : inferProtocolForHost(host);
    return `${protocol}//${host}${CAREERS_PATH}`;
  } catch {
    const protocol = inferProtocolForHost(DEFAULT_CAREERS_DOMAIN);
    return `${protocol}//${DEFAULT_CAREERS_DOMAIN}${CAREERS_PATH}`;
  }
}

function extractSheetGidFromUrl(input: string): string | null {
  const raw = String(input || '').trim();
  const queryMatch = raw.match(/[?&]gid=(\d+)/i);
  if (queryMatch) return queryMatch[1];
  const hashMatch = raw.match(/#gid=(\d+)/i);
  if (hashMatch) return hashMatch[1];
  return null;
}

function isValidGoogleSheetUrl(input: string): boolean {
  const raw = String(input || '').trim();
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(raw);
}

function parseCsvText(csvText: string): string[][] {
  const source = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!source.trim()) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (ch === '"') {
      if (inQuotes && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if (ch === '\n' && !inQuotes) {
      row.push(cell.trim());
      cell = '';

      if (row.some((item) => item.length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((item) => item.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeEmail(input: string | undefined): string {
  return String(input || '').trim().toLowerCase();
}

function hasValidEmail(input: string | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input || '').trim());
}

function hasValidPhone(input: string | undefined): boolean {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 14;
}

function hasSaneWorkerName(input: string | undefined): boolean {
  const name = String(input || '').trim();
  if (!name || name.length < 2 || name.length > 80) return false;
  if (name.includes('@')) return false;
  if (/https?:\/\//i.test(name)) return false;
  if (name.includes('\n')) return false;

  // Reject sentence-like / CSV-fragment strings that are not person names.
  if (/[,:;()\[\]{}]/.test(name)) return false;
  if (/\d/.test(name)) return false;

  // Keep only common name-safe characters.
  if (!/^[A-Za-z .'-]+$/.test(name)) return false;

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 6) return false;

  return parts.every((part) => part.length <= 30);
}

function isLikelyValidWorkerRecord(worker: Worker): boolean {
  return hasSaneWorkerName(worker.fullName) && hasValidEmail(worker.email);
}

function dedupeWorkersByEmail(workers: Worker[]): Worker[] {
  const byIdentity = new Map<string, Worker>();

  const asTime = (value: unknown): number => {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string' || typeof value === 'number') {
      const t = new Date(value).getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    if (typeof value === 'object' && value !== null && 'toDate' in (value as Record<string, unknown>)) {
      try {
        const date = (value as { toDate: () => Date }).toDate();
        return date?.getTime?.() ?? 0;
      } catch {
        return 0;
      }
    }
    return 0;
  };

  const completenessScore = (worker: Worker): number => {
    let score = 0;
    const addIf = (value: unknown, weight = 1) => {
      if (Array.isArray(value)) {
        if (value.length > 0) score += weight;
        return;
      }
      if (typeof value === 'number') {
        if (!Number.isNaN(value) && value > 0) score += weight;
        return;
      }
      if (typeof value === 'boolean') {
        score += weight;
        return;
      }
      if (value !== undefined && value !== null && String(value).trim().length > 0) {
        score += weight;
      }
    };

    addIf(worker.fullName, 2);
    addIf(worker.email, 2);
    addIf(worker.whatsappNumber, 2);
    addIf(worker.dob, 2);
    addIf(worker.age, 2);
    addIf(worker.city, 2);
    addIf(worker.state, 2);
    addIf(worker.country, 1);
    addIf(worker.tshirtSize, 1);
    addIf(worker.occupation, 1);
    addIf(worker.languages, 1);
    addIf(worker.sportsParticipated, 1);
    addIf(worker.eventExperience, 1);
    addIf(worker.leadershipExperience, 1);
    addIf(worker.previousOrganizers, 1);
    addIf(worker.certifications, 1);
    addIf(worker.skills, 1);
    addIf(worker.notes, 1);
    addIf(worker.idCardUrl, 2);

    return score;
  };

  for (const worker of workers) {
    const emailKey = normalizeEmail(worker?.email);
    const identity = emailKey || String(worker?.id || worker?.workerId || '');
    if (!identity) continue;

    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, worker);
      continue;
    }

    const existingTime = Math.max(
      asTime(existing.updatedAt),
      asTime(existing.timestamp),
      asTime(existing.createdAt)
    );
    const candidateTime = Math.max(
      asTime(worker.updatedAt),
      asTime(worker.timestamp),
      asTime(worker.createdAt)
    );

    const existingScore = completenessScore(existing);
    const candidateScore = completenessScore(worker);

    if (candidateScore > existingScore) {
      byIdentity.set(identity, worker);
      continue;
    }

    if (candidateScore < existingScore) {
      continue;
    }

    if (candidateTime >= existingTime) {
      byIdentity.set(identity, worker);
    }
  }

  return Array.from(byIdentity.values());
}

function toClientSafe<T>(value: T): T {
  const convert = (input: unknown): unknown => {
    if (input === null || input === undefined) return input;

    if (input instanceof Date) {
      return input.toISOString();
    }

    if (Array.isArray(input)) {
      return input.map((item) => convert(item));
    }

    if (typeof input === 'object') {
      const maybeTimestamp = input as { toDate?: () => Date; _seconds?: number; _nanoseconds?: number };
      if (typeof maybeTimestamp.toDate === 'function') {
        try {
          return maybeTimestamp.toDate().toISOString();
        } catch {
          return null;
        }
      }

      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        out[key] = convert(val);
      }
      return out;
    }

    return input;
  };

  return convert(value) as T;
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
      // Try next URL
    }
  }

  return '';
}

function normalizeList(input: string | undefined): string[] {
  return String(input || '')
    .split(/[;,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBoolean(input: string | undefined, fallback = false): boolean {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['true', '1', 'yes', 'y', 'on', 'checked'].includes(value);
}

function normalizeHeaderKey(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickFirst(row: Record<string, string>, keys: string[]): string {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeaderKey(key), value] as const);
  for (const key of keys) {
    const normalizedKey = normalizeHeaderKey(key);
    const value = normalizedEntries.find(([entryKey]) => entryKey === normalizedKey)?.[1];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function inferWorkerFromRow(row: Record<string, string>, mapColumns: Record<string, string>): Partial<Worker> {
  const resolve = (field: string, aliases: string[]) => {
    for (const [column, mappedField] of Object.entries(mapColumns || {})) {
      if (String(mappedField || '').trim().toLowerCase() === field.toLowerCase() && row[column] !== undefined) {
        const mappedValue = String(row[column] || '').trim();
        if (mappedValue) return mappedValue;
      }
    }
    return pickFirst(row, aliases);
  };

  const fullName = resolve('fullName', ['fullName', 'Full Name', 'name', 'worker name', 'worker', 'candidate name']);
  const email = resolve('email', ['email', 'Email address', 'Email Id', 'Email', 'e-mail', 'mail']);

  return {
    fullName,
    email,
    dob: resolve('dob', ['dob', 'Date of Birth', 'birth date', 'date of birth']),
    age: Number(resolve('age', ['age', 'Age']) || 0) || undefined,
    whatsappNumber: resolve('whatsappNumber', ['whatsappNumber', 'Whatsapp Number', 'phone', 'mobile', 'mobile number', 'whatsapp']),
    address: resolve('address', ['address', 'Address', 'street address']),
    city: resolve('city', ['city', 'Current City', 'town']),
    state: resolve('state', ['state', 'State', 'province']),
    country: resolve('country', ['country', 'Country']),
    gender: (resolve('gender', ['gender', 'Gender']) as Worker['gender']) || undefined,
    tshirtSize: (resolve('tshirtSize', ['tshirt size', 'Tshirt Size', 'tshirtSize', 't-shirt size']) as Worker['tshirtSize']) || undefined,
    occupation: resolve('occupation', ['occupation', 'Occupation', 'job', 'profession']),
    languages: normalizeList(resolve('languages', ['languages', 'Languages Spoken', 'language'])),
    isTriathlete: normalizeBoolean(resolve('isTriathlete', ['isTriathlete', 'Are You a Triathlete', 'triathlete', 'triathlete?']), false),
    sportsParticipated: normalizeList(resolve('sportsParticipated', ['sportsParticipated', 'Which Endurance Sports Have you Participated in?', 'sports', 'sport'])),
    yearsExperience: Number(resolve('yearsExperience', ['yearsExperience', 'Number of Years Involved in endurance Sports?', 'experience years', 'years of experience']) || 0) || undefined,
    eventExperience: resolve('eventExperience', ['eventExperience', 'Have you Ever Volunteered or Worked at a Sporting event?', 'event experience']),
    leadershipExperience: resolve('leadershipExperience', ['leadershipExperience', 'Do you have leadership experience managing a team', 'leadership experience']),
    previousOrganizers: normalizeList(resolve('previousOrganizers', ['previousOrganizers', 'Have you worked with any triathlon,cycling,running or sports event organizers before?', 'previous organizers', 'organizers'])),
    travelAvailability: (resolve('travelAvailability', ['travelAvailability', 'Are you willing to travel for events for 2 - 3 Days?', 'travel']) as Worker['travelAvailability']) || undefined,
    vehicleTypes: normalizeList(resolve('vehicleTypes', ['vehicleTypes', 'What all vehicles do you ride?', 'vehicles', 'vehicle type'])),
    availabilityPerYear: Number(resolve('availabilityPerYear', ['availabilityPerYear', 'How many events can you be available for the events in a year?', 'events per year', 'availability']) || 0) || undefined,
    weekendAvailability: normalizeBoolean(resolve('weekendAvailability', ['weekendAvailability', 'Are You Available of Weekends (Friday , Saturday, Sunday)', 'weekend availability']), false),
    certifications: normalizeList(resolve('certifications', ['certifications', 'Do you have any of the following certifications?', 'certification'])),
    skills: normalizeList(resolve('skills', ['skills', 'What unique skills can you bring to our events?', 'skill'])),
    notes: resolve('notes', ['notes', 'Describe why you would be a good fit for Team bergman?', 'remark', 'remarks']),
    idCardUrl: resolve('idCardUrl', ['idCardUrl', 'Upload your Id', 'Upload your ID', 'upload id', 'id upload', 'id card url']),
    panNumber: resolve('panNumber', ['panNumber', 'PAN', 'pan', 'pan no']),
    ifscCode: resolve('ifscCode', ['ifscCode', 'IFSC', 'ifsc']),
    bankAccountName: resolve('bankAccountName', ['bankAccountName', 'Bank Account Name', 'account name']),
    bankAccountNumber: resolve('bankAccountNumber', ['bankAccountNumber', 'Bank Account Number', 'account number']),
    upiId: resolve('upiId', ['upiId', 'UPI', 'upi']),
    declaration: normalizeBoolean(resolve('declaration', ['declaration', 'Declaration', 'agree', 'terms']), false),
  };
}

async function upsertWorkerByEmail(workerData: Partial<Worker>) {
  const email = normalizeEmail(workerData.email);
  if (!email) {
    return { success: false, created: false, duplicate: false, skipped: true };
  }

  let existingSnap = await adminDb.collection('workers').where('email', '==', email).limit(1).get();

  // Backward-compatibility for old records where email may have been stored with mixed case.
  if (existingSnap.empty) {
    const legacySnap = await adminDb
      .collection('workers')
      .where('syncedFromGoogleSheet', '==', true)
      .get();

    const legacyMatch = legacySnap.docs.find((doc: any) => {
      const existingEmail = normalizeEmail((doc.data() as Worker)?.email);
      return existingEmail === email;
    });

    if (legacyMatch) {
      existingSnap = {
        empty: false,
        docs: [legacyMatch],
      } as typeof existingSnap;
    }
  }

  const now = new Date();

  if (!existingSnap.empty) {
    const doc = existingSnap.docs[0];
    const updatePayload = compactFirestoreData({
      ...workerData,
      email,
      updatedAt: now,
      lastSyncedAt: now,
      syncedFromGoogleSheet: true,
    });
    await doc.ref.set(updatePayload as Record<string, unknown>, { merge: true });
    return { success: true, created: false, duplicate: false, skipped: false };
  }

  const workerId = `WORKER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const id = adminDb.collection('workers').doc().id;
  const worker: Worker = {
    id,
    workerId,
    timestamp: now,
    fullName: String(workerData.fullName || '').trim() || 'Unnamed Worker',
    email,
    status: (workerData.status as Worker['status']) || 'Active',
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: now,
    syncedFromGoogleSheet: true,
    isRecruitmentApproved: false,
    ...workerData,
  } as Worker;

  await adminDb.collection('workers').doc(id).set(compactFirestoreData(worker) as unknown as Record<string, unknown>);
  return { success: true, created: true, duplicate: false, skipped: false };
}

// ===================== WORKER MANAGEMENT =====================

export async function addWorker(
  workerData: Omit<Worker, 'id' | 'workerId' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; data?: Worker; error?: string }> {
  try {
    // Generate unique workerId
    const workerId = `WORKER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const worker: Worker = {
      id: adminDb.collection('workers').doc().id,
      workerId,
      ...workerData,
      status: 'Active',
      syncedFromGoogleSheet: false,
      isRecruitmentApproved: true,
      recruitmentApprovedAt: new Date(),
      eventsWorked: 0,
      totalPaid: 0,
      paymentPending: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await adminDb.collection('workers').doc(worker.id).set(worker);

    return { success: true, data: toClientSafe(worker) as Worker };
  } catch (error) {
    return {
      success: false,
      error: `Failed to add worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function updateWorker(
  workerId: string,
  updates: Partial<Worker>
): Promise<{ success: boolean; data?: Worker; error?: string }> {
  try {
    const workerRef = adminDb.collection('workers').doc(workerId);
    const workerSnap = await workerRef.get();

    if (!workerSnap.exists) {
      return { success: false, error: 'Worker not found' };
    }

    const updatedData = {
      ...updates,
      updatedAt: new Date(),
    };

    await workerRef.update(updatedData);

    const updated = await workerRef.get();
    return { success: true, data: toClientSafe(updated.data() as Worker) as Worker };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function deleteWorker(workerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Soft delete: mark as inactive
    await adminDb.collection('workers').doc(workerId).update({
      status: 'Inactive',
      updatedAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getWorker(workerId: string): Promise<Worker | null> {
  try {
    const snap = await adminDb.collection('workers').doc(workerId).get();
    return snap.exists ? (toClientSafe(snap.data() as Worker) as Worker) : null;
  } catch (error) {
    console.error('Failed to fetch worker:', error);
    return null;
  }
}

export async function searchWorkers(
  query: string,
  filters?: {
    city?: string;
    status?: string;
    certifications?: string[];
  }
): Promise<Worker[]> {
  try {
    const queryRef = adminDb.collection('workers');

    // Text search on name or email
    if (query) {
      const lowerQuery = query.toLowerCase();
      const results: Worker[] = [];
      const snap = await queryRef.get();

      snap.forEach((doc: any) => {
        const worker = doc.data() as Worker;
        if (
          worker.fullName?.toLowerCase().includes(lowerQuery) ||
          worker.email?.toLowerCase().includes(lowerQuery)
        ) {
          results.push(worker);
        }
      });

      const unique = dedupeWorkersByEmail(results).filter((w) => isLikelyValidWorkerRecord(w));

      return unique.filter((w: Worker) => {
        if (filters?.status && w.status !== filters.status) return false;
        if (filters?.city && w.city !== filters.city) return false;
        if (
          filters?.certifications &&
          filters.certifications.length > 0 &&
          (!w.certifications || !filters.certifications.some((c) => w.certifications?.includes(c)))
        ) {
        return false;
      }
      return true;
    }).map((worker) => toClientSafe(worker) as Worker);

    }

    // If no query, apply filters
    const snap = await queryRef.get();
    const workers = dedupeWorkersByEmail(snap.docs.map((doc: any) => doc.data() as Worker)).filter((w) => isLikelyValidWorkerRecord(w));

    return workers.filter((w: Worker) => {
      if (filters?.status && w.status !== filters.status) return false;
      if (filters?.city && w.city !== filters.city) return false;
      if (
        filters?.certifications &&
        filters.certifications.length > 0 &&
        (!w.certifications || !filters.certifications.some((c) => w.certifications?.includes(c)))
      ) {
        return false;
      }
      return true;
    }).map((worker) => toClientSafe(worker) as Worker);
  } catch (error) {
    console.error('Failed to search workers:', error);
    return [];
  }
}

export async function getAllWorkers(): Promise<Worker[]> {
  try {
    const snap = await adminDb
      .collection('workers')
      .where('status', '==', 'Active')
      .get();
    return dedupeWorkersByEmail(snap.docs.map((doc: any) => doc.data() as Worker))
      .filter((worker) => isLikelyValidWorkerRecord(worker))
      .map((worker) => toClientSafe(worker) as Worker);
  } catch (error) {
    console.error('Failed to fetch workers:', error);
    return [];
  }
}

export async function importWorkersFromGoogleSheet(
  sheetUrl: string,
  mapColumns: Record<string, string> // Map column name to field
): Promise<{ success: boolean; imported: number; duplicates: number; updated: number; skipped: number; headers?: string[]; error?: string }> {
  try {
    if (!sheetUrl || !isValidGoogleSheetUrl(sheetUrl)) {
      return { success: false, imported: 0, duplicates: 0, updated: 0, skipped: 0, error: 'Valid Google Sheet URL is required.' };
    }

    const sheetId = extractSheetIdFromUrl(sheetUrl);
    const gid = extractSheetGidFromUrl(sheetUrl);
    const csvText = await fetchSheetCsv(sheetId, gid);

    if (!csvText) {
      return {
        success: false,
        imported: 0,
        duplicates: 0,
        updated: 0,
        skipped: 0,
        error: 'Unable to read sheet CSV. Ensure the sheet is accessible or published for CSV export.',
      };
    }

    const rows = parseCsvText(csvText);
    if (rows.length < 2) {
      return { success: true, imported: 0, duplicates: 0, updated: 0, skipped: 0, headers: rows[0] || [] };
    }

    const headers = rows[0];
    const body = rows.slice(1);
    const headersMap: Record<string, string> = {};
    headers.forEach((header) => {
      const normalized = String(header || '').trim();
      if (normalized) headersMap[normalized] = normalized;
    });

    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    let skipped = 0;
    const seenEmailsInThisRun = new Set<string>();

    for (const rowValues of body) {
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[String(header || '').trim()] = String(rowValues[index] || '').trim();
      });

      const workerData = inferWorkerFromRow(row, mapColumns && Object.keys(mapColumns).length > 0 ? mapColumns : headersMap);
      const email = normalizeEmail(workerData.email);
      const fullName = String(workerData.fullName || '').trim();

      if (!email || !fullName) {
        skipped += 1;
        continue;
      }

      // Prevent duplicate creates when the source sheet itself has repeated rows.
      if (seenEmailsInThisRun.has(email)) {
        duplicates += 1;
        skipped += 1;
        continue;
      }
      seenEmailsInThisRun.add(email);

      const result = await upsertWorkerByEmail({
        ...workerData,
        email,
        fullName,
      });

      if (!result.success || result.skipped) {
        skipped += 1;
        continue;
      }

      if (result.created) imported += 1;
      else updated += 1;
      if (result.duplicate) duplicates += 1;
    }

    return {
      success: true,
      imported,
      duplicates,
      updated,
      skipped,
      headers,
    };
  } catch (error) {
    return {
      success: false,
      imported: 0,
      duplicates: 0,
      updated: 0,
      skipped: 0,
      error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getWorkBergmanSettingsAction(): Promise<{ success: boolean; data?: WorkBergmanSettings; error?: string }> {
  try {
    const snap = await adminDb.collection('settings').doc('workWithBergman').get();
    const data = toClientSafe((snap.data() || {}) as Partial<WorkBergmanSettings>);

    const payload = {
      id: 'workWithBergman',
      googleSheetUrl: data.googleSheetUrl || '',
      googleSheetSyncEnabled: data.googleSheetSyncEnabled ?? false,
      autoSyncInterval: data.autoSyncInterval ?? 60,
      bergTechnoApiKey: data.bergTechnoApiKey,
      aiSensyApiKey: data.aiSensyApiKey,
      publicCareersUrl: buildPublicCareersUrl(data.publicCareersUrl),
      autoApprovalEnabled: data.autoApprovalEnabled ?? false,
      requiredDocuments: data.requiredDocuments || ['Aadhaar', 'Bank Details', 'PAN'],
      permissions: data.permissions || {},
      updatedAt: data.updatedAt || new Date().toISOString(),
    };

    return {
      success: true,
      data: toClientSafe(payload) as WorkBergmanSettings,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to load Work With Bergman settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function saveWorkBergmanSettingsAction(
  input: Partial<WorkBergmanSettings>
): Promise<{ success: boolean; data?: WorkBergmanSettings; error?: string }> {
  try {
    const current = await getWorkBergmanSettingsAction();
    const merged: WorkBergmanSettings = {
      id: 'workWithBergman',
      googleSheetUrl: String(input.googleSheetUrl ?? current.data?.googleSheetUrl ?? '').trim(),
      googleSheetSyncEnabled: input.googleSheetSyncEnabled ?? current.data?.googleSheetSyncEnabled ?? false,
      autoSyncInterval: Number(input.autoSyncInterval ?? current.data?.autoSyncInterval ?? 60) || 60,
      bergTechnoApiKey: current.data?.bergTechnoApiKey,
      aiSensyApiKey: current.data?.aiSensyApiKey,
      publicCareersUrl: buildPublicCareersUrl(String(input.publicCareersUrl ?? current.data?.publicCareersUrl ?? '').trim()),
      autoApprovalEnabled: input.autoApprovalEnabled ?? current.data?.autoApprovalEnabled ?? false,
      requiredDocuments: Array.isArray(input.requiredDocuments) && input.requiredDocuments.length > 0
        ? input.requiredDocuments
        : current.data?.requiredDocuments || ['Aadhaar', 'Bank Details', 'PAN'],
      permissions: input.permissions || current.data?.permissions || {},
      updatedAt: new Date(),
    };

    await adminDb
      .collection('settings')
      .doc('workWithBergman')
      .set(compactFirestoreData(merged) as unknown as Record<string, unknown>, { merge: true });
    return { success: true, data: toClientSafe(merged) as WorkBergmanSettings };
  } catch (error) {
    return {
      success: false,
      error: `Failed to save Work With Bergman settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function testGoogleSheetConnectionAction(sheetUrl: string): Promise<{
  success: boolean;
  message: string;
  rowCount?: number;
  headers?: string[];
  sampleRows?: string[][];
}> {
  try {
    if (!sheetUrl || !isValidGoogleSheetUrl(sheetUrl)) {
      return { success: false, message: 'Valid Google Sheet URL is required.' };
    }

    const sheetId = extractSheetIdFromUrl(sheetUrl);
    const gid = extractSheetGidFromUrl(sheetUrl);
    const csvText = await fetchSheetCsv(sheetId, gid);

    if (!csvText) {
      return {
        success: false,
        message: 'Unable to read sheet CSV. Ensure the sheet is accessible or published for CSV export.',
      };
    }

    const rows = parseCsvText(csvText);
    const headers = rows[0] || [];
    const sampleRows = rows.slice(1, 4);

    return {
      success: true,
      message: `Connected successfully. Found ${Math.max(0, rows.length - 1)} row(s).`,
      rowCount: Math.max(0, rows.length - 1),
      headers,
      sampleRows,
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getAllApplicationsAction(): Promise<Application[]> {
  try {
    const snap = await adminDb.collection('applications').orderBy('submittedAt', 'desc').get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as Application) as Application);
  } catch (error) {
    console.error('Failed to fetch applications:', error);
    return [];
  }
}

// ===================== ROLE MANAGEMENT =====================

export async function createRole(
  roleData: Omit<OpenRole, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; data?: OpenRole; error?: string }> {
  try {
    const role: OpenRole = {
      id: adminDb.collection('openRoles').doc().id,
      ...roleData,
      numberAssigned: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await adminDb.collection('openRoles').doc(role.id).set(role);

    return { success: true, data: toClientSafe(role) as OpenRole };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create role: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function createRolesForEventsAction(input: {
  eventIds: string[];
  roleData: {
    roleName: string;
    roleDescription: string;
    category: string;
    numberRequired: number;
    paymentAmount: number;
    reportingDate?: Date;
    startDate?: Date;
    endDate?: Date;
    requiredSkills?: string[];
    reportingInstructions?: string;
    isActive: boolean;
  };
  useSameConfigurationAcrossEvents?: boolean;
  perEventReportingDates?: Record<string, string | Date | undefined>;
}): Promise<{ success: boolean; data?: OpenRole[]; createdCount?: number; error?: string }> {
  try {
    const eventIds = Array.from(new Set((input.eventIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (eventIds.length === 0) {
      return { success: false, error: 'Please select at least one event.' };
    }

    const useSameConfigurationAcrossEvents = input.useSameConfigurationAcrossEvents !== false;
    if (!useSameConfigurationAcrossEvents && eventIds.length > 1) {
      return {
        success: false,
        error: 'Disable multi-event selection or enable "Use same role configuration across all selected events".',
      };
    }

    const selectedEventIds = useSameConfigurationAcrossEvents ? eventIds : [eventIds[0]];

    const roleName = String(input.roleData?.roleName || '').trim();
    if (!roleName) {
      return { success: false, error: 'Role name is required.' };
    }

    const numberRequired = Math.max(1, Number(input.roleData?.numberRequired) || 1);
    const paymentAmount = Math.max(0, Number(input.roleData?.paymentAmount) || 0);
    const roleDescription = String(input.roleData?.roleDescription || '').trim();
    const category = String(input.roleData?.category || 'General').trim() || 'General';
    const requiredSkills = Array.isArray(input.roleData?.requiredSkills)
      ? input.roleData.requiredSkills.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const reportingInstructions = String(input.roleData?.reportingInstructions || '').trim() || undefined;

    const createdRoles: OpenRole[] = [];
    const now = new Date();

    const parseDateInput = (value: unknown): Date | undefined => {
      if (!value) return undefined;
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? undefined : date;
    };

    for (const eventId of selectedEventIds) {
      const eventDoc = await adminDb.collection('events').doc(eventId).get();
      const eventData = (eventDoc.exists ? eventDoc.data() : {}) as Record<string, unknown>;
      const eventName = String(eventData?.eventName || eventData?.name || eventId).trim() || eventId;

      const eventDateRaw = String(eventData?.eventDate || '').trim();
      const eventEndDateRaw = String(eventData?.endDate || '').trim();

      const fallbackStart = eventDateRaw ? new Date(eventDateRaw) : now;
      const fallbackEnd = eventEndDateRaw
        ? new Date(eventEndDateRaw)
        : eventDateRaw
          ? new Date(eventDateRaw)
          : fallbackStart;

      const perEventReportingDate = parseDateInput(input.perEventReportingDates?.[eventId]);
      const defaultReportingDate = parseDateInput(input.roleData?.reportingDate);

      const role: OpenRole = {
        id: adminDb.collection('openRoles').doc().id,
        eventId,
        eventName,
        roleName,
        roleDescription,
        category,
        numberRequired,
        paymentAmount,
        reportingDate: perEventReportingDate || defaultReportingDate || fallbackStart,
        startDate: fallbackStart,
        endDate: fallbackEnd,
        requiredSkills,
        reportingInstructions,
        isActive: input.roleData?.isActive !== false,
        numberAssigned: 0,
        createdAt: now,
        updatedAt: now,
      };

      await adminDb
        .collection('openRoles')
        .doc(role.id)
        .set(compactFirestoreData(role) as unknown as Record<string, unknown>);

      createdRoles.push(role);
    }

    return {
      success: true,
      data: createdRoles.map((role) => toClientSafe(role) as OpenRole),
      createdCount: createdRoles.length,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create roles: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function updateRole(
  roleId: string,
  updates: Partial<OpenRole>
): Promise<{ success: boolean; data?: OpenRole; error?: string }> {
  try {
    const roleRef = adminDb.collection('openRoles').doc(roleId);
    const roleSnap = await roleRef.get();

    if (!roleSnap.exists) {
      return { success: false, error: 'Role not found' };
    }

    const updatedData = {
      ...updates,
      updatedAt: new Date(),
    };

    await roleRef.update(updatedData);

    const updated = await roleRef.get();
    return { success: true, data: toClientSafe(updated.data() as OpenRole) as OpenRole };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update role: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function deleteRole(roleId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Soft delete: mark as inactive
    await adminDb.collection('openRoles').doc(roleId).update({
      isActive: false,
      updatedAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete role: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getRole(roleId: string): Promise<OpenRole | null> {
  try {
    const snap = await adminDb.collection('openRoles').doc(roleId).get();
    return snap.exists ? (toClientSafe(snap.data() as OpenRole) as OpenRole) : null;
  } catch (error) {
    console.error('Failed to fetch role:', error);
    return null;
  }
}

export async function getOpenRoles(eventId?: string): Promise<OpenRole[]> {
  try {
    let query: any = adminDb.collection('openRoles').where('isActive', '==', true);

    if (eventId) {
      query = query.where('eventId', '==', eventId);
    }

    const snap = await query.get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as OpenRole) as OpenRole);
  } catch (error) {
    console.error('Failed to fetch roles:', error);
    return [];
  }
}

export async function getVacancyStatus(roleId: string): Promise<{
  required: number;
  assigned: number;
  remaining: number;
} | null> {
  try {
    const role = await getRole(roleId);
    if (!role) return null;

    return {
      required: role.numberRequired,
      assigned: role.numberAssigned || 0,
      remaining: (role.numberRequired - (role.numberAssigned || 0)),
    };
  } catch (error) {
    console.error('Failed to get vacancy status:', error);
    return null;
  }
}

// ===================== WORKER ASSIGNMENT =====================

export async function assignWorkerToRole(
  assignmentData: Omit<WorkerAssignment, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; data?: WorkerAssignment; error?: string }> {
  try {
    const assignment: WorkerAssignment = {
      id: adminDb.collection('assignments').doc().id,
      ...assignmentData,
      status: assignmentData.status || 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Use batch to update assignment and role vacancy
    const batch = adminDb.batch();

    batch.set(adminDb.collection('assignments').doc(assignment.id), assignment);

    // Increment numberAssigned in role
    const roleRef = adminDb.collection('openRoles').doc(assignmentData.roleId);
    const { FieldValue } = require('firebase-admin/firestore');
    batch.update(roleRef, {
      numberAssigned: FieldValue.increment(1),
      updatedAt: new Date(),
    });

    await batch.commit();

    return { success: true, data: toClientSafe(assignment) as WorkerAssignment };
  } catch (error) {
    return {
      success: false,
      error: `Failed to assign worker: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function updateAssignmentStatus(
  assignmentId: string,
  status: 'Pending' | 'Confirmed' | 'Declined' | 'Completed' | 'Cancelled'
): Promise<{ success: boolean; error?: string }> {
  try {
    await adminDb.collection('assignments').doc(assignmentId).update({
      status,
      updatedAt: new Date(),
      ...(status === 'Confirmed' && { confirmedAt: new Date() }),
      ...(status === 'Declined' && { declinedAt: new Date() }),
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update assignment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function confirmAssignmentAction(
  assignmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const assignmentRef = adminDb.collection('assignments').doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      return { success: false, error: 'Assignment not found' };
    }

    const assignment = assignmentSnap.data() as WorkerAssignment;
    const roleSnap = await adminDb.collection('openRoles').doc(assignment.roleId).get();
    const eventSnap = await adminDb.collection('events').doc(assignment.eventId).get();
    const workerSnap = await adminDb.collection('workers').where('email', '==', String(assignment.workerEmail || '').trim()).limit(1).get();

    const roleData = (roleSnap.exists ? roleSnap.data() : {}) as Record<string, unknown>;
    const eventData = (eventSnap.exists ? eventSnap.data() : {}) as Record<string, unknown>;
    const workerData = workerSnap.empty ? {} : (workerSnap.docs[0]?.data() as Record<string, unknown>);

    const safeDate = (value: unknown): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      if (typeof value === 'object' && value !== null) {
        const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number };
        if (typeof maybeTimestamp.toDate === 'function') {
          const parsed = maybeTimestamp.toDate();
          return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
        }
        if (typeof maybeTimestamp._seconds === 'number') {
          const parsed = new Date(maybeTimestamp._seconds * 1000);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
      }
      return null;
    };

    const formatSafeDate = (value: unknown, fallback = 'TBD'): string => {
      const dt = safeDate(value);
      return dt ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : fallback;
    };

    const eventName = String(eventData.eventName || assignment.eventName || 'Selected Event').trim();
    const roleName = String(roleData.roleName || assignment.roleName || 'Assigned Role').trim();
    const reportingDate = formatSafeDate(roleData.reportingDate || assignment.startDate || eventData.startDate || eventData.date, 'TBD');
    const eventStartDate = formatSafeDate(eventData.startDate || assignment.startDate || roleData.startDate || eventData.eventDate, 'TBD');
    const eventEndDate = formatSafeDate(eventData.endDate || assignment.endDate || roleData.endDate || eventData.eventDate, eventStartDate);
    const eventDates = eventStartDate === eventEndDate ? eventStartDate : `${eventStartDate} - ${eventEndDate}`;
    const honorarium = String(Number(assignment.paymentAmount || 0).toLocaleString('en-IN'));
    const eventLocation = String(
      eventData.venueName || eventData.address || eventData.city || eventData.state || roleData.reportingInstructions || assignment.eventName || 'Bergman Event'
    ).trim() || 'Bergman Event';
    const name = String(workerData.fullName || assignment.workerName || 'Team Bergman Member').trim();
    const assignmentUrl = `${(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')}/work-with-bergman`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Role Assignment Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;">
    <tr>
      <td align="center" style="padding:30px 15px;">
        <table width="650" cellpadding="0" cellspacing="0" border="0" style="width:650px;max-width:650px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td align="center" style="background:#111827;padding:40px 30px;">
              <img src="https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/BERGMAN%20LOGOS%2Fbm.png?alt=media&token=893533c9-e655-40d3-bfc2-9ae07c51a3b3" alt="Bergman Triathlon" style="max-width:280px;height:auto;display:block;border:0;outline:none;text-decoration:none;" />
              <div style="width:80px;height:4px;background:#f97316;border-radius:2px;margin:25px auto 20px auto;"></div>
              <h1 style="margin:0;color:#ffffff;font-size:34px;font-weight:800;line-height:1.2;">ROLE ASSIGNMENT CONFIRMED</h1>
              <p style="margin:12px 0 0 0;color:#d1d5db;font-size:16px;">Welcome to Team Bergman</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="font-size:18px;color:#111827;margin-top:0;">Hello <strong>${name}</strong>,</p>
              <p style="font-size:16px;line-height:1.8;color:#4b5563;">Congratulations! Your application has been approved and you have been selected for the role of <strong>${roleName}</strong> at <strong>${eventName}</strong>.</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border-radius:12px;margin-top:25px;">
                <tr>
                  <td style="padding:25px;">
                    <h2 style="margin-top:0;color:#111827;font-size:22px;">🏁 Assignment Details</h2>
                    <p style="margin:10px 0;color:#374151;font-size:15px;"><strong>Event:</strong> ${eventName}</p>
                    <p style="margin:10px 0;color:#374151;font-size:15px;"><strong>Role:</strong> ${roleName}</p>
                    <p style="margin:10px 0;color:#374151;font-size:15px;"><strong>Reporting Date:</strong> ${reportingDate}</p>
                    <p style="margin:10px 0;color:#374151;font-size:15px;"><strong>Event Dates:</strong> ${eventDates}</p>
                    <p style="margin:10px 0;color:#374151;font-size:15px;"><strong>Location:</strong> ${eventLocation}</p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:25px;background:#fff7ed;border:2px solid #fed7aa;border-radius:12px;">
                <tr>
                  <td align="center" style="padding:25px;">
                    <div style="font-size:13px;font-weight:700;color:#ea580c;letter-spacing:1px;">EVENT HONORARIUM</div>
                    <div style="font-size:42px;font-weight:800;color:#c2410c;margin-top:10px;">₹${honorarium}</div>
                    <div style="font-size:13px;color:#7c2d12;margin-top:8px;">Fixed compensation for the complete event assignment</div>
                  </td>
                </tr>
              </table>
              <h2 style="margin-top:35px;color:#111827;font-size:22px;">📋 Event Coordination</h2>
              <p style="font-size:15px;line-height:1.8;color:#4b5563;">Our team will coordinate with you prior to the event and provide all necessary information regarding your role, reporting location, event schedules, operational responsibilities, and race-day procedures.</p>
              <p style="font-size:15px;line-height:1.8;color:#4b5563;">You will also be added to the official <strong>Bergman Event WhatsApp Group</strong> before the event, where important updates, reporting instructions, briefing schedules, operational communications, and event-day information will be shared.</p>
              <p style="font-size:15px;line-height:1.8;color:#4b5563;">Please ensure that your registered mobile number is active and accessible on WhatsApp.</p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px;background:#fef2f2;border-left:5px solid #ef4444;border-radius:8px;">
                <tr>
                  <td style="padding:20px;">
                    <h3 style="margin-top:0;color:#991b1b;">⚠ Important</h3>
                    <p style="margin-bottom:0;font-size:14px;line-height:1.8;color:#7f1d1d;">By accepting this assignment, you acknowledge and agree to the assigned role description, Bergman Triathlon Rules &amp; Regulations, Waiver Agreement, event reporting requirements, safety protocols, code of conduct, and compensation terms.</p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:35px;">
                <tr>
                  <td align="center">
                    <a href="${assignmentUrl}" target="_blank" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 28px;border-radius:10px;">VIEW ASSIGNMENT</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="background:#111827;padding:30px;">
              <img src="https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/BERGMAN%20LOGOS%2Fbm.png?alt=media&token=893533c9-e655-40d3-bfc2-9ae07c51a3b3" alt="Bergman Triathlon" style="max-width:140px;height:auto;display:block;margin-bottom:15px;border:0;outline:none;text-decoration:none;" />
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">TEAM BERGMAN</p>
              <p style="margin:15px 0 0 0;color:#d1d5db;font-size:14px;">📧 info@bergmantri.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const emailResult = await sendNotification({
      templateKey: 'work_with_bergman_accepted_email',
      to: String(workerData.email || assignment.workerEmail || '').trim(),
      params: {
        name,
        event_name: eventName,
        role_name: roleName,
        reporting_date: reportingDate,
        honorarium,
        next_steps: 'Our team will coordinate the next steps, briefing, and reporting details shortly.',
      },
    });

    if (!emailResult.success) {
      return { success: false, error: 'Assignment confirmed but email delivery failed.' };
    }

    await assignmentRef.update({
      status: 'Confirmed',
      confirmedAt: new Date(),
      updatedAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to confirm assignment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function revokeAssignmentAction(
  assignmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const assignmentRef = adminDb.collection('assignments').doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();

    if (!assignmentSnap.exists) {
      return { success: false, error: 'Assignment not found' };
    }

    const assignment = assignmentSnap.data() as WorkerAssignment;
    const roleRef = assignment.roleId ? adminDb.collection('openRoles').doc(assignment.roleId) : null;
    const roleSnap = roleRef ? await roleRef.get() : null;

    const batch = adminDb.batch();

    batch.update(assignmentRef, {
      status: 'Cancelled',
      updatedAt: new Date(),
    });

    if (roleRef && roleSnap?.exists) {
      const roleData = roleSnap.data() as OpenRole;
      const nextAssigned = Math.max(0, (Number(roleData.numberAssigned) || 0) - 1);
      batch.update(roleRef, {
        numberAssigned: nextAssigned,
        updatedAt: new Date(),
      });
    }

    await batch.commit();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to revoke assignment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function deleteAssignmentAction(
  assignmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const assignmentRef = adminDb.collection('assignments').doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();

    if (!assignmentSnap.exists) {
      return { success: false, error: 'Assignment not found' };
    }

    const assignment = assignmentSnap.data() as WorkerAssignment;
    const roleRef = assignment.roleId ? adminDb.collection('openRoles').doc(assignment.roleId) : null;
    const roleSnap = roleRef ? await roleRef.get() : null;
    const applicationRef = assignment.sourceApplicationId ? adminDb.collection('applications').doc(assignment.sourceApplicationId) : null;

    const batch = adminDb.batch();

    if (roleRef && roleSnap?.exists && assignment.status !== 'Cancelled' && assignment.status !== 'Declined') {
      const roleData = roleSnap.data() as OpenRole;
      const nextAssigned = Math.max(0, (Number(roleData.numberAssigned) || 0) - 1);
      batch.update(roleRef, {
        numberAssigned: nextAssigned,
        updatedAt: new Date(),
      });
    }

    batch.delete(assignmentRef);

    if (applicationRef) {
      batch.update(applicationRef, {
        assignmentDeletedAt: new Date(),
        assignmentDeletedReason: 'Deleted from Event Staffing',
        updatedAt: new Date(),
      });
    }

    await batch.commit();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete assignment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

type AssignmentNotifyChannel = 'Email' | 'WhatsApp';

export async function sendAssignmentNotificationAction(
  assignmentId: string,
  channel: AssignmentNotifyChannel
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const assignmentRef = adminDb.collection('assignments').doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      return { success: false, error: 'Assignment not found' };
    }

    const assignment = assignmentSnap.data() as WorkerAssignment;
    const roleSnap = await adminDb.collection('openRoles').doc(assignment.roleId).get();
    const eventSnap = await adminDb.collection('events').doc(assignment.eventId).get();
    const workerSnap = await adminDb.collection('workers').where('email', '==', String(assignment.workerEmail || '').trim()).limit(1).get();

    const roleData = (roleSnap.exists ? roleSnap.data() : {}) as Record<string, unknown>;
    const eventData = (eventSnap.exists ? eventSnap.data() : {}) as Record<string, unknown>;
    const workerData = workerSnap.empty ? {} : (workerSnap.docs[0]?.data() as Record<string, unknown>);

    const safeDate = (value: unknown): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      if (typeof value === 'object' && value !== null) {
        const maybeTimestamp = value as { toDate?: () => Date; _seconds?: number };
        if (typeof maybeTimestamp.toDate === 'function') {
          const parsed = maybeTimestamp.toDate();
          return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
        }
        if (typeof maybeTimestamp._seconds === 'number') {
          const parsed = new Date(maybeTimestamp._seconds * 1000);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
      }
      return null;
    };

    const formatSafeDate = (value: unknown, fallback = 'TBD'): string => {
      const dt = safeDate(value);
      return dt ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : fallback;
    };

    const eventName = String(eventData.eventName || assignment.eventName || 'Selected Event').trim();
    const roleName = String(roleData.roleName || assignment.roleName || 'Assigned Role').trim();
    const reportingDate = formatSafeDate(roleData.reportingDate || assignment.startDate || eventData.startDate || eventData.date, 'TBD');
    const eventStartDate = formatSafeDate(eventData.startDate || assignment.startDate || roleData.startDate || eventData.eventDate, 'TBD');
    const eventEndDate = formatSafeDate(eventData.endDate || assignment.endDate || roleData.endDate || eventData.eventDate, eventStartDate);
    const eventDates = eventStartDate === eventEndDate ? eventStartDate : `${eventStartDate} - ${eventEndDate}`;
    const honorarium = String(Number(assignment.paymentAmount || 0).toLocaleString('en-IN'));
    const eventLocation = String(
      eventData.venueName || eventData.address || eventData.city || eventData.state || roleData.reportingInstructions || assignment.eventName || 'Bergman Event'
    ).trim() || 'Bergman Event';
    const name = String(workerData.fullName || assignment.workerName || 'Team Bergman Member').trim();
    const recipientEmail = String(workerData.email || assignment.workerEmail || '').trim();
    const recipientMobile = String((workerData.whatsappNumber || '')).trim();

    if (channel === 'Email') {
      const sent = await sendNotification({
        templateKey: 'work_with_bergman_accepted_email',
        to: recipientEmail,
        params: {
          name,
          event_name: eventName,
          role_name: roleName,
          reporting_date: reportingDate,
          honorarium,
          next_steps: 'Our team will coordinate the next steps, briefing, and reporting details shortly.',
        },
      });

      return sent.success ? { success: true, message: sent.message || 'Email sent.' } : { success: false, error: sent.message || 'Email delivery failed.' };
    }

    const whatsapp = await sendAiSensyMessage(
      recipientMobile,
      'workwithbergman',
      [name, roleName, reportingDate, eventDates, honorarium],
      'Bergman Work With Bergman',
      'sendAssignmentNotificationAction',
      'BERGMAN 2'
    );

    return whatsapp.success ? { success: true, message: 'WhatsApp sent.' } : { success: false, error: whatsapp.message || 'WhatsApp delivery failed.' };
  } catch (error) {
    return { success: false, error: `Failed to send assignment notification: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

export async function getAssignmentsByWorker(workerId: string): Promise<WorkerAssignment[]> {
  try {
    const snap = await adminDb.collection('assignments').where('workerId', '==', workerId).get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as WorkerAssignment) as WorkerAssignment);
  } catch (error) {
    console.error('Failed to fetch assignments:', error);
    return [];
  }
}

export async function getAssignmentsByRole(roleId: string): Promise<WorkerAssignment[]> {
  try {
    const snap = await adminDb.collection('assignments').where('roleId', '==', roleId).get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as WorkerAssignment) as WorkerAssignment);
  } catch (error) {
    console.error('Failed to fetch assignments:', error);
    return [];
  }
}

export async function getAssignmentsByEvent(eventId: string): Promise<WorkerAssignment[]> {
  try {
    const snap = await adminDb.collection('assignments').where('eventId', '==', eventId).get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as WorkerAssignment) as WorkerAssignment);
  } catch (error) {
    console.error('Failed to fetch assignments:', error);
    return [];
  }
}

export async function getAllAssignments(): Promise<WorkerAssignment[]> {
  try {
    const snap = await adminDb.collection('assignments').get();
    const assignments = snap.docs.map((doc: any) => toClientSafe(doc.data() as WorkerAssignment) as WorkerAssignment);

    return assignments.sort((a, b) => {
      const aTime = new Date(String(a.createdAt || a.assignmentDate || '')).getTime();
      const bTime = new Date(String(b.createdAt || b.assignmentDate || '')).getTime();
      return bTime - aTime;
    });
  } catch (error) {
    console.error('Failed to fetch all assignments:', error);
    return [];
  }
}

// ===================== PAYMENT MANAGEMENT =====================

export async function createPayment(
  paymentData: Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; data?: Payment; error?: string }> {
  try {
    const payment: Payment = {
      id: adminDb.collection('payments').doc().id,
      ...paymentData,
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await adminDb.collection('payments').doc(payment.id).set(payment);

    return { success: true, data: toClientSafe(payment) as Payment };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function updatePaymentStatus(
  paymentId: string,
  status: 'Pending' | 'Approved' | 'Paid' | 'Cancelled',
  approvedBy?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const updates: any = {
      status,
      updatedAt: new Date(),
    };

    if (status === 'Approved') {
      updates.approvedDate = new Date();
      if (approvedBy) updates.approvedBy = approvedBy;
    }

    if (status === 'Paid') {
      updates.paidDate = new Date();
    }

    await adminDb.collection('payments').doc(paymentId).update(updates);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function recordAssignmentPaymentAction(input: {
  assignmentId: string;
  travelReimbursement?: number;
  paymentMethod: 'Bank Transfer' | 'UPI' | 'Cash';
  transactionId?: string;
  paymentDate?: string | Date;
  notes?: string;
}): Promise<{ success: boolean; data?: Payment; message?: string; error?: string }> {
  try {
    const assignmentId = String(input.assignmentId || '').trim();
    if (!assignmentId) {
      return { success: false, error: 'Assignment ID is required.' };
    }

    const assignmentRef = adminDb.collection('assignments').doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      return { success: false, error: 'Assignment not found.' };
    }

    const assignment = assignmentSnap.data() as WorkerAssignment;
    const workerSnap = await adminDb.collection('workers').doc(assignment.workerId).get();
    const roleSnap = await adminDb.collection('openRoles').doc(assignment.roleId).get();
    const eventSnap = await adminDb.collection('events').doc(assignment.eventId).get();

    const workerData = (workerSnap.exists ? workerSnap.data() : {}) as Record<string, unknown>;
    const roleData = (roleSnap.exists ? roleSnap.data() : {}) as Record<string, unknown>;
    const eventData = (eventSnap.exists ? eventSnap.data() : {}) as Record<string, unknown>;

    const honorarium = Math.max(0, Number(assignment.paymentAmount ?? roleData.paymentAmount ?? 0) || 0);
    const travelReimbursement = Math.max(0, Number(input.travelReimbursement || 0) || 0);
    const totalAmount = honorarium + travelReimbursement;
    const paymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date();
    const paymentId = adminDb.collection('payments').doc().id;
    const eventName = String(eventData.eventName || assignment.eventName || 'Selected Event').trim();
    const roleName = String(roleData.roleName || assignment.roleName || 'Assigned Role').trim();
    const workerEmail = String(workerData.email || assignment.workerEmail || '').trim();
    const workerName = String(workerData.fullName || assignment.workerName || 'Team Bergman Member').trim();
    const payment: Payment = {
      id: paymentId,
      workerId: assignment.workerId,
      workerName,
      workerEmail,
      assignmentId,
      roleId: assignment.roleId,
      roleName,
      eventId: assignment.eventId,
      eventName,
      amount: totalAmount,
      honorarium,
      travelReimbursement,
      totalAmount,
      paymentMethod: input.paymentMethod,
      status: 'Paid',
      transactionId: String(input.transactionId || '').trim() || undefined,
      paidDate: paymentDate,
      paymentDate,
      bankDetails: workerSnap.exists
        ? {
            accountName: String(workerData.bankAccountName || '').trim(),
            bankName: String(workerData.bankName || '').trim() || undefined,
            accountNumber: String(workerData.bankAccountNumber || '').trim(),
            ifscCode: String(workerData.ifscCode || '').trim(),
          }
        : undefined,
      upiId: String(workerData.upiId || '').trim() || undefined,
      notes: String(input.notes || '').trim() || undefined,
      approvedBy: 'Admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const batch = adminDb.batch();
    batch.set(adminDb.collection('payments').doc(paymentId), payment);
    batch.update(assignmentRef, {
      paymentStatus: 'Paid',
      updatedAt: new Date(),
    });

    if (workerSnap.exists) {
      const nextTotalPaid = Math.max(0, Number(workerData.totalPaid || 0) + totalAmount);
      const nextPending = Math.max(0, Number(workerData.paymentPending || 0) - totalAmount);
      batch.update(workerSnap.ref, {
        totalPaid: nextTotalPaid,
        paymentPending: nextPending,
        updatedAt: new Date(),
      });
    }

    await batch.commit();

    const paymentDateLabel = paymentDate.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    let emailDelivered = false;
    if (workerEmail) {
      const emailResult = await sendNotification({
        templateKey: 'workbergmanpaymentprocesed',
        to: workerEmail,
        params: {
          name: workerName,
          eventName,
          roleName,
          honorarium: honorarium.toLocaleString('en-IN'),
          travelReimbursement: travelReimbursement.toLocaleString('en-IN'),
          totalAmount: totalAmount.toLocaleString('en-IN'),
          paymentDate: paymentDateLabel,
          paymentMethod: input.paymentMethod,
          utrNumber: String(input.transactionId || '').trim() || 'N/A',
        },
      });
      emailDelivered = Boolean(emailResult.success);
    }

    return {
      success: true,
      data: toClientSafe(payment) as Payment,
      message: emailDelivered ? 'Payment recorded and confirmation email sent.' : 'Payment recorded. Confirmation email was not sent.',
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to record payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function sendPaymentConfirmationEmailAction(paymentId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const id = String(paymentId || '').trim();
    if (!id) {
      return { success: false, error: 'Payment ID is required.' };
    }

    const paymentSnap = await adminDb.collection('payments').doc(id).get();
    if (!paymentSnap.exists) {
      return { success: false, error: 'Payment record not found.' };
    }

    const payment = paymentSnap.data() as Payment;
    const paymentDate = payment.paymentDate || payment.paidDate || payment.createdAt || new Date();
    const paymentDateObj = paymentDate instanceof Date ? paymentDate : new Date(String(paymentDate));
    const paymentDateLabel = Number.isNaN(paymentDateObj.getTime())
      ? 'N/A'
      : paymentDateObj.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

    const emailResult = await sendNotification({
      templateKey: 'workbergmanpaymentprocesed',
      to: payment.workerEmail,
      params: {
        name: payment.workerName,
        eventName: payment.eventName,
        roleName: payment.roleName,
        honorarium: Number(payment.honorarium || 0).toLocaleString('en-IN'),
        travelReimbursement: Number(payment.travelReimbursement || 0).toLocaleString('en-IN'),
        totalAmount: Number(payment.totalAmount || payment.amount || 0).toLocaleString('en-IN'),
        paymentDate: paymentDateLabel,
        paymentMethod: payment.paymentMethod,
        utrNumber: String(payment.transactionId || 'N/A'),
      },
    });

    return emailResult.success
      ? { success: true, message: 'Payment confirmation email sent.' }
      : { success: false, error: emailResult.message || 'Failed to send payment confirmation email.' };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send payment confirmation email: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getPaymentsByWorker(workerId: string): Promise<Payment[]> {
  try {
    const snap = await adminDb.collection('payments').where('workerId', '==', workerId).get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as Payment) as Payment);
  } catch (error) {
    console.error('Failed to fetch payments:', error);
    return [];
  }
}

export async function getPaymentsByEvent(eventId: string): Promise<Payment[]> {
  try {
    const snap = await adminDb.collection('payments').where('eventId', '==', eventId).get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as Payment) as Payment);
  } catch (error) {
    console.error('Failed to fetch payments:', error);
    return [];
  }
}

export async function getAllPaymentsAction(): Promise<Payment[]> {
  try {
    const snap = await adminDb.collection('payments').get();
    const payments = snap.docs.map((doc: any) => toClientSafe(doc.data() as Payment) as Payment);
    return payments.sort((a, b) => {
      const aTime = new Date(String(a.paymentDate || a.paidDate || a.createdAt || '')).getTime();
      const bTime = new Date(String(b.paymentDate || b.paidDate || b.createdAt || '')).getTime();
      return bTime - aTime;
    });
  } catch (error) {
    console.error('Failed to fetch all payments:', error);
    return [];
  }
}

export async function getPendingPayments(): Promise<Payment[]> {
  try {
    const snap = await adminDb
      .collection('payments')
      .where('status', 'in', ['Pending', 'Approved'])
      .get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as Payment) as Payment);
  } catch (error) {
    console.error('Failed to fetch pending payments:', error);
    return [];
  }
}

// ===================== CERTIFICATION & DOCUMENTS =====================

export async function addCertification(
  certification: Omit<Certification, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; data?: Certification; error?: string }> {
  try {
    const cert: Certification = {
      id: adminDb.collection('certifications').doc().id,
      ...certification,
      isExpired: certification.expiryDate ? new Date(certification.expiryDate) < new Date() : false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await adminDb.collection('certifications').doc(cert.id).set(cert);

    return { success: true, data: toClientSafe(cert) as Certification };
  } catch (error) {
    return {
      success: false,
      error: `Failed to add certification: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getCertificationsByWorker(workerId: string): Promise<Certification[]> {
  try {
    const snap = await adminDb
      .collection('certifications')
      .where('workerId', '==', workerId)
      .get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as Certification) as Certification);
  } catch (error) {
    console.error('Failed to fetch certifications:', error);
    return [];
  }
}

export async function addDocument(
  document: Omit<DocumentReference, 'id' | 'uploadedAt'>
): Promise<{ success: boolean; data?: DocumentReference; error?: string }> {
  try {
    const doc: DocumentReference = {
      id: adminDb.collection('documents').doc().id,
      ...document,
      uploadedAt: new Date(),
    };

    await adminDb.collection('documents').doc(doc.id).set(doc);

    return { success: true, data: toClientSafe(doc) as DocumentReference };
  } catch (error) {
    return {
      success: false,
      error: `Failed to add document: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getDocumentsByWorker(workerId: string): Promise<DocumentReference[]> {
  try {
    const snap = await adminDb.collection('documents').where('workerId', '==', workerId).get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as DocumentReference) as DocumentReference);
  } catch (error) {
    console.error('Failed to fetch documents:', error);
    return [];
  }
}

export async function checkRecruitmentEligibilityAction(emailInput: string, eventIdInput?: string): Promise<{
  success: boolean;
  eligible: boolean;
  message: string;
  workerId?: string;
  workerName?: string;
  workerProfile?: {
    fullName?: string;
    email?: string;
    whatsappNumber?: string;
    city?: string;
    state?: string;
    gender?: string;
    tshirtSize?: string;
    hasSavedBankDetails: boolean;
    bankDetails?: {
      accountName?: string;
      bankName?: string;
      accountNumber?: string;
      ifscCode?: string;
      upiId?: string;
      panNumber?: string;
    };
  };
}> {
  try {
    const email = normalizeEmail(emailInput);
    if (!hasValidEmail(email)) {
      return {
        success: true,
        eligible: false,
        message: 'Please enter a valid email to continue.',
      };
    }

    let workerSnap = await adminDb.collection('workers').where('email', '==', email).limit(1).get();

    // Legacy fallback for mixed-case historical rows
    if (workerSnap.empty) {
      const allSnap = await adminDb.collection('workers').get();
      const match = allSnap.docs.find((doc: any) => normalizeEmail((doc.data() as Worker)?.email) === email);
      if (match) {
        workerSnap = {
          empty: false,
          docs: [match],
        } as typeof workerSnap;
      }
    }

    if (workerSnap.empty) {
      return {
        success: true,
        eligible: false,
        message: 'You are not eligible yet. Please contact our team via Contact Us and share your details.',
      };
    }

    const worker = workerSnap.docs[0].data() as Worker;
    const manuallyAddedByAdmin = !worker.syncedFromGoogleSheet;
    const approvedByAdmin = !!worker.isRecruitmentApproved;
    const hasSavedBankDetails = !!(
      String(worker.bankAccountName || '').trim() &&
      String(worker.bankAccountNumber || '').trim() &&
      String(worker.ifscCode || '').trim() &&
      (String((worker as any).bankName || '').trim() || String(worker.upiId || '').trim() || String(worker.panNumber || '').trim())
    );

    const workerProfile = {
      fullName: worker.fullName,
      email: worker.email,
      whatsappNumber: worker.whatsappNumber,
      city: worker.city,
      state: worker.state,
      gender: worker.gender,
      tshirtSize: worker.tshirtSize,
      hasSavedBankDetails,
      bankDetails: hasSavedBankDetails
        ? {
            accountName: worker.bankAccountName,
            bankName: String((worker as any).bankName || '').trim() || undefined,
            accountNumber: worker.bankAccountNumber,
            ifscCode: worker.ifscCode,
            upiId: worker.upiId,
            panNumber: worker.panNumber,
          }
        : undefined,
    };

    const activeAssignmentAnySnap = await adminDb.collection('assignments').where('workerId', '==', worker.id).get();
    const hasAnyActiveAssignment = activeAssignmentAnySnap.docs.some((doc) => {
      const assignment = doc.data() as WorkerAssignment;
      const assignmentStatus = String(assignment.status || '').trim();
      return assignmentStatus !== 'Cancelled' && assignmentStatus !== 'Declined';
    });

    if (manuallyAddedByAdmin || approvedByAdmin || hasAnyActiveAssignment) {
      return {
        success: true,
        eligible: true,
        message: 'You are eligible. Please complete the recruitment form.',
        workerId: worker.id,
        workerName: worker.fullName,
        workerProfile,
      };
    }

    return {
      success: true,
      eligible: false,
      message: 'Your profile is under review. Please contact our team via Contact Us and share your details.',
      workerId: worker.id,
      workerName: worker.fullName,
      workerProfile,
    };
  } catch (error) {
    return {
      success: false,
      eligible: false,
      message: `Eligibility check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function setWorkerRecruitmentApprovalAction(
  workerId: string,
  approved: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!workerId) return { success: false, error: 'Worker ID is required.' };

    await adminDb.collection('workers').doc(workerId).update(
      compactFirestoreData({
        isRecruitmentApproved: approved,
        recruitmentApprovedAt: approved ? new Date() : null,
        updatedAt: new Date(),
      }) as Record<string, unknown>
    );

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update approval: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function approveWorkWithBergmanApplicationAction(
  applicationId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const id = String(applicationId || '').trim();
    if (!id) return { success: false, error: 'Application ID is required.' };

    const applicationRef = adminDb.collection('applications').doc(id);
    const applicationSnap = await applicationRef.get();
    if (!applicationSnap.exists) {
      return { success: false, error: 'Application not found.' };
    }

    const application = applicationSnap.data() as Application;
    const now = new Date();
    const preferredRolePreferenceIds = Array.from(new Set([
      ...(application.rolePreferenceDetails || []).map((role) => String(role.roleId || '').trim()).filter(Boolean),
      ...(application.rolePreferences || []).map((roleId) => String(roleId || '').trim()).filter(Boolean),
    ]));
    const eventName = String(application.selectedEvent?.eventName || 'Selected Event').trim();
    const recipientEmail = normalizeEmail(application.email || '');
    const recipientMobile = String(application.personalDetails?.phone || '').trim();
    const recipientName = String(application.fullName || 'Team Bergman Member').trim();
    const eventId = String(application.selectedEvent?.eventId || '').trim();

    let selectedRole: OpenRole | null = null;
    for (const roleId of preferredRolePreferenceIds) {
      const roleSnap = await adminDb.collection('openRoles').doc(roleId).get();
      if (!roleSnap.exists) continue;

      const role = roleSnap.data() as OpenRole;
      if (String(role.eventId || '').trim() !== eventId) continue;
      if (!role.isActive) continue;
      if ((Number(role.numberAssigned) || 0) >= Number(role.numberRequired || 0)) continue;

      selectedRole = role;
      break;
    }

    if (preferredRolePreferenceIds.length > 0 && !selectedRole) {
      return {
        success: false,
        error: 'No preferred roles are currently available for this application.',
      };
    }

    const roleName = String(selectedRole?.roleName || application.rolePreferenceDetails?.[0]?.roleName || 'Team Bergman Role').trim();
    const selectedRoleId = String(selectedRole?.id || '').trim();

    await applicationRef.update(
      compactFirestoreData({
        status: 'Approved',
        reviewedAt: now,
        updatedAt: now,
      }) as Record<string, unknown>
    );

    let resolvedWorkerId = String(application.workerId || '').trim();
    let workerEmailForAssignment = recipientEmail;
    if (resolvedWorkerId) {
      await adminDb.collection('workers').doc(resolvedWorkerId).update(
        compactFirestoreData({
          isRecruitmentApproved: true,
          recruitmentApprovedAt: now,
          updatedAt: now,
        }) as Record<string, unknown>
      );
    } else {
      const workerSnap = await adminDb.collection('workers').where('email', '==', normalizeEmail(application.email)).limit(1).get();
      if (!workerSnap.empty) {
        resolvedWorkerId = String(workerSnap.docs[0].id || '').trim();
        await workerSnap.docs[0].ref.update(
          compactFirestoreData({
            isRecruitmentApproved: true,
            recruitmentApprovedAt: now,
            updatedAt: now,
          }) as Record<string, unknown>
        );
      }
    }

    if (selectedRoleId && eventId && resolvedWorkerId) {
      const activeSelectedRole = selectedRole;
      if (!activeSelectedRole) {
        return {
          success: false,
          error: 'No preferred roles are currently available for this application.',
        };
      }

      const existingAssignmentSnap = await adminDb
        .collection('assignments')
        .where('sourceApplicationId', '==', id)
        .limit(1)
        .get();

      if (!existingAssignmentSnap.empty) {
        await existingAssignmentSnap.docs[0].ref.update({
          status: 'Confirmed',
          confirmedAt: now,
          updatedAt: now,
        });
      } else {
        await assignWorkerToRole({
          sourceApplicationId: id,
          workerId: resolvedWorkerId,
          workerName: recipientName,
          workerEmail: workerEmailForAssignment,
          roleId: activeSelectedRole.id,
          roleName: activeSelectedRole.roleName,
          eventId,
          eventName,
          assignmentDate: now,
          startDate: activeSelectedRole.startDate,
          endDate: activeSelectedRole.endDate,
          status: 'Confirmed',
          paymentAmount: activeSelectedRole.paymentAmount,
          paymentStatus: 'Pending',
          assignedBy: 'Application Approval',
          notes: `Accepted from public application on ${now.toLocaleString()}`,
        });
      }
    }

    const acceptanceEmailResult = recipientEmail
      ? await sendNotification({
          templateKey: 'work_with_bergman_accepted_email',
          to: recipientEmail,
          params: {
            name: recipientName,
            event_name: eventName,
            role_name: roleName,
            reporting_date: String(application.selectedEvent?.eventDate || '').trim() || 'TBD',
            honorarium: String(Number(application.rolePreferenceDetails?.[0]?.paymentAmount || 0).toLocaleString('en-IN')),
            next_steps: 'Our team will share the next steps, briefing, and reporting details shortly.',
          },
        })
      : { success: false };

    const approvalReportingDate = String(application.selectedEvent?.eventDate || application.selectedEvent?.eventId || '').trim() || 'TBD';
    const approvalEventDates = String(application.selectedEvent?.eventDate || '').trim() || 'TBD';
    const approvalHonorarium = String(Number(application.rolePreferenceDetails?.[0]?.paymentAmount || 0).toLocaleString('en-IN'));

    const acceptanceWhatsappResult = recipientMobile
      ? await sendAiSensyMessage(
          recipientMobile,
          'workwithbergman',
          [
            recipientName,
            roleName,
            approvalReportingDate,
            approvalEventDates,
            approvalHonorarium,
          ],
          'Bergman Work With Bergman',
          'approveWorkWithBergmanApplicationAction',
          'BERGMAN 2'
        )
      : { success: false, message: 'No mobile provided.' };

    const notificationParts: string[] = [];
    if (recipientEmail) notificationParts.push(acceptanceEmailResult.success ? 'email sent' : 'email not sent');
    if (recipientMobile) notificationParts.push(acceptanceWhatsappResult.success ? 'WhatsApp sent' : 'WhatsApp not sent');

    const notificationSummary = notificationParts.length ? ` (${notificationParts.join(', ')})` : '';

    return { success: true, message: `Application approved${notificationSummary}.` };
  } catch (error) {
    return {
      success: false,
      error: `Failed to approve application: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function rejectWorkWithBergmanApplicationAction(
  applicationId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const id = String(applicationId || '').trim();
    if (!id) return { success: false, error: 'Application ID is required.' };

    const applicationRef = adminDb.collection('applications').doc(id);
    const applicationSnap = await applicationRef.get();
    if (!applicationSnap.exists) {
      return { success: false, error: 'Application not found.' };
    }

    const now = new Date();
    await applicationRef.update(
      compactFirestoreData({
        status: 'Rejected',
        reviewedAt: now,
        updatedAt: now,
      }) as Record<string, unknown>
    );

    return { success: true, message: 'Application rejected.' };
  } catch (error) {
    return {
      success: false,
      error: `Failed to reject application: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function cancelRejectWorkWithBergmanApplicationAction(
  applicationId: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const id = String(applicationId || '').trim();
    if (!id) return { success: false, error: 'Application ID is required.' };

    const applicationRef = adminDb.collection('applications').doc(id);
    const applicationSnap = await applicationRef.get();
    if (!applicationSnap.exists) {
      return { success: false, error: 'Application not found.' };
    }

    const now = new Date();
    await applicationRef.update({
      status: 'Submitted',
      reviewedAt: FieldValue.delete(),
      reviewedBy: FieldValue.delete(),
      updatedAt: now,
    });

    return { success: true, message: 'Application moved back to pending.' };
  } catch (error) {
    return {
      success: false,
      error: `Failed to restore application: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function syncApprovedWorkWithBergmanApplicationsToAssignmentsAction(): Promise<{ success: boolean; error?: string; synced?: number }> {
  try {
    const appsSnap = await adminDb.collection('applications').where('status', '==', 'Approved').get();
    let synced = 0;

    for (const doc of appsSnap.docs) {
      const application = doc.data() as Application;
      const applicationId = String(application.id || doc.id || '').trim();
      const preferredRoleId = String(application.rolePreferences?.[0] || application.rolePreferenceDetails?.[0]?.roleId || '').trim();
      const eventId = String(application.selectedEvent?.eventId || '').trim();
      if (!applicationId || !preferredRoleId || !eventId) continue;
      if (application.assignmentDeletedAt) continue;

      const existingAssignmentSnap = await adminDb
        .collection('assignments')
        .where('sourceApplicationId', '==', applicationId)
        .limit(1)
        .get();
      if (!existingAssignmentSnap.empty) {
        const existingAssignment = existingAssignmentSnap.docs[0].data() as WorkerAssignment;
        if (existingAssignment.status !== 'Confirmed') {
          await existingAssignmentSnap.docs[0].ref.update({
            status: 'Confirmed',
            confirmedAt: new Date(),
            updatedAt: new Date(),
          });
          synced += 1;
        }
        continue;
      }

      const roleSnap = await adminDb.collection('openRoles').doc(preferredRoleId).get();
      if (!roleSnap.exists) continue;

      const role = roleSnap.data() as OpenRole;
      const workerEmail = normalizeEmail(application.email || '');
      const workerId = String(application.workerId || '').trim() || (await (async () => {
        const workerSnap = await adminDb.collection('workers').where('email', '==', workerEmail).limit(1).get();
        return workerSnap.empty ? '' : String(workerSnap.docs[0].id || '').trim();
      })());

      if (!workerId) continue;

      await assignWorkerToRole({
        sourceApplicationId: applicationId,
        workerId,
        workerName: String(application.fullName || 'Team Bergman Member').trim(),
        workerEmail,
        roleId: role.id,
        roleName: role.roleName,
        eventId,
        eventName: String(application.selectedEvent?.eventName || role.eventName || 'Selected Event').trim(),
        assignmentDate: application.submittedAt || new Date(),
        startDate: role.startDate,
        endDate: role.endDate,
        status: 'Confirmed',
        paymentAmount: role.paymentAmount,
        paymentStatus: 'Pending',
        assignedBy: 'Application Approval',
        notes: `Accepted from public application on ${new Date().toLocaleString()}`,
      });
      synced += 1;
    }

    return { success: true, synced };
  } catch (error) {
    return {
      success: false,
      error: `Failed to sync approved applications: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function submitWorkWithBergmanApplicationAction(input: {
  fullName: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  skills?: string;
  notes?: string;
  declaration?: boolean;
  eventId?: string;
  eventName?: string;
  eventDate?: string;
  firstPreferenceRoleId?: string;
  secondPreferenceRoleId?: string;
  thirdPreferenceRoleId?: string;
  eventAvailabilityOptions?: string[];
  canTravel?: boolean;
  needAccommodation?: boolean;
  needLocalTransport?: boolean;
  bankDetails?: {
    accountName?: string;
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
    upiId?: string;
    panNumber?: string;
  };
  saveBankForFuture?: boolean;
  updateSavedBankDetails?: boolean;
  agreements?: {
    freelance?: boolean;
    duties?: boolean;
    reporting?: boolean;
    travelReimbursementPolicyAccepted?: boolean;
    accommodationPolicyAccepted?: boolean;
  };
}): Promise<{ success: boolean; message: string }> {
  try {
    const fullName = String(input.fullName || '').trim();
    const email = normalizeEmail(input.email);

    if (!fullName) {
      return { success: false, message: 'Full name is required.' };
    }
    if (!hasValidEmail(email)) {
      return { success: false, message: 'Valid email is required.' };
    }

    if (!input.eventId || !input.eventName) {
      return { success: false, message: 'Please select an event before submitting.' };
    }

    if (!String(input.address || '').trim()) {
      return { success: false, message: 'Full address is required so we can send your kit.' };
    }

    const selectedEventId = String(input.eventId || '').trim();

    const existingApplicationsSnap = await adminDb
      .collection('applications')
      .where('email', '==', email)
      .get();

    const hasExistingApplicationForEvent = existingApplicationsSnap.docs.some((doc) => {
      const existing = doc.data() as Application;
      const existingEventId = String(existing.selectedEvent?.eventId || existing.eventPreferences?.[0] || '').trim();
      const existingStatus = String(existing.status || '').trim();
      return existingEventId === selectedEventId && existingStatus !== 'Rejected';
    });

    if (hasExistingApplicationForEvent) {
      return {
        success: false,
        message: 'You already have an active application for this event. You can apply again only after this event application is rejected or cancelled. You may still apply for other events.',
      };
    }

    const selectedRoleIds = Array.from(new Set([
      String(input.firstPreferenceRoleId || '').trim(),
      String(input.secondPreferenceRoleId || '').trim(),
      String(input.thirdPreferenceRoleId || '').trim(),
    ].filter(Boolean)));

    const selectedRoleId = selectedRoleIds[0] || '';

    if (!selectedRoleId) {
      return { success: false, message: 'Please choose one role preference.' };
    }

    const eventAvailabilityOptions = Array.isArray(input.eventAvailabilityOptions)
      ? input.eventAvailabilityOptions.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (eventAvailabilityOptions.length === 0) {
      return { success: false, message: 'Availability for 2-3 days prior to the event is mandatory.' };
    }

    const availableForPriorDays = eventAvailabilityOptions.some((option) =>
      /2\s*[-–]?\s*3\s*days\s*prior/i.test(option)
    );

    if (!availableForPriorDays) {
      return { success: false, message: 'Availability for 2-3 days prior to the event is mandatory.' };
    }

    const agreements = {
      freelance: !!input.agreements?.freelance,
      duties: !!input.agreements?.duties,
      reporting: !!input.agreements?.reporting,
      travelReimbursementPolicyAccepted: !!input.agreements?.travelReimbursementPolicyAccepted,
      accommodationPolicyAccepted: !!input.agreements?.accommodationPolicyAccepted,
    };

    if (!agreements.freelance || !agreements.duties || !agreements.reporting) {
      return { success: false, message: 'Please accept all agreement checkboxes to continue.' };
    }

    if (!agreements.travelReimbursementPolicyAccepted) {
      return { success: false, message: 'Please accept the travel reimbursement policy to continue.' };
    }

    if (input.needAccommodation === true && !agreements.accommodationPolicyAccepted) {
      return { success: false, message: 'Please accept the accommodation policy to continue.' };
    }

    const eligibility = await checkRecruitmentEligibilityAction(email);
    if (!eligibility.success) {
      return { success: false, message: eligibility.message };
    }
    if (!eligibility.eligible) {
      return {
        success: false,
        message: 'You are not eligible to fill this form. Please contact our team via Contact Us and share your details.',
      };
    }

    const now = new Date();

    const firstPreferenceRoleId = selectedRoleId;
    const allPreferredRoleIds = selectedRoleIds;

    const preferredRoleMap = new Map<string, OpenRole>();
    if (allPreferredRoleIds.length > 0) {
      const openRoles = await getOpenRoles(String(input.eventId));
      for (const role of openRoles) {
        if (allPreferredRoleIds.includes(role.id)) preferredRoleMap.set(role.id, role);
      }
    }

    const bankDetails = {
      accountName: String(input.bankDetails?.accountName || '').trim() || undefined,
      bankName: String(input.bankDetails?.bankName || '').trim() || undefined,
      accountNumber: String(input.bankDetails?.accountNumber || '').trim() || undefined,
      ifscCode: String(input.bankDetails?.ifscCode || '').trim() || undefined,
      upiId: String(input.bankDetails?.upiId || '').trim() || undefined,
      panNumber: String(input.bankDetails?.panNumber || '').trim() || undefined,
      saveForFuture: !!input.saveBankForFuture,
    };

    const hasProvidedBankDetails = !!(
      bankDetails.accountName &&
      bankDetails.bankName &&
      bankDetails.accountNumber &&
      bankDetails.ifscCode &&
      bankDetails.upiId &&
      bankDetails.panNumber
    );

    const hasSavedBankDetails = !!eligibility.workerProfile?.hasSavedBankDetails;
    const updateSavedBankDetails = !!input.updateSavedBankDetails;

    if ((!hasSavedBankDetails || updateSavedBankDetails) && !hasProvidedBankDetails) {
      return {
        success: false,
        message: 'Please provide complete banking information (including UPI and PAN) to continue.',
      };
    }

    let resolvedWorkerDocId = String(eligibility.workerId || '').trim();
    if (!resolvedWorkerDocId) {
      const workerByEmail = await adminDb.collection('workers').where('email', '==', email).limit(1).get();
      if (!workerByEmail.empty) {
        resolvedWorkerDocId = workerByEmail.docs[0].id;
      }
    }

    if (resolvedWorkerDocId) {
      const existingAssignmentSnap = await adminDb
        .collection('assignments')
        .where('workerId', '==', resolvedWorkerDocId)
        .where('eventId', '==', selectedEventId)
        .get();

      const hasExistingAssignmentForEvent = existingAssignmentSnap.docs.some((doc) => {
        const assignment = doc.data() as WorkerAssignment;
        const assignmentStatus = String(assignment.status || '').trim();
        return assignmentStatus !== 'Cancelled' && assignmentStatus !== 'Declined';
      });

      if (hasExistingAssignmentForEvent) {
        return {
          success: false,
          message: 'You already have an active assigned role for this event. Once assigned, this event is no longer open for additional role applications.',
        };
      }
    }

    if (resolvedWorkerDocId) {
      const workerUpdatePayload: Record<string, unknown> = {
        fullName,
        email,
        whatsappNumber: String(input.phone || '').trim() || undefined,
        alternateWhatsappNumber: String(input.alternatePhone || '').trim() || undefined,
        address: String(input.address || '').trim() || undefined,
        city: String(input.city || '').trim() || undefined,
        pincode: String(input.pincode || '').trim() || undefined,
        state: String(input.state || '').trim() || undefined,
        skills: normalizeList(input.skills),
        declaration: agreements.freelance && agreements.duties && agreements.reporting,
        updatedAt: now,
      };

      if ((!hasSavedBankDetails || updateSavedBankDetails) && hasProvidedBankDetails && bankDetails.saveForFuture) {
        workerUpdatePayload.bankAccountName = bankDetails.accountName;
        workerUpdatePayload.bankAccountNumber = bankDetails.accountNumber;
        workerUpdatePayload.ifscCode = bankDetails.ifscCode;
        workerUpdatePayload.upiId = bankDetails.upiId;
        workerUpdatePayload.panNumber = bankDetails.panNumber;
        workerUpdatePayload.bankName = bankDetails.bankName;
      }

      await adminDb
        .collection('workers')
        .doc(resolvedWorkerDocId)
        .set(compactFirestoreData(workerUpdatePayload), { merge: true });
    }

    const rolePreferenceDetails: NonNullable<Application['rolePreferenceDetails']> = [];
    selectedRoleIds.forEach((roleId, index) => {
      rolePreferenceDetails.push({
        roleId,
        roleName: preferredRoleMap.get(roleId)?.roleName,
        paymentAmount: preferredRoleMap.get(roleId)?.paymentAmount,
        preferenceOrder: (index + 1) as 1 | 2 | 3,
      });
    });

    const id = adminDb.collection('applications').doc().id;
    const application: Application = {
      id,
      workerId: resolvedWorkerDocId || undefined,
      email,
      fullName,
      selectedEvent: {
        eventId: String(input.eventId || '').trim(),
        eventName: String(input.eventName || '').trim(),
        eventDate: String(input.eventDate || '').trim() || undefined,
      },
      personalDetails: {
        address: String(input.address || '').trim() || undefined,
        phone: String(input.phone || '').trim() || undefined,
        alternatePhone: String(input.alternatePhone || '').trim() || undefined,
        city: String(input.city || '').trim() || undefined,
        pincode: String(input.pincode || '').trim() || undefined,
        state: String(input.state || '').trim() || undefined,
      },
      experience: {},
      skills: normalizeList(input.skills),
      rolePreferences: allPreferredRoleIds,
      rolePreferenceDetails,
      eventPreferences: [String(input.eventId || '').trim()],
      eventAvailabilityOptions,
      logistics: {
        canTravel: input.canTravel === true,
        needAccommodation: input.needAccommodation === true,
        needLocalTransport: input.needLocalTransport === true,
      },
      agreements,
      bankDetails: bankDetails.saveForFuture || updateSavedBankDetails || !hasSavedBankDetails ? bankDetails : undefined,
      status: 'Submitted',
      notes: String(input.notes || '').trim() || undefined,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await adminDb
      .collection('applications')
      .doc(id)
      .set(compactFirestoreData(application) as unknown as Record<string, unknown>);

    return { success: true, message: 'Application submitted successfully. Status: Applied.' };
  } catch (error) {
    return {
      success: false,
      message: `Failed to submit application: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ===================== COMMUNICATION MANAGEMENT =====================

export async function getCommunicationTemplatesAction(): Promise<CommunicationTemplate[]> {
  try {
    const snap = await adminDb
      .collection('communicationTemplates')
      .orderBy('updatedAt', 'desc')
      .get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as CommunicationTemplate) as CommunicationTemplate);
  } catch (error) {
    console.error('Failed to fetch communication templates:', error);
    return [];
  }
}

export async function createCommunicationTemplateAction(input: {
  name: string;
  type: 'Email' | 'WhatsApp';
  subject?: string;
  body: string;
  category?: CommunicationTemplate['category'];
}): Promise<{ success: boolean; data?: CommunicationTemplate; error?: string }> {
  try {
    const now = new Date();
    const id = adminDb.collection('communicationTemplates').doc().id;
    const template: CommunicationTemplate = {
      id,
      name: String(input.name || '').trim(),
      type: input.type,
      subject: input.type === 'Email' ? String(input.subject || '').trim() : undefined,
      body: String(input.body || '').trim(),
      category: input.category || 'Other',
      createdAt: now,
      updatedAt: now,
    };

    if (!template.name) {
      return { success: false, error: 'Template name is required.' };
    }
    if (!template.body) {
      return { success: false, error: 'Template body is required.' };
    }

    await adminDb
      .collection('communicationTemplates')
      .doc(id)
      .set(compactFirestoreData(template) as unknown as Record<string, unknown>);

    return { success: true, data: toClientSafe(template) as CommunicationTemplate };
  } catch (error) {
    return {
      success: false,
      error: `Failed to save template: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export async function getCommunicationCampaignsAction(limitCount = 25): Promise<Communication[]> {
  try {
    const safeLimit = Math.max(1, Math.min(100, Number(limitCount) || 25));
    const snap = await adminDb
      .collection('communications')
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .get();
    return snap.docs.map((doc: any) => toClientSafe(doc.data() as Communication) as Communication);
  } catch (error) {
    console.error('Failed to fetch communication campaigns:', error);
    return [];
  }
}

export async function sendCommunicationCampaignAction(input: {
  type: 'Email' | 'WhatsApp';
  campaignName: string;
  subject?: string;
  body: string;
  whatsAppTemplateParams?: string[];
  recipientMode: 'all' | 'accepted' | 'selected' | 'single' | 'event' | 'role';
  selectedWorkerIds?: string[];
  singleWorkerId?: string;
  eventId?: string;
  roleId?: string;
}): Promise<{ success: boolean; data?: Communication; message?: string; error?: string }> {
  try {
    const campaignName = String(input.campaignName || '').trim();
    const body = String(input.body || '').trim();
    const whatsAppTemplateParams = Array.isArray(input.whatsAppTemplateParams)
      ? input.whatsAppTemplateParams.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const type = input.type;

    if (!campaignName) {
      return { success: false, error: 'Campaign name is required.' };
    }
    if (type === 'Email' && !body) {
      return { success: false, error: 'Email HTML body is required.' };
    }

    const workersSnap = await adminDb
      .collection('workers')
      .where('status', '==', 'Active')
      .get();
    const workers = dedupeWorkersByEmail(workersSnap.docs.map((doc: any) => doc.data() as Worker));

    const selectedIds = new Set((input.selectedWorkerIds || []).filter(Boolean));
    let recipients: Worker[] = [];

    const acceptedWorkers = workers.filter((worker) => worker.isRecruitmentApproved);

    if (input.recipientMode === 'all') {
      recipients = workers;
    } else if (input.recipientMode === 'accepted') {
      recipients = acceptedWorkers;
    } else if (input.recipientMode === 'event') {
      const eventId = String(input.eventId || '').trim();
      if (!eventId) {
        return { success: false, error: 'Please select an event for event-wise staffing communication.' };
      }

      const eventAssignmentsSnap = await adminDb
        .collection('assignments')
        .where('eventId', '==', eventId)
        .get();

      const activeWorkerIds = new Set(
        eventAssignmentsSnap.docs
          .map((doc: any) => doc.data() as WorkerAssignment)
          .filter((assignment) => {
            const status = String(assignment.status || '').trim();
            return status !== 'Cancelled' && status !== 'Declined';
          })
          .map((assignment) => String(assignment.workerId || '').trim())
          .filter(Boolean)
      );

      recipients = workers.filter((worker) => activeWorkerIds.has(String(worker.id || '').trim()));
    } else if (input.recipientMode === 'role') {
      const roleId = String(input.roleId || '').trim();
      if (!roleId) {
        return { success: false, error: 'Please select a role for role-wise staffing communication.' };
      }

      const roleAssignmentsSnap = await adminDb
        .collection('assignments')
        .where('roleId', '==', roleId)
        .get();

      const activeWorkerIds = new Set(
        roleAssignmentsSnap.docs
          .map((doc: any) => doc.data() as WorkerAssignment)
          .filter((assignment) => {
            const status = String(assignment.status || '').trim();
            return status !== 'Cancelled' && status !== 'Declined';
          })
          .map((assignment) => String(assignment.workerId || '').trim())
          .filter(Boolean)
      );

      recipients = workers.filter((worker) => activeWorkerIds.has(String(worker.id || '').trim()));
    } else if (input.recipientMode === 'single') {
      const single = workers.find((w) => w.id === input.singleWorkerId);
      recipients = single ? [single] : [];
    } else {
      recipients = workers.filter((w) => selectedIds.has(w.id));
    }

    if (type === 'Email') {
      recipients = recipients.filter((w) => !!normalizeEmail(w.email));
    } else {
      recipients = recipients.filter((w) => !!String(w.whatsappNumber || '').trim());
    }

    if (recipients.length === 0) {
      return { success: false, error: 'No eligible recipients found for this campaign.' };
    }

    let sentCount = 0;
    let failedCount = 0;
    const failureSamples: string[] = [];

    const interpolate = (template: string, worker: Worker) =>
      String(template || '')
        .replace(/\{\{\s*workerName\s*\}\}/gi, String(worker.fullName || 'Team Member'))
        .replace(/\{\{\s*workerEmail\s*\}\}/gi, String(worker.email || ''));

    for (const worker of recipients) {
      try {
        if (type === 'Email') {
          const recipientEmail = normalizeEmail(worker.email);
          if (!recipientEmail) {
            failedCount += 1;
            if (failureSamples.length < 3) failureSamples.push(`${worker.fullName || 'Worker'}: missing email`);
            continue;
          }

          const subject = String(input.subject || '').trim() || campaignName;
          const personalizedBody = interpolate(body, worker);
          const delivered = await sendRawHtmlEmail(recipientEmail, subject, personalizedBody);

          if (delivered) {
            sentCount += 1;
          } else {
            failedCount += 1;
            if (failureSamples.length < 3) failureSamples.push(`${recipientEmail}: provider rejected/failed`);
          }
        } else {
          const mobile = String(worker.whatsappNumber || '').trim();
          if (!mobile) {
            failedCount += 1;
            if (failureSamples.length < 3) failureSamples.push(`${worker.fullName || 'Worker'}: missing mobile`);
            continue;
          }

          const resolvedTemplateParams = whatsAppTemplateParams.map((param) => interpolate(param, worker));
          const waResult = await sendAiSensyMessage(
            mobile,
            campaignName,
            resolvedTemplateParams,
            'Bergman Work With Bergman',
            'sendCommunicationCampaignAction',
            'BERGMAN 2'
          );

          if (waResult.success) {
            sentCount += 1;
          } else {
            failedCount += 1;
            if (failureSamples.length < 3) {
              failureSamples.push(`${worker.fullName || mobile}: ${waResult.message || 'WhatsApp delivery failed'}`);
            }
          }
        }
      } catch (deliveryError) {
        failedCount += 1;
        if (failureSamples.length < 3) {
          failureSamples.push(
            `${worker.fullName || worker.email || worker.whatsappNumber || 'Worker'}: ${deliveryError instanceof Error ? deliveryError.message : 'Unknown delivery error'}`
          );
        }
      }
    }

    const campaignStatus: Communication['status'] = sentCount === 0 ? 'Failed' : failedCount > 0 ? 'Partial' : 'Sent';

    const now = new Date();
    const id = adminDb.collection('communications').doc().id;
    const communication: Communication = {
      id,
      type,
      recipientIds: recipients.map((w) => w.id),
      recipientEmail: input.recipientMode === 'single' && type === 'Email' ? normalizeEmail(recipients[0]?.email) : undefined,
      recipientPhone: input.recipientMode === 'single' && type === 'WhatsApp' ? String(recipients[0]?.whatsappNumber || '').trim() : undefined,
      templateName: campaignName,
      subject: type === 'Email' ? String(input.subject || '').trim() : undefined,
      body,
      target:
        input.recipientMode === 'all'
          ? 'All Workers'
          : input.recipientMode === 'accepted'
            ? 'Accepted Workers'
            : input.recipientMode === 'event'
              ? 'Event Workers'
              : input.recipientMode === 'role'
                ? 'Specific Role'
          : input.recipientMode === 'single'
            ? 'Individual'
            : 'Selected Workers',
      eventId: input.recipientMode === 'event' ? String(input.eventId || '').trim() : undefined,
      roleId: input.recipientMode === 'role' ? String(input.roleId || '').trim() : undefined,
      status: campaignStatus,
      sentCount,
      failedCount,
      sentAt: sentCount > 0 ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };

    await adminDb
      .collection('communications')
      .doc(id)
      .set(compactFirestoreData(communication) as unknown as Record<string, unknown>);

    const failureSuffix = failureSamples.length > 0 ? ` Sample errors: ${failureSamples.join(' | ')}` : '';

    if (sentCount === 0) {
      return {
        success: false,
        data: toClientSafe(communication) as Communication,
        error: `Campaign saved, but delivery failed for all ${failedCount} recipient(s).${failureSuffix}`,
      };
    }

    return {
      success: true,
      data: toClientSafe(communication) as Communication,
      message:
        failedCount > 0
          ? `${type} campaign sent to ${sentCount} recipient(s), failed for ${failedCount}.${failureSuffix}`
          : `${type} campaign sent successfully to ${sentCount} recipient(s).`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send campaign: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ===================== DASHBOARD =====================

export async function getDashboardMetrics(): Promise<{
  totalWorkers: number;
  activeWorkers: number;
  pendingApplications: number;
  openRoles: number;
  filledRoles: number;
  upcomingEvents: number;
  totalPaymentsDue: number;
  totalPaymentsPaid: number;
}> {
  try {
    // Total workers (deduped by email to avoid legacy duplicate imports inflating counts)
    const workersSnap = await adminDb.collection('workers').get();
    const workers = dedupeWorkersByEmail(workersSnap.docs.map((d: any) => d.data() as Worker));
    const cleanWorkers = workers.filter((w) => isLikelyValidWorkerRecord(w));
    const totalWorkers = cleanWorkers.length;
    const activeWorkers = cleanWorkers.filter((w) => w.status === 'Active').length;

    // Pending applications
    const appsSnap = await adminDb
      .collection('applications')
      .where('status', '==', 'Submitted')
      .get();
    const pendingApplications = appsSnap.size;

    // Open and filled roles
    const rolesSnap = await adminDb.collection('openRoles').where('isActive', '==', true).get();
    let openRoles = 0;
    let filledRoles = 0;

    rolesSnap.forEach((doc: any) => {
      const role = doc.data() as OpenRole;
      if ((role.numberAssigned || 0) >= role.numberRequired) {
        filledRoles++;
      } else {
        openRoles++;
      }
    });

    // Payments
    const paymentsSnap = await adminDb.collection('payments').get();
    let totalPaymentsDue = 0;
    let totalPaymentsPaid = 0;

    paymentsSnap.forEach((doc: any) => {
      const payment = doc.data() as Payment;
      if (payment.status === 'Paid') {
        totalPaymentsPaid += payment.amount;
      } else if (payment.status === 'Pending' || payment.status === 'Approved') {
        totalPaymentsDue += payment.amount;
      }
    });

    return {
      totalWorkers,
      activeWorkers,
      pendingApplications,
      openRoles,
      filledRoles,
      upcomingEvents: 0, // TODO: Calculate from events
      totalPaymentsDue,
      totalPaymentsPaid,
    };
  } catch (error) {
    console.error('Failed to fetch dashboard metrics:', error);
    return {
      totalWorkers: 0,
      activeWorkers: 0,
      pendingApplications: 0,
      openRoles: 0,
      filledRoles: 0,
      upcomingEvents: 0,
      totalPaymentsDue: 0,
      totalPaymentsPaid: 0,
    };
  }
}
