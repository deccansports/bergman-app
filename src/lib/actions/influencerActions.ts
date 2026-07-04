"use server";

import { getFirestoreInstance, getStorageInstance } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import type { Influencer, InfluencerFormConfig, InfluencerFormResponseRow, InfluencerPostTemplateConfig } from '@/lib/types';
import { isValidImageUrl, serializeValue } from '@/lib/utils';
import { deleteKV, getKV, putKV } from '@/lib/cloudflare/kv';
import { createCouponAction } from './couponActions';
import { refundPaymentAction } from './paymentActions';
import { getTemplate, sendNotification } from '@/lib/services/templateService';
import { sendDynamicTemplateEmail, sendRawHtmlEmail } from '@/lib/auth/brevoService';
import { buildInfluencerEmailHtml } from '@/lib/email/influencerEmailTemplate';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';

function getInfluencersKey(eventId: string) {
  return `event:${eventId}:influencers`;
}

function getInfluencerFormConfigKey(eventId: string) {
  return `event:${eventId}:influencer-form-config`;
}

function getInfluencerFormReviewKey(eventId: string) {
  return `event:${eventId}:influencer-form-review`;
}

function getInfluencerPostTemplateConfigKey(eventId: string) {
  return `event:${eventId}:influencer-post-template-config`;
}

function getInfluencerPostEmailLogsKey(eventId: string) {
  return `event:${eventId}:influencer-post-email-logs`;
}

function getInfluencerPublicCouponUsageLogsKey(eventId: string) {
  return `event:${eventId}:influencer-public-coupon-usage-logs`;
}

function getInfluencerPublicCouponsKey(eventId: string) {
  return `event:${eventId}:influencer-public-coupons`;
}

const ACTIVE_COUPONS_KV_KEY = 'coupons:active';

function getInfluencerRegisteredParticipantsLiteCacheKey(eventId: string) {
  return `event:${eventId}:participants-lite:influencer`;
}

const INFLUENCER_PARTICIPANTS_LITE_CACHE_TTL_MS = 30 * 60 * 1000;

interface InfluencerFormReviewState {
  rejectedRowIds: string[];
  updatedAt?: string;
}

export interface InfluencerPostEmailLogEntry {
  id: string;
  eventId: string;
  eventName: string;
  influencerId: string;
  influencerName: string;
  recipientEmail: string;
  triggerSource: 'approved' | 'finalized' | 'manual';
  sentAt: string;
  message: string;
}

export interface InfluencerPublicCouponLogEntry {
  influencerId: string;
  influencerName: string;
  influencerEmail: string | null;
  isActive: boolean;
  code: string;
  usageCount: number;
  usageLimit: number;
  expiryDate: string | null;
}

export interface InfluencerPublicCouponUsageLogEntry {
  id: string;
  eventId: string;
  couponOrigin?: 'influencer-public' | 'general';
  influencerId: string | null;
  influencerName: string | null;
  couponCode: string;
  participantId: string | null;
  participantName: string;
  participantEmail: string;
  ticketId: string | null;
  ticketName: string;
  bookingId: string | null;
  usedAt: string;
}

async function readInfluencerPostEmailLogs(eventId: string): Promise<InfluencerPostEmailLogEntry[]> {
  const existing = await getKV<InfluencerPostEmailLogEntry[]>(getInfluencerPostEmailLogsKey(eventId), 'readInfluencerPostEmailLogs');
  if (!Array.isArray(existing)) return [];

  return existing
    .map((item) => serializeValue(item) as InfluencerPostEmailLogEntry)
    .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
}

async function writeInfluencerPostEmailLogs(eventId: string, logs: InfluencerPostEmailLogEntry[]) {
  const normalized = logs
    .map((item) => serializeValue(item) as InfluencerPostEmailLogEntry)
    .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')))
    .slice(0, 300);

  await putKV(getInfluencerPostEmailLogsKey(eventId), normalized, 'writeInfluencerPostEmailLogs');
}

async function readInfluencerPublicCouponsFromKV(eventId: string) {
  const coupons = await getKV<Record<string, any>[]>(getInfluencerPublicCouponsKey(eventId), 'readInfluencerPublicCouponsFromKV');
  if (!Array.isArray(coupons)) return [];
  return coupons.map((item) => serializeValue(item) as Record<string, any>);
}

async function writeInfluencerPublicCouponsToKV(eventId: string, coupons: Record<string, any>[]) {
  const normalized = coupons
    .map((item) => serializeValue(item) as Record<string, any>)
    .sort((a, b) => String(a.influencerName || '').localeCompare(String(b.influencerName || '')));
  await putKV(getInfluencerPublicCouponsKey(eventId), normalized, 'writeInfluencerPublicCouponsToKV');
}

async function readActiveCouponsFromKV(source: string) {
  const coupons = await getKV<any[]>(ACTIVE_COUPONS_KV_KEY, source);
  if (!Array.isArray(coupons)) return [];
  return coupons.map((item) => serializeValue(item) as Record<string, any>);
}

async function writeActiveCouponsToKV(coupons: Record<string, any>[], source: string) {
  const normalized = coupons
    .map((item) => serializeValue(item) as Record<string, any>)
    .filter((item) => item?.isActive !== false);
  await putKV(ACTIVE_COUPONS_KV_KEY, normalized, source);
}

async function readInfluencerPublicCouponUsageLogs(eventId: string): Promise<InfluencerPublicCouponUsageLogEntry[]> {
  const existing = await getKV<InfluencerPublicCouponUsageLogEntry[]>(getInfluencerPublicCouponUsageLogsKey(eventId), 'readInfluencerPublicCouponUsageLogs');
  if (!Array.isArray(existing)) return [];

  return existing
    .map((item) => serializeValue(item) as InfluencerPublicCouponUsageLogEntry)
    .sort((a, b) => String(b.usedAt || '').localeCompare(String(a.usedAt || '')));
}

export async function writeInfluencerPublicCouponUsageLogs(eventId: string, logs: InfluencerPublicCouponUsageLogEntry[]) {
  const normalized = logs
    .map((item) => serializeValue(item) as InfluencerPublicCouponUsageLogEntry)
    .sort((a, b) => String(b.usedAt || '').localeCompare(String(a.usedAt || '')))
    .slice(0, 2000);

  await putKV(getInfluencerPublicCouponUsageLogsKey(eventId), normalized, 'writeInfluencerPublicCouponUsageLogs');
}

function sanitizePostTemplateNumber(value: any, fallback: number, options?: { min?: number; max?: number; precision?: number }): number {
  const precision = options?.precision ?? 0;
  const min = options?.min ?? Number.NEGATIVE_INFINITY;
  const max = options?.max ?? Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(max, Math.max(min, parsed));
  return precision > 0 ? Number(clamped.toFixed(precision)) : Math.round(clamped);
}

function normalizeInfluencerPostTemplateConfig(input: Partial<InfluencerPostTemplateConfig> | null | undefined): InfluencerPostTemplateConfig {
  return {
    squareFrameUrl: String(input?.squareFrameUrl || '').trim(),
    templateOnTop: input?.templateOnTop !== false,
    squareWidth: sanitizePostTemplateNumber(input?.squareWidth, 1080, { min: 200 }),
    squareHeight: sanitizePostTemplateNumber(input?.squareHeight, 1080, { min: 200 }),
    squareImageScale: sanitizePostTemplateNumber(input?.squareImageScale, 1, { min: 0.2, max: 6, precision: 2 }),
    squareImageOffsetX: sanitizePostTemplateNumber(input?.squareImageOffsetX, 0),
    squareImageOffsetY: sanitizePostTemplateNumber(input?.squareImageOffsetY, 0),
    squareNameOffsetX: sanitizePostTemplateNumber(input?.squareNameOffsetX, 0),
    squareNameOffsetY: sanitizePostTemplateNumber(input?.squareNameOffsetY, 0),
    storyFrameUrl: String(input?.storyFrameUrl || '').trim(),
    storyWidth: sanitizePostTemplateNumber(input?.storyWidth, 1080, { min: 200 }),
    storyHeight: sanitizePostTemplateNumber(input?.storyHeight, 1920, { min: 200 }),
    storyImageScale: sanitizePostTemplateNumber(input?.storyImageScale, 1, { min: 0.2, max: 6, precision: 2 }),
    storyImageOffsetX: sanitizePostTemplateNumber(input?.storyImageOffsetX, 0),
    storyImageOffsetY: sanitizePostTemplateNumber(input?.storyImageOffsetY, 0),
    storyNameOffsetX: sanitizePostTemplateNumber(input?.storyNameOffsetX, 0),
    storyNameOffsetY: sanitizePostTemplateNumber(input?.storyNameOffsetY, 0),
    nameFontFamily: ['Inter', 'Poppins', 'Bebas Neue'].includes(String(input?.nameFontFamily || ''))
      ? String(input?.nameFontFamily)
      : 'Bebas Neue',
    nameFontSize: sanitizePostTemplateNumber(input?.nameFontSize, 68, { min: 16, max: 300 }),
    nameFontColor: String(input?.nameFontColor || '#ffffff').trim() || '#ffffff',
    nameLetterSpacing: sanitizePostTemplateNumber(input?.nameLetterSpacing, 2, { min: -10, max: 80, precision: 1 }),
    nameShapeEnabled: input?.nameShapeEnabled === true,
    nameShapeColor: String(input?.nameShapeColor || '#000000').trim() || '#000000',
    nameShapeOpacity: sanitizePostTemplateNumber(input?.nameShapeOpacity, 0.45, { min: 0, max: 1, precision: 2 }),
    nameShapePaddingX: sanitizePostTemplateNumber(input?.nameShapePaddingX, 26, { min: 0, max: 200 }),
    nameShapePaddingY: sanitizePostTemplateNumber(input?.nameShapePaddingY, 16, { min: 0, max: 200 }),
    nameShapeRadius: sanitizePostTemplateNumber(input?.nameShapeRadius, 18, { min: 0, max: 200 }),
    includeBrandingText: input?.includeBrandingText !== false,
    updatedAt: new Date().toISOString(),
  };
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
  return /^https:\/\/docs\.google\.com\/forms\//i.test(String(input || '').trim());
}

