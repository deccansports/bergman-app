// src/lib/actions/googleFormActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { getKV, putKV } from '@/lib/cloudflare/kv';
import { serializeValue } from '@/lib/utils';
import { calculateAgeGroup } from '@/lib/utils';
import type { EventCalendarEntry, EventParticipant, TicketDefinition } from '@/lib/types';
import { assignNextAvailableBib } from '@/lib/actions/bibActions';
import { _mirrorParticipantToKV } from '@/lib/actions/dataSyncActions';
import { sendIndividualConfirmationEmailAction, sendIndividualConfirmationWhatsAppAction } from '@/lib/actions/emailActions';
import { sendAdminTicketSaleNotificationEmail } from '@/lib/auth/brevoService';
import { NO_CLUB_SELECTED_VALUE } from '@/lib/constants';
import { getEventParticipants } from '@/lib/dataLayerOptimized';

const ACTION_NAME = 'googleFormActions';
const GOOGLE_FORM_MAPPINGS_CACHE_KEY = 'googleform:mappings:list';
const GOOGLE_FORM_REGISTRATIONS_CACHE_KEY = 'googleform:registrations:list';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoogleFormRegistration {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  eventCategory?: string;
  status: string;
  paymentStatus?: string;
  paymentProof?: string;
  bibNumber?: string;
  source: string;
  sourceType?: string;
  sourceName?: string;
  formId?: string;
  sheetId?: string;
  gst?: boolean;
  createdAt?: string;
  eventId?: string;
  eventName?: string;
  [key: string]: unknown;
}

export interface TicketConfig {
  /** ID of our internal TicketDefinition */
  ourTicketId: string;
  /** Display name of our internal ticket */
  ourTicketName: string;
  /** Optional sub-category id for multi-distance tickets (e.g. Swimathon) */
  selectedSubCategoryId?: string;
  /** Optional sub-category display name */
  selectedSubCategoryName?: string;
  /** Exact text of the option as it appears in the Google Form dropdown */
  formOptionLabel: string;
  /** Price for this channel in paisa (may differ from our standard price) */
  price: number;
  /** @deprecated kept for backward compatibility */
  category?: string;
}

export interface FormMapping {
  id: string;
  formUrl: string;
  formId: string;
  sheetUrl: string;
  sheetId: string;
  eventId: string;
  eventName: string;
  sourceName: string;
  tickets: Record<string, TicketConfig>;
  lastSyncedRow: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type FormMappingInput = Omit<FormMapping, 'id' | 'createdAt' | 'updatedAt'>;

function nowIso(): string {
  return new Date().toISOString();
}

function sortMappings(mappings: FormMapping[]): FormMapping[] {
  return [...mappings].sort((a, b) => {
    const aTime = new Date(String(a.createdAt || a.updatedAt || '')).getTime() || 0;
    const bTime = new Date(String(b.createdAt || b.updatedAt || '')).getTime() || 0;
    return bTime - aTime;
  });
}

function sortRegistrations(registrations: GoogleFormRegistration[]): GoogleFormRegistration[] {
  return [...registrations].sort((a, b) => {
    const aTime = new Date(String((a as any).createdAt || (a as any).updatedAt || '')).getTime() || 0;
    const bTime = new Date(String((b as any).createdAt || (b as any).updatedAt || '')).getTime() || 0;
    return bTime - aTime;
  });
}

async function readFormMappingsCache(): Promise<FormMapping[] | null> {
  const cached = await getKV<FormMapping[]>(GOOGLE_FORM_MAPPINGS_CACHE_KEY, ACTION_NAME);
  return Array.isArray(cached) ? cached : null;
}

async function writeFormMappingsCache(mappings: FormMapping[]): Promise<void> {
  await putKV(GOOGLE_FORM_MAPPINGS_CACHE_KEY, sortMappings(mappings), ACTION_NAME);
}

async function readRegistrationsCache(): Promise<GoogleFormRegistration[] | null> {
  const cached = await getKV<GoogleFormRegistration[]>(GOOGLE_FORM_REGISTRATIONS_CACHE_KEY, ACTION_NAME);
  return Array.isArray(cached) ? cached : null;
}

async function writeRegistrationsCache(registrations: GoogleFormRegistration[]): Promise<void> {
  await putKV(GOOGLE_FORM_REGISTRATIONS_CACHE_KEY, sortRegistrations(registrations), ACTION_NAME);
}

async function fetchFormMappingsFromFirestoreFallback(): Promise<FormMapping[]> {
  const db = getFirestoreInstance();
  const snapshot = await db
    .collection('formMappings')
    .orderBy('createdAt', 'desc')
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...serializeValue(doc.data()),
  })) as FormMapping[];
}

async function ensureFormMappingsCache(): Promise<FormMapping[]> {
  const cached = await readFormMappingsCache();
  if (cached) return sortMappings(cached);

  const fallback = await fetchFormMappingsFromFirestoreFallback();
  await writeFormMappingsCache(fallback);
  return fallback;
}

async function fetchGoogleFormRegistrationsFromFirestoreFallback(): Promise<GoogleFormRegistration[]> {
  const db = getFirestoreInstance();

  const sourceAliasArray = [
    'google_form',
    'googleform',
    'google form',
    'google_sheet',
    'googlesheet',
    'google sheet',
    'sheet',
    'sheet_import',
  ];
  const sourceAliases = new Set(sourceAliasArray);
  const normalize = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const chunk = <T,>(items: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  };

  const fields = [
    'name', 'email', 'phone', 'eventCategory', 'status', 'paymentStatus',
    'paymentProof', 'bibNumber', 'source', 'sourceType', 'sourceName',
    'formId', 'sheetId', 'gst', 'createdAt', 'updatedAt', 'importedAt',
    'eventId', 'eventName', 'clubId', 'clubName', 'participantId', 'ticketId', 'ticketName',
    'selectedSubCategory', 'sourceRowSignature', 'originalEmail', 'emailAliased', 'approvedAt', 'rejectedAt',
  ];

  const mappingsSnap = await db.collection('formMappings')
    .where('active', '==', true)
    .select('formId', 'sheetId')
    .get();

  const mappedFormIds = Array.from(new Set(
    mappingsSnap.docs.map((doc) => String(doc.data()?.formId || '').trim()).filter(Boolean)
  ));
  const mappedSheetIds = Array.from(new Set(
    mappingsSnap.docs.map((doc) => String(doc.data()?.sheetId || '').trim()).filter(Boolean)
  ));

  const reads = await Promise.allSettled([
    db.collection('registrations').where('source', 'in', sourceAliasArray).select(...fields).limit(500).get(),
    db.collection('registrations').where('sourceType', 'in', sourceAliasArray).select(...fields).limit(500).get(),
    ...chunk(mappedFormIds, 10).map((ids) => db.collection('registrations').where('formId', 'in', ids).select(...fields).limit(250).get()),
    ...chunk(mappedSheetIds, 10).map((ids) => db.collection('registrations').where('sheetId', 'in', ids).select(...fields).limit(250).get()),
  ]);

  const docMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const read of reads) {
    if (read.status !== 'fulfilled') continue;
    for (const doc of read.value.docs) {
      if (!docMap.has(doc.id)) docMap.set(doc.id, doc);
    }
  }

  const registrations = Array.from(docMap.values())
    .map((doc) => ({ id: doc.id, ...serializeValue(doc.data()) } as GoogleFormRegistration))
    .filter((r) => {
      const source = normalize(r.source);
      const sourceType = normalize(r.sourceType);
      const hasGoogleLikeSource = sourceAliases.has(source) || sourceAliases.has(sourceType);
      const hasFormOrSheetIdentity = !!String(r.formId || '').trim() || !!String(r.sheetId || '').trim();
      return hasGoogleLikeSource || hasFormOrSheetIdentity;
    });

  return sortRegistrations(registrations);
}

async function ensureRegistrationsCache(): Promise<GoogleFormRegistration[]> {
  const cached = await readRegistrationsCache();
  if (Array.isArray(cached) && cached.length > 0) return sortRegistrations(cached);
  // KV is empty — return fast instead of doing a slow Firestore fallback.
  // The background sync (autoSyncAllFormMappingsAction) will populate the cache.
  return [];
}

// Full Firestore rebuild — only call this explicitly (e.g. from a manual Resync button).
export async function rebuildRegistrationsCacheFromFirestoreAction(): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const registrations = await fetchGoogleFormRegistrationsFromFirestoreFallback();
    await writeRegistrationsCache(registrations);
    return { success: true, count: registrations.length };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function saveFormMappingToCache(mapping: FormMapping): Promise<void> {
  const mappings = await ensureFormMappingsCache();
  const next = mappings.filter((item) => item.id !== mapping.id);
  next.push(mapping);
  await writeFormMappingsCache(next);
}

