'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { deleteKV, getKV, putKV } from '@/lib/cloudflare/kv';
import type {
  WaitlistCode,
  WaitlistCodeStatus,
  WaitlistCodeValidationResult,
  WaitlistEntry,
  WaitlistEntryStatus,
  WaitlistForm,
} from '@/lib/types';
import { sendRawEmailViaProvider, sendTemplateEmailViaProvider } from '@/lib/auth/emailProvider';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';

const SOURCE = 'waitlistActions';

const WAITLIST_FORMS_INDEX_KEY = 'waitlist:forms:index';
const WAITLIST_FORMS_BY_SLUG_PREFIX = 'waitlist:form:slug:';
const WAITLIST_FORM_BY_EVENT_PREFIX = 'waitlist:form:event:';

const WAITLIST_ENTRY_BY_ID_PREFIX = 'waitlist:entry:';
const WAITLIST_ENTRY_INDEX_EVENT_PREFIX = 'waitlist:entries:event:';
const WAITLIST_ENTRY_INDEX_EMAIL_PREFIX = 'waitlist:entries:email:';

const WAITLIST_CODE_BY_ID_PREFIX = 'waitlist:code:id:';
const WAITLIST_CODE_BY_VALUE_PREFIX = 'waitlist:code:value:';
const WAITLIST_CODE_INDEX_EVENT_PREFIX = 'waitlist:codes:event:';
const WAITLIST_SUBMITTED_TEMPLATE_ID = Number(process.env.BREVO_WAITLIST_SUBMITTED_TEMPLATE_ID || 3);
const WAITLIST_ACCEPTED_TEMPLATE_ID = Number(process.env.BREVO_WAITLIST_ACCEPTED_TEMPLATE_ID || 8);

const MAX_LIST_READ = 3000;

type IdIndex = string[];

function nowIso() {
  return new Date().toISOString();
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Ignore outside Next.js request context (tests/CLI).
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

function normalizeMobile(mobile: string | null | undefined): string {
  return String(mobile || '').replace(/\s+/g, '');
}

function normalizeCode(code: string | null | undefined): string {
  return String(code || '').trim().toUpperCase();
}

function normalizeSlug(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function sendWaitlistInvitationViaWhatsApp(input: {
  mobile: string;
  athleteName: string;
  waitlistCode: string;
  expiresAt?: string | null;
}): Promise<{ success: boolean; message: string }> {
  const expiresAtLabel = input.expiresAt
    ? new Date(input.expiresAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const result = await sendAiSensyMessage(
    input.mobile,
    'waitlist',
    [input.athleteName || 'Athlete', input.waitlistCode, expiresAtLabel],
    'Bergman Waitlist',
    'sendWaitlistInvitationViaWhatsApp',
    input.athleteName || 'BERGMAN 2'
  );

  return { success: result.success, message: result.message };
}

function waitlistFormByEventKey(eventId: string) {
  return `${WAITLIST_FORM_BY_EVENT_PREFIX}${eventId}`;
}

function waitlistFormBySlugKey(slug: string) {
  return `${WAITLIST_FORMS_BY_SLUG_PREFIX}${slug}`;
}

function waitlistEntryKey(id: string) {
  return `${WAITLIST_ENTRY_BY_ID_PREFIX}${id}`;
}

function waitlistEntryEventIndexKey(eventId: string) {
  return `${WAITLIST_ENTRY_INDEX_EVENT_PREFIX}${eventId}:index`;
}

function waitlistEntryEmailIndexKey(email: string) {
  return `${WAITLIST_ENTRY_INDEX_EMAIL_PREFIX}${normalizeEmail(email)}:index`;
}

function waitlistCodeByIdKey(id: string) {
  return `${WAITLIST_CODE_BY_ID_PREFIX}${id}`;
}

function waitlistCodeByValueKey(code: string) {
  return `${WAITLIST_CODE_BY_VALUE_PREFIX}${normalizeCode(code)}`;
}

function waitlistCodeEventIndexKey(eventId: string) {
  return `${WAITLIST_CODE_INDEX_EVENT_PREFIX}${eventId}:index`;
}

async function readIndex(key: string): Promise<IdIndex> {
  const value = await getKV<IdIndex>(key, SOURCE);
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.trim().length > 0);
}

async function writeIndex(key: string, ids: IdIndex) {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, MAX_LIST_READ);
  await putKV(key, unique, SOURCE);
}

async function appendToIndex(key: string, id: string) {
  const list = await readIndex(key);
  if (!list.includes(id)) list.unshift(id);
  await writeIndex(key, list);
}

async function removeFromIndex(key: string, id: string) {
  const list = await readIndex(key);
  const filtered = list.filter((item) => item !== id);
  await writeIndex(key, filtered);
}

function buildWaitlistCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let token = '';
  for (let i = 0; i < bytes.length; i += 1) {
    token += alphabet[bytes[i] % alphabet.length];
  }
  return `WL-${token.slice(0, 4)}-${token.slice(4, 8)}`;
}

async function generateUniqueWaitlistCode(): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const code = buildWaitlistCode();
    const existing = await getKV<WaitlistCode>(waitlistCodeByValueKey(code), SOURCE);
    if (!existing) return code;
  }
  throw new Error('Unable to generate a unique waitlist code.');
}

function isCodeExpired(code: WaitlistCode): boolean {
  if (!code.expiresAt) return false;
  const expiryMs = new Date(code.expiresAt).getTime();
  if (Number.isNaN(expiryMs)) return false;
  return Date.now() > expiryMs;
}