function isValidGoogleSheetUrl(input: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//i.test(String(input || '').trim());
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

function normalizeHeaderKey(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCellValue(input: string | null | undefined): string {
  return String(input || '').replace(/^"|"$/g, '').trim();
}

function normalizeDriveImageUrl(input: string | null | undefined): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('drive.google.com')) return raw;

    const byQueryId = parsed.searchParams.get('id');
    if (byQueryId) return `https://drive.google.com/thumbnail?id=${byQueryId}&sz=w600`;

    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
    if (fileMatch?.[1]) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w600`;

    return raw;
  } catch {
    return raw;
  }
}

function normalizeEmail(input: string | null | undefined): string | null {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function normalizeMobile(input: string | null | undefined): string | null {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}

function stableInfluencerCouponCode(eventId: string, rowId: string): string {
  const raw = `INF-${eventId}-${rowId}`.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const suffix = stableHash(raw).toUpperCase();
  return `INF30${suffix.slice(0, 8)}`;
}

function getEffectiveInfluencerDiscountCode(eventId: string, influencer: Pick<Influencer, 'id' | 'discountCouponCode'>): string {
  const current = String(influencer.discountCouponCode || '').trim().toUpperCase();
  if (current.startsWith('INF30')) return current;
  return stableInfluencerCouponCode(eventId, influencer.id);
}

function toInfluencerNameCouponPrefix(name: string | null | undefined): string {
  const lettersOnly = String(name || '').replace(/[^a-z]/gi, '').toUpperCase();
  const first4 = lettersOnly.slice(0, 4);
  return first4.padEnd(4, 'X');
}

function randomTwoDigits(): string {
  return Math.floor(Math.random() * 100).toString().padStart(2, '0');
}

function toInfluencerPublicCouponCode(name: string | null | undefined): string {
  return `BM-${toInfluencerNameCouponPrefix(name)}${randomTwoDigits()}`;
}

async function getInfluencerCouponExpiryDate(eventId: string): Promise<string> {
  const adminDb = getFirestoreInstance();
  const eventDoc = await adminDb.collection('events').doc(eventId).get();
  const eventData = (eventDoc.exists ? (eventDoc.data() as Record<string, any>) : {}) || {};
  const eventDateRaw = String(eventData.eventDate || '').trim();
  const eventDate = eventDateRaw
    ? new Date(eventDateRaw.includes('T') ? eventDateRaw : `${eventDateRaw}T00:00:00Z`)
    : null;

  if (!eventDate || Number.isNaN(eventDate.getTime())) {
    throw new Error('Event date is required to create influencer coupons.');
  }

  const expiryDateObj = new Date(eventDate);
  expiryDateObj.setDate(expiryDateObj.getDate() - 45);
  return expiryDateObj.toISOString().split('T')[0];
}

async function generateUniqueInfluencerPublicCouponCode(eventId: string, influencerName: string, excludedCodes?: Set<string>): Promise<string> {
  const scopedExcluded = excludedCodes || new Set<string>();
  const [activeCoupons, allPromoCoupons] = await Promise.all([
    readActiveCouponsFromKV('generateUniqueInfluencerPublicCouponCode'),
    readInfluencerPublicCouponsFromKV(eventId),
  ]);
  const activeCodes = new Set([
    ...activeCoupons.map((item) => String(item.code || '').trim().toUpperCase()).filter(Boolean),
    ...allPromoCoupons.map((item) => String(item.code || '').trim().toUpperCase()).filter(Boolean),
  ]);

  for (let attempts = 0; attempts < 300; attempts++) {
    const candidate = toInfluencerPublicCouponCode(influencerName).toUpperCase();
    if (scopedExcluded.has(candidate)) continue;
    if (activeCodes.has(candidate)) continue;
    scopedExcluded.add(candidate);
    return candidate;
  }

  throw new Error(`Unable to generate a unique coupon code for ${influencerName || 'influencer'}.`);
}

async function upsertInfluencerPublicCoupon(
  eventId: string,
  influencer: Influencer,
  input?: { discountPercent?: number | null; regenerate?: boolean; reservedCodes?: Set<string> }
): Promise<{ code: string; expiryDate: string }> {
  const discountPercent = Math.max(1, Math.min(100, Number(input?.discountPercent ?? 35) || 35));
  const expiryDate = await getInfluencerCouponExpiryDate(eventId);
  const currentCode = String(influencer.publicCouponCode || '').trim().toUpperCase();
  // When regenerating, keep the existing code and just update the coupon fields.
  // Only generate a new code if there is no existing code at all.
  const code = currentCode
    ? currentCode
    : await generateUniqueInfluencerPublicCouponCode(eventId, influencer.name, input?.reservedCodes);
  const [activeCoupons, promoCoupons] = await Promise.all([
    readActiveCouponsFromKV('upsertInfluencerPublicCoupon'),
    readInfluencerPublicCouponsFromKV(eventId),
  ]);
  const nowIso = new Date().toISOString();
  const filteredActiveCoupons = activeCoupons.filter((item) => {
    const itemCode = String(item.code || '').trim().toUpperCase();
    if (!itemCode) return false;
    if (itemCode === code) return false;
    return true;
  });
  const filteredPromoCoupons = promoCoupons.filter((item) => {
    const itemCode = String(item.code || '').trim().toUpperCase();
    if (!itemCode) return false;
    if (itemCode === code) return false;
    return true;
  });
  const existingCouponData = promoCoupons.find((item) => String(item.code || '').trim().toUpperCase() === code)
    || activeCoupons.find((item) => String(item.code || '').trim().toUpperCase() === code)
    || {};
  const nextCoupon = {
    ...existingCouponData,
    code,
    id: code,
    couponType: 'Discount Code',
    discountType: 'percentage',
    discountValue: discountPercent,
    usageLimit: Number(existingCouponData.usageLimit || 999999999),
    usageCount: Number(existingCouponData.usageCount || 0),
    startDate: null,
    expiryDate,
    isActive: influencer.isActive !== false,
    applicableEventIds: [eventId],
    sourceEventIds: [],
    applicableTicketIds: [],
    applicableClubIds: [],
    minCartValue: null,
    email: null,
    couponOrigin: 'influencer-public',
    influencerId: influencer.id,
    influencerName: influencer.name || '',
    createdAt: String(existingCouponData.createdAt || nowIso),
    updatedAt: nowIso,
  };

  filteredPromoCoupons.push(nextCoupon);
  await writeInfluencerPublicCouponsToKV(eventId, filteredPromoCoupons);

  if (nextCoupon.isActive !== false) {
    filteredActiveCoupons.push(nextCoupon);
  }
  await writeActiveCouponsToKV(filteredActiveCoupons, 'upsertInfluencerPublicCoupon');
  return { code, expiryDate };
}

async function collectInfluencerPublicCouponSnapshot(eventId: string, influencers: Influencer[]): Promise<{
  couponLogs: InfluencerPublicCouponLogEntry[];
  usageLogs: InfluencerPublicCouponUsageLogEntry[];
}> {
  const couponCodes = Array.from(new Set(influencers.map((item) => String(item.publicCouponCode || '').trim().toUpperCase()).filter(Boolean)));
  const couponMap = new Map<string, Record<string, any>>();
  const promoCoupons = await readInfluencerPublicCouponsFromKV(eventId);
  promoCoupons.forEach((coupon) => {
    const code = String(coupon.code || '').trim().toUpperCase();
    if (couponCodes.includes(code)) couponMap.set(code, coupon);
  });

  let usageLogs = (await readInfluencerPublicCouponUsageLogs(eventId))
    .filter((item) => String((item as any).couponOrigin || 'influencer-public') === 'influencer-public')
    .filter((item) => couponCodes.includes(String(item.couponCode || '').trim().toUpperCase()))
    .sort((a, b) => String(b.usedAt || '').localeCompare(String(a.usedAt || '')));

  // Backfill usage logs from participants for older registrations where usage log entries were not written.
  if (usageLogs.length === 0 && couponCodes.length > 0) {
    const adminDb = getFirestoreInstance();
    const byCodeInfluencer = new Map(
      influencers
        .filter((item) => Boolean(item.publicCouponCode))
        .map((item) => [String(item.publicCouponCode || '').trim().toUpperCase(), item])
    );

    const chunkSize = 10; // Firestore 'in' query limit
    const codeChunks: string[][] = [];
    for (let i = 0; i < couponCodes.length; i += chunkSize) {
      codeChunks.push(couponCodes.slice(i, i + chunkSize));
    }

    const rebuilt: InfluencerPublicCouponUsageLogEntry[] = [];
    for (const codes of codeChunks) {
      const snap = await adminDb
        .collection('events')
        .doc(eventId)
        .collection('participants')
        .where('couponCode', 'in', codes)
        .select('couponCode', 'name', 'email', 'ticketId', 'ticketName', 'bookingId', 'registeredAt')
        .get();

      for (const doc of snap.docs) {
        const data = (doc.data() || {}) as Record<string, any>;
        const couponCode = String(data.couponCode || '').trim().toUpperCase();
        if (!couponCode || !couponCodes.includes(couponCode)) continue;

        const influencer = byCodeInfluencer.get(couponCode);
        const bookingId = String(data.bookingId || '').trim();
        const usageLogId = `${eventId}_${couponCode}_${bookingId || doc.id}`.replace(/[^A-Z0-9_-]/gi, '_');

        rebuilt.push({
          id: usageLogId,
          eventId,
          couponCode,
          couponOrigin: 'influencer-public',
          influencerId: influencer?.id || null,
          influencerName: influencer?.name || null,
          participantId: doc.id,
          participantName: String(data.name || ''),
          participantEmail: String(data.email || '').toLowerCase(),
          ticketId: data.ticketId ? String(data.ticketId) : null,
          ticketName: String(data.ticketName || ''),
          bookingId: bookingId || null,
          usedAt: String(data.registeredAt || new Date().toISOString()),
        });
      }
    }

    if (rebuilt.length > 0) {
      const deduped = Array.from(new Map(rebuilt.map((item) => [item.id, item])).values())
        .sort((a, b) => String(b.usedAt || '').localeCompare(String(a.usedAt || '')));
      await writeInfluencerPublicCouponUsageLogs(eventId, deduped);
      usageLogs = deduped;
    }
  }

  const usageCountByCode = new Map<string, number>();
  for (const item of usageLogs) {
    const code = String(item.couponCode || '').trim().toUpperCase();
    usageCountByCode.set(code, (usageCountByCode.get(code) || 0) + 1);
  }

  const couponLogs = influencers
    .filter((item) => Boolean(item.publicCouponCode))
    .map((item) => {
      const code = String(item.publicCouponCode || '').trim().toUpperCase();
      const coupon = couponMap.get(code) || {};
      const derivedCount = usageCountByCode.get(code) || 0;
      return {
        influencerId: item.id,
        influencerName: item.name,
        influencerEmail: item.email || null,
        isActive: item.isActive !== false,
        code,
        usageCount: Math.max(Number(coupon.usageCount || 0), derivedCount),
        usageLimit: Number(coupon.usageLimit || 999999999),
        expiryDate: coupon.expiryDate ? String(coupon.expiryDate) : null,
      };
    });

  return { couponLogs, usageLogs };
}

async function syncInfluencerPublicCouponActiveStates(eventId: string, influencers: Influencer[]) {
  const promoCoupons = await readInfluencerPublicCouponsFromKV(eventId);
  const activeCoupons = await readActiveCouponsFromKV('syncInfluencerPublicCouponActiveStates');
  const influencerById = new Map(influencers.map((item) => [item.id, item]));
  const influencerByCode = new Map(
    influencers
      .filter((item) => Boolean(item.publicCouponCode))
      .map((item) => [String(item.publicCouponCode || '').trim().toUpperCase(), item])
  );

  const syncedPromoCoupons = promoCoupons.map((coupon) => {
    const couponCode = String(coupon.code || '').trim().toUpperCase();
    const matchedInfluencer = influencerById.get(String(coupon.influencerId || '')) || influencerByCode.get(couponCode);
    if (!matchedInfluencer) return coupon;

    return {
      ...coupon,
      code: couponCode,
      id: couponCode,
      influencerId: matchedInfluencer.id,
      influencerName: matchedInfluencer.name || '',
      isActive: matchedInfluencer.isActive !== false,
      updatedAt: new Date().toISOString(),
    };
  });

  await writeInfluencerPublicCouponsToKV(eventId, syncedPromoCoupons);

  const nonPromoActiveCoupons = activeCoupons.filter((coupon) => String(coupon.couponOrigin || '') !== 'influencer-public');
  const activePromoCoupons = syncedPromoCoupons.filter((coupon) => coupon.isActive !== false);
  await writeActiveCouponsToKV([...nonPromoActiveCoupons, ...activePromoCoupons], 'syncInfluencerPublicCouponActiveStates');
}

async function syncInfluencerPublicCouponMetadata(
  eventId: string,
  influencers: Influencer[],
  input?: { persist?: boolean; source?: string }
): Promise<Influencer[]> {
  if (influencers.length === 0) return influencers;

  const promoCoupons = await readInfluencerPublicCouponsFromKV(eventId);
  const couponByInfluencerId = new Map<string, Record<string, any>>();
  const couponByCode = new Map<string, Record<string, any>>();

  promoCoupons.forEach((coupon) => {
    const code = String(coupon.code || '').trim().toUpperCase();
    const influencerId = String(coupon.influencerId || '').trim();
    if (influencerId && !couponByInfluencerId.has(influencerId)) couponByInfluencerId.set(influencerId, coupon);
    if (code && !couponByCode.has(code)) couponByCode.set(code, coupon);
  });

  let changed = false;
  const synced = influencers.map((influencer) => {
    const currentCode = String(influencer.publicCouponCode || '').trim().toUpperCase();
    const matchedCoupon = couponByInfluencerId.get(influencer.id) || (currentCode ? couponByCode.get(currentCode) : null);
    if (!matchedCoupon) return influencer;

    const nextCode = String(matchedCoupon.code || '').trim().toUpperCase();
    if (!nextCode || nextCode === currentCode) return influencer;

    changed = true;
    return {
      ...influencer,
      publicCouponCode: nextCode,
      updatedAt: new Date().toISOString(),
    };
  });

  if (changed && input?.persist) {
    await writeInfluencersToKV(eventId, synced, input.source || 'syncInfluencerPublicCouponMetadata');
  }

  return synced;
}

function resolveAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    'https://www.bergmantri.com'
  ).replace(/\/$/, '');
}

async function getInfluencerEventMeta(eventId: string): Promise<{ eventName: string; registrationUrl: string }> {
  const adminDb = getFirestoreInstance();
  const eventDoc = await adminDb.collection('events').doc(eventId).get();
  const eventData = (eventDoc.exists ? (eventDoc.data() as Record<string, any>) : {}) || {};

  const eventName = String(eventData.eventName || 'Bergman Event');
  const customSlug = String(eventData.customSlug || '').trim();
  const externalRegistrationUrl = String(eventData.registrationUrl || '').trim();

  const registrationUrl = /^https?:\/\//i.test(externalRegistrationUrl)
    ? externalRegistrationUrl
    : (customSlug ? `${resolveAppBaseUrl()}/event-form/${customSlug}` : `${resolveAppBaseUrl()}`);

  return { eventName, registrationUrl };
}

function buildInfluencerTemplateParams(payload: {
  eventId: string;
  eventName: string;
  influencer: Influencer;
  registrationUrl: string;
  discountCode: string;
  discountPercent?: number;
}) {
  const promoCode = String(payload.influencer.publicCouponCode || '').trim();
  return {
    name: payload.influencer.name,
    eventname: payload.eventName,
    event_name: payload.eventName,
    title: payload.influencer.title || '',
    achievements: payload.influencer.achievements,
    details: payload.influencer.details || '',
    social_url: payload.influencer.socialUrl || '',
    photo_url: payload.influencer.photoUrl || '',
    email: payload.influencer.email || '',
    mobile: payload.influencer.mobile || '',
    event_id: payload.eventId,
    registration_url: payload.registrationUrl,
    discount_percent: String(payload.discountPercent ?? 35),
    discount_code: payload.discountCode,
    discountCode: payload.discountCode,
    promo_code: promoCode,
    promoCode,
    unique_code: promoCode,
    uniqueCode: promoCode,
    influencer_status: payload.influencer.isActive ? 'active' : 'inactive',
    year: String(new Date().getFullYear()),
  };
}

function buildInfluencerWhatsappParams(name: string, eventName: string, discountCode: string): string[] {
  return [name || '', eventName || '', discountCode || ''];
}

async function sendInfluencerEmailNotification(templateRef: string | null | undefined, to: string | null | undefined, params: Record<string, any>) {
  const normalizedRef = String(templateRef || '').trim();
  const recipient = normalizeEmail(to || '');

  if (!normalizedRef || !recipient) {
    return { success: false, skipped: true, message: 'Missing email template or recipient email.' };
  }

  if (/^\d+$/.test(normalizedRef)) {
    const sent = await sendDynamicTemplateEmail(Number(normalizedRef), recipient, params, 'sendInfluencerEmailNotification');
    return { success: sent, skipped: false, message: sent ? 'Sent via Brevo template ID.' : 'Brevo template send failed.' };
  }

  const template = await getTemplate(normalizedRef);
  if (!template) {
    return { success: false, skipped: false, message: `Template "${normalizedRef}" not found in Firestore.` };
  }

  return sendNotification({ templateKey: normalizedRef, to: recipient, params });
}

async function sendInfluencerWhatsappNotification(
  templateRef: string | null | undefined,
  to: string | null | undefined,
  params: Record<string, any>,
  orderedParams: string[]
) {
  const normalizedRef = String(templateRef || '').trim();
  const recipient = String(to || '').trim();

  if (!normalizedRef || !recipient) {
    return { success: false, skipped: true, message: 'Missing WhatsApp template or recipient mobile.' };
  }

  const template = await getTemplate(normalizedRef);
  if (template) {
    return sendNotification({
      templateKey: normalizedRef,
      to: recipient,
      params,
      aisensyTemplateParams: orderedParams,
    });
  }

  return sendAiSensyMessage(
    recipient,
    normalizedRef,
    orderedParams,
    'Bergman Influencer Program',
    'sendInfluencerWhatsappNotification',
    'BERGMAN 2'
  );
}

function firstNonEmpty(record: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = cleanCellValue(record[alias]);
    if (value) return value;
  }
  return '';
}

interface RegisteredParticipantLite {
  id: string;
  email: string | null;
  mobile: string | null;
  ticketStatus: string | null;
  paymentId: string | null;
  amountPaidPaisa: number;
  ticketPricePaisa: number;
  couponCode: string | null;
  couponDiscountPaisa: number;
  basePricePaisa: number;
  pricingBasePaisa: number;
  pricingDiscountPaisa: number;
  pricingTotalPayablePaisa: number;
  /** Sum of all pricingBreakdown components (base + GST + fees) — the true sticker price regardless of what was paid */
  pricingFullStickerPaisa: number;
  influencerDiscountRefundProcessed: boolean;
  influencerDiscountRefundId: string | null;
  influencerDiscountRefundStatus: string | null;
  influencerDiscountRefundAt: string | null;
  influencerDiscountRefundPaymentId: string | null;
  influencerDiscountRefundRrn: string | null;
  influencerDiscountRefundAmountPaisa: number;
}

function toSafeMoney(value: any): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function estimateExistingDiscountPercentFromParticipant(participant: {
  couponDiscountPaisa?: number | null;
  pricingDiscountPaisa?: number | null;
  basePricePaisa?: number | null;
  pricingBasePaisa?: number | null;
}): number {
  const discountPaisa = Math.max(
    0,
    toSafeMoney(participant.couponDiscountPaisa),
    toSafeMoney(participant.pricingDiscountPaisa)
  );
  const basePaisa = Math.max(
    0,
    toSafeMoney(participant.basePricePaisa),
    toSafeMoney(participant.pricingBasePaisa)
  );

  if (discountPaisa <= 0 || basePaisa <= 0) return 0;
  const percent = (discountPaisa / basePaisa) * 100;
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Number(percent.toFixed(2)))) : 0;
}

async function readRegisteredParticipantsLite(eventId: string): Promise<{
  byEmail: Map<string, RegisteredParticipantLite>;
  byMobile: Map<string, RegisteredParticipantLite>;
}> {
  const cacheKey = getInfluencerRegisteredParticipantsLiteCacheKey(eventId);
  const actionName = 'readRegisteredParticipantsLite';

  type CachedPayload = {
    fetchedAt: string;
    participants: RegisteredParticipantLite[];
  };

  const cached = await getKV<CachedPayload>(cacheKey, actionName);
  if (cached && Array.isArray(cached.participants) && cached.fetchedAt) {
    const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= INFLUENCER_PARTICIPANTS_LITE_CACHE_TTL_MS) {
      const byEmail = new Map<string, RegisteredParticipantLite>();
      const byMobile = new Map<string, RegisteredParticipantLite>();

      for (const participant of cached.participants) {
        const email = normalizeEmail(String(participant.email || ''));
        const mobile = normalizeMobile(String(participant.mobile || ''));
        if (email && !byEmail.has(email)) byEmail.set(email, participant);
        if (mobile && !byMobile.has(mobile)) byMobile.set(mobile, participant);
      }

      return { byEmail, byMobile };
    }
  }

  const adminDb = getFirestoreInstance();
  const snap = await adminDb
    .collection('events')
    .doc(eventId)
    .collection('participants')
    .select(
      'email',
      'mobile',
      'ticketStatus',
      'transactionId',
      'paymentId',
      'amountPaidPaisa',
      'ticketPrice',
      'couponCode',
      'couponDiscountPaisa',
      'basePricePaisa',
      'pricingBreakdown',
      'influencerDiscountRefundProcessed',
      'influencerDiscountRefundId',
      'influencerDiscountRefundStatus',
      'influencerDiscountRefundAt',
      'influencerDiscountRefundPaymentId',
      'influencerDiscountRefundRrn',
      'influencerDiscountRefundAmountPaisa'
    )
    .get();

  const byEmail = new Map<string, RegisteredParticipantLite>();
  const byMobile = new Map<string, RegisteredParticipantLite>();
  const participantsForCache: RegisteredParticipantLite[] = [];

  snap.docs.forEach((doc) => {
    const data = (doc.data() || {}) as Record<string, any>;
    const ticketStatus = String(data.ticketStatus || '').trim();
    if (['Cancelled', 'Refunded', 'Inactive'].includes(ticketStatus)) return;

    const email = normalizeEmail(String(data.email || ''));
    const mobile = normalizeMobile(String(data.mobile || ''));
    const paymentId = String(data.transactionId || data.paymentId || '').trim() || null;
    const amountPaidPaisa = toSafeMoney(data.amountPaidPaisa);
    const pricingBreakdown = (data.pricingBreakdown || {}) as Record<string, any>;

    const participant: RegisteredParticipantLite = {
      id: doc.id,
      email,
      mobile,
      ticketStatus: ticketStatus || null,
      paymentId,
      amountPaidPaisa,
      ticketPricePaisa: toSafeMoney(data.ticketPrice),
      couponCode: String(data.couponCode || '').trim() || null,
      couponDiscountPaisa: toSafeMoney(data.couponDiscountPaisa) || toSafeMoney(pricingBreakdown.discount),
      basePricePaisa: toSafeMoney(data.basePricePaisa),
      pricingBasePaisa: toSafeMoney(pricingBreakdown.base),
      pricingDiscountPaisa: toSafeMoney(pricingBreakdown.discount),
      pricingTotalPayablePaisa: toSafeMoney(pricingBreakdown.totalPayable),
      // Sum all components to get true sticker price (works for both online and offline registrations)
      // For offline admin registrations: totalPayable = amountPaid, but base+GST+fees = the real ticket price
      pricingFullStickerPaisa:
        toSafeMoney(pricingBreakdown.base) +
        toSafeMoney(pricingBreakdown.eventGST) +
        toSafeMoney(pricingBreakdown.platformFeeBase) +
        toSafeMoney(pricingBreakdown.platformGST) +
        toSafeMoney(pricingBreakdown.processingFeeBase) +
        toSafeMoney(pricingBreakdown.processingGST),
      influencerDiscountRefundProcessed: data.influencerDiscountRefundProcessed === true,
      influencerDiscountRefundId: String(data.influencerDiscountRefundId || '').trim() || null,
      influencerDiscountRefundStatus: String(data.influencerDiscountRefundStatus || '').trim() || null,
      influencerDiscountRefundAt: String(data.influencerDiscountRefundAt || '').trim() || null,
      influencerDiscountRefundPaymentId: String(data.influencerDiscountRefundPaymentId || '').trim() || null,
      influencerDiscountRefundRrn: String(data.influencerDiscountRefundRrn || '').trim() || null,
      influencerDiscountRefundAmountPaisa: toSafeMoney(data.influencerDiscountRefundAmountPaisa),
    };

    if (email && !byEmail.has(email)) byEmail.set(email, participant);
    if (mobile && !byMobile.has(mobile)) byMobile.set(mobile, participant);
    participantsForCache.push(participant);
  });

  await putKV(
    cacheKey,
    {
      fetchedAt: new Date().toISOString(),
      participants: participantsForCache,
    },
    actionName
  );

  return { byEmail, byMobile };
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
      if (text.trim()) return text;
    } catch {
      // try next URL
    }
  }

  return '';
}

function normalizeInfluencerFormConfig(input: { formUrl: string; sheetUrl: string; emailTemplateKey?: string; whatsappTemplateKey?: string; defaultWhatsappNumber?: string; discountPercent?: number | null }): { config?: InfluencerFormConfig; error?: string } {
  const formUrl = String(input.formUrl || '').trim();
  const sheetUrl = String(input.sheetUrl || '').trim();
  const emailTemplateKey = String(input.emailTemplateKey || '').trim() || null;
  const whatsappTemplateKey = String(input.whatsappTemplateKey || '').trim() || null;
  const defaultWhatsappNumber = normalizeMobile(input.defaultWhatsappNumber || '') || null;
  const discountPercent = input.discountPercent != null && Number.isFinite(Number(input.discountPercent)) ? Math.max(1, Math.min(100, Math.round(Number(input.discountPercent)))) : 35;

  if (!isValidGoogleFormUrl(formUrl)) {
    return { error: 'Valid Google Form URL is required.' };
  }

  if (!isValidGoogleSheetUrl(sheetUrl)) {
    return { error: 'Valid Google Sheet URL is required.' };
  }

  const sheetId = extractSheetIdFromUrl(sheetUrl);
  if (!sheetId) {
    return { error: 'Could not extract Sheet ID from Google Sheet URL.' };
  }

  return {
    config: {
      formUrl,
      sheetUrl,
      sheetId,
      sheetGid: extractSheetGidFromUrl(sheetUrl),
      emailTemplateKey,
      whatsappTemplateKey,
      defaultWhatsappNumber,
      discountPercent,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function readInfluencerFormConfig(eventId: string): Promise<InfluencerFormConfig | null> {
  const existing = await getKV<InfluencerFormConfig>(getInfluencerFormConfigKey(eventId), 'readInfluencerFormConfig');
  if (!existing || typeof existing !== 'object') return null;
  if (!existing.formUrl || !existing.sheetUrl || !existing.sheetId) return null;
  return serializeValue(existing) as InfluencerFormConfig;
}

async function readInfluencerPostTemplateConfig(eventId: string): Promise<InfluencerPostTemplateConfig | null> {
  const existing = await getKV<InfluencerPostTemplateConfig>(getInfluencerPostTemplateConfigKey(eventId), 'readInfluencerPostTemplateConfig');
  if (!existing || typeof existing !== 'object') return null;
  return normalizeInfluencerPostTemplateConfig(serializeValue(existing) as InfluencerPostTemplateConfig);
}

async function readInfluencerFormReviewState(eventId: string): Promise<InfluencerFormReviewState> {
  const existing = await getKV<InfluencerFormReviewState>(getInfluencerFormReviewKey(eventId), 'readInfluencerFormReviewState');
  if (!existing || typeof existing !== 'object') {
    return { rejectedRowIds: [] };
  }

  const serialized = serializeValue(existing) as InfluencerFormReviewState;
  return {
    rejectedRowIds: Array.isArray(serialized.rejectedRowIds) ? serialized.rejectedRowIds.filter(Boolean) : [],
    updatedAt: serialized.updatedAt,
  };
}

async function writeInfluencerFormReviewState(eventId: string, state: InfluencerFormReviewState, source: string) {
  await putKV(getInfluencerFormReviewKey(eventId), {
    rejectedRowIds: Array.from(new Set(state.rejectedRowIds.filter(Boolean))),
    updatedAt: new Date().toISOString(),
  }, source);
}

function parseInfluencerRows(
  csvText: string,
  existingInfluencers: Influencer[],
  rejectedRowIds: Set<string>,
  registeredParticipants: { byEmail: Map<string, RegisteredParticipantLite>; byMobile: Map<string, RegisteredParticipantLite> }
): InfluencerFormResponseRow[] {
  const records = splitCsvRecords(csvText);
  if (records.length < 2) return [];

  const headers = parseCsvLine(records[0]).map((header) => cleanCellValue(header));
  const normalizedHeaders = headers.map(normalizeHeaderKey);

  const rows = records.slice(1).map((recordLine, index) => {
    const cells = parseCsvLine(recordLine);
    const rawData: Record<string, string> = {};

    normalizedHeaders.forEach((header, headerIndex) => {
      rawData[header] = cleanCellValue(cells[headerIndex]);
    });

    const name = firstNonEmpty(rawData, ['full name', 'name', 'influencer name', 'your name']);
    const title = firstNonEmpty(rawData, ['title', 'role', 'designation', 'profession', 'city', 'state']);

    const directAchievements = firstNonEmpty(rawData, ['achievements', 'achievement', 'highlights', 'key achievements', 'accomplishments', 'awards', 'sports achievements']);
    const fitnessMilestones = firstNonEmpty(rawData, ['fitness milestones']);
    const eventsCompleted = firstNonEmpty(rawData, ['number of triathlon events completed']);
    const personalBest = firstNonEmpty(rawData, ['personal best timings in triathlon if yes share results link']);
    const collaborations = firstNonEmpty(rawData, ['influencer collaborations if any']);

    const achievements = directAchievements;

    const directDetails = firstNonEmpty(rawData, ['details', 'additional details', 'bio', 'about', 'profile', 'summary', 'description']);
    const otherDetails = firstNonEmpty(rawData, ['any other details you d like to share']);
    const otherLinks = firstNonEmpty(rawData, ['youtube facebook other links optional']);

    const details = [
      directDetails,
      otherDetails ? `Other details: ${otherDetails}` : '',
      otherLinks ? `Other links: ${otherLinks}` : '',
    ].filter(Boolean).join('\n\n');

    const socialUrl = firstNonEmpty(rawData, [
      'instagram profile link',
      'youtube facebook other links optional',
      'social media link',
      'social media links',
      'social url',
      'social link',
      'website',
      'website url',
      'instagram',
      'instagram url',
      'linkedin',
      'linkedin url',
      'youtube',
      'profile link',
    ]);
    const rawPhotoUrl = normalizeDriveImageUrl(firstNonEmpty(rawData, [
      'upload your in action photo',
      'upload your action photo',
      'in action photo',
      'photo url',
      'photo',
      'image url',
      'image',
      'profile photo',
      'headshot',
      'head shot',
      'photo link',
    ]));
    const email = normalizeEmail(firstNonEmpty(rawData, ['email', 'email id', 'email address', 'contact email']));
    const mobile = normalizeMobile(firstNonEmpty(rawData, ['mobile', 'mobile number', 'phone', 'phone number', 'whatsapp', 'whatsapp number', 'contact number']));
    const timestamp = firstNonEmpty(rawData, ['timestamp', 'submitted at', 'submission time', 'created at']);

    const rowKey = stableHash(JSON.stringify(rawData));
    const fallbackPhotoUrl = `https://picsum.photos/seed/influencer-${rowKey}/600/800`;
    const photoUrl = isValidImageUrl(rawPhotoUrl) ? rawPhotoUrl : fallbackPhotoUrl;
    const missingFields: string[] = [];

    if (!name) missingFields.push('Name');
    if (!achievements) missingFields.push('Achievements');
    if (!email) missingFields.push('Email');

    const importedInfluencer = existingInfluencers.find((influencer) => influencer.importSourceKey === rowKey) || null;
    const alreadyImported = !!importedInfluencer;
    const isRejected = rejectedRowIds.has(rowKey);
    const matchedRegistration =
      (email ? registeredParticipants.byEmail.get(email) : null) ||
      (mobile ? registeredParticipants.byMobile.get(mobile) : null) ||
      null;
    const existingDiscountPercent = matchedRegistration
      ? estimateExistingDiscountPercentFromParticipant(matchedRegistration)
      : 0;

    return {
      id: rowKey,
      timestamp: timestamp || null,
      name,
      title: title || null,
      achievements: achievements || null,
      details: details || null,
      socialUrl: socialUrl || null,
      photoUrl: photoUrl || null,
      email,
      mobile,
      missingFields,
      canImport: missingFields.length === 0 && !alreadyImported && !isRejected,
      alreadyImported,
      isRejected,
      isRegistered: alreadyImported ? (matchedRegistration ? true : importedInfluencer?.isActive !== false) : (matchedRegistration ? true : null),
      couponCode: importedInfluencer?.discountCouponCode || null,
      participantCouponCode: matchedRegistration?.couponCode || null,
      razorpayPaymentId: matchedRegistration?.paymentId || null,
      paidAmountPaisa: matchedRegistration?.amountPaidPaisa || 0,
      ticketPricePaisa: matchedRegistration?.ticketPricePaisa || 0,
      couponDiscountPaisa: matchedRegistration?.couponDiscountPaisa || 0,
      pricingTotalPayablePaisa: matchedRegistration?.pricingTotalPayablePaisa || 0,
      pricingFullStickerPaisa: matchedRegistration?.pricingFullStickerPaisa || 0,
      existingDiscountPercent,
      isDiscountRefunded: matchedRegistration?.influencerDiscountRefundProcessed || false,
      influencerRefundId: matchedRegistration?.influencerDiscountRefundId || null,
      influencerRefundStatus: matchedRegistration?.influencerDiscountRefundStatus || null,
      influencerRefundPaymentId: matchedRegistration?.influencerDiscountRefundPaymentId || null,
      influencerRefundAt: matchedRegistration?.influencerDiscountRefundAt || null,
      influencerRefundRrn: matchedRegistration?.influencerDiscountRefundRrn || null,
      influencerRefundAmountPaisa: matchedRegistration?.influencerDiscountRefundAmountPaisa || 0,
      rawData,
    } satisfies InfluencerFormResponseRow;
  });

  return rows.filter((row) => Object.values(row.rawData).some(Boolean) || row.name || row.photoUrl);
}