async function deleteFormMappingFromCache(id: string): Promise<void> {
  const mappings = await ensureFormMappingsCache();
  await writeFormMappingsCache(mappings.filter((item) => item.id !== id));
}

async function saveRegistrationToCache(registration: GoogleFormRegistration): Promise<void> {
  const registrations = await ensureRegistrationsCache();
  const next = registrations.filter((item) => item.id !== registration.id);
  next.push(registration);
  await writeRegistrationsCache(next);
}

async function replaceRegistrationsCache(registrations: GoogleFormRegistration[]): Promise<void> {
  await writeRegistrationsCache(registrations);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBibPrefix(category: string): string {
  const lower = (category || '').toLowerCase();
  if (lower.includes('olympic')) return 'OT';
  if (lower.includes('sprint')) return 'ST';
  if (lower.includes('duathlon')) return 'DU';
  return 'EV';
}

function generateBibNumber(category: string): string {
  const prefix = getBibPrefix(category);
  const random = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}${random}`;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

async function resolveAffiliatedClubFromSystem(
  db: ReturnType<typeof getFirestoreInstance>,
  emailInput: unknown
): Promise<{ clubId: string | null; clubName: string | null }> {
  const email = String(emailInput || '').trim().toLowerCase();
  if (!email) {
    return { clubId: null, clubName: null };
  }

  const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (userSnap.empty) {
    return { clubId: null, clubName: null };
  }

  const userData = userSnap.docs[0]?.data() || {};
  const activeClubFromHistory = Array.isArray(userData?.clubHistory)
    ? (userData.clubHistory.find((entry: any) => entry?.isActive) || null)
    : null;
  const clubId = String(userData?.clubId || activeClubFromHistory?.clubId || '').trim();
  const fallbackNameFromUser = String(userData?.clubName || '').trim();
  const fallbackNameFromHistory = String(activeClubFromHistory?.clubName || '').trim();
  const fallbackName = (fallbackNameFromUser || fallbackNameFromHistory || '').trim();
  const normalizedFallback = fallbackName.toLowerCase();

  if (!clubId || clubId === NO_CLUB_SELECTED_VALUE) {
    return { clubId: null, clubName: null };
  }

  const clubDoc = await db.collection('clubs').doc(clubId).get();
  if (clubDoc.exists) {
    const clubDocData = clubDoc.data() || {};
    const clubNameFromDoc = String(
      (clubDocData as any)?.name ||
      (clubDocData as any)?.clubName ||
      (clubDocData as any)?.club_name ||
      ''
    ).trim();
    if (clubNameFromDoc) {
      return { clubId, clubName: clubNameFromDoc };
    }
  }

  if (fallbackName && normalizedFallback !== 'unaffiliated') {
    return { clubId, clubName: fallbackName };
  }

  // Avoid inconsistent state like { clubId: 'abc', clubName: null }.
  return { clubId: null, clubName: null };
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function extractFormIdFromUrl(input: string): string {
  const raw = String(input || '').trim();
  const match = raw.match(/\/d\/(?:e\/)?([a-zA-Z0-9_-]{10,})/);
  if (match) return match[1];
  return raw;
}

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
  const raw = String(input || '').trim();
  return /^https:\/\/docs\.google\.com\/forms\//i.test(raw);
}

function isValidGoogleSheetUrl(input: string): boolean {
  const raw = String(input || '').trim();
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(raw);
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

function normalizeHeaderKey(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTicketLabelForMatch(input: string): string {
  const base = normalizeText(input)
    // remove trailing price patterns like " - 8999" / " - ₹8999"
    .replace(/\s*-\s*₹?\s*\d+(?:[.,]\d+)?\s*$/, '')
    // remove brackets with amounts e.g. "(8999)"
    .replace(/\(\s*₹?\s*\d+(?:[.,]\d+)?\s*\)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base;
}

function normalizeDobToIso(input: string | null | undefined): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Already ISO-ish
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // dd/mm/yyyy or mm/dd/yyyy or dd-mm-yyyy
  const partsMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (partsMatch) {
    let a = Number(partsMatch[1]);
    let b = Number(partsMatch[2]);
    const y = Number(partsMatch[3]);
    if (y < 1900 || y > 2100) return null;

    let day: number;
    let month: number;

    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    } else {
      // Default to DD/MM for India-centric forms when ambiguous.
      day = a;
      month = b;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function buildEmailAlias(email: string, suffix: number): string {
  const raw = String(email || '').trim();
  if (!raw.includes('@')) return raw;
  const [local, domain] = raw.split('@');
  const cleanLocal = (local || '').replace(/\+\d+$/, '');
  return `${cleanLocal}+${suffix}@${domain}`.toLowerCase();
}

function ensureUniqueEmail(
  email: string | null | undefined,
  usedEmails: Set<string>
): { email: string | null; originalEmail?: string | null; aliased: boolean } {
  const candidate = String(email || '').trim().toLowerCase();
  if (!candidate) return { email: null, originalEmail: null, aliased: false };

  if (!usedEmails.has(candidate)) {
    usedEmails.add(candidate);
    return { email: candidate, originalEmail: null, aliased: false };
  }

  let suffix = 1;
  let alias = buildEmailAlias(candidate, suffix);
  while (usedEmails.has(alias)) {
    suffix++;
    alias = buildEmailAlias(candidate, suffix);
  }

  usedEmails.add(alias);
  return { email: alias, originalEmail: candidate, aliased: true };
}

function isLikelyEmail(value: unknown): boolean {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return false;
  // Lightweight validation: enough for sheet imports where values can be noisy.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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
      // try next URL
    }
  }

  return '';
}

function validateFormMappingInput(data: FormMappingInput): string | null {
  if (!data.formUrl || !isValidGoogleFormUrl(data.formUrl)) return 'Valid Google Form URL is required.';
  if (!data.formId) return 'Could not extract Form ID from Form URL.';
  if (!data.sheetUrl || !isValidGoogleSheetUrl(data.sheetUrl)) return 'Valid Google Sheet URL is required.';
  if (!data.sheetId) return 'Could not extract Sheet ID from Sheet URL.';
  if (!data.eventId) return 'Event is required.';
  if (!data.sourceName?.trim()) return 'Source Name is required.';

  const values = Object.values(data.tickets || {});
  if (values.length === 0) return 'At least 1 ticket mapping is required.';

  const seenOurTickets = new Set<string>();
  const seenFormOptions = new Set<string>();
  for (const t of values) {
    if (!t.ourTicketId?.trim()) return 'Each ticket mapping must select Our Ticket.';
    if (!t.formOptionLabel?.trim()) return 'Each ticket mapping must define Google Form Option.';
    const ourKey = `${t.ourTicketId.trim()}::${String(t.selectedSubCategoryId || '').trim()}`;
    const formKey = normalizeText(t.formOptionLabel);
    if (seenOurTickets.has(ourKey)) return 'Duplicate Our Ticket mapping found.';
    if (seenFormOptions.has(formKey)) return 'Duplicate Google Form Option mapping found.';
    seenOurTickets.add(ourKey);
    seenFormOptions.add(formKey);
  }

  return null;
}

function resolveTicketFromMapping(
  mapping: FormMapping | null,
  requestedFormOption: string
): TicketConfig | null {
  if (!mapping?.tickets) return null;
  const values = Object.values(mapping.tickets);
  if (values.length === 0) return null;

  const wanted = normalizeText(requestedFormOption);
  if (!wanted) return null;

  const exact = values.find((t) =>
    normalizeText(t.formOptionLabel || t.category) === wanted
  );
  if (exact) return exact;

  return null;
}

// ─── Registrations ────────────────────────────────────────────────────────────

export async function getGoogleFormRegistrationsAction(): Promise<{
  success: boolean;
  registrations?: GoogleFormRegistration[];
  error?: string;
}> {
  try {
    const registrations = await ensureRegistrationsCache();

    return { success: true, registrations };
  } catch (error: any) {
    console.error('[getGoogleFormRegistrations] Error:', error);
    return { success: false, error: error.message || 'Failed to fetch registrations' };
  }
}

export async function approveGoogleFormRegistrationAction(
  registrationId: string,
  category?: string,
  options?: { forceWriteAllFields?: boolean; reassignBib?: boolean }
): Promise<{ success: boolean; bibNumber?: string; participantId?: string; error?: string }> {
  try {
    const db = getFirestoreInstance();
    const registrations = await ensureRegistrationsCache();
    const reg = registrations.find((item) => item.id === registrationId) as Record<string, any> | undefined;
    if (!reg) {
      return { success: false, error: 'Registration not found.' };
    }
    const eventId = String(reg.eventId || '').trim();
    if (!eventId) {
      return { success: false, error: 'Registration is missing eventId.' };
    }

    const pickFirstNonEmpty = (...values: unknown[]): string | null => {
      for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
      }
      return null;
    };

    // If already linked to a participant, keep idempotent behavior.
    // When options.forceWriteAllFields is true, re-apply all participant fields from registration.
    if (reg.participantId) {
      const eventRef = db.collection('events').doc(eventId);
      const participantRef = eventRef.collection('participants').doc(String(reg.participantId));
      const participantSnap = await participantRef.get();

      if (participantSnap.exists) {
        const participant = participantSnap.data() as Record<string, any>;
        const preferReg = !!options?.forceWriteAllFields;
        const currentBib = String(participant?.bibNumber || reg.bibNumber || '').trim();
        let correctedBib = currentBib;

        // Auto-correct old fallback bibs, missing bibs, or force-reassign on explicit resync.
        const looksLikeFallbackBib = /^[A-Z]{2}\d{4}$/.test(currentBib);
        const shouldTryBibReassign = !!options?.reassignBib || !currentBib || looksLikeFallbackBib;
        const ticketIdForBib = String((reg as any).mappedTicketId || participant?.ticketId || '').trim();
        const selectedSubCategoryForBib = String((reg as any).selectedSubCategory || participant?.selectedSubCategory || '').trim() || null;
        if (shouldTryBibReassign && ticketIdForBib) {
          const participantsSnapshotForKeys = await getEventParticipants(eventId);
          const isTerminalStatus = (p: any) => {
            const combined = [p?.ticketStatus, p?.registrationStatus, p?.status, p?.paymentStatus]
              .map((s) => String(s || '').trim().toLowerCase())
              .filter(Boolean)
              .join(' ');
            return combined.includes('cancel') || combined.includes('defer') || combined.includes('refund') || combined.includes('inactive');
          };

          const allAssignedBibs = new Set<string>(
            participantsSnapshotForKeys
              .filter((p: any) => !isTerminalStatus(p) && String(p?.id || '') !== String(reg.participantId))
              .map((p: any) => p?.bibNumber)
              .filter(Boolean)
              .map(String)
          );

          let reassigned = await assignNextAvailableBib(
            eventId,
            ticketIdForBib,
            String(participant?.ageCategory || (reg as any).ageCategory || '').trim() || null,
            String(participant?.gender || (reg as any).gender || '').trim() || null,
            allAssignedBibs,
            selectedSubCategoryForBib
          );

          // Relaxed fallback: if strict age/gender/sub-category does not match any BIB rule,
          // retry with generic criteria so resync can still fix legacy random bibs.
          if (!reassigned) {
            reassigned = await assignNextAvailableBib(
              eventId,
              ticketIdForBib,
              null,
              null,
              allAssignedBibs,
              null
            );
          }

          if (reassigned) {
            correctedBib = reassigned;
          } else if (options?.reassignBib) {
            // Keep existing BIB and continue resync so profile data can still be repaired
            // even when BIB rules are missing for this event/ticket.
            console.warn(
              `[approveGoogleFormRegistrationAction] Re-sync skipped BIB reassignment (no rule). Event:${eventId}, Ticket:${ticketIdForBib}, Participant:${reg.participantId}`
            );
          }
        } else if (options?.reassignBib && !ticketIdForBib) {
          return {
            success: false,
            error: 'Cannot reassign BIB: participant has no mapped ticket.',
          };
        }

        const resolvedName = pickFirstNonEmpty(
          ...(preferReg
            ? [(reg as any).name, participant?.name]
            : [participant?.name, (reg as any).name])
        );
        const resolvedEmail = pickFirstNonEmpty(
          ...(preferReg
            ? [(reg as any).email, participant?.email]
            : [participant?.email, (reg as any).email])
        );

        const resolvedMobile = pickFirstNonEmpty(
          ...(preferReg
            ? [
                (reg as any).mobile,
                (reg as any).phone,
                (reg as any).contact,
                (reg as any).contactNumber,
                (reg as any).phoneNumber,
                (reg as any).whatsappNumber,
                participant?.mobile,
                participant?.phone,
              ]
            : [
                participant?.mobile,
                participant?.phone,
                (reg as any).mobile,
                (reg as any).phone,
                (reg as any).contact,
                (reg as any).contactNumber,
                (reg as any).phoneNumber,
                (reg as any).whatsappNumber,
              ])
        );
        const resolvedGender = pickFirstNonEmpty(...(preferReg ? [(reg as any).gender, (reg as any).sex, participant?.gender] : [participant?.gender, (reg as any).gender, (reg as any).sex]));
        const resolvedBloodGroup = pickFirstNonEmpty(...(preferReg ? [(reg as any).bloodGroup, (reg as any).blood, participant?.bloodGroup] : [participant?.bloodGroup, (reg as any).bloodGroup, (reg as any).blood]));
        const resolvedTshirt = pickFirstNonEmpty(...(preferReg ? [(reg as any).tshirtSize, (reg as any).tshirt, (reg as any).tshirt_size, participant?.tshirtSize] : [participant?.tshirtSize, (reg as any).tshirtSize, (reg as any).tshirt, (reg as any).tshirt_size]));
        const resolvedEmergencyContact = pickFirstNonEmpty(
          ...(preferReg
            ? [
                (reg as any).emergencyContactNumber,
                (reg as any).emergencyContact,
                (reg as any).emergency,
                (reg as any).emergencyNumber,
                participant?.emergencyContactNumber,
              ]
            : [
                participant?.emergencyContactNumber,
                (reg as any).emergencyContactNumber,
                (reg as any).emergencyContact,
                (reg as any).emergency,
                (reg as any).emergencyNumber,
              ])
        );

        const resolvedTicketId = pickFirstNonEmpty((reg as any).mappedTicketId, participant?.ticketId);
        const resolvedTicketName = pickFirstNonEmpty((reg as any).mappedTicketName, participant?.ticketName, participant?.raceCategory);
        const resolvedSubCategory = pickFirstNonEmpty((reg as any).selectedSubCategory, participant?.selectedSubCategory);
        const mappedPricePaisa = Number((reg as any).mappedPricePaisa ?? participant?.amountPaidPaisa ?? participant?.basePricePaisa ?? 0);
        const resolvedAmountPaidPaisa = Number.isFinite(mappedPricePaisa) ? Math.max(0, Math.round(mappedPricePaisa)) : 0;
        const resolvedClub = await resolveAffiliatedClubFromSystem(db, resolvedEmail);

        await participantRef.set({
          name: resolvedName,
          nameLower: String(resolvedName || '').trim().toLowerCase() || null,
          email: resolvedEmail,
          buyerEmail: resolvedEmail,
          buyerName: resolvedName,
          mobile: resolvedMobile,
          gender: resolvedGender,
          dob: pickFirstNonEmpty((reg as any).dob, participant?.dob),
          age: Number((reg as any).age ?? participant?.age ?? 0) || null,
          ageCategory: pickFirstNonEmpty((reg as any).ageCategory, participant?.ageCategory),
          bloodGroup: resolvedBloodGroup,
          tshirtSize: resolvedTshirt,
          emergencyContactNumber: resolvedEmergencyContact,
          address: pickFirstNonEmpty((reg as any).address, (reg as any).fullAddress, participant?.address),
          city: pickFirstNonEmpty((reg as any).city, participant?.city),
          pincode: pickFirstNonEmpty((reg as any).pincode, (reg as any).pinCode, (reg as any).zipCode, participant?.pincode),
          state: pickFirstNonEmpty((reg as any).state, participant?.state),
          country: pickFirstNonEmpty((reg as any).country, participant?.country),
          idProofUrl: pickFirstNonEmpty((reg as any).idProofUrl, (reg as any).identityProofUrl, (reg as any).idProof, participant?.idProofUrl),
          previousTimingCertificateUrl: pickFirstNonEmpty((reg as any).previousTimingCertificateUrl, (reg as any).timingProofUrl, (reg as any).timingCertificateUrl, participant?.previousTimingCertificateUrl),
          digitalSignatureName: pickFirstNonEmpty((reg as any).digitalSignatureName, (reg as any).signatureName, (reg as any).signature, participant?.digitalSignatureName),
          raceCategory: pickFirstNonEmpty((reg as any).eventCategory, participant?.raceCategory),
          ticketId: resolvedTicketId,
          ticketName: resolvedTicketName,
          selectedSubCategory: resolvedSubCategory,
          amountPaidPaisa: resolvedAmountPaidPaisa || participant?.amountPaidPaisa || null,
          basePricePaisa: resolvedAmountPaidPaisa || participant?.basePricePaisa || null,
          ticketPrice: resolvedAmountPaidPaisa > 0 ? Number((resolvedAmountPaidPaisa / 100).toFixed(2)) : (participant?.ticketPrice || null),
          paymentMethod: pickFirstNonEmpty(participant?.paymentMethod, 'Google Form / Sheet'),
          paymentProof: pickFirstNonEmpty((reg as any).paymentProof, participant?.paymentProof),
          source: pickFirstNonEmpty((reg as any).source, participant?.source, 'google_form'),
          sourceType: pickFirstNonEmpty((reg as any).sourceType, (reg as any).source, participant?.sourceType, participant?.source, 'google_form'),
          sourceName: pickFirstNonEmpty((reg as any).sourceName, participant?.sourceName),
          formId: pickFirstNonEmpty((reg as any).formId, participant?.formId),
          googleFormRegistrationId: registrationId,
          status: 'approved',
          registrationStatus: 'approved',
          ticketStatus: pickFirstNonEmpty(participant?.ticketStatus, 'Active'),
          clubId: resolvedClub.clubId || participant?.clubId || null,
          clubName: resolvedClub.clubName || participant?.clubName || null,
          agreedWaiver: participant?.agreedWaiver ?? true,
          agreedRules: participant?.agreedRules ?? true,
          agreedCutoff: participant?.agreedCutoff ?? true,
          agreedPolicyChangeFlow: participant?.agreedPolicyChangeFlow ?? true,
          consentPromotions: participant?.consentPromotions ?? true,
          bibNumber: correctedBib || null,
          updatedAt: nowIso(),
        }, { merge: true });

        const updatedParticipantSnap = await participantRef.get();
        await _mirrorParticipantToKV({ id: updatedParticipantSnap.id, ...serializeValue(updatedParticipantSnap.data() || {}) });

        await saveRegistrationToCache({
          ...(reg as GoogleFormRegistration),
          status: 'approved',
          paymentStatus: 'paid',
          bibNumber: correctedBib || reg.bibNumber,
          participantId: String(reg.participantId || ''),
          eventId: String(reg.eventId || ''),
          eventName: String(reg.eventName || ''),
          formId: String(reg.formId || ''),
          sheetId: String(reg.sheetId || ''),
          source: String(reg.source || 'google_sheet'),
          sourceType: String(reg.sourceType || reg.source || 'google_sheet'),
          sourceName: String(reg.sourceName || ''),
          name: String((reg as any).name || participant?.name || ''),
          email: String((reg as any).email || participant?.email || ''),
          phone: String((reg as any).phone || (reg as any).mobile || participant?.mobile || ''),
          paymentProof: String((reg as any).paymentProof || participant?.paymentProof || ''),
          eventCategory: String((reg as any).eventCategory || participant?.raceCategory || ''),
          ticketId: String((reg as any).mappedTicketId || participant?.ticketId || ''),
          ticketName: String((reg as any).mappedTicketName || participant?.ticketName || ''),
          selectedSubCategory: String((reg as any).selectedSubCategory || participant?.selectedSubCategory || ''),
          clubId: String(participant?.clubId || ''),
          clubName: String(participant?.clubName || ''),
          approvedAt: nowIso(),
          updatedAt: nowIso(),
        });

        return { success: true, bibNumber: correctedBib || reg.bibNumber, participantId: reg.participantId };
      }

      await saveRegistrationToCache({
        ...(reg as GoogleFormRegistration),
        status: 'approved',
        paymentStatus: 'paid',
        approvedAt: nowIso(),
        updatedAt: nowIso(),
      });
      return { success: true, bibNumber: reg.bibNumber, participantId: reg.participantId };
    }

    const eventRef = db.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return { success: false, error: `Event ${eventId} not found.` };
    }
    const eventData = eventSnap.data() as EventCalendarEntry;

    // Resolve the form mapping for this registration.
    let mapping: FormMapping | null = null;
    const mappings = await ensureFormMappingsCache();
    const formId = String(reg.formId || '').trim();
    if (formId) {
      mapping = mappings.find((item) => item.formId === formId && item.eventId === eventId) || null;
    }
    if (!mapping && reg.sourceName) {
      mapping = mappings.find((item) => item.sourceName === reg.sourceName && item.eventId === eventId) || null;
    }

    // Prefer the mapped ticket captured at import time for this registration.
    // This avoids wrong assignment if admin edits form mappings later.
    const regMappedTicketId = String((reg as any).mappedTicketId || '').trim();
    const regMappedTicketName = String((reg as any).mappedTicketName || '').trim();
    const regMappedPricePaisa = Number((reg as any).mappedPricePaisa ?? 0);
    const regMappedSubCategory = String((reg as any).selectedSubCategory || '').trim() || null;

    const requestedCategory = String(reg.eventCategory || category || '').trim();
    const ticketFromMapping = resolveTicketFromMapping(mapping, requestedCategory);

    let ticketId = String(regMappedTicketId || ticketFromMapping?.ourTicketId || '').trim();
    let ticketName = String(regMappedTicketName || ticketFromMapping?.ourTicketName || requestedCategory || 'General').trim();
    let ticketPricePaisa = Number(regMappedPricePaisa || (ticketFromMapping?.price ?? 0));
    const selectedSubCategoryId = String(regMappedSubCategory || ticketFromMapping?.selectedSubCategoryId || reg.selectedSubCategory || '').trim() || null;

    // Fallback for old mappings where only category was stored.
    if (!ticketId && mapping?.tickets) {
      const fallback = Object.values(mapping.tickets).find((t) => normalizeText(t.category) === normalizeText(requestedCategory));
      if (fallback?.ourTicketId) {
        ticketId = fallback.ourTicketId;
        ticketName = fallback.ourTicketName || fallback.category || ticketName;
        ticketPricePaisa = Number(fallback.price ?? ticketPricePaisa ?? 0);
      }
    }

    // Mandatory for creating official event participant.
    if (!ticketId) {
      return {
        success: false,
        error: 'No mapped internal ticket found. Please configure ticket mapping (Our Ticket → Google Form Option) before approving.',
      };
    }

    const ticketSnap = await eventRef.collection('ticketDefinitions').doc(ticketId).get();
    if (!ticketSnap.exists) {
      return { success: false, error: `Mapped ticket (${ticketId}) not found in event.` };
    }
    const ticketData = ticketSnap.data() as TicketDefinition;
    const selectedSubCategory = selectedSubCategoryId && Array.isArray(ticketData.subCategories)
      ? ticketData.subCategories.find((s) => s.id === selectedSubCategoryId) || null
      : null;
    ticketName = ticketData.ticketName || ticketName;
    if (!Number.isFinite(ticketPricePaisa) || ticketPricePaisa <= 0) {
      // Prefer sub-category pricing if mapping points to a sub-category.
      if (selectedSubCategoryId && Array.isArray(ticketData.subCategories)) {
        const sub = ticketData.subCategories.find((s) => s.id === selectedSubCategoryId);
        if (sub?.pricePaisa != null) {
          ticketPricePaisa = Math.max(0, Math.round(Number(sub.pricePaisa)));
        }
      }

      // Fallback to ticket-level price (typically rupees in this model).
      if (!Number.isFinite(ticketPricePaisa) || ticketPricePaisa <= 0) {
        ticketPricePaisa = Math.max(0, Math.round(Number(ticketData.price ?? 0) * 100));
      }
    }

    const ticketPriceRupees = ticketPricePaisa > 0 ? Number((ticketPricePaisa / 100).toFixed(2)) : 0;

    const dobIso = normalizeDobToIso(reg.dob ? String(reg.dob) : null) || (reg.dob ? String(reg.dob) : null);
    const ageGroupsRaw = selectedSubCategory?.applicableAgeGroups || ticketData.applicableAgeGroups || eventData.ageCategories;
    const ageGroups = Array.isArray(ageGroupsRaw)
      ? ageGroupsRaw
      : (typeof ageGroupsRaw === 'string' ? ageGroupsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []);
    const { age, ageCategory } = calculateAgeGroup(dobIso, eventData.eventName, ageGroups, eventData.eventDate || null);

    // BIB assignment with graceful fallback.
    const participantsCol = eventRef.collection('participants');
    const participantsSnapshotForKeys = await getEventParticipants(eventId);

    const isTerminalStatus = (participant: any) => {
      const combined = [
        participant?.ticketStatus,
        participant?.registrationStatus,
        participant?.status,
        participant?.paymentStatus,
      ]
        .map((s) => String(s || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

      return (
        combined.includes('cancel') ||
        combined.includes('defer') ||
        combined.includes('refund') ||
        combined.includes('inactive')
      );
    };

    const activeParticipants = participantsSnapshotForKeys.filter((p: any) => !isTerminalStatus(p));
    const allAssignedBibs = new Set<string>(
      activeParticipants
        .map((d: any) => d?.bibNumber)
        .filter(Boolean)
        .map(String)
    );
    const usedEmails = new Set<string>(
      activeParticipants
        .map((d: any) => String(d?.email || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const preferredEmail = reg.email ? String(reg.email).toLowerCase() : null;
    const uniqueEmailResult = ensureUniqueEmail(preferredEmail, usedEmails);
    const finalEmail = uniqueEmailResult.email;

    let bibNumber = await assignNextAvailableBib(
      eventId,
      ticketId,
      ageCategory,
      reg.gender ? String(reg.gender) : null,
      allAssignedBibs,
      selectedSubCategoryId
    );
    // Relaxed fallback: retry without age/gender/sub-category so BIB assignment works
    // even when the registration is missing DOB/gender (e.g. older imports).
    if (!bibNumber) {
      bibNumber = await assignNextAvailableBib(eventId, ticketId, null, null, allAssignedBibs, null);
    }
    if (!bibNumber) {
      return {
        success: false,
        error: `No BIB assignment rule found for ticket "${ticketName}" (Event: ${eventId}). Please configure BIB ranges (Admin → BIB Assignment) before approving.`,
      };
    }

    const registrationTimestamp = new Date().toISOString();
    const bookingId = `BMIN${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const participantRef = participantsCol.doc();
    const resolvedClub = await resolveAffiliatedClubFromSystem(db, finalEmail);

    const resolvedMobile = pickFirstNonEmpty(
      (reg as any).mobile,
      (reg as any).phone,
      (reg as any).contact,
      (reg as any).contactNumber,
      (reg as any).phoneNumber,
      (reg as any).whatsappNumber
    );
    const resolvedGender = pickFirstNonEmpty((reg as any).gender, (reg as any).sex);
    const resolvedBloodGroup = pickFirstNonEmpty((reg as any).bloodGroup, (reg as any).blood);
    const resolvedTshirt = pickFirstNonEmpty((reg as any).tshirtSize, (reg as any).tshirt, (reg as any).tshirt_size);
    const resolvedEmergencyContact = pickFirstNonEmpty(
      (reg as any).emergencyContactNumber,
      (reg as any).emergencyContact,
      (reg as any).emergency,
      (reg as any).emergencyNumber
    );
    const resolvedAddress = pickFirstNonEmpty((reg as any).address, (reg as any).fullAddress);
    const resolvedCity = pickFirstNonEmpty((reg as any).city);
    const resolvedPincode = pickFirstNonEmpty((reg as any).pincode, (reg as any).pinCode, (reg as any).zipCode);
    const resolvedState = pickFirstNonEmpty((reg as any).state);
    const resolvedCountry = pickFirstNonEmpty((reg as any).country);
    const resolvedIdProofUrl = pickFirstNonEmpty((reg as any).idProofUrl, (reg as any).identityProofUrl, (reg as any).idProof);
    const resolvedTimingProof = pickFirstNonEmpty((reg as any).previousTimingCertificateUrl, (reg as any).timingProofUrl, (reg as any).timingCertificateUrl);
    const resolvedSignature = pickFirstNonEmpty((reg as any).digitalSignatureName, (reg as any).signatureName, (reg as any).signature);

    const participantPayload: Omit<EventParticipant, 'id'> & Record<string, unknown> = {
      eventId,
      eventName: eventData.eventName || reg.eventName || '',
      eventDate: eventData.eventDate || null,
      name: String(reg.name || 'Unknown Athlete').trim(),
      nameLower: String(reg.name || '').trim().toLowerCase(),
      email: finalEmail,
      buyerEmail: finalEmail,
      buyerName: String(reg.name || 'Unknown Athlete').trim(),
      mobile: resolvedMobile,
      gender: resolvedGender,
      dob: dobIso,
      age: age ?? null,
      ageCategory: ageCategory ?? null,
      bloodGroup: resolvedBloodGroup,
      tshirtSize: resolvedTshirt,
      emergencyContactNumber: resolvedEmergencyContact,
      address: resolvedAddress,
      city: resolvedCity,
      pincode: resolvedPincode,
      state: resolvedState,
      country: resolvedCountry,
      idProofUrl: resolvedIdProofUrl,
      previousTimingCertificateUrl: resolvedTimingProof,
      digitalSignatureName: resolvedSignature,
      clubId: resolvedClub.clubId,
      clubName: resolvedClub.clubName,
      agreedWaiver: true,
      agreedRules: true,
      agreedCutoff: true,
      agreedPolicyChangeFlow: true,
      consentPromotions: true,
      raceCategory: requestedCategory || null,
      ticketId,
      ticketName,
      selectedSubCategory: selectedSubCategoryId,
      ticketPrice: ticketPriceRupees || null,
      amountPaidPaisa: Math.max(0, Math.round(ticketPricePaisa || 0)),
      basePricePaisa: Math.max(0, Math.round(ticketPricePaisa || 0)),
      paymentMethod: 'Google Form / Sheet',
      ticketStatus: 'Active',
      bookingId,
      bibNumber,
      registeredAt: registrationTimestamp,
      createdAt: registrationTimestamp,
      updatedAt: registrationTimestamp,
      zohoSynced: false,
      source: reg.source || 'google_form',
      sourceType: reg.sourceType || reg.source || 'google_form',
      sourceName: reg.sourceName || null,
      formId: reg.formId || null,
      googleFormRegistrationId: registrationId,
      originalEmail: uniqueEmailResult.originalEmail || null,
      emailAliased: uniqueEmailResult.aliased,
      registrationStatus: 'approved',
      status: 'approved',
      paymentProof: reg.paymentProof || null,
      gstPaid: reg.gst ? 'Yes' : 'No',
    };

    await participantRef.set(participantPayload);

    await saveRegistrationToCache({
      ...(reg as GoogleFormRegistration),
      status: 'approved',
      paymentStatus: 'paid',
      bibNumber,
      participantId: participantRef.id,
      email: finalEmail,
      originalEmail: uniqueEmailResult.originalEmail || null,
      emailAliased: uniqueEmailResult.aliased,
      ticketId,
      ticketName,
      sourceType: reg.sourceType || reg.source || 'google_form',
      sourceName: reg.sourceName || null,
      approvedAt: nowIso(),
      updatedAt: nowIso(),
      clubId: resolvedClub.clubId,
      clubName: resolvedClub.clubName,
    } as GoogleFormRegistration);

    // Keep analytics/KV in sync with the primary participant model.
    const participantForKv = {
      ...(participantPayload as unknown as Omit<EventParticipant, 'id'>),
      id: participantRef.id,
    } as EventParticipant;
    await _mirrorParticipantToKV(participantForKv);

    // Send confirmation notifications (do not fail approval if notification fails).
    const notificationResults = await Promise.allSettled([
      sendIndividualConfirmationEmailAction(eventId, participantRef.id),
      sendIndividualConfirmationWhatsAppAction(eventId, participantRef.id),
      sendAdminTicketSaleNotificationEmail(
        participantPayload.name || null,
        participantPayload.eventName || eventData.eventName || 'Event',
        bookingId,
        registrationTimestamp,
        ticketName,
        eventData.venueName || eventData.address,
        (participantPayload.eventDate as string | null) || eventData.eventDate || null,
        participantPayload.address as string | null,
        participantPayload.mobile as string | null,
        participantPayload.emergencyContactNumber as string | null,
        participantPayload.email as string | null,
        null,
        bibNumber,
        eventData.organizerName,
        eventData.organizerAddress,
        eventData.organizerCompanyDescription,
        participantPayload.country as string | null,
      ),
    ]);

    const emailOutcome = notificationResults[0];
    const whatsappOutcome = notificationResults[1];
    const adminOutcome = notificationResults[2];
    if (emailOutcome.status === 'rejected') {
      console.warn('[approveGoogleFormRegistration] Email confirmation failed:', emailOutcome.reason);
    }
    if (whatsappOutcome.status === 'rejected') {
      console.warn('[approveGoogleFormRegistration] WhatsApp confirmation failed:', whatsappOutcome.reason);
    }
    if (adminOutcome.status === 'rejected') {
      console.warn('[approveGoogleFormRegistration] Admin notification failed:', adminOutcome.reason);
    }

    revalidatePath('/admin/dashboard');
    return { success: true, bibNumber: bibNumber ?? undefined, participantId: participantRef.id };
  } catch (error: any) {
    console.error('[approveGoogleFormRegistration] Error:', error);
    return { success: false, error: error.message || 'Failed to approve registration' };
  }
}

