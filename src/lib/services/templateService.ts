// src/lib/services/templateService.ts

import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { sendDynamicTemplateEmail, sendRawHtmlEmail } from '@/lib/auth/brevoService';
import { sendAiSensyMessage } from '@/lib/auth/aisensyService';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeMobile(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NotificationTemplate {
  id: string;
  key: string;               // doc ID — e.g. "invoice_email", "deferral_whatsapp"
  name: string;              // Human-readable label
  category: string;          // "invoice" | "registration" | "otp" | "deferral" | etc.
  subCategory?: string;      // "current" | "legacy" | custom
  channel: 'email' | 'whatsapp';
  brevoTemplateId?: number | null; // legacy field name; now used as BergTechno provider template id
  subject?: string;          // email only — supports {{params.x}}
  content: string;           // full HTML for email, text for whatsapp (preview)
  variables: string[];       // declared params e.g. ["params.name", "params.event_name"]
  aisensyCampaignName?: string;  // whatsapp — AiSensy campaign name
  aisensyParamKeys?: string[];   // ordered keys mapping to {{1}}, {{2}}…  e.g. ["params.name","params.event_name"]
    aisensyOtpButton?: boolean;    // true for OTP-button campaigns — first param used as button URL text
    active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Lightweight template renderer ────────────────────────────────────────

/**
 * Render a simple template string without external dependencies.
 * Supports both flat keys and params-prefixed keys: {{name}}, {{params.name}}, etc.
 */
export function renderTemplate(template: string, params: Record<string, any>): string {
  try {
    const context = { ...params, params } as Record<string, any>;
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
      const val = path.trim().split('.').reduce((obj: any, k: string) => obj?.[k], context);
      return val !== undefined && val !== null ? String(val) : '';
    });
  } catch (e: any) {
    console.error('[renderTemplate] Error:', e.message);
    return template;
  }
}
/**
 * Render an AiSensy-style template that uses {{1}}, {{2}}, {{3}}... positional placeholders.
 * @param content  - template text with {{1}}, {{2}} etc.
 * @param values   - ordered array of resolved values; values[0] → {{1}}, values[1] → {{2}}…
 */
export function renderAiSensyTemplate(content: string, values: string[]): string {
  try {
    return content.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
      const idx = parseInt(n, 10) - 1; // {{1}} → index 0
      return idx >= 0 && idx < values.length ? values[idx] : '';
    });
  } catch (e: any) {
    console.error('[renderAiSensyTemplate] Error:', e.message);
    return content;
  }
}
// ─── Firestore fetch (server-side admin SDK) ────────────────────────────────

export async function getTemplate(key: string): Promise<NotificationTemplate | null> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('templates').doc(key).get();
    if (!snap.exists) {
      const normalizedKey = String(key || '').trim().toLowerCase();
      if (normalizedKey === 'work_with_bergman_accepted_email') {
        return {
          id: key,
          key,
          name: 'Work With Bergman Accepted Email',
          category: 'work_with_bergman',
          channel: 'email',
          brevoTemplateId: 11,
          subject: 'Welcome to Team Bergman – {{params.role_name}} confirmed for {{params.event_name}}',
          content: '',
          variables: ['params.name', 'params.event_name', 'params.role_name', 'params.reporting_date', 'params.honorarium', 'params.next_steps'],
          active: true,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as NotificationTemplate;
      }
      if (normalizedKey === 'workbergmanpaymentprocesed' || normalizedKey === 'work_with_bergman_payment_email') {
        return {
          id: key,
          key,
          name: 'Work Bergman Payment Processed',
          category: 'work_with_bergman',
          channel: 'email',
          brevoTemplateId: 13,
          subject: '✅ Payment Processed – {{params.eventName}} | Team Bergman',
          content: '',
          variables: ['params.name', 'params.eventName', 'params.roleName', 'params.honorarium', 'params.travelReimbursement', 'params.totalAmount', 'params.paymentDate', 'params.paymentMethod', 'params.utrNumber'],
          active: true,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as NotificationTemplate;
      }
      return null;
    }
    return { id: snap.id, ...snap.data() } as NotificationTemplate;
  } catch (e: any) {
    console.error(`[getTemplate] Error fetching "${key}":`, e.message);
    return null;
  }
}