async function readInfluencersFromKV(eventId: string, source: string): Promise<Influencer[]> {
  const existing = await getKV<Influencer[]>(getInfluencersKey(eventId), source);
  if (!Array.isArray(existing)) return [];

  return existing
    .map((item) => serializeValue(item) as Influencer)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

async function writeInfluencersToKV(eventId: string, influencers: Influencer[], source: string) {
  const normalized = influencers
    .map((item) => serializeValue(item) as Influencer)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });

  await putKV(getInfluencersKey(eventId), normalized, source);
}

async function normalizeInfluencerDiscountCouponMetadata(
  eventId: string,
  influencers: Influencer[],
  input?: { persist?: boolean; source?: string }
): Promise<Influencer[]> {
  let changed = false;
  const nowIso = new Date().toISOString();

  const normalized = influencers.map((influencer) => {
    const current = String(influencer.discountCouponCode || '').trim().toUpperCase();
    if (!current || current.startsWith('INF30')) return influencer;

    changed = true;
    return {
      ...influencer,
      discountCouponCode: getEffectiveInfluencerDiscountCode(eventId, influencer),
      updatedAt: nowIso,
    };
  });

  if (changed && input?.persist) {
    await writeInfluencersToKV(eventId, normalized, input.source || 'normalizeInfluencerDiscountCouponMetadata');
  }

  return normalized;
}