export async function resyncGoogleFormRegistrationAction(
  registrationId: string,
  category?: string
): Promise<{ success: boolean; bibNumber?: string; participantId?: string; error?: string }> {
  return approveGoogleFormRegistrationAction(registrationId, category, {
    forceWriteAllFields: true,
    reassignBib: true,
  });
}

export async function rejectGoogleFormRegistrationAction(
  registrationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const registrations = await ensureRegistrationsCache();
    const registration = registrations.find((item) => item.id === registrationId);
    if (!registration) return { success: false, error: 'Registration not found.' };

    await saveRegistrationToCache({
      ...registration,
      status: 'rejected',
      rejectedAt: nowIso(),
      updatedAt: nowIso(),
    } as GoogleFormRegistration);

    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (error: any) {
    console.error('[rejectGoogleFormRegistration] Error:', error);
    return { success: false, error: error.message || 'Failed to reject registration' };
  }
}

// ─── Form Mappings CRUD ───────────────────────────────────────────────────────

export async function getFormMappingsAction(): Promise<{
  success: boolean;
  mappings?: FormMapping[];
  error?: string;
}> {
  try {
    const mappings = await ensureFormMappingsCache();
    return { success: true, mappings };
  } catch (error: any) {
    console.error('[getFormMappings] Error:', error);
    return { success: false, error: error.message || 'Failed to fetch form mappings' };
  }
}

