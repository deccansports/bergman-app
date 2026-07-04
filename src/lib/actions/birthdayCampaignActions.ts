'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { deleteKV, getKV, putKV } from '@/lib/cloudflare/kv';
import type { Coupon, User } from '@/lib/types';
import { sendDynamicTemplateEmail } from '@/lib/auth/brevoService';
import { sendRawHtmlEmail } from '@/lib/auth/brevoService';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';
import { authOtpConfig } from '@/lib/auth/authConfig';
import { _syncCouponsToKV } from './dataSyncActions';

interface BirthdayCampaignRecipient {
  uid: string;
  name: string;
  email: string;
  mobile?: string | null;
  dob?: string | null;
  couponCode?: string;
  emailSent?: boolean;
  whatsappSent?: boolean;
  status: 'processed' | 'skipped' | 'failed';
  reason?: string;
}

interface BirthdayAthleteLite {
  uid: string;
  role: string;
  dob: string | null;
  name: string;
  email: string;
  mobile?: string | null;
}

const BIRTHDAY_ATHLETES_CACHE_KEY = 'birthday:athletes-lite:v1';
const BIRTHDAY_ATHLETES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface BirthdayCampaignResult {
  success: boolean;
  message: string;
  stats: {
    scanned: number;
    birthdayToday: number;
    couponsCreated: number;
    couponsReused: number;
    emailSent: number;
    whatsappSent: number;
    alreadyProcessed: number;
    syncedDobToKv: number;
    failed: number;
  };
  recipients: BirthdayCampaignRecipient[];
}

export interface TodayBirthdayCampaignEntry {
  uid: string;
  name: string;
  email: string;
  mobile?: string | null;
  dob?: string | null;
  couponCode?: string | null;
  status: 'processed' | 'failed' | 'not_sent';
  emailSent?: boolean;
  whatsappSent?: boolean;
  reason?: string;
}

export interface TodayBirthdayCampaignStatus {
  success: boolean;
  message: string;
  date: string;
  daysAhead?: number;
  birthdayToday: number;
  processed: number;
  failed: number;
  notSent: number;
  items: TodayBirthdayCampaignEntry[];
}

export interface BirthdayCampaignDashboardStatus {
  success: boolean;
  message: string;
  today: TodayBirthdayCampaignStatus;
  upcoming: TodayBirthdayCampaignStatus;
}

function normalizeDobMonthDay(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const raw = String(dob).trim();
  if (!raw) return null;

  // ISO formats: yyyy-MM-dd or yyyy-MM-ddTHH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(5, 10);
  }

  // dd/MM/yyyy
  const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) {
    const dd = slash[1];
    const mm = slash[2];
    return `${mm}-${dd}`;
  }

  // dd-MM-yyyy
  const dash = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dash) {
    const dd = dash[1];
    const mm = dash[2];
    return `${mm}-${dd}`;
  }

  return null;
}

function buildBirthdayCouponCode(uid: string, year: number): string {
  return `BDAY-${year}-${uid.slice(-6).toUpperCase()}`;
}

function toYmd(date: Date): string {
  // Use IST (Asia/Kolkata) timezone for date generation
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function loadUserFromKvOrSync(uid: string, firestoreUser: User): Promise<{ user: Partial<User>; syncedDob: boolean }> {
  const actionName = 'loadUserFromKvOrSync';
  const kvProfile = (await getKV<Partial<User>>(`user:${uid}:profile`, actionName))
    || (await getKV<Partial<User>>(`user:${uid}`, actionName))
    || {};

  if (kvProfile.dob) {
    return { user: kvProfile, syncedDob: false };
  }

  if (!firestoreUser?.dob) {
    return { user: { ...kvProfile, dob: null }, syncedDob: false };
  }

  const mergedUser = {
    ...firestoreUser,
    ...kvProfile,
    dob: firestoreUser.dob,
  } as Partial<User>;

  // Keep both keys for backward compatibility with existing reads.
  await putKV(`user:${uid}:profile`, mergedUser, actionName);
  await putKV(`user:${uid}`, mergedUser, actionName);

  return { user: mergedUser, syncedDob: true };
}

async function getCampaignRunMapByYear(year: number): Promise<Map<string, any>> {
  const db = getFirestoreInstance();
  const map = new Map<string, any>();
  const snap = await db.collection('birthdayCampaignRuns').where('birthdayYear', '==', year).get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const uid = String(data.uid || '').trim();
    if (uid) map.set(uid, data);
  }
  return map;
}