async function revalidateInfluencerPages(eventId: string) {
  revalidatePath('/admin/dashboard');
  const adminDb = getFirestoreInstance();
  const eventDoc = await adminDb.collection('events').doc(eventId).get();
  if (eventDoc.exists && eventDoc.data()?.customSlug) {
    revalidatePath(`/races/${eventDoc.data()?.customSlug}`);
  }
}

async function ensureInfluencerCoupon(eventId: string, row: InfluencerFormResponseRow, discountPercent = 35): Promise<{ success: boolean; code?: string; message?: string }> {
  const couponCode = stableInfluencerCouponCode(eventId, row.id);
  const adminDb = getFirestoreInstance();
  const couponSnap = await adminDb.collection('coupons').doc(couponCode).get();

  if (couponSnap.exists) {
    return { success: true, code: couponCode };
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 5);
  const expiryDateStr = expiryDate.toISOString().split('T')[0]; // YYYY-MM-DD

  const couponResult = await createCouponAction({
    code: couponCode,
    couponType: 'Discount Code',
    discountType: 'percentage',
    discountValue: discountPercent,
    usageLimit: 1,
    startDate: null,
    expiryDate: expiryDateStr,
    isActive: true,
    applicableEventIds: [eventId],
    sourceEventIds: [],
    applicableTicketIds: [],
    applicableClubIds: [],
    minCartValue: null,
    email: row.email || null,
  });

  if (!couponResult.success) {
    return { success: false, message: couponResult.message || 'Failed to create influencer coupon.' };
  }

  return { success: true, code: couponCode };
}

async function syncInfluencerActivationStatus(eventId: string, influencers: Influencer[]): Promise<Influencer[]> {
  const pending = influencers.filter((item) => item.isActive === false && (!!item.email || !!item.mobile));
  if (pending.length === 0) return influencers;

  const registered = await readRegisteredParticipantsLite(eventId);
  const emailSet = new Set<string>(registered.byEmail.keys());
  const mobileSet = new Set<string>(registered.byMobile.keys());

  let changed = false;
  const nowIso = new Date().toISOString();
  const activatedInfluencerIds = new Set<string>();
  const updated = influencers.map((influencer) => {
    if (influencer.isActive !== false) return influencer;
    const hasRegisteredByEmail = !!influencer.email && emailSet.has(String(influencer.email).toLowerCase());
    const hasRegisteredByMobile = !!influencer.mobile && mobileSet.has(String(influencer.mobile));

    if (hasRegisteredByEmail || hasRegisteredByMobile) {
      changed = true;
      activatedInfluencerIds.add(influencer.id);
      return {
        ...influencer,
        isActive: true,
        registrationMatchedAt: influencer.registrationMatchedAt || nowIso,
        updatedAt: nowIso,
      };
    }

    return influencer;
  });

  if (changed) {
    const config = await readInfluencerFormConfig(eventId);
    const discountPercent = config?.discountPercent ?? 35;
    const withCoupons = await Promise.all(updated.map(async (influencer) => {
      if (!activatedInfluencerIds.has(influencer.id)) return influencer;
      const publicCoupon = await upsertInfluencerPublicCoupon(eventId, influencer, { discountPercent });
      return {
        ...influencer,
        publicCouponCode: publicCoupon.code,
        updatedAt: nowIso,
      };
    }));

    await writeInfluencersToKV(eventId, withCoupons, 'syncInfluencerActivationStatus');
    await revalidateInfluencerPages(eventId);
    return withCoupons;
  }

  return updated;
}

export async function getInfluencersForEventAction(
  eventId: string,
  options?: { publicOnly?: boolean }
): Promise<Influencer[]> {
  const influencers = await readInfluencersFromKV(eventId, 'getInfluencersForEventAction');
  const activationSynced = await syncInfluencerActivationStatus(eventId, influencers);
  const discountSynced = await normalizeInfluencerDiscountCouponMetadata(eventId, activationSynced, {
    persist: true,
    source: 'getInfluencersForEventAction:normalizeDiscountCouponMetadata',
  });
  const synced = await syncInfluencerPublicCouponMetadata(eventId, discountSynced, {
    persist: true,
    source: 'getInfluencersForEventAction:syncCouponMetadata',
  });
  if (options?.publicOnly) {
    const activeInfluencers = synced.filter((item) => item.isActive !== false);
    return activeInfluencers.length > 0 ? activeInfluencers : synced;
  }
  return synced;
}

export async function getInfluencerFormConfigAction(eventId: string): Promise<{ success: boolean; message: string; config?: InfluencerFormConfig | null }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };

  try {
    const config = await readInfluencerFormConfig(eventId);
    return { success: true, message: config ? 'Influencer form config fetched.' : 'No influencer form config found.', config };
  } catch (e: any) {
    return { success: false, message: `Failed to load influencer form config: ${e.message}` };
  }
}

export async function getInfluencerPostTemplateConfigAction(eventId: string): Promise<{ success: boolean; message: string; config?: InfluencerPostTemplateConfig | null }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };

  try {
    const config = await readInfluencerPostTemplateConfig(eventId);
    return { success: true, message: config ? 'Influencer post template config fetched.' : 'No influencer post template config found.', config };
  } catch (e: any) {
    return { success: false, message: `Failed to load influencer post template config: ${e.message}` };
  }
}

export async function saveInfluencerFormConfigAction(
  eventId: string,
  input: { formUrl: string; sheetUrl: string; emailTemplateKey?: string; whatsappTemplateKey?: string; defaultWhatsappNumber?: string; discountPercent?: number | null }
): Promise<{ success: boolean; message: string; config?: InfluencerFormConfig }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };

  const { config, error } = normalizeInfluencerFormConfig(input);
  if (!config || error) return { success: false, message: error || 'Invalid influencer form configuration.' };

  try {
    await putKV(getInfluencerFormConfigKey(eventId), config, 'saveInfluencerFormConfigAction');
    return { success: true, message: 'Influencer Google Form config saved.', config };
  } catch (e: any) {
    return { success: false, message: `Failed to save influencer form config: ${e.message}` };
  }
}

export async function saveInfluencerPostTemplateConfigAction(
  eventId: string,
  input: Partial<InfluencerPostTemplateConfig>
): Promise<{ success: boolean; message: string; config?: InfluencerPostTemplateConfig }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };

  try {
    const config = normalizeInfluencerPostTemplateConfig(input);
    await putKV(getInfluencerPostTemplateConfigKey(eventId), config, 'saveInfluencerPostTemplateConfigAction');
    await revalidateInfluencerPages(eventId);
    return { success: true, message: 'Influencer post template saved.', config };
  } catch (e: any) {
    return { success: false, message: `Failed to save influencer post template config: ${e.message}` };
  }
}

