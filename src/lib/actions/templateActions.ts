// src/lib/actions/templateActions.ts
'use server';

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { sendNotification, renderTemplate, renderAiSensyTemplate } from '@/lib/services/templateService';
import type { NotificationTemplate } from '@/lib/services/templateService';

const CATEGORY_BY_KEY: Record<string, string> = {
  legacy_admin_notification_email: 'admin',
  legacy_admin_ticket_sale_notification_email: 'admin',

  legacy_bike_checkout_otp_email: 'auth',
  legacy_otp_email: 'auth',
  legacy_otp_whatsapp: 'auth',
  legacy_volunteer_checkin_otp_whatsapp: 'auth',
  legacy_waiver_otp_email: 'auth',
  legacy_welcome_email: 'auth',
  otp_email: 'auth',

  admin_cancellation_notice_email: 'cancellation',
  legacy_cancellation_confirmation_email: 'cancellation',
  legacy_cancellation_confirmation_whatsapp: 'cancellation',
  legacy_refund_initiated_whatsapp: 'cancellation',

  category_change_email: 'category_change',
  category_change_whatsapp: 'category_change',
  legacy_admin_category_change_email: 'category_change',
  legacy_athlete_category_change_email: 'category_change',

  athlete_club_removal_email: 'club',
  legacy_club_affiliation_notice_email: 'club',
  legacy_club_affiliation_notice_whatsapp: 'club',
  legacy_club_athlete_registration_email: 'club',
  legacy_club_athlete_registration_whatsapp: 'club',
  legacy_club_registration_confirmation_email: 'club',

  deferral_email: 'deferral',
  deferral_whatsapp: 'deferral',
  legacy_deferral_confirmation_email: 'deferral',
  legacy_monthly_deferral_reminder_email: 'deferral',

  invoice_email: 'invoice',
  invoice_whatsapp: 'invoice',
  service_fee_invoice_whatsapp: 'invoice',

  legacy_bike_checkin_whatsapp: 'other',
  legacy_bike_checkout_whatsapp: 'other',
  legacy_bike_checkout_reminder_whatsapp: 'other',
  legacy_bike_rack_assignment_email: 'other',
  legacy_bike_rack_assignment_whatsapp: 'other',
  legacy_feedback_coupon_email: 'other',
  legacy_food_order_confirmation_email: 'other',
  legacy_locker_assignment_email: 'other',
  legacy_locker_assignment_whatsapp: 'other',
  legacy_locker_return_email: 'other',
  legacy_locker_return_whatsapp: 'other',

  legacy_incomplete_registration_email: 'registration',
  legacy_incomplete_registration_whatsapp: 'registration',
  legacy_registration_confirmation_email: 'registration',
  legacy_registration_confirmation_usd_email: 'registration',
  legacy_waiver_checked_in_email: 'registration',
  legacy_waiver_checked_in_whatsapp: 'registration',
  registration_email: 'registration',
  registration_whatsapp: 'registration',

  legacy_store_admin_order_alert_email: 'store',
  legacy_store_order_confirmed_email: 'store',
  legacy_store_order_confirmed_whatsapp: 'store',
  legacy_store_order_shipped_email: 'store',
  legacy_store_order_shipped_whatsapp: 'store',

  legacy_contact_enquiry_ack_email: 'support',
  legacy_contact_enquiry_admin_email: 'support',

  work_with_bergman_accepted_email: 'work_with_bergman',
  work_with_bergman_payment_email: 'work_with_bergman',
  workbergmanpaymentprocesed: 'work_with_bergman',
  work_with_bergman_accepted_whatsapp: 'work_with_bergman',
};

const AISENSY_CAMPAIGN_BY_KEY: Record<string, string> = {
  legacy_otp_whatsapp: 'otp1',
  legacy_volunteer_checkin_otp_whatsapp: 'otp1',
  legacy_cancellation_confirmation_whatsapp: 'bergmanregcan',
  legacy_refund_initiated_whatsapp: 'bmcanrefund',
  category_change_whatsapp: 'bmlogcatchan1',
  legacy_club_affiliation_notice_whatsapp: 'clubaffliation',
  legacy_club_athlete_registration_whatsapp: 'clubparticipantreg',
  deferral_whatsapp: 'bmdeferral1',
  invoice_whatsapp: 'invoice',
  service_fee_invoice_whatsapp: 'Invoice def',
  legacy_bike_checkin_whatsapp: 'bikecheckin4',
  legacy_bike_checkout_whatsapp: 'bikecheckout1',
  legacy_bike_checkout_reminder_whatsapp: 'bikecheckoutreminder',
  legacy_bike_rack_assignment_whatsapp: 'bikerack',
  legacy_locker_assignment_whatsapp: 'locker3',
  legacy_locker_return_whatsapp: 'lockerreturn',
  legacy_incomplete_registration_whatsapp: 'potentialregistration',
  legacy_waiver_checked_in_whatsapp: 'waiverchecked1',
  registration_whatsapp: 'bmregconf',
  legacy_store_order_confirmed_whatsapp: 'bergman_store_invoice',
  legacy_store_order_shipped_whatsapp: 'bergman_order_shipped',
};

// Keys that must be whatsapp channel — anything ending in _whatsapp or in the AiSensy map
const WHATSAPP_KEYS = new Set<string>([
  ...Object.keys(AISENSY_CAMPAIGN_BY_KEY),
  // non-legacy whatsapp keys that don't end in _whatsapp but are WA channel
]);

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getAllTemplatesAction(): Promise<{
  success: boolean;
  templates?: NotificationTemplate[];
  message?: string;
}> {
  try {
    const db = getFirestoreInstance();
    await syncMissingLegacyTemplates(db);
    const snap = await db.collection('templates').orderBy('category').get();
    const templates = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as NotificationTemplate))
      .sort((a, b) => `${a.category}_${a.name}`.localeCompare(`${b.category}_${b.name}`));
    return { success: true, templates };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export type BergTechnoIntegrationInput = {
  apiBaseUrl: string;
  apiKey?: string;
  senderEmail?: string;
  senderName?: string;
  apiKeyHeader?: string;
  templateSendPath?: string;
  rawSendPath?: string;
  timeoutMs?: number;
  webhookUrl?: string;
  webhookEvents?: string[];
  webhookActive?: boolean;
};

const DEFAULT_BERGTECHNO_WEBHOOK_URL = 'https://raceupshot.com/api/webhooks/bergtecno';
const DEFAULT_BERGTECHNO_WEBHOOK_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.unsubscribed',
  'email.bounced',
  'email.spam',
];

export type BergTechnoDeliveryLog = {
  id: string;
  event: string;
  status: string;
  recipient: string;
  messageId: string;
  createdAt: string;
};