// ─── Multi-channel send ─────────────────────────────────────────────────────

export async function sendNotification({
  templateKey,
  to,
  params,
  attachment,
  aisensyTemplateParams,
}: {
  templateKey: string;
  to: string;
  params: Record<string, any>;
  attachment?: { content: string; name: string } | null;
  /** Override ordered params for AiSensy {{1}}, {{2}}… instead of auto-mapping aisensyParamKeys */
  aisensyTemplateParams?: string[];
}): Promise<{ success: boolean; message?: string; skipped?: boolean }> {

  const template = await getTemplate(templateKey);

  if (!template) {
    console.warn(`[sendNotification] Template "${templateKey}" not found in Firestore.`);
    return { success: false, message: `Template "${templateKey}" not found.` };
  }

  if (!template.active) {
    console.info(`[sendNotification] Template "${templateKey}" is inactive — skipping.`);
    return { success: true, skipped: true, message: 'Template inactive.' };
  }

  // ── Email ──
  if (template.channel === 'email') {
    if (!isValidEmail(to)) {
      return {
        success: false,
        message: 'Invalid recipient for email template. Please use a valid email address.',
      };
    }

    if (template.brevoTemplateId && template.brevoTemplateId > 0) {
      const sent = await sendDynamicTemplateEmail(
        template.brevoTemplateId,
        to,
        params,
        `sendNotification:${templateKey}`,
        attachment ?? null
      );
      return {
        success: sent,
        message: sent ? `Sent via BergTechno template ${template.brevoTemplateId}.` : `Failed via BergTechno template ${template.brevoTemplateId}.`,
      };
    }

    if (!template.content || !template.content.trim()) {
      return {
        success: false,
        message: `Template "${templateKey}" is missing provider template ID and HTML content.`,
      };
    }

    const subject = template.subject
      ? renderTemplate(template.subject, params)
      : 'Notification from Bergman Events';
    const html = renderTemplate(template.content, params);
    const sent = await sendRawHtmlEmail(to, subject, html, attachment ?? null);
    return { success: sent };
  }

  // ── WhatsApp ──
  if (template.channel === 'whatsapp') {
    const normalizedMobile = normalizeMobile(to);
    if (!normalizedMobile) {
      return {
        success: false,
        message: 'Invalid recipient for WhatsApp template. Use a valid 10-digit mobile number (or +91 format).',
      };
    }

    if (!template.aisensyCampaignName) {
      return { success: false, message: `Template "${templateKey}" is missing aisensyCampaignName.` };
    }

    let finalParams: string[];
    if (aisensyTemplateParams) {
      finalParams = aisensyTemplateParams;
    } else if (template.aisensyParamKeys?.length) {
      finalParams = template.aisensyParamKeys.map(keyPath => {
        // keyPath like "params.name" → resolve from { params }
        const val = keyPath.split('.').reduce((obj: any, k) => obj?.[k], { params });
        return val !== undefined && val !== null ? String(val) : '';
      });
    } else {
      finalParams = [];
    }

    const result = await sendAiSensyMessage(
      normalizedMobile,
      template.aisensyCampaignName,
      finalParams,
      'Bergman Template System',
      `sendNotification:${templateKey}`,
        'BERGMAN 2',
        null,
        // OTP-button campaigns need the OTP value passed as a URL button param too
        template.aisensyOtpButton && finalParams[0]
          ? [{ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: finalParams[0] }] }]
          : null
      );
    if (!result.success) {
      console.error(
        `[sendNotification:${templateKey}] AiSensy FAILED to ${normalizedMobile}.`,
        'Campaign:', template.aisensyCampaignName,
        'Params:', finalParams,
        'Response:', result.aisensyResponse ?? result.error ?? result.message
      );
      return {
        success: false,
        message: result.message + (result.aisensyResponse?.message ? ` — ${result.aisensyResponse.message}` : ''),
      };
    }
    return result;
  }

  return { success: false, message: 'Unknown channel.' };
}