export async function previewInfluencerFormResponsesAction(
  eventId: string,
  input?: { formUrl?: string; sheetUrl?: string; emailTemplateKey?: string; whatsappTemplateKey?: string; defaultWhatsappNumber?: string; discountPercent?: number | null }
): Promise<{ success: boolean; message: string; config?: InfluencerFormConfig; rows?: InfluencerFormResponseRow[] }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };

  try {
    let config: InfluencerFormConfig | null = null;

    if (input?.formUrl || input?.sheetUrl) {
      const normalized = normalizeInfluencerFormConfig({
        formUrl: String(input?.formUrl || ''),
        sheetUrl: String(input?.sheetUrl || ''),
        emailTemplateKey: String(input?.emailTemplateKey || ''),
        whatsappTemplateKey: String(input?.whatsappTemplateKey || ''),
        defaultWhatsappNumber: String(input?.defaultWhatsappNumber || ''),
        discountPercent: input?.discountPercent ?? null,
      });
      if (!normalized.config || normalized.error) {
        return { success: false, message: normalized.error || 'Invalid influencer form configuration.' };
      }
      config = normalized.config;
    } else {
      config = await readInfluencerFormConfig(eventId);
    }

    if (!config) {
      return { success: false, message: 'Save a Google Form URL and Google Sheet URL first.' };
    }

    const csvText = await fetchSheetCsv(config.sheetId, config.sheetGid);
    if (!csvText) {
      return { success: false, message: 'Unable to fetch Google Sheet responses. Make sure the sheet is accessible and has response data.' };
    }

    const influencers = await getInfluencersForEventAction(eventId);
    const reviewState = await readInfluencerFormReviewState(eventId);
    const registeredParticipants = await readRegisteredParticipantsLite(eventId);
    const rows = parseInfluencerRows(csvText, influencers, new Set(reviewState.rejectedRowIds), registeredParticipants);

    return {
      success: true,
      message: rows.length > 0 ? 'Influencer form responses loaded.' : 'No influencer responses found in the sheet.',
      config,
      rows,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to preview influencer form responses: ${e.message}` };
  }
}

export async function importInfluencerFormResponsesAction(
  eventId: string,
  rowIds: string[],
  input?: { formUrl?: string; sheetUrl?: string; emailTemplateKey?: string; whatsappTemplateKey?: string; defaultWhatsappNumber?: string; discountPercent?: number | null; sendEmail?: boolean; sendWhatsapp?: boolean }
): Promise<{ success: boolean; message: string; influencers?: Influencer[]; notifications?: { emailSent: number; whatsappSent: number }; couponCodes?: string[] }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };
  if (!Array.isArray(rowIds) || rowIds.length === 0) {
    return { success: false, message: 'Select at least one form response to import.' };
  }

  try {
    const previewResult = await previewInfluencerFormResponsesAction(eventId, input);
    if (!previewResult.success || !previewResult.rows) {
      return { success: false, message: previewResult.message };
    }

    const selectedIds = new Set(rowIds);
    const rowsToImport = previewResult.rows.filter((row) => selectedIds.has(row.id) && row.canImport);
    if (rowsToImport.length === 0) {
      return { success: false, message: 'No selected rows are ready to import.' };
    }

    const config = previewResult.config || null;
    const discountPercent = input?.discountPercent ?? config?.discountPercent ?? 35;
    const eventMeta = await getInfluencerEventMeta(eventId);
    const influencers = await readInfluencersFromKV(eventId, 'importInfluencerFormResponsesAction');
    const registeredParticipants = await readRegisteredParticipantsLite(eventId);
    let nextOrder = influencers.length > 0 ? Math.max(...influencers.map((item) => item.order ?? 0)) + 1 : 1;
    let emailSent = 0;
    let whatsappSent = 0;
    const couponCodes: string[] = [];

    const createdInfluencers: Influencer[] = [];

    for (const row of rowsToImport) {
      const createdAt = new Date().toISOString();
      const couponResult = await ensureInfluencerCoupon(eventId, row, discountPercent);
      if (!couponResult.success || !couponResult.code) {
        return { success: false, message: couponResult.message || `Failed to create coupon for ${row.name}.` };
      }
      const couponCode = couponResult.code;
      couponCodes.push(couponCode);

      const matchedRegistration =
        (row.email ? registeredParticipants.byEmail.get(String(row.email).toLowerCase()) : null) ||
        (row.mobile ? registeredParticipants.byMobile.get(String(row.mobile)) : null) ||
        null;
      const shouldActivateImmediately = !!matchedRegistration;
      const influencerId = crypto.randomUUID();
      const publicCoupon = await upsertInfluencerPublicCoupon(eventId, {
        id: influencerId,
        eventId,
        name: row.name,
        title: row.title || null,
        achievements: row.achievements || '',
        details: row.details || null,
        socialUrl: row.socialUrl || null,
        photoUrl: row.photoUrl || '',
        email: row.email || null,
        mobile: row.mobile || null,
        isActive: shouldActivateImmediately,
        order: nextOrder,
        createdAt,
      }, { discountPercent });

      const influencer: Influencer = {
        id: influencerId,
        eventId,
        name: row.name,
        title: row.title || null,
        achievements: row.achievements || '',
        details: row.details || null,
        socialUrl: row.socialUrl || null,
        photoUrl: row.photoUrl || '',
        email: row.email || null,
        mobile: row.mobile || null,
        isActive: shouldActivateImmediately,
        approvedAt: createdAt,
        registrationMatchedAt: shouldActivateImmediately ? createdAt : null,
        discountCouponCode: couponCode,
        publicCouponCode: publicCoupon.code || null,
        emailTemplateKey: config?.emailTemplateKey || null,
        whatsappTemplateKey: config?.whatsappTemplateKey || null,
        order: nextOrder++,
        createdAt,
        importSourceKey: row.id,
      };

      createdInfluencers.push(influencer);

      const params = buildInfluencerTemplateParams({
        eventId,
        eventName: eventMeta.eventName,
        influencer,
        registrationUrl: eventMeta.registrationUrl,
        discountCode: influencer.discountCouponCode || couponCode,
        discountPercent,
      });

      if (input?.sendEmail !== false && config?.emailTemplateKey && influencer.email) {
        const emailResult = await sendInfluencerEmailNotification(
          config.emailTemplateKey,
          influencer.email,
          params
        );
        if (emailResult.success) emailSent++;
      }

      const recipientMobile = influencer.mobile || null;
      if (input?.sendWhatsapp !== false && config?.whatsappTemplateKey && recipientMobile) {
        const waResult = await sendInfluencerWhatsappNotification(
          config.whatsappTemplateKey,
          recipientMobile,
          params,
          buildInfluencerWhatsappParams(
            influencer.name,
            eventMeta.eventName,
            influencer.discountCouponCode || couponCode
          )
        );
        if (waResult.success) whatsappSent++;
      }
    }

    await writeInfluencersToKV(eventId, [...influencers, ...createdInfluencers], 'importInfluencerFormResponsesAction');
    const reviewState = await readInfluencerFormReviewState(eventId);
    if (reviewState.rejectedRowIds.length > 0) {
      await writeInfluencerFormReviewState(eventId, {
        rejectedRowIds: reviewState.rejectedRowIds.filter((id) => !selectedIds.has(id)),
      }, 'importInfluencerFormResponsesAction:clearRejected');
    }
    await revalidateInfluencerPages(eventId);

    return {
      success: true,
      message: `${createdInfluencers.length} influencer${createdInfluencers.length === 1 ? '' : 's'} approved and created. Email sent: ${emailSent}, WhatsApp sent: ${whatsappSent}.`,
      influencers: createdInfluencers,
      notifications: { emailSent, whatsappSent },
      couponCodes,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to import influencer responses: ${e.message}` };
  }
}