function isCodeAtLimit(code: WaitlistCode): boolean {
  const usageLimit = Math.max(Number(code.usageLimit || 1), 1);
  const usageCount = Math.max(Number(code.usageCount || 0), 0);
  return usageCount >= usageLimit;
}

async function getWaitlistEntryByIdInternal(entryId: string): Promise<WaitlistEntry | null> {
  if (!entryId) return null;
  return await getKV<WaitlistEntry>(waitlistEntryKey(entryId), SOURCE);
}

async function saveWaitlistEntryInternal(entry: WaitlistEntry): Promise<void> {
  await putKV(waitlistEntryKey(entry.id), entry, SOURCE);
  await appendToIndex(waitlistEntryEventIndexKey(entry.eventId), entry.id);
  await appendToIndex(waitlistEntryEmailIndexKey(entry.email), entry.id);
}

async function getWaitlistCodeByIdInternal(codeId: string): Promise<WaitlistCode | null> {
  if (!codeId) return null;
  return await getKV<WaitlistCode>(waitlistCodeByIdKey(codeId), SOURCE);
}

async function saveWaitlistCodeInternal(code: WaitlistCode): Promise<void> {
  await putKV(waitlistCodeByIdKey(code.id), code, SOURCE);
  await putKV(waitlistCodeByValueKey(code.code), code, SOURCE);
  await appendToIndex(waitlistCodeEventIndexKey(code.eventId), code.id);
}