export async function getBergTechnoIntegrationAction(): Promise<{
  success: boolean;
  data?: {
    provider: 'bergtechno';
    apiBaseUrl: string;
    senderEmail: string;
    senderName: string;
    apiKeyHeader: string;
    templateSendPath: string;
    rawSendPath: string;
    timeoutMs: number;
    hasApiKey: boolean;
    apiKeyMasked: string;
    webhookUrl: string;
    webhookEvents: string[];
    webhookActive: boolean;
  };
  message?: string;
}> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('settings').doc('integration').get();
    const root = (snap.data() || {}) as any;
    const data = (root.bergTechnoEmail || {}) as any;
    const webhookData = (root.bergTechnoWebhook || {}) as any;

    const apiKey = String(data.apiKey || '').trim();
    const masked = apiKey ? `••••••${apiKey.slice(-4)}` : '';

    return {
      success: true,
      data: {
        provider: 'bergtechno',
        apiBaseUrl: String(data.apiBaseUrl || process.env.BERGTECHNO_EMAIL_API_BASE_URL || process.env.BERGTECNO_EMAIL_API_BASE_URL || ''),
        senderEmail: String(data.senderEmail || process.env.BERGTECHNO_SENDER_EMAIL || process.env.BERGTECNO_SENDER_EMAIL || process.env.BREVO_SENDER_EMAIL || 'info@bergmantri.com'),
        senderName: String(data.senderName || process.env.BERGTECHNO_SENDER_NAME || process.env.BERGTECNO_SENDER_NAME || process.env.BREVO_SENDER_NAME || 'Bergman Triathlon'),
        apiKeyHeader: String(data.apiKeyHeader || process.env.BERGTECHNO_EMAIL_API_KEY_HEADER || process.env.BERGTECNO_EMAIL_API_KEY_HEADER || 'x-api-key'),
        templateSendPath: String(data.templateSendPath || process.env.BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH || process.env.BERGTECNO_EMAIL_TEMPLATE_SEND_PATH || '/email/send-template'),
        rawSendPath: String(data.rawSendPath || process.env.BERGTECHNO_EMAIL_RAW_SEND_PATH || process.env.BERGTECNO_EMAIL_RAW_SEND_PATH || '/email/send'),
        timeoutMs: Number(data.timeoutMs || process.env.BERGTECHNO_EMAIL_TIMEOUT_MS || process.env.BERGTECNO_EMAIL_TIMEOUT_MS || 15000),
        hasApiKey: !!apiKey,
        apiKeyMasked: masked,
        webhookUrl: String(webhookData.url || DEFAULT_BERGTECHNO_WEBHOOK_URL),
        webhookEvents: Array.isArray(webhookData.events) && webhookData.events.length > 0
          ? webhookData.events.map((x: unknown) => String(x).trim()).filter(Boolean)
          : [...DEFAULT_BERGTECHNO_WEBHOOK_EVENTS],
        webhookActive: webhookData.active !== false,
      },
    };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to load integration settings.' };
  }
}

export async function getBergTechnoDeliveryLogsAction(limit = 100): Promise<{
  success: boolean;
  logs?: BergTechnoDeliveryLog[];
  message?: string;
}> {
  try {
    const db = getFirestoreInstance();
    const snap = await db
      .collection('bergtechnoWebhookLogs')
      .orderBy('createdAt', 'desc')
      .limit(Math.max(1, Math.min(500, Number(limit) || 100)))
      .get();

    const logs: BergTechnoDeliveryLog[] = snap.docs.map((doc) => {
      const d = doc.data() as any;
      const createdAt = d?.createdAt?.toDate
        ? d.createdAt.toDate().toISOString()
        : (typeof d?.createdAt === 'string' ? d.createdAt : new Date().toISOString());

      return {
        id: doc.id,
        event: String(d?.event || 'unknown'),
        status: String(d?.status || d?.event || 'received'),
        recipient: String(d?.recipient || d?.to || 'N/A'),
        messageId: String(d?.messageId || d?.message_id || d?.id || 'N/A'),
        createdAt,
      };
    });

    return { success: true, logs };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to load delivery logs.' };
  }
}

export async function clearBergTechnoDeliveryLogsAction(): Promise<{ success: boolean; message: string }> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('bergtechnoWebhookLogs').limit(500).get();
    if (snap.empty) return { success: true, message: 'No delivery logs to delete.' };

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    return { success: true, message: `Deleted ${snap.size} delivery log(s).` };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to delete delivery logs.' };
  }
}