export async function refundInfluencerDiscountPaymentAction(
  eventId: string,
  rowId: string,
  discountPercentInput?: number | null
): Promise<{ success: boolean; message: string; refundId?: string; status?: string; paymentId?: string; amountPaisa?: number; refundRrn?: string }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };
  if (!rowId) return { success: false, message: 'Row ID is required.' };

  try {
    const influencers = await readInfluencersFromKV(eventId, 'refundInfluencerDiscountPaymentAction');
    const influencer = influencers.find((item) => item.importSourceKey === rowId) || null;
    if (!influencer) {
      return { success: false, message: 'Influencer not found for selected response.' };
    }

    const adminDb = getFirestoreInstance();
    const participantsRef = adminDb.collection('events').doc(eventId).collection('participants');

    const normalizedEmail = normalizeEmail(influencer.email || '');
    const normalizedMobile = normalizeMobile(influencer.mobile || '');

    let participantDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    if (normalizedEmail) {
      const byEmail = await participantsRef.where('email', '==', normalizedEmail).limit(5).get();
      participantDoc = byEmail.docs.find((doc) => {
        const status = String((doc.data() as any)?.ticketStatus || '');
        return !['Cancelled', 'Refunded', 'Inactive'].includes(status);
      }) || byEmail.docs[0] || null;
    }

    if (!participantDoc && normalizedMobile) {
      const byMobile = await participantsRef.where('mobile', '==', normalizedMobile).limit(5).get();
      participantDoc = byMobile.docs.find((doc) => {
        const status = String((doc.data() as any)?.ticketStatus || '');
        return !['Cancelled', 'Refunded', 'Inactive'].includes(status);
      }) || byMobile.docs[0] || null;
    }

    if (!participantDoc) {
      return { success: false, message: 'No matching registered participant found for this influencer.' };
    }

    const participant = participantDoc.data() as Record<string, any>;
    if (participant.influencerDiscountRefundProcessed === true) {
      return { success: false, message: 'Discounted amount already refunded for this participant.' };
    }

    const paymentId = String(participant.transactionId || participant.paymentId || '').trim();
    if (!paymentId || !/^pay_/i.test(paymentId)) {
      return { success: false, message: 'Razorpay payment ID not found for this participant.' };
    }

    const paidAmountPaisa = Math.max(0, Math.round(Number(participant.amountPaidPaisa || 0)));
    if (!paidAmountPaisa) {
      return { success: false, message: 'No paid amount found to refund.' };
    }

    const resolvedInfluencerDiscountPercent = discountPercentInput != null
      ? Math.max(1, Math.min(100, Math.round(Number(discountPercentInput) || 35)))
      : 35;

    // Amount-based refund: influencer% × full sticker price − coupon discount − offline underpayment
    const pricingBreakdownData = (participant.pricingBreakdown || {}) as Record<string, any>;
    const couponDiscountPaisa = Math.max(
      0,
      toSafeMoney(participant.couponDiscountPaisa) || toSafeMoney(pricingBreakdownData.discount)
    );

    // Reconstruct the true sticker price from all pricingBreakdown components.
    // For online Razorpay: base + eventGST + processingFee + platformFee = totalPayable ≈ amountPaid
    // For offline admin registrations: totalPayable was set to amountPaid, but base + eventGST = the real ticket price
    const pricingBase = toSafeMoney(pricingBreakdownData.base);
    const pricingFullStickerPaisa =
      pricingBase > 0
        ? pricingBase +
          toSafeMoney(pricingBreakdownData.eventGST) +
          toSafeMoney(pricingBreakdownData.platformFeeBase) +
          toSafeMoney(pricingBreakdownData.platformGST) +
          toSafeMoney(pricingBreakdownData.processingFeeBase) +
          toSafeMoney(pricingBreakdownData.processingGST)
        : 0;

    // Fallback: ticketPrice field or basePricePaisa + 18% GST estimate
    const ticketPricePaisa = toSafeMoney(participant.ticketPrice);
    const basePricePaisa = toSafeMoney(participant.basePricePaisa);

    // Full price (what athlete would pay with no coupon). Priority: pricingBreakdown components → ticketPrice → basePricePaisa+GST → paidAmount
    const stickerPricePaisa =
      pricingFullStickerPaisa > 0
        ? pricingFullStickerPaisa
        : ticketPricePaisa > 0
          ? ticketPricePaisa
          : basePricePaisa > 0
            ? Math.round(basePricePaisa * 1.18)
            : paidAmountPaisa;
    const fullPricePaisa = stickerPricePaisa + couponDiscountPaisa;

    // Offline/underpayment: athlete paid less than the sticker price (e.g. admin manual entry)
    const offlineDiscountPaisa = stickerPricePaisa > paidAmountPaisa
      ? stickerPricePaisa - paidAmountPaisa
      : 0;

    const totalExistingDiscountPaisa = couponDiscountPaisa + offlineDiscountPaisa;
    const influencerDiscountAmountPaisa = Math.round((resolvedInfluencerDiscountPercent / 100) * fullPricePaisa);
    const amountPaisa = Math.max(0, Math.min(paidAmountPaisa, influencerDiscountAmountPaisa - totalExistingDiscountPaisa));

    if (!amountPaisa) {
      const parts: string[] = [];
      if (couponDiscountPaisa > 0) parts.push(`₹${(couponDiscountPaisa / 100).toFixed(2)} coupon discount`);
      if (offlineDiscountPaisa > 0) parts.push(`₹${(offlineDiscountPaisa / 100).toFixed(2)} offline discount`);
      return {
        success: false,
        message: `Refund is zero after deducting ${parts.join(' and ') || 'existing discounts'} from ${resolvedInfluencerDiscountPercent}% on ₹${(fullPricePaisa / 100).toFixed(2)}.`,
      };
    }

    const refundResult = await refundPaymentAction(paymentId, amountPaisa);
    if (!refundResult.success) {
      return { success: false, message: refundResult.message || 'Refund failed.' };
    }

    await participantDoc.ref.update({
      influencerDiscountRefundProcessed: true,
      influencerDiscountRefundAt: new Date().toISOString(),
      influencerDiscountRefundId: refundResult.refundId || null,
      influencerDiscountRefundStatus: refundResult.status || null,
      influencerDiscountRefundRrn: refundResult.refundRrn || null,
      influencerDiscountRefundAmountPaisa: amountPaisa,
      influencerDiscountPercent: resolvedInfluencerDiscountPercent,
      influencerFullPricePaisa: fullPricePaisa,
      influencerCouponDiscountPaisa: couponDiscountPaisa,
      influencerOfflineDiscountPaisa: offlineDiscountPaisa,
      influencerDiscountRefundPaymentId: paymentId,
      updatedAt: new Date().toISOString(),
    });

    await deleteKV(getInfluencerRegisteredParticipantsLiteCacheKey(eventId), 'refundInfluencerDiscountPaymentAction');

    const refundParts: string[] = [];
    if (couponDiscountPaisa > 0) refundParts.push(`₹${(couponDiscountPaisa / 100).toFixed(2)} coupon`);
    if (offlineDiscountPaisa > 0) refundParts.push(`₹${(offlineDiscountPaisa / 100).toFixed(2)} offline`);

    return {
      success: true,
      message: `Refund of ₹${(amountPaisa / 100).toFixed(2)} initiated (${resolvedInfluencerDiscountPercent}% × ₹${(fullPricePaisa / 100).toFixed(2)}${refundParts.length ? ` − ${refundParts.join(' − ')}` : ''}).`,
      refundId: refundResult.refundId,
      status: refundResult.status,
      paymentId,
      amountPaisa,
      refundRrn: refundResult.refundRrn,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to refund influencer payment: ${e.message}` };
  }
}

export async function updateInfluencerFormResponseReviewAction(
  eventId: string,
  rowId: string,
  status: 'rejected' | 'pending'
): Promise<{ success: boolean; message: string }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };
  if (!rowId) return { success: false, message: 'Response row ID is required.' };

  try {
    const current = await readInfluencerFormReviewState(eventId);
    const nextRejectedIds = new Set(current.rejectedRowIds);

    if (status === 'rejected') {
      nextRejectedIds.add(rowId);
    } else {
      nextRejectedIds.delete(rowId);
    }

    await writeInfluencerFormReviewState(eventId, { rejectedRowIds: Array.from(nextRejectedIds) }, 'updateInfluencerFormResponseReviewAction');
    return { success: true, message: status === 'rejected' ? 'Response rejected.' : 'Response moved back to pending.' };
  } catch (e: any) {
    return { success: false, message: `Failed to update influencer response review: ${e.message}` };
  }
}

export async function sendInfluencerTemplateTestAction(
  eventId: string,
  rowId: string,
  input?: { formUrl?: string; sheetUrl?: string; emailTemplateKey?: string; whatsappTemplateKey?: string; defaultWhatsappNumber?: string }
): Promise<{
  success: boolean;
  message: string;
  testResult?: { emailSent: boolean; whatsappSent: boolean; emailTo?: string | null; whatsappTo?: string | null; params: Record<string, any> };
}> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };
  if (!rowId) return { success: false, message: 'Select a response row to send test notifications.' };

  try {
    const previewResult = await previewInfluencerFormResponsesAction(eventId, input);
    if (!previewResult.success || !previewResult.rows) {
      return { success: false, message: previewResult.message };
    }

    const selectedRow = previewResult.rows.find((row) => row.id === rowId);
    if (!selectedRow) {
      return { success: false, message: 'Selected response row was not found in the latest sheet preview.' };
    }

    const config = previewResult.config || null;
    const eventMeta = await getInfluencerEventMeta(eventId);
    const testCouponCode = stableInfluencerCouponCode(eventId, selectedRow.id);

    const testInfluencer: Influencer = {
      id: selectedRow.id,
      eventId,
      name: selectedRow.name || 'Influencer',
      title: selectedRow.title || null,
      achievements: selectedRow.achievements || '',
      details: selectedRow.details || null,
      socialUrl: selectedRow.socialUrl || null,
      photoUrl: selectedRow.photoUrl || '',
      email: selectedRow.email || null,
      mobile: selectedRow.mobile || null,
      isActive: false,
      order: 0,
      createdAt: new Date().toISOString(),
    };

    const params = buildInfluencerTemplateParams({
      eventId,
      eventName: eventMeta.eventName,
      influencer: testInfluencer,
      registrationUrl: eventMeta.registrationUrl,
      discountCode: testCouponCode,
    });

    let emailSent = false;
    let whatsappSent = false;

    if (config?.emailTemplateKey && testInfluencer.email) {
      const emailResult = await sendInfluencerEmailNotification(
        config.emailTemplateKey,
        testInfluencer.email,
        params
      );
      emailSent = !!emailResult.success;
    }

    const whatsappTo = testInfluencer.mobile || config?.defaultWhatsappNumber || null;
    if (config?.whatsappTemplateKey && whatsappTo) {
      const waResult = await sendInfluencerWhatsappNotification(
        config.whatsappTemplateKey,
        whatsappTo,
        params,
        buildInfluencerWhatsappParams(
          testInfluencer.name,
          eventMeta.eventName,
          testCouponCode
        )
      );
      whatsappSent = !!waResult.success;
    }

    return {
      success: true,
      message: `Test sent. Email: ${emailSent ? 'success' : 'skipped/failed'}, WhatsApp: ${whatsappSent ? 'success' : 'skipped/failed'}.`,
      testResult: {
        emailSent,
        whatsappSent,
        emailTo: testInfluencer.email || null,
        whatsappTo,
        params,
      },
    };
  } catch (e: any) {
    return { success: false, message: `Failed to send influencer template test: ${e.message}` };
  }
}

export async function sendInfluencerCampaignAction(
  eventId: string,
  input: { channel: 'email' | 'whatsapp'; audience: 'active' | 'inactive' }
): Promise<{ success: boolean; message: string; total: number; sent: number; failed: number; skipped: number }> {
  if (!eventId) return { success: false, message: 'Event ID is required.', total: 0, sent: 0, failed: 0, skipped: 0 };

  const channel = input?.channel;
  const audience = input?.audience;

  if (channel !== 'email' && channel !== 'whatsapp') {
    return { success: false, message: 'Invalid channel. Use email or whatsapp.', total: 0, sent: 0, failed: 0, skipped: 0 };
  }
  if (audience !== 'active' && audience !== 'inactive') {
    return { success: false, message: 'Invalid audience. Use active or inactive.', total: 0, sent: 0, failed: 0, skipped: 0 };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'sendInfluencerCampaignAction');
    const targetInfluencers = influencers.filter((influencer) => (
      audience === 'active' ? influencer.isActive !== false : influencer.isActive === false
    ));

    if (targetInfluencers.length === 0) {
      return {
        success: true,
        message: `No ${audience} influencers found for this event.`,
        total: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      };
    }

    const config = await readInfluencerFormConfig(eventId);
    if (!config) {
      return {
        success: false,
        message: 'Influencer campaign config is missing. Please save Google Form config first.',
        total: targetInfluencers.length,
        sent: 0,
        failed: 0,
        skipped: targetInfluencers.length,
      };
    }

    if (channel === 'email' && !config.emailTemplateKey) {
      return {
        success: false,
        message: 'Email template key is missing in influencer config.',
        total: targetInfluencers.length,
        sent: 0,
        failed: 0,
        skipped: targetInfluencers.length,
      };
    }

    if (channel === 'whatsapp' && !config.whatsappTemplateKey) {
      return {
        success: false,
        message: 'WhatsApp template key is missing in influencer config.',
        total: targetInfluencers.length,
        sent: 0,
        failed: 0,
        skipped: targetInfluencers.length,
      };
    }

    const eventMeta = await getInfluencerEventMeta(eventId);
    const adminDb = getFirestoreInstance();
    const discountPercent = config.discountPercent ?? 35;

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let changed = false;

    const updatedInfluencers = [...influencers];

    for (const influencer of targetInfluencers) {
      let couponCode = getEffectiveInfluencerDiscountCode(eventId, influencer);
      if (!couponCode) {
        couponCode = stableInfluencerCouponCode(eventId, influencer.id);
        const couponSnap = await adminDb.collection('coupons').doc(couponCode).get();
        if (!couponSnap.exists) {
          const expiryDate = new Date();
          expiryDate.setDate(expiryDate.getDate() + 5);
          const expiryDateStr = expiryDate.toISOString().split('T')[0];

          const couponResult = await createCouponAction({
            code: couponCode,
            couponType: 'Discount Code',
            discountType: 'percentage',
            discountValue: discountPercent,
            usageLimit: 1,
            startDate: null,
            expiryDate: expiryDateStr,
            isActive: true,
            applicableEventIds: [eventId],
            sourceEventIds: [],
            applicableTicketIds: [],
            applicableClubIds: [],
            minCartValue: null,
            email: influencer.email || null,
          });

          if (!couponResult.success) {
            failed++;
            continue;
          }
        }

        const index = updatedInfluencers.findIndex((item) => item.id === influencer.id);
        if (index >= 0) {
          updatedInfluencers[index] = {
            ...updatedInfluencers[index],
            discountCouponCode: couponCode,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
      }

      const influencerWithCoupon = {
        ...influencer,
        discountCouponCode: couponCode,
      };

      const params = buildInfluencerTemplateParams({
        eventId,
        eventName: eventMeta.eventName,
        influencer: influencerWithCoupon,
        registrationUrl: eventMeta.registrationUrl,
        discountCode: couponCode,
        discountPercent,
      });

      if (channel === 'email') {
        const emailResult = await sendInfluencerEmailNotification(
          config.emailTemplateKey,
          influencer.email,
          params
        );
        if (emailResult.success) sent++;
        else if (emailResult.skipped) skipped++;
        else failed++;
        continue;
      }

      const mobile = normalizeMobile(influencer.mobile || '') || String(influencer.mobile || '').trim();
      const waResult = await sendInfluencerWhatsappNotification(
        config.whatsappTemplateKey,
        mobile,
        params,
        buildInfluencerWhatsappParams(
          influencer.name,
          eventMeta.eventName,
          couponCode
        )
      );
      if (waResult.success) sent++;
      else if ('skipped' in waResult && waResult.skipped) skipped++;
      else failed++;
    }

    if (changed) {
      await writeInfluencersToKV(eventId, updatedInfluencers, 'sendInfluencerCampaignAction:updateCoupons');
      await revalidateInfluencerPages(eventId);
    }

    const channelLabel = channel === 'email' ? 'Email' : 'WhatsApp';
    return {
      success: true,
      message: `${channelLabel} campaign completed for ${audience} influencers. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
      total: targetInfluencers.length,
      sent,
      failed,
      skipped,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to send influencer campaign: ${e.message}`, total: 0, sent: 0, failed: 0, skipped: 0 };
  }
}

export async function sendInfluencerCampaignTestAction(
  eventId: string,
  input: { channel: 'email' | 'whatsapp'; audience: 'active' | 'inactive'; targetInfluencerId?: string; testRecipient?: string }
): Promise<{ success: boolean; message: string; targetName?: string | null; targetRecipient?: string | null }> {
  if (!eventId) return { success: false, message: 'Event ID is required.' };

  const channel = input?.channel;
  const audience = input?.audience;

  if (channel !== 'email' && channel !== 'whatsapp') {
    return { success: false, message: 'Invalid channel. Use email or whatsapp.' };
  }
  if (audience !== 'active' && audience !== 'inactive') {
    return { success: false, message: 'Invalid audience. Use active or inactive.' };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'sendInfluencerCampaignTestAction');
    const audienceInfluencers = influencers.filter((influencer) => (
      audience === 'active' ? influencer.isActive !== false : influencer.isActive === false
    ));

    const preferredInfluencerId = String(input?.targetInfluencerId || '').trim();
    const hasValidRecipient = (influencer: Influencer) => (
      channel === 'email'
        ? !!normalizeEmail(influencer.email || '')
        : !!(normalizeMobile(influencer.mobile || '') || String(influencer.mobile || '').trim())
    );

    const preferredInfluencer = preferredInfluencerId
      ? audienceInfluencers.find((influencer) => influencer.id === preferredInfluencerId)
      : null;

    const targetInfluencer = (preferredInfluencer && hasValidRecipient(preferredInfluencer))
      ? preferredInfluencer
      : audienceInfluencers.find((influencer) => hasValidRecipient(influencer));

    if (!targetInfluencer) {
      return { success: false, message: `No ${audience} influencer with valid ${channel} recipient found.` };
    }

    const config = await readInfluencerFormConfig(eventId);
    if (!config) return { success: false, message: 'Influencer campaign config is missing.' };
    if (channel === 'email' && !config.emailTemplateKey) return { success: false, message: 'Email template key is missing in influencer config.' };
    if (channel === 'whatsapp' && !config.whatsappTemplateKey) return { success: false, message: 'WhatsApp template key is missing in influencer config.' };

    let couponCode = getEffectiveInfluencerDiscountCode(eventId, targetInfluencer);
    const discountPercent = config.discountPercent ?? 35;

    if (!couponCode) {
      couponCode = stableInfluencerCouponCode(eventId, targetInfluencer.id);
      const adminDb = getFirestoreInstance();
      const couponSnap = await adminDb.collection('coupons').doc(couponCode).get();
      if (!couponSnap.exists) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 5);
        const expiryDateStr = expiryDate.toISOString().split('T')[0];

        const couponResult = await createCouponAction({
          code: couponCode,
          couponType: 'Discount Code',
          discountType: 'percentage',
          discountValue: discountPercent,
          usageLimit: 1,
          startDate: null,
          expiryDate: expiryDateStr,
          isActive: true,
          applicableEventIds: [eventId],
          sourceEventIds: [],
          applicableTicketIds: [],
          applicableClubIds: [],
          minCartValue: null,
          email: targetInfluencer.email || null,
        });

        if (!couponResult.success) {
          return { success: false, message: couponResult.message || 'Failed to create coupon for test send.' };
        }
      }
    }

    const eventMeta = await getInfluencerEventMeta(eventId);
    const params = buildInfluencerTemplateParams({
      eventId,
      eventName: eventMeta.eventName,
      influencer: { ...targetInfluencer, discountCouponCode: couponCode },
      registrationUrl: eventMeta.registrationUrl,
      discountCode: couponCode,
      discountPercent,
    });

    const customRecipientRaw = String(input?.testRecipient || '').trim();

    if (channel === 'email') {
      const emailTo = normalizeEmail(customRecipientRaw);
      if (!emailTo) {
        return { success: false, message: 'Custom test email is required for Test Email.' };
      }

      const result = await sendInfluencerEmailNotification(config.emailTemplateKey, emailTo, params);
      return {
        success: !!result.success,
        message: result.success
          ? `Test email sent to ${emailTo}.`
          : (result.message || 'Test email send failed.'),
        targetName: targetInfluencer.name,
        targetRecipient: emailTo,
      };
    }

    const mobile = normalizeMobile(customRecipientRaw || targetInfluencer.mobile || '') || String(customRecipientRaw || targetInfluencer.mobile || '').trim();
    if (!mobile) {
      return { success: false, message: 'Invalid test WhatsApp recipient.' };
    }
    const result = await sendInfluencerWhatsappNotification(
      config.whatsappTemplateKey,
      mobile,
      params,
      buildInfluencerWhatsappParams(targetInfluencer.name, eventMeta.eventName, couponCode)
    );

    return {
      success: !!result.success,
      message: result.success
        ? `Test WhatsApp sent to ${mobile}.`
        : (result.message || 'Test WhatsApp send failed.'),
      targetName: targetInfluencer.name,
      targetRecipient: mobile,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to send campaign test: ${e.message}` };
  }
}

function applyInfluencerCampaignTokens(template: string, values: Record<string, string>) {
  let output = String(template || '');
  Object.entries(values).forEach(([key, value]) => {
    const token = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    output = output.replace(token, value || '');
  });
  return output;
}