async function getBirthdayAthletesLite(): Promise<BirthdayAthleteLite[]> {
  const actionName = 'getBirthdayAthletesLite';

  const cached = await getKV<{ updatedAt: string; items: BirthdayAthleteLite[] }>(
    BIRTHDAY_ATHLETES_CACHE_KEY,
    actionName
  );

  if (cached?.updatedAt && Array.isArray(cached.items)) {
    const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= BIRTHDAY_ATHLETES_CACHE_TTL_MS) {
      return cached.items;
    }
  }

  const db = getFirestoreInstance();
  const usersSnap = await db.collection('users').select('role', 'dob', 'name', 'email', 'mobile').get();

  const items: BirthdayAthleteLite[] = usersSnap.docs
    .map((doc) => {
      const data = doc.data() as User;
      return {
        uid: doc.id,
        role: String(data?.role || 'athlete'),
        dob: data?.dob ? String(data.dob).trim() : null,
        name: String(data?.name || 'Athlete').trim(),
        email: String(data?.email || '').trim().toLowerCase(),
        mobile: String(data?.mobile || '').trim() || null,
      };
    })
    .filter((u) => u.role === 'athlete' && !!u.dob);

  await putKV(
    BIRTHDAY_ATHLETES_CACHE_KEY,
    { updatedAt: new Date().toISOString(), items },
    actionName
  );

  return items;
}

async function ensureBirthdayCoupon(input: {
  uid: string;
  email: string;
  name: string;
  year: number;
}): Promise<{ couponCode: string; created: boolean }> {
  const db = getFirestoreInstance();
  const couponCode = buildBirthdayCouponCode(input.uid, input.year);
  const couponRef = db.collection('coupons').doc(couponCode);
  const couponSnap = await couponRef.get();

  if (couponSnap.exists) {
    return { couponCode, created: false };
  }

  const now = new Date();
  const startDate = toYmd(now);
  const expiryDate = toYmd(addDays(now, 30));

  const couponPayload: Omit<Coupon, 'id'> & Record<string, any> = {
    code: couponCode,
    couponType: 'Birthday Coupon',
    discountType: 'percentage',
    discountValue: 15,
    usageLimit: 1,
    usageCount: 0,
    isActive: true,
    applicableEventIds: [],
    sourceEventIds: [],
    applicableTicketIds: [],
    applicableClubIds: [],
    minCartValue: null,
    startDate,
    expiryDate,
    email: input.email.toLowerCase(),
    birthdayYear: input.year,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    source: 'birthday_campaign',
    athleteUid: input.uid,
    athleteName: input.name,
    autoApply: true,
  };

  await couponRef.set(couponPayload);
  return { couponCode, created: true };
}

function getTodayMonthDay(now = new Date()): string {
  // Use IST (Asia/Kolkata) timezone for birthday matching
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const mm = parts.find((p) => p.type === 'month')?.value || '01';
  const dd = parts.find((p) => p.type === 'day')?.value || '01';
  return `${mm}-${dd}`;
}