export async function createFormMappingAction(
  data: FormMappingInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const sanitized: FormMappingInput = {
      ...data,
      formUrl: String(data.formUrl || '').trim(),
      formId: extractFormIdFromUrl(String(data.formUrl || data.formId || '')),
      sheetUrl: String(data.sheetUrl || '').trim(),
      sheetId: extractSheetIdFromUrl(String(data.sheetUrl || data.sheetId || '')),
      lastSyncedRow: Number.isFinite(Number(data.lastSyncedRow)) ? Number(data.lastSyncedRow) : 1,
      sourceName: String(data.sourceName || '').trim(),
      eventName: String(data.eventName || '').trim(),
      tickets: data.tickets || {},
      active: !!data.active,
      eventId: String(data.eventId || '').trim(),
    };
    const validationError = validateFormMappingInput(sanitized);
    if (validationError) return { success: false, error: validationError };

    const id = `gfm_${Math.random().toString(36).slice(2, 10)}`;
    await saveFormMappingToCache({
      id,
      ...sanitized,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    revalidatePath('/admin/dashboard');
    return { success: true, id };
  } catch (error: any) {
    console.error('[createFormMapping] Error:', error);
    return { success: false, error: error.message || 'Failed to create form mapping' };
  }
}

export async function updateFormMappingAction(
  id: string,
  data: Partial<FormMappingInput>
): Promise<{ success: boolean; error?: string }> {
  try {
    const mappings = await ensureFormMappingsCache();
    const existing = mappings.find((item) => item.id === id);
    if (!existing) return { success: false, error: 'Mapping not found.' };

    const merged = {
      ...(existing as Record<string, any>),
      ...data,
    } as FormMappingInput;

    const sanitized: FormMappingInput = {
      ...merged,
      formUrl: String(merged.formUrl || '').trim(),
      formId: extractFormIdFromUrl(String(merged.formUrl || merged.formId || '')),
      sheetUrl: String(merged.sheetUrl || '').trim(),
      sheetId: extractSheetIdFromUrl(String(merged.sheetUrl || merged.sheetId || '')),
      lastSyncedRow: Number.isFinite(Number(merged.lastSyncedRow)) ? Number(merged.lastSyncedRow) : 1,
      sourceName: String(merged.sourceName || '').trim(),
      eventName: String(merged.eventName || '').trim(),
      tickets: merged.tickets || {},
      active: !!merged.active,
      eventId: String(merged.eventId || '').trim(),
    };

    const validationError = validateFormMappingInput(sanitized);
    if (validationError) return { success: false, error: validationError };

    await saveFormMappingToCache({
      ...existing,
      ...sanitized,
      updatedAt: nowIso(),
    });

    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (error: any) {
    console.error('[updateFormMapping] Error:', error);
    return { success: false, error: error.message || 'Failed to update form mapping' };
  }
}

export async function deleteFormMappingAction(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteFormMappingFromCache(id);

    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (error: any) {
    console.error('[deleteFormMapping] Error:', error);
    return { success: false, error: error.message || 'Failed to delete form mapping' };
  }
}

export async function toggleFormMappingActiveAction(
  id: string,
  active: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const mappings = await ensureFormMappingsCache();
    const existing = mappings.find((item) => item.id === id);
    if (!existing) return { success: false, error: 'Mapping not found.' };

    await saveFormMappingToCache({
      ...existing,
      active,
      updatedAt: nowIso(),
    });

    revalidatePath('/admin/dashboard');
    return { success: true };
  } catch (error: any) {
    console.error('[toggleFormMappingActive] Error:', error);
    return { success: false, error: error.message || 'Failed to toggle form mapping' };
  }
}

export async function testFormMappingAction(input: {
  sheetUrl: string;
  sheetId?: string;
  sheetGid?: string;
  tickets: Record<string, TicketConfig>;
  lastSyncedRow?: number;
}): Promise<{
  success: boolean;
  mappingOk?: boolean;
  rowsCount?: number;
  lastSyncedRow?: number;
  newEntries?: number;
  ticketColumn?: string | null;
  lastRowTicket?: string | null;
  unmappedTickets?: string[];
  error?: string;
}> {
  try {
    const sheetUrl = String(input.sheetUrl || '').trim();
    const sheetId = extractSheetIdFromUrl(String(input.sheetId || sheetUrl || ''));
    const gid = String(input.sheetGid || extractSheetGidFromUrl(sheetUrl) || '').trim() || null;
    if (!sheetUrl || !isValidGoogleSheetUrl(sheetUrl)) {
      return { success: false, error: 'Valid Google Sheet URL is required.' };
    }
    if (!sheetId) {
      return { success: false, error: 'Could not extract Sheet ID from URL.' };
    }

    const csvText = await fetchSheetCsv(sheetId, gid);

    if (!csvText) {
      return {
        success: false,
        error: 'Unable to read sheet CSV. Ensure the sheet is accessible (Anyone with link can view) or connected service account has read access.',
      };
    }

    const records = splitCsvRecords(csvText);
    if (records.length <= 1) {
      const rowsCount = Math.max(records.length - 1, 0);
      const lastSyncedRow = Number(input.lastSyncedRow || 1);
      return { success: true, mappingOk: true, rowsCount, lastSyncedRow, newEntries: Math.max(rowsCount - lastSyncedRow, 0), ticketColumn: null, lastRowTicket: null, unmappedTickets: [] };
    }

    const header = parseCsvLine(records[0]).map((h) => h.trim());
    const dataRows = records.slice(1).map(parseCsvLine).filter((r) => r.some((c) => String(c || '').trim() !== ''));
    const rowsCount = dataRows.length;
    const lastSyncedRow = Number.isFinite(Number(input.lastSyncedRow)) ? Number(input.lastSyncedRow) : 1;
    const newEntries = Math.max(rowsCount - lastSyncedRow, 0);

    const ticketColCandidates = ['ticket', 'tickets', 'category', 'race category', 'event category', 'ticket type', 'distance'];
    const headerNormalized = header.map((h) => normalizeHeaderKey(h));
    const ticketIndex = headerNormalized.findIndex((h) => ticketColCandidates.some((c) => h === c || h.includes(c)));
    const ticketColumn = ticketIndex >= 0 ? header[ticketIndex] : null;

    const mappedLabels = new Set(
      Object.values(input.tickets || {})
        .map((t) => normalizeText(t.formOptionLabel || t.category || ''))
        .filter(Boolean)
    );

    let lastRowTicket: string | null = null;
    const unmappedSet = new Set<string>();
    if (ticketIndex >= 0) {
      const last = dataRows[dataRows.length - 1];
      lastRowTicket = String(last?.[ticketIndex] || '').trim() || null;

      for (const row of dataRows) {
        const value = String(row[ticketIndex] || '').trim();
        if (!value) continue;
        if (!mappedLabels.has(normalizeText(value))) {
          unmappedSet.add(value);
          if (unmappedSet.size >= 5) break;
        }
      }
    }

    const unmappedTickets = Array.from(unmappedSet);
    return {
      success: true,
      mappingOk: unmappedTickets.length === 0,
      rowsCount,
      lastSyncedRow,
      newEntries,
      ticketColumn,
      lastRowTicket,
      unmappedTickets,
      error: unmappedTickets.length > 0 ? `Ticket not mapped: ${unmappedTickets[0]}` : undefined,
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Test mapping failed.' };
  }
}

export async function syncFormMappingFromSheetAction(
  mappingId: string,
  options?: { forceResync?: boolean }
): Promise<{
  success: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  rowsRead?: number;
  lastSyncedRow?: number;
  error?: string;
}> {
  try {
    const db = getFirestoreInstance();
    const mappings = await ensureFormMappingsCache();
    const mapping = mappings.find((item) => item.id === mappingId) || null;
    if (!mapping) return { success: false, error: 'Mapping not found.' };
    if (!mapping.active) return { success: false, error: 'Mapping is inactive.' };

    const sheetId = extractSheetIdFromUrl(String(mapping.sheetId || mapping.sheetUrl || ''));
    const gid = extractSheetGidFromUrl(String(mapping.sheetUrl || ''));
    if (!sheetId) return { success: false, error: 'Missing Sheet ID in mapping.' };

    const csvText = await fetchSheetCsv(sheetId, gid);
    if (!csvText) {
      return { success: false, error: 'Unable to read sheet CSV. Check sharing/access.' };
    }

    const records = splitCsvRecords(csvText);
    if (records.length <= 1) {
      return { success: true, created: 0, updated: 0, skipped: 0, rowsRead: 0, lastSyncedRow: Number(mapping.lastSyncedRow || 1) };
    }

    const header = parseCsvLine(records[0]).map((h) => h.trim());
    const dataRows = records.slice(1).map(parseCsvLine).filter((r) => r.some((c) => String(c || '').trim() !== ''));
    const rowsRead = dataRows.length;

    const findCol = (candidates: string[]) => {
      const normalizedHeaders = header.map((h) => normalizeHeaderKey(h));
      const normalizedCandidates = candidates
        .map((c) => normalizeHeaderKey(c))
        .filter(Boolean);

      let bestIndex = -1;
      let bestScore = -1;

      for (let i = 0; i < normalizedHeaders.length; i++) {
        const h = normalizedHeaders[i];

        for (const candidate of normalizedCandidates) {
          let score = -1;

          if (h === candidate) {
            score = 100 + candidate.length; // strongest: exact match
          } else if (!candidate.includes(' ') && h.startsWith(`${candidate} `)) {
            score = 60 + candidate.length; // single-word prefix match only
          } else if (candidate.includes(' ') && h.includes(candidate)) {
            score = 40 + candidate.length; // flexible match for long/compound labels
          }

          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }
      }

      return bestIndex;
    };

    const col = {
      timestamp: findCol(['timestamp', 'time stamp']),
      tickets: findCol(['tickets', 'ticket', 'category', 'race category', 'event category', 'ticket type']),
      name: findCol(['name', 'full name']),
      emailId: findCol(['email id', 'email']),
      emailAddress: findCol(['email address']),
      address: findCol(['address']),
      city: findCol(['city']),
      pincode: findCol(['pincode', 'pin code', 'zipcode', 'zip code']),
      state: findCol(['state']),
      country: findCol(['country']),
      tshirt: findCol(['t-shirt size', 't shirt size', 'tshirt size']),
      dob: findCol(['date of birth', 'dob']),
      contact: findCol(['contact number', 'mobile', 'phone']),
      gender: findCol(['gender']),
      blood: findCol(['blood group']),
      idProof: findCol(['id proof', 'identity proof']),
      club: findCol(['group name/club name', 'club name', 'group name']),
      emergency: findCol([
        'emergancy contact number',
        'emergency contact number',
        'emergency contact',
        'emergency number',
        'emergency mobile',
        'emergency phone',
      ]),
      timingProof: findCol(['previous triathlon / duathlon event timing certificate.  link . if its your 1st triathlon attach link of strava / garmin / others which shows your data of self supported triathlon/duathlon)', 'previous triathlon / duathlon event timing certificate', 'timing certificate']),
      signature: findCol(['digital signature']),
      waiver: findCol(['i agree to waiver & rules and regulations']),
      marketingConsent: findCol(['marketing consent', 'i agree for promotional communication', 'consent promotions']),
      receipt: findCol(['attach payment receipt']),
    };
    const eventRef = db.collection('events').doc(mapping.eventId);
    const eventSnap = await eventRef.get();
    const eventData = eventSnap.exists ? (eventSnap.data() as EventCalendarEntry) : null;

    const uniqueTicketIds = Array.from(new Set(
      Object.values(mapping.tickets || {})
        .map((t) => String(t.ourTicketId || '').trim())
        .filter(Boolean)
    ));

    const ticketDefs = new Map<string, TicketDefinition>();
    await Promise.all(uniqueTicketIds.map(async (tid) => {
      const snap = await eventRef.collection('ticketDefinitions').doc(tid).get();
      if (snap.exists) {
        ticketDefs.set(tid, snap.data() as TicketDefinition);
      }
    }));


    if (col.tickets < 0 || (col.name < 0 && col.emailId < 0 && col.emailAddress < 0)) {
      return { success: false, error: 'Required columns not found. Need at least TICKETS and NAME/EMAIL.' };
    }

    // Build used-email set to prevent duplicate registrations by email.
    const usedEmails = new Set<string>();
    const [existingRegistrations, existingParticipants] = await Promise.all([
      ensureRegistrationsCache(),
      getEventParticipants(mapping.eventId),
    ]);

    const lastSynced = Number.isFinite(Number(mapping.lastSyncedRow)) ? Number(mapping.lastSyncedRow) : 1;
    const shouldFullRebuild = !options?.forceResync && existingRegistrations.length === 0;
    const sheetRowsWithHeader = records.length;
    const sheetShrankSinceLastSync = sheetRowsWithHeader < lastSynced;
    // Keep a rolling lookback window so deleted/re-added rows can be detected
    // without requiring full force-resync every time.
    const LOOKBACK_ROWS = 500;
    const startLineNumber = (options?.forceResync || shouldFullRebuild || sheetShrankSinceLastSync)
      ? 2
      : Math.max(2, (lastSynced + 1) - LOOKBACK_ROWS); // includes header row at line 1
    for (const d of existingRegistrations.filter((item) => item.eventId === mapping.eventId)) {
      const e = String((d as any).email || '').trim().toLowerCase();
      if (e) usedEmails.add(e);
    }
    for (const d of existingParticipants) {
      const e = String((d as any)?.email || '').trim().toLowerCase();
      if (e) usedEmails.add(e);
    }

    const nextRegistrations = [...existingRegistrations];
    const existingIds = new Set(existingRegistrations.map((item) => item.id));
    const existingSignatures = new Set(existingRegistrations.map((item: any) => String(item?.sourceRowSignature || '').trim()).filter(Boolean));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const mappedByLabel = new Map<string, TicketConfig>();
    Object.values(mapping.tickets || {}).forEach((t) => {
      const raw = String(t.formOptionLabel || t.category || '');
      const normal = normalizeText(raw);
      const normalizedTicket = normalizeTicketLabelForMatch(raw);
      if (normal) mappedByLabel.set(normal, t);
      if (normalizedTicket) mappedByLabel.set(normalizedTicket, t);
    });

    for (let lineNo = startLineNumber; lineNo <= records.length; lineNo++) {
      const row = parseCsvLine(records[lineNo - 1] || '');
      const ticketLabel = String(row[col.tickets] || '').trim();
      if (!ticketLabel) {
        skipped++;
        continue;
      }

      const normalizedTicket = normalizeText(ticketLabel);
      const normalizedTicketNoAmount = normalizeTicketLabelForMatch(ticketLabel);
      const mapped = mappedByLabel.get(normalizedTicket) || mappedByLabel.get(normalizedTicketNoAmount);
      if (!mapped) {
        skipped++;
        continue;
      }

      const emailFromAddressCol = col.emailAddress >= 0 ? String(row[col.emailAddress] || '').trim().toLowerCase() : '';
      const emailFromIdCol = col.emailId >= 0 ? String(row[col.emailId] || '').trim().toLowerCase() : '';
      const rawEmail = isLikelyEmail(emailFromAddressCol)
        ? emailFromAddressCol
        : (isLikelyEmail(emailFromIdCol) ? emailFromIdCol : (emailFromAddressCol || emailFromIdCol || ''));
      const name = String(row[col.name] || '').trim();
      const phone = String(row[col.contact] || '').trim();
      const timestamp = String(row[col.timestamp] || '').trim();
      const dobRaw = col.dob >= 0 ? String(row[col.dob] || '').trim() : '';
      const dobIso = normalizeDobToIso(dobRaw) || (dobRaw || null);

      const rowSignature = [
        normalizeText(mapping.eventId),
        normalizeText(mapping.formId || mapping.id),
        normalizeText(ticketLabel),
        normalizeText(rawEmail),
        normalizeText(name),
        normalizeText(timestamp),
      ].join('|');
      const hasStrongIdentity = !!(rawEmail || name || timestamp);
      const stableKey = hasStrongIdentity ? rowSignature : `${mapping.id}|${lineNo}|${normalizeText(ticketLabel)}`;

      const rowDocId = `sheet_${mapping.id}_${stableHash(stableKey)}`;
      const existingIndex = nextRegistrations.findIndex((item: any) =>
        String(item?.id || '') === rowDocId ||
        String(item?.sourceRowSignature || '') === rowSignature ||
        (
          String(item?.formId || '') === String(mapping.formId || '') &&
          String(item?.sheetId || '') === String(sheetId || '') &&
          Number(item?.sheetRowNumber || 0) === Number(lineNo)
        )
      );

      const ticketData = ticketDefs.get(String(mapped.ourTicketId || '').trim()) || null;
      const selectedSubCategory = mapped.selectedSubCategoryId && Array.isArray(ticketData?.subCategories)
        ? ticketData!.subCategories!.find((s) => s.id === mapped.selectedSubCategoryId) || null
        : null;
      const ageGroupsRaw = selectedSubCategory?.applicableAgeGroups || ticketData?.applicableAgeGroups || eventData?.ageCategories;
      const ageGroups = Array.isArray(ageGroupsRaw)
        ? ageGroupsRaw
        : (typeof ageGroupsRaw === 'string' ? ageGroupsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []);
      const { age, ageCategory } = calculateAgeGroup(dobIso, eventData?.eventName || mapping.eventName, ageGroups, eventData?.eventDate || null);

      const baseRegistration = {
        id: rowDocId,
        source: 'google_sheet',
        sourceType: 'google_sheet',
        sourceName: mapping.sourceName,
        formId: mapping.formId,
        sheetId,
        sheetRowNumber: lineNo,
        sourceRowSignature: rowSignature,
        eventId: mapping.eventId,
        eventName: mapping.eventName,
        eventCategory: ticketLabel,
        mappedTicketId: mapped.ourTicketId,
        mappedTicketName: mapped.ourTicketName,
        selectedSubCategory: mapped.selectedSubCategoryId || null,
        mappedPricePaisa: Number(mapped.price || 0),
        name: name || 'Unknown Athlete',
        email: rawEmail || null,
        originalEmail: null,
        emailAliased: false,
        phone: phone || null,
        mobile: phone || null,
        gender: col.gender >= 0 ? String(row[col.gender] || '').trim() || null : null,
        dob: dobIso,
        age: age ?? null,
        ageCategory: ageCategory ?? null,
        bloodGroup: col.blood >= 0 ? String(row[col.blood] || '').trim() || null : null,
        address: col.address >= 0 ? String(row[col.address] || '').trim() || null : null,
        city: col.city >= 0 ? String(row[col.city] || '').trim() || null : null,
        pincode: col.pincode >= 0 ? String(row[col.pincode] || '').trim() || null : null,
        state: col.state >= 0 ? String(row[col.state] || '').trim() || null : null,
        country: col.country >= 0 ? String(row[col.country] || '').trim() || null : null,
        tshirtSize: col.tshirt >= 0 ? String(row[col.tshirt] || '').trim() || null : null,
        idProofUrl: col.idProof >= 0 ? String(row[col.idProof] || '').trim() || null : null,
        clubId: null,
        clubName: null,
        sourceClubName: col.club >= 0 ? String(row[col.club] || '').trim() || null : null,
        emergencyContactNumber: col.emergency >= 0 ? String(row[col.emergency] || '').trim() || null : null,
        previousTimingCertificateUrl: col.timingProof >= 0 ? String(row[col.timingProof] || '').trim() || null : null,
        digitalSignatureName: col.signature >= 0 ? String(row[col.signature] || '').trim() || null : null,
        agreedWaiver: true,
        agreedRules: true,
        agreedCutoff: true,
        agreedPolicyChangeFlow: true,
        consentPromotions: true,
        paymentProof: col.receipt >= 0 ? String(row[col.receipt] || '').trim() || null : null,
        status: 'pending',
        paymentStatus: 'pending',
        createdAt: timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        importedAt: nowIso(),
      } as Record<string, any>;

      if (existingIndex >= 0) {
        if (options?.forceResync) {
          const existing = (nextRegistrations[existingIndex] || {}) as Record<string, any>;

          // Keep lifecycle/payment/bib linkage fields; refresh form-derived profile fields.
          const retainedEmail = isLikelyEmail(existing.email) ? String(existing.email).trim().toLowerCase() : '';
          const nextEmail = isLikelyEmail(baseRegistration.email) ? String(baseRegistration.email).trim().toLowerCase() : '';

          nextRegistrations[existingIndex] = {
            ...existing,
            ...baseRegistration,
            id: String(existing.id || rowDocId),
            email: retainedEmail || nextEmail || existing.email || undefined,
            originalEmail: existing.originalEmail ?? baseRegistration.originalEmail ?? null,
            emailAliased: Boolean(existing.emailAliased ?? baseRegistration.emailAliased ?? false),
            status: existing.status || baseRegistration.status,
            paymentStatus: existing.paymentStatus || baseRegistration.paymentStatus,
            participantId: existing.participantId || null,
            bibNumber: existing.bibNumber || null,
            approvedAt: existing.approvedAt || null,
            rejectedAt: existing.rejectedAt || null,
            createdAt: existing.createdAt || baseRegistration.createdAt,
            updatedAt: nowIso(),
          } as unknown as GoogleFormRegistration;
          updated++;
        } else {
          skipped++;
          continue;
        }
      } else {
        const uniqueEmail = ensureUniqueEmail(baseRegistration.email || null, usedEmails);
        nextRegistrations.push({
          ...(baseRegistration as GoogleFormRegistration),
          email: uniqueEmail.email || undefined,
          originalEmail: uniqueEmail.originalEmail || null,
          emailAliased: uniqueEmail.aliased,
        });

        created++;
        existingIds.add(rowDocId);
        existingSignatures.add(rowSignature);
      }
    }

    // Always write the cache so stale/empty KV state is replaced with current data.
    await replaceRegistrationsCache(nextRegistrations);

    // Persist actual current sheet height so future syncs adapt when rows are deleted.
    const newLastSyncedRow = records.length;
    await saveFormMappingToCache({
      ...mapping,
      lastSyncedRow: newLastSyncedRow,
      updatedAt: nowIso(),
    });

    revalidatePath('/admin/dashboard');
    return {
      success: true,
      created,
      updated,
      skipped,
      rowsRead,
      lastSyncedRow: newLastSyncedRow,
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Sync failed.' };
  }
}

export async function autoSyncAllFormMappingsAction(options?: { forceResync?: boolean }): Promise<{
  success: boolean;
  synced?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  failures?: Array<{ mappingId: string; error: string }>;
  error?: string;
}> {
  try {
    const mappings = await ensureFormMappingsCache();
    const activeMappings = mappings.filter((item) => item.active);

    if (activeMappings.length === 0) {
      return { success: true, synced: 0, created: 0, updated: 0, skipped: 0, failures: [] };
    }

    let synced = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const failures: Array<{ mappingId: string; error: string }> = [];

    for (const mapping of activeMappings) {
      const res = await syncFormMappingFromSheetAction(mapping.id, {
        forceResync: !!options?.forceResync,
      });
      if (res.success) {
        synced++;
        created += Number(res.created || 0);
        updated += Number(res.updated || 0);
        skipped += Number(res.skipped || 0);
      } else {
        failures.push({ mappingId: mapping.id, error: res.error || 'Sync failed' });
      }
    }

    revalidatePath('/admin/dashboard');
    return { success: true, synced, created, updated, skipped, failures };
  } catch (error: any) {
    return { success: false, error: error.message || 'Auto sync failed.' };
  }
}