export async function sendInfluencerCustomCampaignAction(
  eventId: string,
  input: {
    channel: 'email' | 'whatsapp';
    audience: 'active' | 'inactive' | 'rejected' | 'not_selected';
    emailSubject?: string;
    emailHtml?: string;
    whatsappCampaignName?: string;
    whatsappParams?: string[];
    testMode?: boolean;
    testRecipient?: string;
    targetInfluencerId?: string;
    targetInfluencerIds?: string[];
  }
): Promise<{ success: boolean; message: string; total: number; sent: number; failed: number; skipped: number }> {
  if (!eventId) return { success: false, message: 'Event ID is required.', total: 0, sent: 0, failed: 0, skipped: 0 };

  const channel = input?.channel;
  const audience = input?.audience;
  const testMode = input?.testMode === true;

  if (channel !== 'email' && channel !== 'whatsapp') {
    return { success: false, message: 'Invalid channel. Use email or whatsapp.', total: 0, sent: 0, failed: 0, skipped: 0 };
  }
  if (audience !== 'active' && audience !== 'inactive' && audience !== 'rejected' && audience !== 'not_selected') {
    return { success: false, message: 'Invalid audience. Use active, inactive, rejected or not_selected.', total: 0, sent: 0, failed: 0, skipped: 0 };
  }

  if ((audience === 'rejected' || audience === 'not_selected') && channel !== 'email') {
    return { success: false, message: 'Rejected/Not selected audiences currently support email only.', total: 0, sent: 0, failed: 0, skipped: 0 };
  }

  if (channel === 'email') {
    if (!String(input?.emailSubject || '').trim()) {
      return { success: false, message: 'Email subject is required.', total: 0, sent: 0, failed: 0, skipped: 0 };
    }
    if (!String(input?.emailHtml || '').trim()) {
      return { success: false, message: 'Email HTML content is required.', total: 0, sent: 0, failed: 0, skipped: 0 };
    }
  }

  if (channel === 'whatsapp') {
    if (!String(input?.whatsappCampaignName || '').trim()) {
      return { success: false, message: 'WhatsApp campaign name is required.', total: 0, sent: 0, failed: 0, skipped: 0 };
    }
  }

  try {
    if (audience === 'rejected' || audience === 'not_selected') {
      const preview = await previewInfluencerFormResponsesAction(eventId);
      if (!preview.success || !preview.rows) {
        return { success: false, message: preview.message || 'Failed to load form responses.', total: 0, sent: 0, failed: 0, skipped: 0 };
      }

      const responseRows = preview.rows.filter((row) => {
        if (row.alreadyImported) return false;
        if (audience === 'rejected') return row.isRejected === true;
        return row.isRejected !== true;
      });

      const eligibleRows = responseRows.filter((row) => !!normalizeEmail(row.email || ''));
      if (eligibleRows.length === 0) {
        return {
          success: false,
          message: `No ${audience === 'rejected' ? 'rejected' : 'not selected'} form responses with valid email found.`,
          total: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
        };
      }

      const eventMeta = await getInfluencerEventMeta(eventId);
      const config = await readInfluencerFormConfig(eventId);
      const discountPercent = config?.discountPercent ?? 35;

      const customTestRecipient = String(input?.testRecipient || '').trim();
      const customTestEmail = normalizeEmail(customTestRecipient);

      if (testMode && !customTestRecipient) {
        return {
          success: false,
          message: 'Custom test email is required for Test Send (email).',
          total: 0,
          sent: 0,
          failed: 0,
          skipped: 0,
        };
      }

      if (testMode && customTestRecipient) {
        if (!customTestEmail) {
          return { success: false, message: 'Invalid custom test email.', total: 1, sent: 0, failed: 1, skipped: 0 };
        }
        const tokenValues = {
          name: 'Test User',
          eventName: eventMeta.eventName || '',
          event_name: eventMeta.eventName || '',
          title: '',
          email: customTestEmail,
          mobile: '',
          discountCode: '',
          discount_code: '',
          promoCode: '',
          promo_code: '',
          uniqueCode: '',
          unique_code: '',
          discountPercent: String(discountPercent),
          registrationUrl: eventMeta.registrationUrl || '',
          registration_url: eventMeta.registrationUrl || '',
          influencerStatus: audience,
        };

        const subject = applyInfluencerCampaignTokens(String(input.emailSubject || ''), tokenValues);
        const html = applyInfluencerCampaignTokens(String(input.emailHtml || ''), tokenValues);
        const result = await sendRawHtmlEmail(customTestEmail, subject, html);
        return {
          success: result,
          message: result ? `Test email sent to ${customTestEmail}.` : `Failed to send test email to ${customTestEmail}.`,
          total: 1,
          sent: result ? 1 : 0,
          failed: result ? 0 : 1,
          skipped: 0,
        };
      }

      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const row of eligibleRows) {
        const recipient = normalizeEmail(row.email || '');
        if (!recipient) {
          skipped++;
          continue;
        }

        const tokenValues = {
          name: row.name || '',
          eventName: eventMeta.eventName || '',
          event_name: eventMeta.eventName || '',
          title: row.title || '',
          email: recipient,
          mobile: row.mobile || '',
          discountCode: '',
          discount_code: '',
          promoCode: '',
          promo_code: '',
          uniqueCode: '',
          unique_code: '',
          discountPercent: String(discountPercent),
          registrationUrl: eventMeta.registrationUrl || '',
          registration_url: eventMeta.registrationUrl || '',
          influencerStatus: audience,
        };

        const subject = applyInfluencerCampaignTokens(String(input.emailSubject || ''), tokenValues);
        const html = applyInfluencerCampaignTokens(String(input.emailHtml || ''), tokenValues);
        const result = await sendRawHtmlEmail(recipient, subject, html);
        if (result) sent++;
        else failed++;
      }

      const modeLabel = testMode ? 'Test' : 'Campaign';
      return {
        success: sent > 0,
        message: `${modeLabel} Email completed for ${audience === 'rejected' ? 'rejected' : 'not selected'} responses. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
        total: eligibleRows.length,
        sent,
        failed,
        skipped,
      };
    }

    const syncedInfluencers = await syncInfluencerPublicCouponMetadata(
      eventId,
      await readInfluencersFromKV(eventId, 'sendInfluencerCustomCampaignAction'),
      { persist: true, source: 'sendInfluencerCustomCampaignAction:syncCouponMetadata' }
    );
    const influencers = syncedInfluencers;
    const audienceInfluencers = influencers.filter((influencer) => (
      audience === 'active' ? influencer.isActive !== false : influencer.isActive === false
    ));

    const eligibleInfluencers = audienceInfluencers.filter((influencer) => (
      channel === 'email'
        ? !!normalizeEmail(influencer.email || '')
        : !!(normalizeMobile(influencer.mobile || '') || String(influencer.mobile || '').trim())
    ));

    if (eligibleInfluencers.length === 0) {
      return {
        success: false,
        message: `No ${audience} influencers with valid ${channel} recipients found.`,
        total: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      };
    }

    const preferredInfluencerIds = new Set(
      (Array.isArray(input?.targetInfluencerIds) ? input.targetInfluencerIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const legacySingleTargetId = String(input?.targetInfluencerId || '').trim();
    if (legacySingleTargetId) preferredInfluencerIds.add(legacySingleTargetId);

    const selectedInfluencers = preferredInfluencerIds.size > 0
      ? eligibleInfluencers.filter((influencer) => preferredInfluencerIds.has(influencer.id))
      : [];

    if (preferredInfluencerIds.size > 0 && selectedInfluencers.length === 0) {
      return {
        success: false,
        message: `No selected influencers have valid ${channel} recipients in ${audience} audience.`,
        total: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      };
    }

    const targets = selectedInfluencers.length > 0
      ? selectedInfluencers
      : (testMode ? [eligibleInfluencers[0]] : eligibleInfluencers);
    const eventMeta = await getInfluencerEventMeta(eventId);
    const config = await readInfluencerFormConfig(eventId);
    const discountPercent = config?.discountPercent ?? 35;

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const customTestRecipient = String(input?.testRecipient || '').trim();
    const customTestEmail = channel === 'email' ? normalizeEmail(customTestRecipient) : null;
    const customTestMobile = channel === 'whatsapp' ? (normalizeMobile(customTestRecipient) || customTestRecipient) : null;

    if (testMode && channel === 'email' && !customTestRecipient) {
      return {
        success: false,
        message: 'Custom test email is required for Test Send (email).',
        total: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
      };
    }

    if (testMode && customTestRecipient) {
      const tokenValues = {
        name: 'Test User',
        eventName: eventMeta.eventName || '',
        event_name: eventMeta.eventName || '',
        title: '',
        email: customTestEmail || '',
        mobile: customTestMobile || '',
        discountCode: 'TESTCODE',
        discount_code: 'TESTCODE',
        promoCode: 'BM-TEST01',
        promo_code: 'BM-TEST01',
        uniqueCode: 'BM-TEST01',
        unique_code: 'BM-TEST01',
        discountPercent: String(discountPercent),
        registrationUrl: eventMeta.registrationUrl || '',
        registration_url: eventMeta.registrationUrl || '',
        influencerStatus: audience,
      };

      if (channel === 'email') {
        if (!customTestEmail) {
          return { success: false, message: 'Invalid custom test email.', total: 1, sent: 0, failed: 1, skipped: 0 };
        }
        const subject = applyInfluencerCampaignTokens(String(input.emailSubject || ''), tokenValues);
        const html = applyInfluencerCampaignTokens(String(input.emailHtml || ''), tokenValues);
        const result = await sendRawHtmlEmail(customTestEmail, subject, html);
        return {
          success: result,
          message: result ? `Test email sent to ${customTestEmail}.` : `Failed to send test email to ${customTestEmail}.`,
          total: 1,
          sent: result ? 1 : 0,
          failed: result ? 0 : 1,
          skipped: 0,
        };
      }

      if (!customTestMobile) {
        return { success: false, message: 'Invalid custom test WhatsApp number.', total: 1, sent: 0, failed: 1, skipped: 0 };
      }

      const params = Array.isArray(input.whatsappParams) && input.whatsappParams.length > 0
        ? input.whatsappParams.map((value) => applyInfluencerCampaignTokens(String(value || ''), tokenValues))
        : [
            tokenValues.name,
            tokenValues.eventName,
            tokenValues.discountCode,
          ];

      const result = await sendAiSensyMessage(
        customTestMobile,
        String(input.whatsappCampaignName || '').trim(),
        params,
        'Bergman Influencer Custom Campaign',
        'sendInfluencerCustomCampaignAction:testRecipient',
        'BERGMAN 2'
      );

      return {
        success: result.success,
        message: result.success ? `Test WhatsApp sent to ${customTestMobile}.` : (result.message || `Failed to send test WhatsApp to ${customTestMobile}.`),
        total: 1,
        sent: result.success ? 1 : 0,
        failed: result.success ? 0 : 1,
        skipped: 0,
      };
    }

    for (const influencer of targets) {
      const couponCode = getEffectiveInfluencerDiscountCode(eventId, influencer);
      const promoCode = influencer.isActive === false
        ? ''
        : String(influencer.publicCouponCode || '').trim().toUpperCase();
      const tokenValues = {
        name: influencer.name || '',
        eventName: eventMeta.eventName || '',
        event_name: eventMeta.eventName || '',
        title: influencer.title || '',
        email: influencer.email || '',
        mobile: influencer.mobile || '',
        discountCode: couponCode,
        discount_code: couponCode,
        promoCode,
        promo_code: promoCode,
        uniqueCode: promoCode,
        unique_code: promoCode,
        discountPercent: String(discountPercent),
        registrationUrl: eventMeta.registrationUrl || '',
        registration_url: eventMeta.registrationUrl || '',
        influencerStatus: influencer.isActive === false ? 'inactive' : 'active',
      };

      if (channel === 'email') {
        const recipient = normalizeEmail(influencer.email || '');
        if (!recipient) {
          skipped++;
          continue;
        }

        const subject = applyInfluencerCampaignTokens(String(input.emailSubject || ''), tokenValues);
        const html = applyInfluencerCampaignTokens(String(input.emailHtml || ''), tokenValues);
        const result = await sendRawHtmlEmail(recipient, subject, html);
        if (result) sent++;
        else failed++;
        continue;
      }

      const recipient = normalizeMobile(influencer.mobile || '') || String(influencer.mobile || '').trim();
      if (!recipient) {
        skipped++;
        continue;
      }

      const params = Array.isArray(input.whatsappParams) && input.whatsappParams.length > 0
        ? input.whatsappParams.map((value) => applyInfluencerCampaignTokens(String(value || ''), tokenValues))
        : [
            tokenValues.name,
            tokenValues.eventName,
            tokenValues.discountCode,
          ];

      const result = await sendAiSensyMessage(
        recipient,
        String(input.whatsappCampaignName || '').trim(),
        params,
        'Bergman Influencer Custom Campaign',
        'sendInfluencerCustomCampaignAction',
        'BERGMAN 2'
      );

      if (result.success) sent++;
      else failed++;
    }

    const modeLabel = testMode ? 'Test' : 'Campaign';
    const channelLabel = channel === 'email' ? 'Email' : 'WhatsApp';
    const targetLabel = selectedInfluencers.length > 0
      ? (selectedInfluencers.length === 1 ? selectedInfluencers[0].name : `${selectedInfluencers.length} selected influencers`)
      : `${audience} influencers`;
    return {
      success: sent > 0,
      message: `${modeLabel} ${channelLabel} completed for ${targetLabel}. Sent: ${sent}, Failed: ${failed}, Skipped: ${skipped}.`,
      total: targets.length,
      sent,
      failed,
      skipped,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to send custom influencer campaign: ${e.message}`, total: 0, sent: 0, failed: 0, skipped: 0 };
  }
}

export async function generateInfluencerDiscountCouponsAction(
  eventId: string,
  input: { discountPercent: number; regenerateExisting?: boolean }
): Promise<{
  success: boolean;
  message: string;
  generated: number;
  skipped: number;
  failed: number;
  couponLogs?: InfluencerPublicCouponLogEntry[];
  usageLogs?: InfluencerPublicCouponUsageLogEntry[];
  influencers?: Influencer[];
}> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.', generated: 0, skipped: 0, failed: 0 };
  }

  const discountPercent = Math.max(1, Math.min(100, Number(input?.discountPercent || 35)));
  const regenerateExisting = input?.regenerateExisting === true;

  try {
    const influencers = await syncInfluencerPublicCouponMetadata(
      eventId,
      await readInfluencersFromKV(eventId, 'generateInfluencerDiscountCouponsAction'),
      { persist: true, source: 'generateInfluencerDiscountCouponsAction:syncCouponMetadata' }
    );
    if (influencers.length === 0) {
      return { success: true, message: 'No influencers found for this event.', generated: 0, skipped: 0, failed: 0, couponLogs: [], usageLogs: [], influencers: [] };
    }
    await getInfluencerCouponExpiryDate(eventId);

    const usedCodes = new Set<string>(influencers.map((item) => String(item.publicCouponCode || '').trim().toUpperCase()).filter(Boolean));
    const updatedInfluencers = [...influencers];

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < updatedInfluencers.length; i++) {
      const influencer = updatedInfluencers[i];
      if (!regenerateExisting && influencer.publicCouponCode) {
        skipped++;
        continue;
      }

      try {
        const publicCoupon = await upsertInfluencerPublicCoupon(eventId, influencer, {
          discountPercent,
          regenerate: regenerateExisting,
          reservedCodes: usedCodes,
        });
        generated++;
        updatedInfluencers[i] = {
          ...influencer,
          publicCouponCode: publicCoupon.code,
          updatedAt: new Date().toISOString(),
        };
      } catch {
        failed++;
      }
    }

    if (generated > 0) {
      await writeInfluencersToKV(eventId, updatedInfluencers, 'generateInfluencerDiscountCouponsAction');
      await revalidateInfluencerPages(eventId);
    }

    await syncInfluencerPublicCouponActiveStates(eventId, updatedInfluencers);

    const finalInfluencers = await syncInfluencerPublicCouponMetadata(eventId, updatedInfluencers, {
      persist: true,
      source: 'generateInfluencerDiscountCouponsAction:finalSyncCouponMetadata',
    });

    const snapshot = await collectInfluencerPublicCouponSnapshot(eventId, finalInfluencers);

    return {
      success: true,
      message: `Coupon generation completed. Generated: ${generated}, Skipped: ${skipped}, Failed: ${failed}.`,
      generated,
      skipped,
      failed,
      couponLogs: snapshot.couponLogs,
      usageLogs: snapshot.usageLogs,
      influencers: finalInfluencers,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `Failed to generate influencer coupons: ${e.message}`,
      generated: 0,
      skipped: 0,
      failed: 0,
    };
  }
}