async function sendBirthdayMessages(params: {
  name: string;
  email: string;
  mobile?: string | null;
  couponCode: string;
}): Promise<{ emailSent: boolean; whatsappSent: boolean; emailError?: string; whatsappError?: string }> {
  const safeName = params.name || 'Athlete';

  let emailSent = false;
  let emailError: string | undefined;

  try {
    emailSent = await sendDynamicTemplateEmail(
      authOtpConfig.brevo.birthdayCampaignTemplateId,
      params.email,
      {
        name: safeName,
        firstName: safeName,
        athleteName: safeName,
        couponCode: params.couponCode,
        coupon: params.couponCode,
        discount: '15%',
        discountValue: '15%',
        validity: '30 days',
        validityDays: '30 days',
      },
      'sendBirthdayMessages'
    );
    if (!emailSent) {
      emailError = 'Brevo template send returned false';
    }
  } catch (e: any) {
    emailSent = false;
    emailError = e?.message || 'Brevo template email failed';
  }

  // Fallback to raw HTML email if Brevo template send is unsuccessful.
  if (!emailSent) {
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2 style="margin:0 0 12px;color:#0f172a;">🎉 Happy Birthday, ${safeName}!</h2>
        <p>Another year stronger. Faster. Unstoppable. 💪</p>
        <p>From all of us at Bergman, we wish you an incredible year ahead filled with new personal bests, epic finish lines, and unforgettable races.</p>
        <p>To celebrate your day, here’s a special gift 🎁</p>
        <p><strong>${params.couponCode}</strong></p>
        <p>🎯 <strong>15% OFF</strong> on any event</p>
        <p>Valid for <strong>30 days</strong></p>
        <p>See you at the start line 🏁</p>
        <p>— Team Bergman</p>
      </div>
    `;

    try {
      const fallbackSent = await sendRawHtmlEmail(
        params.email,
        `🎉 Happy Birthday, ${safeName}! Your Bergman Coupon`,
        html
      );
      emailSent = fallbackSent;
      if (!fallbackSent) {
        emailError = emailError || 'Raw HTML fallback email failed';
      }
    } catch (e: any) {
      emailSent = false;
      emailError = emailError || e?.message || 'Raw HTML fallback email failed';
    }
  }

  let whatsappSent = false;
  let whatsappError: string | undefined;
  if (params.mobile) {
    try {
      const waResPrimary = await sendAiSensyMessage(
        params.mobile,
        authOtpConfig.aisensy.birthdayCampaignName,
        [safeName, params.couponCode],
        'Bergman Birthday Campaign',
        'sendBirthdayMessages',
        'BERGMAN 2'
      );

      if (waResPrimary.success) {
        whatsappSent = true;
      } else {
        // Retry with extended params in case campaign template expects more placeholders.
        const waResRetry = await sendAiSensyMessage(
          params.mobile,
          authOtpConfig.aisensy.birthdayCampaignName,
          [safeName, params.couponCode, '15%', '30 days'],
          'Bergman Birthday Campaign',
          'sendBirthdayMessagesRetry',
          'BERGMAN 2'
        );

        whatsappSent = waResRetry.success;
        if (!waResRetry.success) {
          whatsappError = waResRetry.message || waResRetry.error || waResPrimary.message || waResPrimary.error || 'WhatsApp send failed';
        }
      }
    } catch (e: any) {
      whatsappSent = false;
      whatsappError = e?.message || 'WhatsApp send failed';
    }
  } else {
    whatsappError = 'Mobile number missing';
  }

  return { emailSent, whatsappSent, emailError, whatsappError };
}

export async function syncUserDobToKVAction(limit = 0): Promise<{ success: boolean; message: string; synced: number; scanned: number }> {
  const db = getFirestoreInstance();
  const usersSnap = await db.collection('users').get();

  let scanned = 0;
  let synced = 0;

  for (const doc of usersSnap.docs) {
    if (limit > 0 && scanned >= limit) break;
    scanned++;

    const uid = doc.id;
    const userData = doc.data() as User;
    if (!userData?.dob) continue;

    const kvProfile = (await getKV<Partial<User>>(`user:${uid}:profile`, 'syncUserDobToKVAction'))
      || (await getKV<Partial<User>>(`user:${uid}`, 'syncUserDobToKVAction'))
      || {};

    if (kvProfile.dob) continue;

    const merged = { ...userData, ...kvProfile, dob: userData.dob };
    await putKV(`user:${uid}:profile`, merged, 'syncUserDobToKVAction');
    await putKV(`user:${uid}`, merged, 'syncUserDobToKVAction');
    synced++;
  }

  await invalidateBirthdayDashboardCache('syncUserDobToKVAction');
  await deleteKV(BIRTHDAY_ATHLETES_CACHE_KEY, 'syncUserDobToKVAction');

  return {
    success: true,
    message: `DOB sync complete. Synced ${synced} user profiles to KV.`,
    synced,
    scanned,
  };
}

export async function runBirthdayCampaignAction(runDate?: string): Promise<BirthdayCampaignResult> {
  const db = getFirestoreInstance();
  const now = runDate ? new Date(runDate) : new Date();
  const year = now.getFullYear();
  const monthDay = getTodayMonthDay(now);

  const stats = {
    scanned: 0,
    birthdayToday: 0,
    couponsCreated: 0,
    couponsReused: 0,
    emailSent: 0,
    whatsappSent: 0,
    alreadyProcessed: 0,
    syncedDobToKv: 0,
    failed: 0,
  };

  const recipients: BirthdayCampaignRecipient[] = [];

  try {
    const birthdayAthletes = await getBirthdayAthletesLite();

    for (const athlete of birthdayAthletes) {
      const uid = athlete.uid;
      stats.scanned++;

      if (!athlete.dob) continue;

      // Normalize and check birthday
      const dobValue = String(athlete.dob).trim();
      const dobMonthDay = normalizeDobMonthDay(dobValue);
      if (!dobMonthDay || dobMonthDay !== monthDay) continue;

      stats.birthdayToday++;

      const email = String(athlete.email || '').trim().toLowerCase();
      const name = String(athlete.name || 'Athlete').trim();
      const mobile = String(athlete.mobile || '').trim() || null;

      if (!email) {
        stats.failed++;
        recipients.push({ uid, name, email: '', mobile, dob: dobValue || null, status: 'failed', reason: 'Missing email address' });
        continue;
      }

      const campaignDocId = `${year}_${uid}`;
      const campaignRef = db.collection('birthdayCampaignRuns').doc(campaignDocId);
      const campaignSnap = await campaignRef.get();
      const existingStatus = campaignSnap.exists ? String(campaignSnap.data()?.status || '') : '';
      if (existingStatus === 'success') {
        stats.alreadyProcessed++;
        recipients.push({ uid, name, email, mobile, dob: dobValue || null, status: 'skipped', reason: 'Already processed this year' });
        continue;
      }

      const { couponCode, created } = await ensureBirthdayCoupon({ uid, email, name, year });
      if (created) stats.couponsCreated++;
      else stats.couponsReused++;

      const { emailSent, whatsappSent, emailError, whatsappError } = await sendBirthdayMessages({
        name,
        email,
        mobile,
        couponCode,
      });

      if (emailSent) stats.emailSent++;
      if (whatsappSent) stats.whatsappSent++;

      const status: 'success' | 'failed' = (emailSent || whatsappSent) ? 'success' : 'failed';
      if (status === 'failed') stats.failed++;

      await campaignRef.set({
        uid,
        email,
        name,
        mobile,
        dob: dobValue || null,
        birthdayMonthDay: monthDay,
        birthdayYear: year,
        couponCode,
        emailSent,
        whatsappSent,
        emailError: emailError || null,
        whatsappError: whatsappError || null,
        status,
        source: 'admin_birthday_campaign',
        attemptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: campaignSnap.exists ? campaignSnap.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true });

      recipients.push({
        uid,
        name,
        email,
        mobile,
        dob: dobValue || null,
        couponCode,
        emailSent,
        whatsappSent,
        status: status === 'success' ? 'processed' : 'failed',
        reason: status === 'success' ? undefined : (emailError || whatsappError || 'Delivery failed for both channels'),
      });
    }

    // Keep edge cache current for auto-apply coupon checks.
    await _syncCouponsToKV();
    await invalidateBirthdayDashboardCache('runBirthdayCampaignAction');

    return {
      success: true,
      message: `Birthday campaign completed. Processed ${stats.birthdayToday} birthday athletes.`,
      stats,
      recipients,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Birthday campaign failed.',
      stats,
      recipients,
    };
  }
}

export async function runBirthdayCampaignTodayAction(): Promise<BirthdayCampaignResult> {
  return runBirthdayCampaignAction();
}

export async function runUpcomingBirthdayCampaignAction(): Promise<BirthdayCampaignResult> {
  const targetDate = addDays(new Date(), 1);
  return runBirthdayCampaignAction(toYmd(targetDate));
}

async function getBirthdayCampaignStatusByOffset(daysAhead: number): Promise<TodayBirthdayCampaignStatus> {
  const targetDate = addDays(new Date(), daysAhead);
  const year = targetDate.getFullYear();
  const monthDay = getTodayMonthDay(targetDate);

  const items: TodayBirthdayCampaignEntry[] = [];
  let processed = 0;
  let failed = 0;
  let notSent = 0;

  try {
    const users = await getBirthdayAthletesLite();
    const campaignMap = await getCampaignRunMapByYear(year);

    for (const user of users) {
      const uid = user.uid;
      const dobValue = String(user?.dob || '').trim();
      const dobMonthDay = normalizeDobMonthDay(dobValue);
      if (!dobMonthDay || dobMonthDay !== monthDay) continue;

      const email = String(user?.email || '').trim().toLowerCase();
      const name = String(user?.name || 'Athlete').trim();
      const mobile = String(user?.mobile || '').trim() || null;
      const campaign = campaignMap.get(uid) || null;
      const couponCode: string | null = campaign?.couponCode ? String(campaign.couponCode) : null;

      let status: 'processed' | 'failed' | 'not_sent' = 'not_sent';
      const campaignStatus = String(campaign?.status || '');
      const emailSent = !!campaign?.emailSent;
      const whatsappSent = !!campaign?.whatsappSent;
      const hasAnyDelivery = emailSent || whatsappSent;

      let reason: string | undefined;
      if (hasAnyDelivery) {
        status = 'processed';
        processed++;

        // Don't mark whole row as failure when one channel succeeded.
        if (!emailSent && campaign?.emailError) {
          reason = `Email issue: ${String(campaign.emailError).trim()}`;
        } else if (!whatsappSent && campaign?.whatsappError) {
          reason = `WhatsApp issue: ${String(campaign.whatsappError).trim()}`;
        }
      } else if (campaignStatus === 'failed' || campaign) {
        status = 'failed';
        failed++;
        reason = String(campaign?.emailError || campaign?.whatsappError || 'Delivery failed for both channels').trim();
      } else {
        status = 'not_sent';
        notSent++;
      }

      items.push({
        uid,
        name,
        email,
        mobile,
        dob: dobValue || null,
        couponCode,
        status,
        emailSent,
        whatsappSent,
        reason,
      });
    }

    items.sort((a, b) => a.name.localeCompare(b.name));

    return {
      success: true,
      message: `Found ${items.length} birthday athlete(s) for ${daysAhead === 0 ? 'today' : `${daysAhead} day(s) ahead`}.`,
      date: targetDate.toISOString().slice(0, 10),
      daysAhead,
      birthdayToday: items.length,
      processed,
      failed,
      notSent,
      items,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || 'Failed to load today birthday status.',
      date: targetDate.toISOString().slice(0, 10),
      daysAhead,
      birthdayToday: items.length,
      processed,
      failed,
      notSent,
      items,
    };
  }
}

export async function getTodayBirthdayCampaignStatusAction(): Promise<TodayBirthdayCampaignStatus> {
  return getBirthdayCampaignStatusByOffset(0);
}

export async function getUpcomingBirthdayCampaignStatusAction(): Promise<TodayBirthdayCampaignStatus> {
  return getBirthdayCampaignStatusByOffset(1);
}

function createEmptyStatus(targetDate: Date, daysAhead: number): TodayBirthdayCampaignStatus {
  return {
    success: true,
    message: 'No data yet.',
    date: targetDate.toISOString().slice(0, 10),
    daysAhead,
    birthdayToday: 0,
    processed: 0,
    failed: 0,
    notSent: 0,
    items: [],
  };
}

function getBirthdayDashboardCacheKey(baseDate: Date = new Date()): string {
  const today = baseDate.toISOString().slice(0, 10);
  const upcoming = addDays(baseDate, 1).toISOString().slice(0, 10);
  return `birthday:dashboard:${today}:${upcoming}`;
}

async function invalidateBirthdayDashboardCache(source: string): Promise<void> {
  await deleteKV(getBirthdayDashboardCacheKey(), source);
}

export async function getBirthdayCampaignDashboardStatusAction(): Promise<BirthdayCampaignDashboardStatus> {
  const now = new Date();
  const upcomingDate = addDays(now, 1);
  const todayMonthDay = getTodayMonthDay(now);
  const upcomingMonthDay = getTodayMonthDay(upcomingDate);

  const todayStatus = createEmptyStatus(now, 0);
  const upcomingStatus = createEmptyStatus(upcomingDate, 1);
  const actionName = 'getBirthdayCampaignDashboardStatusAction';
  const cacheKey = getBirthdayDashboardCacheKey(now);

  try {
    const cached = await getKV<BirthdayCampaignDashboardStatus>(cacheKey, actionName);
    if (cached) {
      return cached;
    }

    const users = await getBirthdayAthletesLite();
    const todayYear = now.getFullYear();
    const upcomingYear = upcomingDate.getFullYear();
    const todayCampaignMap = await getCampaignRunMapByYear(todayYear);
    const upcomingCampaignMap = upcomingYear === todayYear
      ? todayCampaignMap
      : await getCampaignRunMapByYear(upcomingYear);

    for (const user of users) {
      const uid = user.uid;
      const dobValue = String(user?.dob || '').trim();
      const dobMonthDay = normalizeDobMonthDay(dobValue);
      if (!dobMonthDay) continue;

      let target: TodayBirthdayCampaignStatus | null = null;
      let campaignMap: Map<string, any> = todayCampaignMap;

      if (dobMonthDay === todayMonthDay) {
        target = todayStatus;
        campaignMap = todayCampaignMap;
      } else if (dobMonthDay === upcomingMonthDay) {
        target = upcomingStatus;
        campaignMap = upcomingCampaignMap;
      }

      if (!target) continue;

      const email = String(user?.email || '').trim().toLowerCase();
      const name = String(user?.name || 'Athlete').trim();
      const mobile = String(user?.mobile || '').trim() || null;
      const campaign = campaignMap.get(uid) || null;
      const couponCode: string | null = campaign?.couponCode ? String(campaign.couponCode) : null;

      let status: 'processed' | 'failed' | 'not_sent' = 'not_sent';
      const campaignStatus = String(campaign?.status || '');
      const emailSent = !!campaign?.emailSent;
      const whatsappSent = !!campaign?.whatsappSent;
      const hasAnyDelivery = emailSent || whatsappSent;

      let reason: string | undefined;
      if (hasAnyDelivery) {
        status = 'processed';
        target.processed++;

        // Surface channel-specific issue without treating overall send as failed.
        if (!emailSent && campaign?.emailError) {
          reason = `Email issue: ${String(campaign.emailError).trim()}`;
        } else if (!whatsappSent && campaign?.whatsappError) {
          reason = `WhatsApp issue: ${String(campaign.whatsappError).trim()}`;
        }
      } else if (campaignStatus === 'failed' || campaign) {
        status = 'failed';
        target.failed++;
        reason = String(campaign?.emailError || campaign?.whatsappError || 'Delivery failed for both channels').trim();
      } else {
        target.notSent++;
      }

      target.items.push({
        uid,
        name,
        email,
        mobile,
        dob: dobValue || null,
        couponCode,
        status,
        emailSent,
        whatsappSent,
        reason,
      });
    }

    todayStatus.items.sort((a, b) => a.name.localeCompare(b.name));
    upcomingStatus.items.sort((a, b) => a.name.localeCompare(b.name));
    todayStatus.birthdayToday = todayStatus.items.length;
    upcomingStatus.birthdayToday = upcomingStatus.items.length;
    todayStatus.message = `Found ${todayStatus.items.length} birthday athlete(s) for today.`;
    upcomingStatus.message = `Found ${upcomingStatus.items.length} birthday athlete(s) for 1 day ahead.`;

    const response = {
      success: true,
      message: 'Birthday dashboard status loaded.',
      today: todayStatus,
      upcoming: upcomingStatus,
    };

    await putKV(cacheKey, response, actionName);
    return response;
  } catch (error: any) {
    todayStatus.success = false;
    upcomingStatus.success = false;
    const message = error?.message || 'Failed to load birthday dashboard status.';
    todayStatus.message = message;
    upcomingStatus.message = message;

    return {
      success: false,
      message,
      today: todayStatus,
      upcoming: upcomingStatus,
    };
  }
}