export async function saveBergTechnoIntegrationAction(
  input: BergTechnoIntegrationInput
): Promise<{ success: boolean; message: string }> {
  try {
    const apiBaseUrl = String(input.apiBaseUrl || '').trim();
    if (!/^https?:\/\//i.test(apiBaseUrl)) {
      return { success: false, message: 'API base URL must start with http:// or https://.' };
    }

    const senderEmail = String(input.senderEmail || '').trim();
    if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      return { success: false, message: 'Sender email is invalid.' };
    }

    const timeoutMs = Math.max(1000, Number(input.timeoutMs || 15000));

    const db = getFirestoreInstance();
    const ref = db.collection('settings').doc('integration');
    const existing = await ref.get();
    const prev = (existing.data()?.bergTechnoEmail || {}) as Record<string, unknown>;
    const prevWebhook = (existing.data()?.bergTechnoWebhook || {}) as Record<string, unknown>;

    const apiKey = String(input.apiKey || '').trim();

    const webhookUrl = String(input.webhookUrl || prevWebhook.url || DEFAULT_BERGTECHNO_WEBHOOK_URL).trim() || DEFAULT_BERGTECHNO_WEBHOOK_URL;
    const webhookEvents = Array.isArray(input.webhookEvents) && input.webhookEvents.length > 0
      ? input.webhookEvents.map((x) => String(x).trim()).filter(Boolean)
      : (Array.isArray(prevWebhook.events) && prevWebhook.events.length > 0
          ? (prevWebhook.events as unknown[]).map((x) => String(x).trim()).filter(Boolean)
          : [...DEFAULT_BERGTECHNO_WEBHOOK_EVENTS]);
    const webhookActive = input.webhookActive === undefined
      ? (prevWebhook.active !== false)
      : !!input.webhookActive;

    await ref.set(
      {
        emailProvider: 'bergtechno',
        bergTechnoEmail: {
          ...prev,
          apiBaseUrl,
          senderEmail: senderEmail || 'info@bergmantri.com',
          senderName: String(input.senderName || '').trim() || 'Bergman Triathlon',
          apiKeyHeader: String(input.apiKeyHeader || '').trim() || 'x-api-key',
          templateSendPath: String(input.templateSendPath || '').trim() || '/email/send-template',
          rawSendPath: String(input.rawSendPath || '').trim() || '/email/send',
          timeoutMs,
          ...(apiKey ? { apiKey } : {}),
          enabled: true,
          updatedAt: new Date().toISOString(),
        },
        bergTechnoWebhook: {
          ...prevWebhook,
          url: webhookUrl,
          events: webhookEvents,
          active: webhookActive,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return { success: true, message: 'BergTechno integration settings saved.' };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to save integration settings.' };
  }
}

export async function testBergTechnoConnectionAction(input?: {
  apiBaseUrl?: string;
  apiKey?: string;
  apiKeyHeader?: string;
}): Promise<{ success: boolean; connected: boolean; message: string; checkedUrl?: string }> {
  try {
    const baseInput = String(input?.apiBaseUrl || '').trim();

    let apiBaseUrl = baseInput;
    let apiKey = String(input?.apiKey || '').trim();
    let apiKeyHeader = String(input?.apiKeyHeader || '').trim() || 'x-api-key';

    if (!apiBaseUrl || !apiKey) {
      const db = getFirestoreInstance();
      const snap = await db.collection('settings').doc('integration').get();
      const data = (snap.data()?.bergTechnoEmail || {}) as Record<string, any>;

      apiBaseUrl = apiBaseUrl || String(data.apiBaseUrl || process.env.BERGTECHNO_EMAIL_API_BASE_URL || process.env.BERGTECNO_EMAIL_API_BASE_URL || '').trim();
      apiKey = apiKey || String(data.apiKey || process.env.BERGTECHNO_EMAIL_API_KEY || process.env.BERGTECNO_EMAIL_API_KEY || '').trim();
      apiKeyHeader = apiKeyHeader || String(data.apiKeyHeader || process.env.BERGTECHNO_EMAIL_API_KEY_HEADER || process.env.BERGTECNO_EMAIL_API_KEY_HEADER || 'x-api-key').trim();
    }

    if (!apiBaseUrl) return { success: false, connected: false, message: 'API base URL is not configured.' };
    if (!apiKey) return { success: false, connected: false, message: 'API key is not configured.' };

    const cleanBase = apiBaseUrl.replace(/\/+$/, '');
    const origin = cleanBase.replace(/\/api$/i, '');
    // Try multiple candidate URLs — any HTTP response (even 404/401) means the server IS reachable.
    const checkUrls = [
      `${origin}/health`,
      `${cleanBase}/health`,
      `${origin}/status`,
      `${cleanBase}/status`,
      cleanBase,
      origin,
    ];

    const authHeaders: Record<string, string> = apiKeyHeader.toLowerCase() === 'authorization'
      ? { Authorization: apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}` }
      : { [apiKeyHeader]: apiKey };

    for (const url of checkUrls) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            ...authHeaders,
            Accept: 'application/json, text/plain;q=0.9,*/*;q=0.8',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        // ANY HTTP response (including 4xx) means the server is reachable → Connected.
        return {
          success: true,
          connected: true,
          message: `Connected (HTTP ${res.status})`,
          checkedUrl: url,
        };
      } catch {
        // Network error or timeout on this URL — try next
      }
    }

    return { success: true, connected: false, message: 'Server unreachable. Check the API base URL and your network.' };
  } catch (e: any) {
    return { success: false, connected: false, message: e.message || 'Connection check failed.' };
  }
}

// ─── Write ──────────────────────────────────────────────────────────────────

export async function saveTemplateAction(
  data: Omit<NotificationTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version'>
): Promise<{ success: boolean; message?: string }> {
  try {
    if (!data.key || !/^[a-z0-9_]+$/.test(data.key)) {
      return { success: false, message: 'Key must be lowercase letters, numbers, and underscores only.' };
    }

    if (data.channel === 'whatsapp') {
      if (!data.aisensyCampaignName || !data.aisensyCampaignName.trim()) {
        return { success: false, message: 'AiSensy campaign name is required for WhatsApp templates.' };
      }
    }

    if (data.channel === 'email') {
      const hasBrevoTemplateId = !!(data.brevoTemplateId && data.brevoTemplateId > 0);
      const hasRawHtml = !!(data.content && data.content.trim());
      if (!hasBrevoTemplateId && !hasRawHtml) {
        return { success: false, message: 'For email templates, set a provider template ID (legacy field: brevoTemplateId) or provide raw HTML content.' };
      }
    }

    const db = getFirestoreInstance();
    const ref = db.collection('templates').doc(data.key);
    const existing = await ref.get();

    const now = new Date().toISOString();

    if (existing.exists) {
      await ref.update({
        ...data,
        version: FieldValue.increment(1),
        updatedAt: now,
      });
    } else {
      await ref.set({
        ...data,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { success: true, message: 'Template saved.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteTemplateAction(key: string): Promise<{ success: boolean; message?: string }> {
  try {
    const db = getFirestoreInstance();
    await db.collection('templates').doc(key).delete();
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ─── Test send ───────────────────────────────────────────────────────────────

export async function testSendTemplateAction({
  templateKey,
  to,
  sampleParams,
}: {
  templateKey: string;
  to: string;
  sampleParams: Record<string, any>;
}): Promise<{ success: boolean; message?: string }> {
  const result = await sendNotification({ templateKey, to, params: sampleParams });
  if (!result.success) {
    console.error(`[testSendTemplateAction] Failed for template "${templateKey}" to "${to}": ${result.message}`);
  }
  return result;
}

// ─── Preview render (server action so Handlebars runs server-side) ───────────

export async function renderPreviewAction(
  content: string,
  subject: string,
  sampleParams: Record<string, any>,
  channel?: string,
  aisensyParamKeys?: string[]
): Promise<{ html: string; subject: string }> {
  if (channel === 'whatsapp' && aisensyParamKeys?.length) {
    // Resolve each key path from sampleParams to get ordered values for {{1}}, {{2}}...
    const values = aisensyParamKeys.map(keyPath => {
      const val = keyPath.split('.').reduce((obj: any, k: string) => obj?.[k], { params: sampleParams });
      return val !== undefined && val !== null ? String(val) : `[${keyPath}]`;
    });
    return {
      html: renderAiSensyTemplate(content, values),
      subject: '',
    };
  }
  return {
    html: renderTemplate(content, sampleParams),
    subject: renderTemplate(subject || '', sampleParams),
  };
}

function createLegacyEmailTemplate(
  now: string,
  {
    key,
    name,
    category,
    brevoTemplateId,
    variables,
    subject,
    content,
  }: {
    key: string;
    name: string;
    category: string;
    brevoTemplateId: number;
    variables: string[];
    subject?: string;
    content?: string;
  }
): Omit<NotificationTemplate, 'id'> {
  return {
    key,
    name,
    category,
    subCategory: 'legacy',
    channel: 'email',
    brevoTemplateId,
    subject: subject ?? `Legacy Email Template #${brevoTemplateId}`,
    content:
      content ??
      `<div style="font-family:Arial,sans-serif;padding:24px;"><h2>${name}</h2><p>This is a legacy dynamic template.</p><p><strong>Template ID:</strong> ${brevoTemplateId}</p><p><strong>Variables:</strong> ${variables.join(', ')}</p></div>`,
    variables,
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function createLegacyWhatsAppTemplate(
  now: string,
  {
    key,
    name,
    category,
    campaignName,
    paramKeys,
    content,
  }: {
    key: string;
    name: string;
    category: string;
    campaignName: string;
    paramKeys: string[];
    content?: string;
  }
): Omit<NotificationTemplate, 'id'> {
  return {
    key,
    name,
    category,
    subCategory: 'legacy',
    channel: 'whatsapp',
    content: content ?? `Legacy AiSensy template: ${campaignName}\nVariables: ${paramKeys.join(', ')}`,
    variables: paramKeys,
    aisensyCampaignName: campaignName,
    aisensyParamKeys: paramKeys,
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
  function createLegacyOtpWhatsAppTemplate(
    now: string,
    opts: { key: string; name: string; category: string; campaignName: string }
  ): Omit<NotificationTemplate, 'id'> {
    return {
      key: opts.key,
      name: opts.name,
      category: opts.category,
      subCategory: 'legacy',
      channel: 'whatsapp',
      content: 'Your OTP is {{1}}',
      variables: ['params.otp'],
      aisensyCampaignName: opts.campaignName,
      aisensyParamKeys: ['params.otp'],
      aisensyOtpButton: true,
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Template keys that use OTP-button style campaigns (need button URL param)
  const OTP_BUTTON_KEYS = new Set([
    'legacy_otp_whatsapp',
    'legacy_volunteer_checkin_otp_whatsapp',
    'otp_whatsapp',
  ]);

function getLegacyTemplates(now: string): Omit<NotificationTemplate, 'id'>[] {
  return [
    createLegacyEmailTemplate(now, { key: 'legacy_otp_email', name: 'Legacy OTP Email', category: 'auth', brevoTemplateId: 178, variables: ['params.otp', 'params.name'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_waiver_otp_email', name: 'Legacy Waiver OTP Email', category: 'auth', brevoTemplateId: 174, variables: ['params.otp', 'params.name'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_bike_checkout_otp_email', name: 'Legacy Bike Checkout OTP Email', category: 'auth', brevoTemplateId: 224, variables: ['params.otp', 'params.name'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_registration_confirmation_email', name: 'Legacy Registration Confirmation Email', category: 'registration', brevoTemplateId: 199, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.eventdate', 'params.address', 'params.phone', 'params.email', 'params.emergencynumber', 'params.time', 'params.booking_id', 'params.booking_date', 'params.event_venue', 'params.invoice_number', 'params.bib_number', 'params.category', 'params.day', 'params.date', 'params.organizer_name', 'params.company_description', 'params.organizer_address', 'params.country'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_registration_confirmation_usd_email', name: 'Legacy Registration Confirmation USD Email', category: 'registration', brevoTemplateId: 243, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.eventdate', 'params.address', 'params.phone', 'params.email', 'params.emergencynumber', 'params.time', 'params.booking_id', 'params.booking_date', 'params.event_venue', 'params.invoice_number', 'params.bib_number', 'params.category', 'params.day', 'params.date', 'params.organizer_name', 'params.company_description', 'params.organizer_address', 'params.country'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_waiver_checked_in_email', name: 'Legacy Waiver Checked-In Email', category: 'registration', brevoTemplateId: 188, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.eventdate', 'params.address', 'params.phone', 'params.email', 'params.emergencynumber', 'params.emergency_number', 'params.emergency_contact', 'params.day', 'params.date', 'params.time', 'params.organizer_name', 'params.company_description', 'params.organizer_address', 'params.country', 'params.EVENT_NAME'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_cancellation_confirmation_email', name: 'Legacy Cancellation Confirmation Email', category: 'cancellation', brevoTemplateId: 201, variables: ['params.eventname', 'params.name', 'params.amount'] }),
    {
      key: 'admin_cancellation_notice_email',
      name: 'Admin Cancellation Notice Email',
      category: 'cancellation',
      channel: 'email',
      subject: 'Cancellation Notice for {{params.eventName}}',
      content: '<p>Hello {{params.athleteName}},</p><p>This is to inform you that your registration for <strong>{{params.eventName}}</strong> has been cancelled by the administrator.</p>{{#if params.reason}}<p><strong>Reason provided:</strong> {{params.reason}}</p>{{/if}}<p>If you have any questions, please contact our support team.</p><p>Regards,<br/>The Bergman Team</p>',
      variables: ['params.athleteName', 'params.eventName', 'params.reason'],
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    createLegacyEmailTemplate(now, { key: 'legacy_deferral_confirmation_email', name: 'Legacy Deferral Confirmation Email', category: 'deferral', brevoTemplateId: 191, variables: ['params.name', 'params.eventname', 'params.deferred_event'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_incomplete_registration_email', name: 'Legacy Incomplete Registration Email', category: 'registration', brevoTemplateId: 203, variables: ['params.name', 'params.eventname', 'params.redirectUrl'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_club_affiliation_notice_email', name: 'Legacy Club Affiliation Notice Email', category: 'club', brevoTemplateId: 205, variables: ['params.clubName', 'params.name'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_monthly_deferral_reminder_email', name: 'Legacy Monthly Deferral Reminder Email', category: 'deferral', brevoTemplateId: 207, variables: ['params.name'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_club_registration_confirmation_email', name: 'Legacy Club Registration Confirmation Email', category: 'club', brevoTemplateId: 208, variables: ['params.name', 'params.clubName'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_welcome_email', name: 'Legacy Welcome Email', category: 'auth', brevoTemplateId: 214, variables: ['params.name'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_admin_category_change_email', name: 'Legacy Admin Category Change Email', category: 'category_change', brevoTemplateId: 217, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.changedticket'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_athlete_category_change_email', name: 'Legacy Athlete Category Change Email', category: 'category_change', brevoTemplateId: 255, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.changedticket'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_admin_notification_email', name: 'Legacy Admin Notification Email', category: 'admin', brevoTemplateId: 215, variables: ['params.subject', 'params.message'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_club_athlete_registration_email', name: 'Legacy Club Athlete Registration Email', category: 'club', brevoTemplateId: 221, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.event_venue', 'params.eventdate'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_locker_assignment_email', name: 'Legacy Locker Assignment Email', category: 'other', brevoTemplateId: 223, variables: ['params.name', 'params.bib_number', 'params.lockerno'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_locker_return_email', name: 'Legacy Locker Return Email', category: 'other', brevoTemplateId: 224, variables: ['params.name', 'params.lockerno'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_food_order_confirmation_email', name: 'Legacy Food Order Confirmation Email', category: 'other', brevoTemplateId: 25, variables: ['params.name', 'params.orderid', 'params.items', 'params.amount', 'params.quantity', 'params.number'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_bike_rack_assignment_email', name: 'Legacy Bike Rack Assignment Email', category: 'other', brevoTemplateId: 234, variables: ['params.name', 'params.event', 'params.bibno', 'params.rack', 'params.eventdate', 'params.location'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_contact_enquiry_ack_email', name: 'Legacy Contact Enquiry Ack Email', category: 'support', brevoTemplateId: 246, variables: ['params.fullName', 'params.ticketId', 'params.email', 'params.mobile', 'params.message', 'params.addTags'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_contact_enquiry_admin_email', name: 'Legacy Contact Enquiry Admin Email', category: 'support', brevoTemplateId: 247, variables: ['params.ticketId', 'params.email', 'params.mobile', 'params.message'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_feedback_coupon_email', name: 'Legacy Feedback Coupon Email', category: 'other', brevoTemplateId: 250, variables: ['params.name', 'params.couponCode', 'params.eventname'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_store_order_shipped_email', name: 'Legacy Store Order Shipped Email', category: 'store', brevoTemplateId: 251, variables: ['params.email', 'params.customer_name', 'params.order_id', 'params.courier_name', 'params.tracking_id', 'params.tracking_url'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_store_order_confirmed_email', name: 'Legacy Store Order Confirmed Email', category: 'store', brevoTemplateId: 252, variables: ['params.email', 'params.customer_name', 'params.order_id', 'params.order_date', 'params.product_summary', 'params.total_amount', 'params.payment_method', 'params.order_details_url', 'params.support_email'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_store_admin_order_alert_email', name: 'Legacy Store Admin Order Alert Email', category: 'store', brevoTemplateId: 253, variables: ['params.customer_name', 'params.order_id', 'params.order_date', 'params.product_summary', 'params.total_amount', 'params.shipping_address', 'params.email', 'params.mobile'] }),
    createLegacyEmailTemplate(now, { key: 'legacy_admin_ticket_sale_notification_email', name: 'Legacy Admin Ticket Sale Notification Email', category: 'admin', brevoTemplateId: 254, variables: ['params.name', 'params.eventname', 'params.ticket', 'params.booking_id', 'params.booking_date', 'params.eventdate', 'params.event_venue', 'params.bib_number', 'params.address', 'params.phone', 'params.email', 'params.emergency_number', 'params.day', 'params.date', 'params.organizer_name', 'params.company_description', 'params.organizer_address', 'params.country', 'params.invoice_number', 'params.category'] }),
    {
      key: 'athlete_club_removal_email',
      name: 'Athlete Club Removal Email',
      category: 'club',
      channel: 'email',
      subject: 'Club Affiliation Removed: {{params.clubName}}',
      content: '<p>Hello {{params.athleteName}},</p><p>This is to inform you that your affiliation with <strong>{{params.clubName}}</strong> has been removed by the {{params.removedBy}}.</p>{{#if params.reason}}<p><strong>Reason provided:</strong> {{params.reason}}</p>{{/if}}<p>If you have any questions, please contact the club owner.</p><p>Regards,<br/>The Bergman Team</p>',
      variables: ['params.athleteName', 'params.clubName', 'params.removedBy', 'params.removalDate', 'params.reason'],
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    createLegacyWhatsAppTemplate(now, { key: 'legacy_otp_whatsapp', name: 'Legacy OTP WhatsApp', category: 'auth', campaignName: 'otp1', paramKeys: ['params.otp'], content: 'OTP: {{params.otp}}' }),
    createLegacyOtpWhatsAppTemplate(now, { key: 'legacy_otp_whatsapp', name: 'Legacy OTP WhatsApp', category: 'auth', campaignName: 'otp1' }),
    createLegacyOtpWhatsAppTemplate(now, { key: 'legacy_volunteer_checkin_otp_whatsapp', name: 'Legacy Volunteer Check-in OTP WhatsApp', category: 'auth', campaignName: 'otp1' }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_waiver_checked_in_whatsapp', name: 'Legacy Waiver Checked-In WhatsApp', category: 'registration', campaignName: 'waiverchecked1', paramKeys: ['params.name', 'params.event_name', 'params.category'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_bike_checkin_whatsapp', name: 'Legacy Bike Check-in WhatsApp', category: 'other', campaignName: 'bikecheckin4', paramKeys: ['params.name', 'params.checkin_date', 'params.checkin_time', 'params.event_name'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_bike_checkout_whatsapp', name: 'Legacy Bike Check-out WhatsApp', category: 'other', campaignName: 'bikecheckout1', paramKeys: ['params.name', 'params.checkout_date', 'params.checkout_time', 'params.event_name'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_refund_initiated_whatsapp', name: 'Legacy Refund Initiated WhatsApp', category: 'cancellation', campaignName: 'bmcanrefund', paramKeys: ['params.name', 'params.amount', 'params.refund_id', 'params.refund_date'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_bike_checkout_reminder_whatsapp', name: 'Legacy Bike Checkout Reminder WhatsApp', category: 'other', campaignName: 'bikecheckoutreminder', paramKeys: ['params.name', 'params.bib_number'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_incomplete_registration_whatsapp', name: 'Legacy Incomplete Registration WhatsApp', category: 'registration', campaignName: 'potentialregistration', paramKeys: ['params.name', 'params.event_name'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_locker_assignment_whatsapp', name: 'Legacy Locker Assignment WhatsApp', category: 'other', campaignName: 'locker3', paramKeys: ['params.name', 'params.bib_number', 'params.locker_number'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_locker_return_whatsapp', name: 'Legacy Locker Return WhatsApp', category: 'other', campaignName: 'lockerreturn', paramKeys: ['params.name', 'params.locker_number'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_club_affiliation_notice_whatsapp', name: 'Legacy Club Affiliation Notice WhatsApp', category: 'club', campaignName: 'clubaffliation', paramKeys: ['params.owner_name', 'params.name', 'params.club_name'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_cancellation_confirmation_whatsapp', name: 'Legacy Cancellation Confirmation WhatsApp', category: 'cancellation', campaignName: 'bergmanregcan', paramKeys: ['params.name', 'params.event_name'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_club_athlete_registration_whatsapp', name: 'Legacy Club Athlete Registration WhatsApp', category: 'club', campaignName: 'clubparticipantreg', paramKeys: ['params.name', 'params.event_name', 'params.category', 'params.event_date'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_store_order_confirmed_whatsapp', name: 'Legacy Store Order Confirmed WhatsApp', category: 'store', campaignName: 'bergman_store_invoice', paramKeys: ['params.customer_name', 'params.event_name', 'params.invoice_number'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_store_order_shipped_whatsapp', name: 'Legacy Store Order Shipped WhatsApp', category: 'store', campaignName: 'bergman_order_shipped', paramKeys: ['params.customer_name', 'params.order_id', 'params.courier_name', 'params.tracking_id', 'params.tracking_url'] }),
    createLegacyWhatsAppTemplate(now, { key: 'legacy_bike_rack_assignment_whatsapp', name: 'Legacy Bike Rack Assignment WhatsApp', category: 'other', campaignName: 'bikerack', paramKeys: ['params.name', 'params.event_name', 'params.bib_number', 'params.rack_name'] }),
  ];
}

async function syncMissingLegacyTemplates(db: ReturnType<typeof getFirestoreInstance>): Promise<number> {
  const legacyTemplates = getLegacyTemplates(new Date().toISOString());

  // Build a lookup: key → full legacy template (source of truth for metadata)
  const legacyByKey = new Map(legacyTemplates.map(t => [t.key, t]));

  const insertBatch = db.batch();
  let insertedCount = 0;

  for (const template of legacyTemplates) {
    const ref = db.collection('templates').doc(template.key);
    const existing = await ref.get();
    if (!existing.exists) {
      insertBatch.set(ref, template);
      insertedCount += 1;
    }
  }

  if (insertedCount > 0) {
    await insertBatch.commit();
  }

  const metadataBatch = db.batch();
  let metadataUpdates = 0;
  const snap = await db.collection('templates').get();

  for (const doc of snap.docs) {
    const data = doc.data() as Partial<NotificationTemplate>;
    const updates: Record<string, any> = {};

    const expectedCategory = CATEGORY_BY_KEY[doc.id];
    if (expectedCategory && data.category !== expectedCategory) {
      updates.category = expectedCategory;
    }

    const expectedSubCategory = doc.id.startsWith('legacy_') ? 'legacy' : 'current';
    if (data.subCategory !== expectedSubCategory) {
      updates.subCategory = expectedSubCategory;
    }

    const expectedCampaignName = AISENSY_CAMPAIGN_BY_KEY[doc.id];
    const expectedChannel = (WHATSAPP_KEYS.has(doc.id) || doc.id.endsWith('_whatsapp')) ? 'whatsapp' : null;

    if (expectedChannel && data.channel !== expectedChannel) {
      updates.channel = expectedChannel;
    }

    if (
      expectedCampaignName &&
      (data.channel === 'whatsapp' || expectedChannel === 'whatsapp') &&
      data.aisensyCampaignName !== expectedCampaignName
    ) {
      updates.aisensyCampaignName = expectedCampaignName;
    }

    // Patch aisensyParamKeys if missing or empty — use legacy registry as source of truth
    const legacyDef = legacyByKey.get(doc.id);
    if (legacyDef?.aisensyParamKeys?.length && (!data.aisensyParamKeys || data.aisensyParamKeys.length === 0)) {
      updates.aisensyParamKeys = legacyDef.aisensyParamKeys;
    }

      // Patch aisensyOtpButton for OTP campaigns
      if (OTP_BUTTON_KEYS.has(doc.id) && !data.aisensyOtpButton) {
        updates.aisensyOtpButton = true;
      }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString();
      metadataBatch.update(doc.ref, updates);
      metadataUpdates += 1;
    }
  }

  if (metadataUpdates > 0) {
    await metadataBatch.commit();
  }

  return insertedCount;
}

// ─── Seed initial templates ──────────────────────────────────────────────────

export async function seedTemplatesAction(): Promise<{ success: boolean; count: number; message?: string }> {
  try {
    const db = getFirestoreInstance();
    const now = new Date().toISOString();

    const templates: Omit<NotificationTemplate, 'id'>[] = [
      // ─── Invoice email ───────────────────────────────────────────────────
      {
        key: 'invoice_email',
        name: 'Invoice for Participants',
        category: 'invoice',
        channel: 'email',
        subject: 'Invoice for {{params.event_name}}',
        content: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Invoice - {{params.event_name}}</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;margin:20px auto;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#000;color:#fff;padding:20px;text-align:center;">
          <h1 style="margin:0;font-size:20px;letter-spacing:2px;">🏁 BERGMAN EVENTS</h1>
          <p style="margin:5px 0 0;font-size:12px;color:#ccc;">Race. Compete. Conquer.</p>
        </td></tr>
        <tr><td style="padding:20px;text-align:center;">
          <h2 style="margin:0;color:#ff6a00;">🧾 Registration Invoice</h2>
        </td></tr>
        <tr><td style="padding:0 20px 10px;">
          <p style="font-size:14px;color:#333;">Dear <strong>{{params.name}}</strong>,</p>
          <p style="font-size:14px;color:#333;">Your registration for <strong>{{params.event_name}}</strong> is confirmed 🎉</p>
        </td></tr>
        <tr><td style="padding:10px 20px;">
          <table width="100%" style="border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:8px;color:#777;">Invoice Number</td><td style="padding:8px;font-weight:bold;">{{params.invoice_number}}</td></tr>
            <tr><td style="padding:8px;color:#777;">Event</td><td style="padding:8px;font-weight:bold;">{{params.event_name}}</td></tr>
            <tr><td style="padding:8px;color:#777;">Category</td><td style="padding:8px;font-weight:bold;">{{params.category}}</td></tr>
            <tr><td style="padding:8px;color:#777;">Event Date</td><td style="padding:8px;font-weight:bold;">{{params.event_date}}</td></tr>
            <tr><td style="padding:8px;color:#777;">Amount Paid</td><td style="padding:8px;font-weight:bold;color:#ff6a00;">₹{{params.amount}}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:10px 20px;"><hr style="border:none;border-top:1px solid #eee;"></td></tr>
        <tr><td style="padding:0 20px 20px;">
          <p style="font-size:13px;color:#555;">🏊🚴🏃 Get ready to race! Please carry a valid ID and arrive early on race day.</p>
          <p style="font-size:13px;color:#555;">Your invoice is attached to this email for your records.</p>
        </td></tr>
        <tr><td style="padding:0 20px 20px;text-align:center;">
          <a href="{{params.event_link}}" style="display:inline-block;background:#ff6a00;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">View Event Details</a>
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:15px;text-align:center;font-size:12px;color:#777;">
          Deccan Sports Club<br>📧 support@bergmantri.com<br>🌐 www.bergmantri.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        variables: ['params.name', 'params.event_name', 'params.invoice_number', 'params.category', 'params.event_date', 'params.amount', 'params.event_link'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── Registration confirmation email ─────────────────────────────────
      {
        key: 'registration_email',
        name: 'Registration Confirmation Email',
        category: 'registration',
        channel: 'email',
        subject: '🎉 Registration Confirmed - {{params.event_name}}',
        content: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;margin:20px auto;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#000;color:#fff;padding:20px;text-align:center;">
          <h1 style="margin:0;font-size:20px;letter-spacing:2px;">🏁 BERGMAN EVENTS</h1>
        </td></tr>
        <tr><td style="padding:24px;">
          <h2 style="color:#ff6a00;margin-top:0;">Registration Confirmed ✅</h2>
          <p>Dear <strong>{{params.name}}</strong>,</p>
          <p>You are officially registered for <strong>{{params.event_name}}</strong>!</p>
          <table width="100%" style="border-collapse:collapse;font-size:14px;margin:16px 0;">
            <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Booking ID</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">{{params.booking_id}}</td></tr>
            <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Category</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">{{params.category}}</td></tr>
            <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">BIB Number</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">{{params.bib_number}}</td></tr>
            <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Event Date</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">{{params.event_date}}</td></tr>
            <tr><td style="padding:8px;color:#777;">Venue</td><td style="padding:8px;font-weight:bold;">{{params.venue}}</td></tr>
          </table>
          <p style="font-size:13px;color:#555;">🏊🚴🏃 Train hard and see you on race day!</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;padding:15px;text-align:center;font-size:12px;color:#777;">
          Deccan Sports Club · support@bergmantri.com · www.bergmantri.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        variables: ['params.name', 'params.event_name', 'params.booking_id', 'params.category', 'params.bib_number', 'params.event_date', 'params.venue'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── Deferral email ──────────────────────────────────────────────────
      {
        key: 'deferral_email',
        name: 'Deferral Confirmation Email',
        category: 'deferral',
        channel: 'email',
        subject: 'Deferral Confirmed - {{params.event_name}}',
        content: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;margin:20px auto;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#000;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:20px;letter-spacing:2px;">🏁 BERGMAN EVENTS</h1></td></tr>
      <tr><td style="padding:24px;">
        <h2 style="color:#ff6a00;margin-top:0;">Deferral Invoice</h2>
        <p>Dear <strong>{{params.name}}</strong>,</p>
        <p>Your deferral from <strong>{{params.event_name}}</strong> has been processed.</p>
        <table width="100%" style="border-collapse:collapse;font-size:14px;margin:16px 0;">
          <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Invoice Number</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">{{params.invoice_number}}</td></tr>
          <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Deferral Fee</td><td style="padding:8px;font-weight:bold;color:#ff6a00;border-bottom:1px solid #eee;">₹{{params.amount}}</td></tr>
          <tr><td style="padding:8px;color:#777;">Credit Valid Until</td><td style="padding:8px;font-weight:bold;">{{params.expiry_date}}</td></tr>
        </table>
        <p style="font-size:13px;color:#555;">Your race credit will be applied when you register for a future event. Invoice attached.</p>
      </td></tr>
      <tr><td style="background:#f9f9f9;padding:15px;text-align:center;font-size:12px;color:#777;">
        Deccan Sports Club · support@bergmantri.com · www.bergmantri.com
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
        variables: ['params.name', 'params.event_name', 'params.invoice_number', 'params.amount', 'params.expiry_date'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── Category change email ───────────────────────────────────────────
      {
        key: 'category_change_email',
        name: 'Category Change Invoice Email',
        category: 'category_change',
        channel: 'email',
        subject: 'Category Change Confirmed - {{params.event_name}}',
        content: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;margin:20px auto;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#000;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:20px;letter-spacing:2px;">🏁 BERGMAN EVENTS</h1></td></tr>
      <tr><td style="padding:24px;">
        <h2 style="color:#ff6a00;margin-top:0;">Category Change Invoice</h2>
        <p>Dear <strong>{{params.name}}</strong>,</p>
        <p>Your category for <strong>{{params.event_name}}</strong> has been updated.</p>
        <table width="100%" style="border-collapse:collapse;font-size:14px;margin:16px 0;">
          <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Invoice Number</td><td style="padding:8px;font-weight:bold;border-bottom:1px solid #eee;">{{params.invoice_number}}</td></tr>
          <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">Previous Category</td><td style="padding:8px;border-bottom:1px solid #eee;">{{params.from_category}}</td></tr>
          <tr><td style="padding:8px;color:#777;border-bottom:1px solid #eee;">New Category</td><td style="padding:8px;font-weight:bold;color:#ff6a00;border-bottom:1px solid #eee;">{{params.to_category}}</td></tr>
          <tr><td style="padding:8px;color:#777;">Amount Paid</td><td style="padding:8px;font-weight:bold;">₹{{params.amount}}</td></tr>
        </table>
        <p style="font-size:13px;color:#555;">Invoice attached for your records.</p>
      </td></tr>
      <tr><td style="background:#f9f9f9;padding:15px;text-align:center;font-size:12px;color:#777;">
        Deccan Sports Club · support@bergmantri.com · www.bergmantri.com
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
        variables: ['params.name', 'params.event_name', 'params.invoice_number', 'params.from_category', 'params.to_category', 'params.amount'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── Work With Bergman acceptance email ───────────────────────────
      {
        key: 'work_with_bergman_accepted_email',
        name: 'Work With Bergman Accepted Email',
        category: 'work_with_bergman',
        channel: 'email',
        brevoTemplateId: 11,
        subject: 'Welcome to Team Bergman – {{params.role_name}} confirmed for {{params.event_name}}',
        content: '',
        variables: ['params.name', 'params.event_name', 'params.role_name', 'params.reporting_date', 'params.honorarium', 'params.next_steps'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── Work With Bergman payment confirmation email ─────────────────
      {
        key: 'workbergmanpaymentprocesed',
        name: 'Work With Bergman Payment Email',
        category: 'work_with_bergman',
        channel: 'email',
        brevoTemplateId: 13,
        subject: 'Payment Processed – {{params.eventName}}',
        content: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f7fb;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px;">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
      <tr><td style="background:#111827;color:#fff;padding:28px 32px;text-align:center;">
        <h1 style="margin:0;font-size:26px;">Payment Processed</h1>
        <p style="margin:8px 0 0 0;color:#cbd5e1;">Team Bergman</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <p style="font-size:16px;color:#111827;margin-top:0;">Dear <strong>{{params.name}}</strong>,</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;">Thank you for your contribution and support at <strong>{{params.eventName}}</strong>.</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;">We are pleased to inform you that your payment has been successfully processed.</p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:24px 0;">
          <h2 style="margin:0 0 14px 0;color:#0f172a;font-size:18px;">Payment Details</h2>
          <table width="100%" style="border-collapse:collapse;font-size:14px;color:#334155;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Event</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;">{{params.eventName}}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Role</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;">{{params.roleName}}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Honorarium</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;">₹{{params.honorarium}}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Travel Reimbursement</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;">₹{{params.travelReimbursement}}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Total Amount Paid</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;color:#0f766e;">₹{{params.totalAmount}}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Payment Date</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;">{{params.paymentDate}}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">Payment Method</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:bold;">{{params.paymentMethod}}</td></tr>
            <tr><td style="padding:8px 0;">Transaction / UTR Number</td><td style="padding:8px 0;font-weight:bold;">{{params.utrNumber}}</td></tr>
          </table>
        </div>

        <p style="font-size:15px;color:#334155;line-height:1.7;">The payment has been transferred to your registered bank account or selected payment method.</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;">We sincerely appreciate your professionalism, dedication, and contribution towards making {{params.eventName}} a successful event.</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;">We look forward to working with you again at future Bergman events.</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;">Thank you for being part of Team Bergman.</p>
        <p style="font-size:15px;color:#334155;line-height:1.7;margin-bottom:0;">Best Regards,<br/>Team Bergman<br/>info@bergmantri.com</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`,
        variables: ['params.name', 'params.eventName', 'params.roleName', 'params.honorarium', 'params.travelReimbursement', 'params.totalAmount', 'params.paymentDate', 'params.paymentMethod', 'params.utrNumber'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── Work With Bergman acceptance WhatsApp ────────────────────────
      {
        key: 'work_with_bergman_accepted_whatsapp',
        name: 'Work With Bergman Accepted WhatsApp',
        category: 'work_with_bergman',
        channel: 'whatsapp',
        content: 'Welcome to Team Bergman\n\nHello {{1}},\n\nCongratulations! 🎉\n\nYour application has been approved and you have been assigned the role of {{2}}\n\n📅 Reporting Date: {{3}}\n🏁 Event Dates: {{4}}\n💰 Event Honorarium: ₹{{5}}\n\nOur team will contact you before the event and add you to the official Bergman Event WhatsApp Group for updates, briefings, and operational communication.\n\nWelcome to Team Bergman! 🏁\n\n– Team Bergman',
        variables: ['params.name', 'params.role_name', 'params.reporting_date', 'params.event_dates', 'params.honorarium'],
        aisensyCampaignName: 'workwithbergman',
        aisensyParamKeys: ['params.name', 'params.role_name', 'params.reporting_date', 'params.event_dates', 'params.honorarium'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── OTP email ───────────────────────────────────────────────────────
      {
        key: 'otp_email',
        name: 'OTP Email',
        category: 'auth',
        channel: 'email',
        subject: 'Your OTP - Bergman Events',
        content: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;margin:20px auto;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#000;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:20px;letter-spacing:2px;">🏁 BERGMAN EVENTS</h1></td></tr>
      <tr><td style="padding:32px;text-align:center;">
        <p style="font-size:15px;color:#333;">Hello <strong>{{params.name}}</strong>,</p>
        <p style="font-size:14px;color:#555;">Your one-time password is:</p>
        <div style="display:inline-block;background:#f0f0f0;border-radius:8px;padding:16px 40px;font-size:36px;font-weight:bold;letter-spacing:8px;color:#000;margin:16px 0;">
          {{params.otp}}
        </div>
        <p style="font-size:12px;color:#999;">Valid for 10 minutes. Do not share with anyone.</p>
      </td></tr>
      <tr><td style="background:#f9f9f9;padding:15px;text-align:center;font-size:12px;color:#777;">
        Deccan Sports Club · support@bergmantri.com
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`,
        variables: ['params.name', 'params.otp'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── WhatsApp: registration ──────────────────────────────────────────
      {
        key: 'registration_whatsapp',
        name: 'Registration Confirmation WhatsApp',
        category: 'registration',
        channel: 'whatsapp',
        content: 'Hi {{params.name}}! Your registration for {{params.event_name}} is confirmed 🎉\n\nBooking ID: {{params.booking_id}}\nCategory: {{params.category}}\nBIB: {{params.bib_number}}\nDate: {{params.event_date}}\n\n🏁 See you on race day!',
        variables: ['params.name', 'params.event_name', 'params.booking_id', 'params.category', 'params.bib_number', 'params.event_date'],
        aisensyCampaignName: 'bmregconf',
        aisensyParamKeys: ['params.name', 'params.event_name', 'params.booking_id', 'params.category', 'params.bib_number', 'params.event_date'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── WhatsApp: invoice ───────────────────────────────────────────────
      {
        key: 'invoice_whatsapp',
        name: 'Registration Invoice WhatsApp',
        category: 'invoice',
        channel: 'whatsapp',
        content: 'Hi {{params.name}}, your invoice for {{params.event_name}} is ready.\n\nInvoice: {{params.invoice_number}}\n\nPlease find your invoice attached.',
        variables: ['params.name', 'params.event_name', 'params.invoice_number'],
        aisensyCampaignName: 'invoice',
        aisensyParamKeys: ['params.name', 'params.event_name', 'params.invoice_number'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── WhatsApp: service fee invoice ───────────────────────────────────
      {
        key: 'service_fee_invoice_whatsapp',
        name: 'Service Fee Invoice WhatsApp',
        category: 'invoice',
        channel: 'whatsapp',
        content: 'Hi {{params.name}}, your {{params.service_type}} invoice for {{params.event_name}} is ready.\n\nInvoice: {{params.invoice_number}}\n\nPlease find your invoice attached.',
        variables: ['params.name', 'params.service_type', 'params.event_name', 'params.invoice_number'],
        aisensyCampaignName: 'Invoice def',
        aisensyParamKeys: ['params.name', 'params.service_type', 'params.event_name', 'params.invoice_number'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── WhatsApp: deferral ──────────────────────────────────────────────
      {
        key: 'deferral_whatsapp',
        name: 'Deferral Confirmation WhatsApp',
        category: 'deferral',
        channel: 'whatsapp',
        content: 'Hi {{params.name}}, your deferral from {{params.event_name}} has been confirmed. Your credit is valid and will be applied to your next registration.',
        variables: ['params.name', 'params.event_name'],
        aisensyCampaignName: 'bmdeferral1',
        aisensyParamKeys: ['params.name', 'params.event_name'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },

      // ─── WhatsApp: category change ───────────────────────────────────────
      {
        key: 'category_change_whatsapp',
        name: 'Category Change WhatsApp',
        category: 'category_change',
        channel: 'whatsapp',
        content: 'Hi {{params.name}}, your category for {{params.event_name}} has been updated from {{params.from_category}} to {{params.to_category}}.',
        variables: ['params.name', 'params.event_name', 'params.from_category', 'params.to_category'],
        aisensyCampaignName: 'bmlogcatchan1',
        aisensyParamKeys: ['params.name', 'params.event_name', 'params.from_category', 'params.to_category'],
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      ...getLegacyTemplates(now),
    ];

    const normalizedTemplates = templates.map((template) => ({
      ...template,
      category: CATEGORY_BY_KEY[template.key] ?? template.category,
      subCategory: template.subCategory ?? (template.key.startsWith('legacy_') ? 'legacy' : 'current'),
      aisensyCampaignName:
        template.channel === 'whatsapp'
          ? AISENSY_CAMPAIGN_BY_KEY[template.key] ?? template.aisensyCampaignName
          : template.aisensyCampaignName,
    }));

    const batch = db.batch();
    for (const t of normalizedTemplates) {
      const ref = db.collection('templates').doc(t.key);
      const existing = await ref.get();
      if (!existing.exists) {
        batch.set(ref, t);
      }
    }
    await batch.commit();

    await syncMissingLegacyTemplates(db);

    return { success: true, count: normalizedTemplates.length, message: `Seeded ${normalizedTemplates.length} templates (skipped existing).` };
  } catch (e: any) {
    return { success: false, count: 0, message: e.message };
  }
}

export type { NotificationTemplate };