export async function addInfluencerAction(
  eventId: string,
  data: Omit<Influencer, 'id' | 'createdAt'>
): Promise<{ success: boolean; message: string; influencerId?: string; influencer?: Influencer }> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }
  if (!data.name || !data.photoUrl || !data.achievements) {
    return { success: false, message: 'Name, photo URL, and achievements are required.' };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'addInfluencerAction');
    const influencerId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    let newInfluencer: Influencer = {
      id: influencerId,
      ...data,
      isActive: data.isActive ?? true,
      createdAt,
    };

    const config = await readInfluencerFormConfig(eventId);
    const publicCoupon = await upsertInfluencerPublicCoupon(eventId, newInfluencer, { discountPercent: config?.discountPercent ?? 35 });
    newInfluencer = {
      ...newInfluencer,
      publicCouponCode: publicCoupon.code,
    };

    influencers.push(newInfluencer);
    await writeInfluencersToKV(eventId, influencers, 'addInfluencerAction');
    await revalidateInfluencerPages(eventId);

    return { success: true, message: 'Influencer added.', influencerId, influencer: newInfluencer };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function getInfluencerPostEmailLogsAction(
  eventId: string
): Promise<{ success: boolean; message: string; logs?: InfluencerPostEmailLogEntry[] }> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const logs = await readInfluencerPostEmailLogs(eventId);
    return { success: true, message: 'Influencer post email logs fetched.', logs };
  } catch (e: any) {
    return { success: false, message: `Failed to fetch influencer post email logs: ${e.message}` };
  }
}

export async function getInfluencerPublicCouponLogsAction(
  eventId: string
): Promise<{ success: boolean; message: string; couponLogs?: InfluencerPublicCouponLogEntry[]; usageLogs?: InfluencerPublicCouponUsageLogEntry[] }> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const influencers = await getInfluencersForEventAction(eventId);
    await syncInfluencerPublicCouponActiveStates(eventId, influencers);
    const snapshot = await collectInfluencerPublicCouponSnapshot(eventId, influencers);
    return {
      success: true,
      message: 'Influencer public coupon logs fetched.',
      couponLogs: snapshot.couponLogs,
      usageLogs: snapshot.usageLogs,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to fetch influencer coupon logs: ${e.message}` };
  }
}

export async function sendInfluencerPostCardsAction(
  eventId: string,
  influencerId: string,
  input: {
    eventName?: string;
    squareImageBase64: string;
    storyImageBase64: string;
    triggerSource?: 'approved' | 'finalized' | 'manual';
  }
): Promise<{ success: boolean; message: string }> {
  if (!eventId || !influencerId) {
    return { success: false, message: 'Event ID and Influencer ID are required.' };
  }

  const squareImageBase64 = String(input?.squareImageBase64 || '').trim();
  const storyImageBase64 = String(input?.storyImageBase64 || '').trim();

  if (!squareImageBase64 || !storyImageBase64) {
    return { success: false, message: 'Both square and story images are required.' };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'sendInfluencerPostCardsAction');
    const influencer = influencers.find((item) => item.id === influencerId);

    if (!influencer) {
      return { success: false, message: 'Influencer not found for this event.' };
    }

    const recipientEmail = String(influencer.email || '').trim().toLowerCase();
    if (!recipientEmail) {
      return { success: false, message: 'Selected influencer has no email address.' };
    }

    const safeName = (influencer.name || 'influencer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'influencer';

    const eventName = String(input?.eventName || 'Bergman Triathlon').trim();
    const adminDb = getFirestoreInstance();
    const eventDoc = await adminDb.collection('events').doc(eventId).get();
    const eventData = (eventDoc.exists ? (eventDoc.data() as Record<string, any>) : {}) || {};

    const eventCity = String(eventData.city || '').trim();
    const eventState = String(eventData.state || '').trim();
    const eventLocation = (eventCity && eventState)
      ? `${eventCity}, ${eventState}`
      : (eventCity || eventState || String(eventData.venueName || '').trim() || 'India');

    const eventDateRaw = String(eventData.eventDate || '').trim();
    const eventDate = eventDateRaw && !Number.isNaN(new Date(eventDateRaw).getTime())
      ? new Date(eventDateRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'TBD';

    const eventShort = eventName
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((word) => word.slice(0, 4).toUpperCase())
      .join('') || 'BERG';

    // Upload images to Firebase Storage so the HTML uses public URLs (not base64 data URIs).
    // This keeps the email payload small and makes the download buttons work in email clients.
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) throw new Error('Firebase Storage bucket not configured.');
    const bucket = getStorageInstance().bucket(bucketName);

    const uploadImage = async (base64: string, fileName: string): Promise<string> => {
      const buffer = Buffer.from(base64, 'base64');
      const filePath = `influencer-kits/${eventId}/${fileName}`;
      const file = bucket.file(filePath);
      await file.save(buffer, { metadata: { contentType: 'image/png' }, public: true });
      return `https://storage.googleapis.com/${bucketName}/${filePath}`;
    };

    const [squareImageUrl, storyImageUrl] = await Promise.all([
      uploadImage(squareImageBase64, `${safeName}-post-1080x1080.png`),
      uploadImage(storyImageBase64, `${safeName}-story-1080x1920.png`),
    ]);

    const templateParams = {
      event_name: eventName,
      event_location: eventLocation,
      event_type: String(eventData.eventType || 'Triathlon'),
      event_date: eventDate,
      event_tagline: String(eventData.tagline || 'Official Influencer Collab Kit'),
      theme_primary: '#00c8ff',
      theme_secondary: '#aaff00',
      theme_accent: '#ff6b00',
      event_emoji: '🏁',
      event_short: eventShort,
      instagram_handle: '@bergman_bengaluru',
      event_id: eventId,
      img1080x1080: squareImageUrl,
      img1080x1920: storyImageUrl,
      collab_email: 'collab@bergman.in',
      event_icons: '🏊🚴🏃',
      influencer_name: influencer.name || 'Influencer',
      influencer_email: recipientEmail,
      addTags: ['influencer-post-kit', `event-${eventId}`],
    };

    // Build HTML locally and inline all CSS so Gmail/Outlook don't strip the design
    const htmlContent = buildInfluencerEmailHtml(
      Object.fromEntries(Object.entries(templateParams).map(([k, v]) => [k, String(v)]))
    );
    const emailSubject = `${templateParams.event_name} — Your Influencer Collab Kit`;

    // Images are now hosted on Firebase Storage — also attach them directly so influencer has them offline
    const emailSent = await sendRawHtmlEmail(recipientEmail, emailSubject, htmlContent, [
      { content: squareImageBase64, name: `${safeName}-insta-post-1080x1080.png` },
      { content: storyImageBase64, name: `${safeName}-insta-story-1080x1920.png` },
    ]);

    if (!emailSent) {
      return { success: false, message: 'Failed to send influencer post email via Brevo template #261.' };
    }

    const existingLogs = await readInfluencerPostEmailLogs(eventId);
    const logEntry: InfluencerPostEmailLogEntry = {
      id: crypto.randomUUID(),
      eventId,
      eventName,
      influencerId: influencer.id,
      influencerName: influencer.name || 'Influencer',
      recipientEmail,
      triggerSource: input?.triggerSource || 'manual',
      sentAt: new Date().toISOString(),
      message: `Generated cards emailed to ${recipientEmail}.`,
    };
    await writeInfluencerPostEmailLogs(eventId, [logEntry, ...existingLogs]);

    return { success: true, message: `Generated cards emailed to ${recipientEmail}.` };
  } catch (e: any) {
    return { success: false, message: `Failed to send influencer post cards: ${e.message}` };
  }
}

export async function getInfluencersAction(eventId: string): Promise<{ success: boolean; message: string; influencers?: Influencer[] }> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const influencers = await getInfluencersForEventAction(eventId);
    if (influencers.length === 0) {
      return { success: true, message: 'No influencers found for this event.', influencers: [] };
    }

    return { success: true, message: 'Influencers fetched.', influencers };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function deleteInfluencerAction(eventId: string, id: string): Promise<{ success: boolean; message: string }> {
  if (!eventId || !id) {
    return { success: false, message: 'Event ID and Influencer ID are required.' };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'deleteInfluencerAction');
    const filtered = influencers.filter((item) => item.id !== id);
    await writeInfluencersToKV(eventId, filtered, 'deleteInfluencerAction');
    await revalidateInfluencerPages(eventId);
    return { success: true, message: 'Influencer deleted.' };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updateInfluencerOrderAction(eventId: string, influencers: { id: string; order: number }[]): Promise<{ success: boolean; message: string }> {
  if (!eventId) {
    return { success: false, message: 'Event ID is required.' };
  }

  try {
    const existing = await readInfluencersFromKV(eventId, 'updateInfluencerOrderAction');
    const orderMap = new Map(influencers.map((item) => [item.id, item.order]));
    const updated = existing.map((item) => ({
      ...item,
      order: orderMap.get(item.id) ?? item.order,
      updatedAt: new Date().toISOString(),
    }));

    await writeInfluencersToKV(eventId, updated, 'updateInfluencerOrderAction');
    await revalidateInfluencerPages(eventId);
    return { success: true, message: 'Influencer order updated.' };
  } catch (e: any) {
    return { success: false, message: `Server action failed: ${e.message}` };
  }
}

export async function updateInfluencerAction(
  eventId: string,
  influencerId: string,
  data: Partial<Pick<Influencer, 'name' | 'photoUrl' | 'achievements' | 'details' | 'title' | 'socialUrl' | 'order' | 'email' | 'mobile' | 'isActive'>>
): Promise<{ success: boolean; message: string; influencer?: Influencer }> {
  if (!eventId || !influencerId) {
    return { success: false, message: 'Event and Influencer ID are required.' };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'updateInfluencerAction');
    const existingInfluencer = influencers.find((item) => item.id === influencerId);
    if (!existingInfluencer) {
      return { success: false, message: 'Influencer not found.' };
    }

    const normalizedUpdates: Record<string, any> = { ...data };

    (Object.keys(normalizedUpdates) as Array<keyof typeof normalizedUpdates>).forEach((key) => {
      if (normalizedUpdates[key] === '') {
        normalizedUpdates[key] = null;
      }
    });

    let updatedInfluencer: Influencer = {
      ...existingInfluencer,
      ...normalizedUpdates,
      updatedAt: new Date().toISOString(),
    };

    if (updatedInfluencer.publicCouponCode || updatedInfluencer.isActive !== false) {
      const config = await readInfluencerFormConfig(eventId);
      const publicCoupon = await upsertInfluencerPublicCoupon(eventId, updatedInfluencer, { discountPercent: config?.discountPercent ?? 35 });
      updatedInfluencer = {
        ...updatedInfluencer,
        publicCouponCode: publicCoupon.code,
      };
    }

    const updated = influencers.map((item) => item.id === influencerId ? updatedInfluencer : item);

    await writeInfluencersToKV(eventId, updated, 'updateInfluencerAction');
    await revalidateInfluencerPages(eventId);

    return { success: true, message: 'Influencer details updated.', influencer: updatedInfluencer };
  } catch (e: any) {
    return { success: false, message: `Failed to update influencer: ${e.message}` };
  }
}

export async function extendInfluencerRegistrationWindowAction(
  eventId: string,
  influencerId: string,
  daysToAdd: number
): Promise<{ success: boolean; message: string; influencer?: Influencer }> {
  if (!eventId || !influencerId) {
    return { success: false, message: 'Event and Influencer ID are required.' };
  }

  const safeDaysToAdd = Math.max(1, Math.min(30, Math.round(Number(daysToAdd) || 0)));
  if (!safeDaysToAdd) {
    return { success: false, message: 'Days to add must be between 1 and 30.' };
  }

  try {
    const influencers = await readInfluencersFromKV(eventId, 'extendInfluencerRegistrationWindowAction');
    const existingInfluencer = influencers.find((item) => item.id === influencerId);
    if (!existingInfluencer) {
      return { success: false, message: 'Influencer not found.' };
    }
    if (existingInfluencer.isActive !== false) {
      return { success: false, message: 'Registration window extension is only for inactive influencers.' };
    }
    const effectiveCouponCode = getEffectiveInfluencerDiscountCode(eventId, existingInfluencer);
    if (!effectiveCouponCode) {
      return { success: false, message: 'No personal discount coupon found to reactivate.' };
    }

    const baseRaw = existingInfluencer.approvedAt || existingInfluencer.createdAt;
    const baseDate = baseRaw ? new Date(baseRaw) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return { success: false, message: 'Invalid approval/creation date on influencer record.' };
    }

    const nextBaseDate = new Date(baseDate.getTime() + (safeDaysToAdd * 24 * 60 * 60 * 1000));
    const nowIso = new Date().toISOString();
    const updatedInfluencer: Influencer = {
      ...existingInfluencer,
      discountCouponCode: effectiveCouponCode,
      approvedAt: nextBaseDate.toISOString(),
      updatedAt: nowIso,
    };

    const updated = influencers.map((item) => item.id === influencerId ? updatedInfluencer : item);
    await writeInfluencersToKV(eventId, updated, 'extendInfluencerRegistrationWindowAction');
    await revalidateInfluencerPages(eventId);

    return {
      success: true,
      message: `Registration window extended by ${safeDaysToAdd} day${safeDaysToAdd === 1 ? '' : 's'} for ${existingInfluencer.name}.`,
      influencer: updatedInfluencer,
    };
  } catch (e: any) {
    return { success: false, message: `Failed to extend registration window: ${e.message}` };
  }
}