export async function upsertWaitlistFormAction(input: {
  eventId: string;
  eventName: string;
  slug?: string;
  isActive?: boolean;
  allowedTicketIds?: string[] | null;
  waitlistOpenAt?: string | null;
  waitlistCloseAt?: string | null;
  actor?: string | null;
}): Promise<{ success: boolean; form?: WaitlistForm; message: string }> {
  try {
    const eventId = String(input.eventId || '').trim();
    const eventName = String(input.eventName || '').trim();
    if (!eventId || !eventName) {
      return { success: false, message: 'Event ID and event name are required.' };
    }

    const existing = await getKV<WaitlistForm>(waitlistFormByEventKey(eventId), SOURCE);
    const timestamp = nowIso();
    const slugBase = normalizeSlug(input.slug || eventName || eventId);
    const slug = slugBase || `event-${eventId.toLowerCase()}`;
    const normalizedAllowedTicketIds = Array.from(
      new Set((input.allowedTicketIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    );

    const form: WaitlistForm = {
      id: existing?.id || crypto.randomUUID(),
      eventId,
      eventName,
      slug,
      isActive: input.isActive !== false,
      allowedTicketIds: normalizedAllowedTicketIds,
      waitlistOpenAt: String(input.waitlistOpenAt || existing?.waitlistOpenAt || '').trim() || null,
      waitlistCloseAt: String(input.waitlistCloseAt || existing?.waitlistCloseAt || '').trim() || null,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      createdBy: existing?.createdBy ?? (String(input.actor || '').trim() || null),
      updatedBy: String(input.actor || '').trim() || null,
    };

    await putKV(waitlistFormByEventKey(eventId), form, SOURCE);
    await putKV(waitlistFormBySlugKey(slug), eventId, SOURCE);
    await appendToIndex(WAITLIST_FORMS_INDEX_KEY, eventId);

    safeRevalidatePath('/admin/dashboard');
    safeRevalidatePath(`/event-form/${slug}`);
    safeRevalidatePath(`/waitlist/${slug}`);

    return { success: true, form, message: 'Waitlist form saved.' };
  } catch (error: any) {
    console.error('[upsertWaitlistFormAction] Error:', error);
    return { success: false, message: error?.message || 'Failed to save waitlist form.' };
  }
}

export async function getWaitlistFormByEventAction(eventId: string): Promise<{
  success: boolean;
  form?: WaitlistForm;
  message: string;
}> {
  try {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return { success: false, message: 'Event ID is required.' };

    const form = await getKV<WaitlistForm>(waitlistFormByEventKey(normalizedEventId), SOURCE);
    if (!form) return { success: false, message: 'Waitlist form not found.' };

    return { success: true, form, message: 'OK' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to fetch waitlist form.' };
  }
}

export async function getWaitlistFormBySlugAction(slug: string): Promise<{
  success: boolean;
  form?: WaitlistForm;
  message: string;
}> {
  try {
    const normalizedSlug = normalizeSlug(slug);
    if (!normalizedSlug) return { success: false, message: 'Invalid waitlist form URL.' };

    const eventId = await getKV<string>(waitlistFormBySlugKey(normalizedSlug), SOURCE);

    if (eventId) {
      const form = await getKV<WaitlistForm>(waitlistFormByEventKey(String(eventId)), SOURCE);
      if (form) return { success: true, form, message: 'OK' };
    }

    // Fallback path for legacy/stale slug index keys:
    // scan form index and resolve by normalized slug.
    const eventIds = await readIndex(WAITLIST_FORMS_INDEX_KEY);
    for (const id of eventIds) {
      const form = await getKV<WaitlistForm>(waitlistFormByEventKey(id), SOURCE);
      if (!form) continue;
      if (normalizeSlug(form.slug || '') === normalizedSlug) {
        // self-heal slug mapping for future requests
        await putKV(waitlistFormBySlugKey(normalizedSlug), form.eventId, SOURCE);
        return { success: true, form, message: 'OK' };
      }
    }

    return { success: false, message: 'Waitlist form not found.' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to fetch waitlist form.' };
  }
}

export async function listWaitlistFormsAction(): Promise<{
  success: boolean;
  forms?: WaitlistForm[];
  message: string;
}> {
  try {
    const eventIds = await readIndex(WAITLIST_FORMS_INDEX_KEY);
    const forms = await Promise.all(
      eventIds.slice(0, MAX_LIST_READ).map(async (eventId) => getKV<WaitlistForm>(waitlistFormByEventKey(eventId), SOURCE))
    );

    const normalized = forms
      .filter((f): f is WaitlistForm => !!f)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { success: true, forms: normalized, message: 'OK' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to list waitlist forms.' };
  }
}

export async function submitWaitlistEntryAction(input: {
  eventId: string;
  eventName: string;
  ticketId?: string | null;
  ticketName?: string | null;
  athleteName: string;
  email: string;
  mobile: string;
  message?: string | null;
}): Promise<{ success: boolean; entry?: WaitlistEntry; message: string }> {
  try {
    const eventId = String(input.eventId || '').trim();
    const eventName = String(input.eventName || '').trim();
    const athleteName = String(input.athleteName || '').trim();
    const email = normalizeEmail(input.email);
    const mobile = normalizeMobile(input.mobile);

    if (!eventId || !eventName) return { success: false, message: 'Event details are missing.' };
    if (!athleteName) return { success: false, message: 'Athlete name is required.' };
    if (!email) return { success: false, message: 'Email is required.' };
    if (!mobile) return { success: false, message: 'Mobile number is required.' };

    const form = await getKV<WaitlistForm>(waitlistFormByEventKey(eventId), SOURCE);
    if (!form || !form.isActive) {
      return { success: false, message: 'Waitlist is currently unavailable for this event.' };
    }

    const now = new Date();
    const openAt = form.waitlistOpenAt ? new Date(form.waitlistOpenAt) : null;
    const closeAt = form.waitlistCloseAt ? new Date(form.waitlistCloseAt) : null;

    if (openAt && !Number.isNaN(openAt.getTime()) && now < openAt) {
      return { success: false, message: `Waitlist opens on ${openAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.` };
    }

    if (closeAt && !Number.isNaN(closeAt.getTime()) && now > closeAt) {
      return { success: false, message: `Waitlist closed on ${closeAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.` };
    }

    const normalizedAllowedTicketIds = Array.from(
      new Set((form.allowedTicketIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    );
    if (normalizedAllowedTicketIds.length > 0 && input.ticketId) {
      const normalizedTicketId = String(input.ticketId).trim();
      if (!normalizedAllowedTicketIds.includes(normalizedTicketId)) {
        return { success: false, message: 'Selected category is not enabled for waitlist.' };
      }
    }

    const entryId = crypto.randomUUID();
    const timestamp = nowIso();
    const entry: WaitlistEntry = {
      id: entryId,
      formId: form.id,
      eventId,
      eventName,
      ticketId: input.ticketId ? String(input.ticketId).trim() : null,
      ticketName: input.ticketName ? String(input.ticketName).trim() : null,
      athleteName,
      email,
      mobile,
      message: input.message ? String(input.message).trim() : null,
      status: 'pending',
      codeId: null,
      invitedAt: null,
      codeSentAt: null,
      registeredAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await saveWaitlistEntryInternal(entry);
    safeRevalidatePath('/admin/dashboard');

    // Send confirmation email (non-blocking – failure does not fail submission)
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://bergmantri.com';
      const ctaUrl = `${appUrl}/event-form/${normalizeSlug(eventName)}`;
      const templateParams = {
        name: athleteName,
        athleteName,
        event_name: eventName,
        eventName,
        ticket_name: entry.ticketName || '',
        ticketName: entry.ticketName || '',
        cta_url: ctaUrl,
        registrationLink: ctaUrl,
        year: new Date().getFullYear(),
        brand_name: 'Bergman Triathlon',
        brandName: 'Bergman Triathlon',
      };

      const sentByTemplate = WAITLIST_SUBMITTED_TEMPLATE_ID > 0
        ? await sendTemplateEmailViaProvider({
            templateId: WAITLIST_SUBMITTED_TEMPLATE_ID,
            recipientEmail: email,
            tags: ['waitlist', 'waitlist-submitted', 'transactional'],
            params: templateParams,
          })
        : false;

      const confirmationHtml = buildWaitlistConfirmationHtml({
        athleteName,
        eventName,
        ticketName: entry.ticketName || null,
        ctaUrl,
        year: new Date().getFullYear(),
        brandName: 'Bergman Triathlon',
      });
      if (!sentByTemplate) {
        await sendRawEmailViaProvider({
          recipientEmail: email,
          subject: `You're on the waitlist — ${eventName}`,
          htmlContent: confirmationHtml,
        });
      }
    } catch (emailErr) {
      console.warn('[submitWaitlistEntryAction] Confirmation email failed:', emailErr);
    }

    return { success: true, entry, message: 'You have been added to the waitlist.' };
  } catch (error: any) {
    console.error('[submitWaitlistEntryAction] Error:', error);
    return { success: false, message: error?.message || 'Failed to submit waitlist request.' };
  }
}

export async function listWaitlistEntriesAction(filters?: {
  eventId?: string;
  ticketId?: string;
  status?: WaitlistEntryStatus | 'all';
  email?: string;
}): Promise<{ success: boolean; entries?: WaitlistEntry[]; message: string }> {
  try {
    const eventId = String(filters?.eventId || '').trim();
    const ticketId = String(filters?.ticketId || '').trim();
    const status = String(filters?.status || 'all').trim().toLowerCase();
    const email = normalizeEmail(filters?.email || '');

    let candidateEntryIds: string[] = [];

    if (email) {
      candidateEntryIds = await readIndex(waitlistEntryEmailIndexKey(email));
    } else if (eventId) {
      candidateEntryIds = await readIndex(waitlistEntryEventIndexKey(eventId));
    } else {
      const eventIds = await readIndex(WAITLIST_FORMS_INDEX_KEY);
      const allLists = await Promise.all(eventIds.map((id) => readIndex(waitlistEntryEventIndexKey(id))));
      candidateEntryIds = allLists.flat();
    }

    const uniqueIds = Array.from(new Set(candidateEntryIds)).slice(0, MAX_LIST_READ);
    const entries = await Promise.all(uniqueIds.map((id) => getWaitlistEntryByIdInternal(id)));

    const normalized = entries
      .filter((entry): entry is WaitlistEntry => !!entry)
      .filter((entry) => {
        if (eventId && entry.eventId !== eventId) return false;
        if (ticketId && String(entry.ticketId || '') !== ticketId) return false;
        if (status && status !== 'all' && entry.status !== status) return false;
        if (email && entry.email !== email) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const codesToLoad = normalized
      .filter((entry) => !!entry.codeId)
      .map((entry) => String(entry.codeId || '').trim())
      .filter(Boolean);

    if (codesToLoad.length > 0) {
      const uniqueCodeIds = Array.from(new Set(codesToLoad));
      const codePairs = await Promise.all(
        uniqueCodeIds.map(async (codeId) => [codeId, await getWaitlistCodeByIdInternal(codeId)] as const),
      );
      const codeMap = new Map<string, WaitlistCode>();
      for (const [codeId, code] of codePairs) {
        if (code) codeMap.set(codeId, code);
      }

      return {
        success: true,
        entries: normalized.map((entry) => ({
          ...entry,
          code: entry.codeId ? codeMap.get(String(entry.codeId || '').trim()) || null : null,
        })),
        message: 'OK',
      };
    }

    return { success: true, entries: normalized, message: 'OK' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to fetch waitlist entries.' };
  }
}

export async function updateWaitlistEntryStatusAction(input: {
  entryId: string;
  status: WaitlistEntryStatus;
  note?: string | null;
}): Promise<{ success: boolean; entry?: WaitlistEntry; message: string }> {
  try {
    const entryId = String(input.entryId || '').trim();
    const status = String(input.status || '').trim().toLowerCase() as WaitlistEntryStatus;
    if (!entryId || !status) return { success: false, message: 'Entry and status are required.' };

    const entry = await getWaitlistEntryByIdInternal(entryId);
    if (!entry) return { success: false, message: 'Waitlist entry not found.' };

    const timestamp = nowIso();
    const updated: WaitlistEntry = {
      ...entry,
      status,
      lastStatusNote: input.note ? String(input.note).trim() : entry.lastStatusNote || null,
      invitedAt: status === 'invited' ? (entry.invitedAt || timestamp) : entry.invitedAt || null,
      codeSentAt: status === 'code_sent' ? (entry.codeSentAt || timestamp) : entry.codeSentAt || null,
      registeredAt: status === 'registered' ? (entry.registeredAt || timestamp) : entry.registeredAt || null,
      updatedAt: timestamp,
    };

    await saveWaitlistEntryInternal(updated);
    safeRevalidatePath('/admin/dashboard');

    return { success: true, entry: updated, message: 'Waitlist entry updated.' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to update waitlist entry.' };
  }
}

export async function updateWaitlistEntryTicketAction(input: {
  entryId: string;
  ticketId?: string | null;
  ticketName?: string | null;
}): Promise<{ success: boolean; entry?: WaitlistEntry; message: string }> {
  try {
    const entryId = String(input.entryId || '').trim();
    if (!entryId) return { success: false, message: 'Entry ID is required.' };

    const entry = await getWaitlistEntryByIdInternal(entryId);
    if (!entry) return { success: false, message: 'Waitlist entry not found.' };

    const ticketId = String(input.ticketId || '').trim() || null;
    const ticketName = String(input.ticketName || '').trim() || null;
    const timestamp = nowIso();

    const updated: WaitlistEntry = {
      ...entry,
      ticketId,
      ticketName,
      updatedAt: timestamp,
    };

    await saveWaitlistEntryInternal(updated);

    if (entry.codeId) {
      const linkedCode = await getWaitlistCodeByIdInternal(entry.codeId);
      if (linkedCode) {
        await saveWaitlistCodeInternal({
          ...linkedCode,
          ticketId,
          ticketName,
          allowedTicketIds: ticketId ? [ticketId] : linkedCode.allowedTicketIds || null,
          updatedAt: timestamp,
        });
      }
    }

    safeRevalidatePath('/admin/dashboard');
    return { success: true, entry: updated, message: 'Waitlist ticket updated.' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to update waitlist ticket.' };
  }
}

export async function deleteWaitlistEntryAction(input: {
  entryId: string;
  actor?: string | null;
}): Promise<{ success: boolean; message: string }> {
  try {
    const entryId = String(input.entryId || '').trim();
    if (!entryId) return { success: false, message: 'Entry ID is required.' };

    const entry = await getWaitlistEntryByIdInternal(entryId);
    if (!entry) return { success: false, message: 'Waitlist entry not found.' };

    // Delete linked waitlist code if it exists
    if (entry.codeId) {
      const linkedCode = await getWaitlistCodeByIdInternal(entry.codeId);
      if (linkedCode) {
        await deleteKV(waitlistCodeByIdKey(linkedCode.id), SOURCE);
        await deleteKV(waitlistCodeByValueKey(linkedCode.code), SOURCE);
        await removeFromIndex(waitlistCodeEventIndexKey(linkedCode.eventId), linkedCode.id);
      }
    }

    // Delete entry and clean indexes
    await deleteKV(waitlistEntryKey(entry.id), SOURCE);
    await removeFromIndex(waitlistEntryEventIndexKey(entry.eventId), entry.id);
    await removeFromIndex(waitlistEntryEmailIndexKey(entry.email), entry.id);

    safeRevalidatePath('/admin/dashboard');
    safeRevalidatePath(`/event-form/${normalizeSlug(entry.eventName)}`);
    safeRevalidatePath(`/waitlist/${normalizeSlug(entry.eventName)}`);

    return { success: true, message: 'Waitlist entry deleted.' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to delete waitlist entry.' };
  }
}

export async function generateWaitlistCodeAction(input: {
  entryId: string;
  expiresAt?: string | null;
  usageLimit?: number;
  allowedTicketIds?: string[] | null;
  createdBy?: string | null;
}): Promise<{ success: boolean; code?: WaitlistCode; message: string }> {
  try {
    const entryId = String(input.entryId || '').trim();
    if (!entryId) return { success: false, message: 'Entry ID is required.' };

    const entry = await getWaitlistEntryByIdInternal(entryId);
    if (!entry) return { success: false, message: 'Waitlist entry not found.' };

    const now = nowIso();
    const usageLimit = Math.max(Number(input.usageLimit || 1), 1);
    const normalizedAllowedTicketIds = Array.from(
      new Set((input.allowedTicketIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    );

    const existing = entry.codeId ? await getWaitlistCodeByIdInternal(entry.codeId) : null;
    if (existing && existing.status === 'active' && !isCodeExpired(existing) && !isCodeAtLimit(existing)) {
      return { success: true, code: existing, message: 'Active code already exists for this entry.' };
    }

    const code: WaitlistCode = {
      id: crypto.randomUUID(),
      code: await generateUniqueWaitlistCode(),
      eventId: entry.eventId,
      eventName: entry.eventName,
      ticketId: entry.ticketId || null,
      ticketName: entry.ticketName || null,
      allowedTicketIds: normalizedAllowedTicketIds,
      email: entry.email,
      athleteName: entry.athleteName,
      entryId: entry.id,
      status: 'active',
      expiresAt: input.expiresAt ? String(input.expiresAt) : null,
      usageLimit,
      usageCount: 0,
      usedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: String(input.createdBy || '').trim() || null,
      lastSentAt: null,
      usedByAttemptId: null,
      usedByParticipantId: null,
    };

    await saveWaitlistCodeInternal(code);

    await saveWaitlistEntryInternal({
      ...entry,
      codeId: code.id,
      status: 'invited',
      invitedAt: entry.invitedAt || now,
      updatedAt: now,
    });

    return { success: true, code, message: 'Waitlist code created.' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to create waitlist code.' };
  }
}

export async function updateWaitlistCodeStatusAction(input: {
  codeId: string;
  status: WaitlistCodeStatus;
}): Promise<{ success: boolean; code?: WaitlistCode; message: string }> {
  try {
    const codeId = String(input.codeId || '').trim();
    const status = String(input.status || '').trim().toLowerCase() as WaitlistCodeStatus;
    if (!codeId || !status) return { success: false, message: 'Code and status are required.' };

    const code = await getWaitlistCodeByIdInternal(codeId);
    if (!code) return { success: false, message: 'Waitlist code not found.' };

    const updated: WaitlistCode = {
      ...code,
      status,
      updatedAt: nowIso(),
      usedAt: status === 'used' ? (code.usedAt || nowIso()) : code.usedAt || null,
    };

    await saveWaitlistCodeInternal(updated);
    safeRevalidatePath('/admin/dashboard');

    return { success: true, code: updated, message: 'Code status updated.' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to update waitlist code status.' };
  }
}

export async function validateWaitlistCodeForRegistrationAction(input: {
  code: string;
  email: string;
  eventId: string;
  ticketId?: string | null;
}): Promise<WaitlistCodeValidationResult> {
  try {
    const codeValue = normalizeCode(input.code);
    const email = normalizeEmail(input.email);
    const eventId = String(input.eventId || '').trim();
    const ticketId = String(input.ticketId || '').trim();

    if (!codeValue) return { success: false, message: 'Waitlist code is required.' };
    if (!email) return { success: false, message: 'Email is required to validate the code.' };
    if (!eventId) return { success: false, message: 'Event is required to validate the code.' };

    const code = await getKV<WaitlistCode>(waitlistCodeByValueKey(codeValue), SOURCE);
    if (!code) return { success: false, message: 'Invalid waitlist code.' };

    if (code.status !== 'active') {
      return { success: false, message: `This code is ${code.status} and cannot be used.` };
    }

    if (isCodeExpired(code)) {
      const expiredCode: WaitlistCode = { ...code, status: 'expired', updatedAt: nowIso() };
      await saveWaitlistCodeInternal(expiredCode);
      return { success: false, message: 'This waitlist code has expired.' };
    }

    if (isCodeAtLimit(code)) {
      const exhausted: WaitlistCode = {
        ...code,
        status: code.usageCount >= code.usageLimit ? 'used' : code.status,
        updatedAt: nowIso(),
      };
      await saveWaitlistCodeInternal(exhausted);
      return { success: false, message: 'This waitlist code has already been used.' };
    }

    if (normalizeEmail(code.email) !== email) {
      return { success: false, message: 'This code is not assigned to this email address.' };
    }

    if (String(code.eventId || '') !== eventId) {
      return { success: false, message: 'This code is not valid for this event.' };
    }

    if (ticketId && code.ticketId && String(code.ticketId) !== ticketId) {
      return { success: false, message: 'This code is not valid for this ticket/category.' };
    }

    const allowedTicketIds = Array.from(
      new Set((code.allowedTicketIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    );
    if (ticketId && allowedTicketIds.length > 0 && !allowedTicketIds.includes(ticketId)) {
      return { success: false, message: 'This code is not enabled for the selected ticket/category.' };
    }

    return { success: true, message: 'Waitlist code validated.', code };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to validate waitlist code.' };
  }
}

export async function validateWaitlistCodeAction(input: {
  code: string;
  email: string;
  eventId: string;
  ticketId?: string | null;
}): Promise<{
  success: boolean;
  message: string;
  unlock?: {
    codeId: string;
    code: string;
    eventId: string;
    ticketId: string | null;
    entryId?: string | null;
    email: string;
    expiresAt?: string | null;
  };
}> {
  const result = await validateWaitlistCodeForRegistrationAction(input);
  if (!result.success || !result.code) {
    return { success: false, message: result.message };
  }

  return {
    success: true,
    message: result.message,
    unlock: {
      codeId: result.code.id,
      code: result.code.code,
      eventId: result.code.eventId,
      ticketId: result.code.ticketId || null,
      entryId: result.code.entryId || null,
      email: result.code.email,
      expiresAt: result.code.expiresAt || null,
    },
  };
}

export async function consumeWaitlistCodeForRegistrationAction(input: {
  code: string;
  email: string;
  eventId: string;
  ticketId?: string | null;
  registrationAttemptId?: string | null;
  participantId?: string | null;
}): Promise<{ success: boolean; message: string; code?: WaitlistCode }> {
  try {
    const validation = await validateWaitlistCodeForRegistrationAction({
      code: input.code,
      email: input.email,
      eventId: input.eventId,
      ticketId: input.ticketId,
    });

    if (!validation.success || !validation.code) {
      const codeValue = normalizeCode(input.code);
      const existing = codeValue ? await getKV<WaitlistCode>(waitlistCodeByValueKey(codeValue), SOURCE) : null;
      if (
        existing &&
        existing.status === 'used' &&
        String(existing.usedByAttemptId || '') === String(input.registrationAttemptId || '')
      ) {
        return { success: true, message: 'Code already consumed for this registration.', code: existing };
      }
      return { success: false, message: validation.message };
    }

    const code = validation.code;
    const now = nowIso();
    const usageCount = Math.max(Number(code.usageCount || 0), 0) + 1;
    const usageLimit = Math.max(Number(code.usageLimit || 1), 1);

    const updatedCode: WaitlistCode = {
      ...code,
      usageCount,
      status: usageCount >= usageLimit ? 'used' : 'active',
      usedAt: usageCount >= usageLimit ? now : code.usedAt || null,
      updatedAt: now,
      usedByAttemptId: input.registrationAttemptId ? String(input.registrationAttemptId) : code.usedByAttemptId || null,
      usedByParticipantId: input.participantId ? String(input.participantId) : code.usedByParticipantId || null,
    };

    await saveWaitlistCodeInternal(updatedCode);

    if (updatedCode.entryId) {
      const entry = await getWaitlistEntryByIdInternal(updatedCode.entryId);
      if (entry) {
        await saveWaitlistEntryInternal({
          ...entry,
          status: 'registered',
          registeredAt: entry.registeredAt || now,
          updatedAt: now,
        });
      }
    }

    safeRevalidatePath('/admin/dashboard');
    return { success: true, message: 'Waitlist code consumed.', code: updatedCode };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to consume waitlist code.' };
  }
}

function buildWaitlistConfirmationHtml(input: {
  athleteName: string;
  eventName: string;
  ticketName?: string | null;
  ctaUrl: string;
  year: number;
  brandName: string;
}): string {
  const ticketLine = input.ticketName
    ? `<li>Preferred category: <strong>${input.ticketName}</strong></li>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're on the Waitlist</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f7fb; font-family:Arial, Helvetica, sans-serif; color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f7fb; margin:0; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; background-color:#ffffff; border-radius:16px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg, #0f172a, #1d4ed8); padding:40px 32px; text-align:center;">
              <div style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#93c5fd; font-weight:bold;">Game On</div>
              <h1 style="margin:12px 0 0; font-size:32px; line-height:40px; color:#ffffff;">You're Officially on the Waitlist</h1>
              <p style="margin:16px 0 0; font-size:16px; line-height:24px; color:#dbeafe;">Thanks for joining. You're one step closer to register.</p>
            </td>
          </tr>

          <!-- Hero Section -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px; font-size:16px; line-height:26px; color:#374151;">Hi ${input.athleteName || 'Athlete'},</p>
              <p style="margin:0 0 16px; font-size:16px; line-height:26px; color:#374151;">Welcome to the team. You've secured your spot on the waitlist for <strong>${input.eventName}</strong> and will be among the first to hear when a spot opens up.</p>
              <p style="margin:0; font-size:16px; line-height:26px; color:#374151;">We're making sure every serious athlete gets a fair shot — faster updates, better experience, and exclusive access from day one.</p>
            </td>
          </tr>

          <!-- Highlights -->
          <tr>
            <td style="padding:0 32px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding:20px; background-color:#eff6ff; border-radius:12px;">
                    <h2 style="margin:0 0 12px; font-size:20px; color:#1e3a8a;">What to expect</h2>
                    <ul style="margin:0; padding-left:20px; color:#374151; font-size:15px; line-height:24px;">
                      <li>Access to sold-out tickets when a spot opens</li>
                      ${ticketLine}
                      <li>A unique access code sent directly to you</li>
                      <li>Priority registration window — 2 days to complete</li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 40px; text-align:center;">
              <a href="${input.ctaUrl}" style="display:inline-block; background-color:#2563eb; color:#ffffff; text-decoration:none; font-size:16px; font-weight:bold; padding:14px 28px; border-radius:999px;">View Event</a>
              <p style="margin:16px 0 0; font-size:13px; line-height:20px; color:#6b7280;">Or share with your friends and build the hype.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px; background-color:#0f172a; text-align:center;">
              <p style="margin:0 0 8px; font-size:14px; line-height:22px; color:#cbd5e1;">Stay ready. Big things are coming.</p>
              <p style="margin:0; font-size:12px; line-height:18px; color:#94a3b8;">&copy; ${input.year} ${input.brandName}. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildWaitlistInvitationHtml(input: {
  athleteName: string;
  eventName: string;
  ticketName?: string | null;
  code: string;
  registrationLink: string;
  expiresAt?: string | null;
}): string {
  const expiryRow = input.expiresAt
    ? `<tr>
        <td style="padding:0 32px 20px; text-align:center;">
          <p style="margin:0; font-size:13px; line-height:20px; color:#991b1b; font-weight:700;">
            ⏱ Code expires: ${new Date(input.expiresAt).toLocaleString()} — complete registration within 2 days.
          </p>
        </td>
      </tr>`
    : '';

  const ticketRow = input.ticketName
    ? `<tr>
        <td style="padding:0 32px 8px;">
          <p style="margin:0; font-size:15px; line-height:24px; color:#374151;">
            <strong>Category:</strong> ${input.ticketName}
          </p>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're Off The Waitlist</title>
</head>
<body style="margin:0; padding:0; background-color:#eef2f7; font-family:Arial, Helvetica, sans-serif; color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eef2f7; margin:0; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; background-color:#ffffff; border-radius:18px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg, #052e16 0%, #166534 55%, #22c55e 100%); padding:28px 32px 36px; text-align:center;">
              <img
                src="https://firebasestorage.googleapis.com/v0/b/racehub-ao1fu.firebasestorage.app/o/BERGMAN%20LOGOS%2Fbm.png?alt=media&token=893533c9-e655-40d3-bfc2-9ae07c51a3b3"
                alt="Bergman Logo"
                width="120"
                style="display:block; margin:0 auto 20px; max-width:120px; height:auto;"
              />
              <div style="font-size:12px; line-height:18px; letter-spacing:2px; text-transform:uppercase; color:#bbf7d0; font-weight:bold;">
                Waitlist Accepted
              </div>
              <h1 style="margin:12px 0 0; font-size:30px; line-height:38px; color:#ffffff; font-weight:700;">
                You Made The Starting Lineup
              </h1>
              <p style="margin:14px 0 0; font-size:16px; line-height:24px; color:#dcfce7;">
                Your access is unlocked. It's officially game time.
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:32px 32px 16px;">
              <p style="margin:0 0 16px; font-size:16px; line-height:26px; color:#374151;">
                Hi ${input.athleteName || 'Athlete'},
              </p>
              <p style="margin:0 0 16px; font-size:16px; line-height:26px; color:#374151;">
                Great news — you've been accepted from the waitlist for <strong>${input.eventName}</strong> and your access is now available.
              </p>
              <p style="margin:0; font-size:16px; line-height:26px; color:#374151;">
                Your unique waitlist code is below:
              </p>
            </td>
          </tr>

          ${ticketRow}

          <!-- Code block -->
          <tr>
            <td style="padding:16px 32px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0fdf4; border:1px solid #86efac; border-radius:14px;">
                <tr>
                  <td style="padding:22px; text-align:center;">
                    <div style="font-size:13px; line-height:20px; text-transform:uppercase; letter-spacing:1.5px; color:#15803d; font-weight:bold; margin-bottom:8px;">
                      Your Waitlist Code
                    </div>
                    <div style="font-size:28px; line-height:34px; font-weight:800; letter-spacing:2px; color:#052e16;">
                      ${input.code}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${expiryRow}

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px; text-align:center;">
              <a href="${input.registrationLink}" style="display:inline-block; background-color:#16a34a; color:#ffffff; text-decoration:none; font-size:16px; font-weight:bold; padding:14px 30px; border-radius:999px;">
                Access Now
              </a>
              <p style="margin:14px 0 0; font-size:13px; line-height:20px; color:#6b7280;">
                If the button doesn't work, copy and paste this link into your browser:<br />
                <span style="color:#374151;">${input.registrationLink}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px; background-color:#052e16; text-align:center;">
              <p style="margin:0 0 8px; font-size:14px; line-height:22px; color:#d1fae5;">
                Welcome to the squad.
              </p>
              <p style="margin:0; font-size:12px; line-height:18px; color:#86efac;">
                &copy; ${new Date().getFullYear()} Bergman Triathlon. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendWaitlistInvitationAction(input: {
  entryId: string;
  registrationLink: string;
  expiresAt?: string | null;
  usageLimit?: number;
  allowedTicketIds?: string[] | null;
  actor?: string | null;
}): Promise<{ success: boolean; message: string; code?: WaitlistCode }> {
  try {
    const entryId = String(input.entryId || '').trim();
    const registrationLink = String(input.registrationLink || '').trim();
    if (!entryId) return { success: false, message: 'Entry ID is required.' };
    if (!registrationLink) return { success: false, message: 'Registration link is required.' };

    const entry = await getWaitlistEntryByIdInternal(entryId);
    if (!entry) return { success: false, message: 'Waitlist entry not found.' };

    const created = await generateWaitlistCodeAction({
      entryId,
      expiresAt: input.expiresAt,
      usageLimit: input.usageLimit,
      allowedTicketIds: input.allowedTicketIds,
      createdBy: input.actor,
    });

    if (!created.success || !created.code) {
      return { success: false, message: created.message || 'Could not generate code.' };
    }

    const code = created.code;

    const html = buildWaitlistInvitationHtml({
      athleteName: entry.athleteName,
      eventName: entry.eventName,
      ticketName: entry.ticketName || null,
      code: code.code,
      registrationLink,
      expiresAt: code.expiresAt || null,
    });

    // Prefer transactional template (#8 waitlist accepted). Fallback to raw HTML if template send fails.
    const expiresAtLabel = code.expiresAt
      ? new Date(code.expiresAt).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    const templateOk = WAITLIST_ACCEPTED_TEMPLATE_ID > 0
      ? await sendTemplateEmailViaProvider({
          templateId: WAITLIST_ACCEPTED_TEMPLATE_ID,
          recipientEmail: entry.email,
          tags: ['waitlist', 'waitlist-accepted', 'transactional'],
          params: {
            name: entry.athleteName || 'Athlete',
            athleteName: entry.athleteName || 'Athlete',
            waitlist_code: code.code,
            code: code.code,
            cta_url: registrationLink,
            registrationLink,
            event_name: entry.eventName,
            eventName: entry.eventName,
            ticket_name: entry.ticketName || '',
            ticketName: entry.ticketName || '',
            expires_at: expiresAtLabel,
            expiresAt: expiresAtLabel,
            year: new Date().getFullYear(),
            brand_name: 'Bergman Triathlon',
            brandName: 'Bergman Triathlon',
          },
        })
      : false;

    const emailOk = templateOk
      ? true
      : await sendRawEmailViaProvider({
          recipientEmail: entry.email,
          subject: 'You are in — you can register using the waitlist code',
          htmlContent: html,
        });

    if (!emailOk) {
      return { success: false, message: 'Code created but email could not be sent.', code };
    }

    try {
      const waResult = await sendWaitlistInvitationViaWhatsApp({
        mobile: entry.mobile,
        athleteName: entry.athleteName,
        waitlistCode: code.code,
        expiresAt: code.expiresAt || null,
      });
      if (!waResult.success) {
        console.warn('[sendWaitlistInvitationAction] WhatsApp send failed:', waResult.message);
      }
    } catch (waError) {
      console.warn('[sendWaitlistInvitationAction] WhatsApp send exception:', waError);
    }

    const now = nowIso();
    await saveWaitlistCodeInternal({
      ...code,
      lastSentAt: now,
      updatedAt: now,
    });

    await saveWaitlistEntryInternal({
      ...entry,
      status: 'code_sent',
      codeId: code.id,
      invitedAt: entry.invitedAt || now,
      codeSentAt: now,
      updatedAt: now,
    });

    safeRevalidatePath('/admin/dashboard');

    return { success: true, message: 'Invitation email sent.', code: { ...code, lastSentAt: now, updatedAt: now } };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to send invitation.' };
  }
}

export async function getWaitlistCodeForEntryAction(input: {
  entryId: string;
  email: string;
}): Promise<{ success: boolean; code?: WaitlistCode; message: string }> {
  try {
    const entryId = String(input.entryId || '').trim();
    const email = normalizeEmail(input.email);
    if (!entryId || !email) return { success: false, message: 'Entry ID and email are required.' };

    const entry = await getWaitlistEntryByIdInternal(entryId);
    if (!entry) return { success: false, message: 'Waitlist entry not found.' };
    if (normalizeEmail(entry.email) !== email) return { success: false, message: 'Unauthorised.' };
    if (!entry.codeId) return { success: false, message: 'No code assigned yet.' };

    const code = await getWaitlistCodeByIdInternal(entry.codeId);
    if (!code) return { success: false, message: 'Code not found.' };

    return { success: true, code, message: 'OK' };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to fetch waitlist code.' };
  }
}

export async function bulkSendWaitlistInvitationsAction(input: {
  entryIds: string[];
  registrationLink: string;
  expiresAt?: string | null;
  usageLimit?: number;
  allowedTicketIds?: string[] | null;
  actor?: string | null;
}): Promise<{
  success: boolean;
  message: string;
  stats: { total: number; sent: number; failed: number };
}> {
  const entryIds = Array.from(new Set((input.entryIds || []).filter(Boolean)));
  if (entryIds.length === 0) {
    return { success: false, message: 'No waitlist entries selected.', stats: { total: 0, sent: 0, failed: 0 } };
  }

  let sent = 0;
  let failed = 0;

  for (const entryId of entryIds) {
    const result = await sendWaitlistInvitationAction({
      entryId,
      registrationLink: input.registrationLink,
      expiresAt: input.expiresAt,
      usageLimit: input.usageLimit,
      allowedTicketIds: input.allowedTicketIds,
      actor: input.actor,
    });

    if (result.success) sent += 1;
    else failed += 1;
  }

  return {
    success: failed === 0,
    message: failed === 0
      ? `Sent ${sent}/${entryIds.length} waitlist invitations.`
      : `Sent ${sent}/${entryIds.length}. Failed: ${failed}.`,
    stats: { total: entryIds.length, sent, failed },
  };
}
