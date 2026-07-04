// src/functions/src/auth/brevoService.ts
import { authOtpConfig as config } from './authConfig';

function getBergTechnoConfig() {
  const apiBaseUrl = String(process.env.BERGTECHNO_EMAIL_API_BASE_URL || process.env.BERGTECNO_EMAIL_API_BASE_URL || '').trim();
  const apiKey = String(process.env.BERGTECHNO_EMAIL_API_KEY || process.env.BERGTECNO_EMAIL_API_KEY || '').trim();
  const apiKeyHeader = String(process.env.BERGTECHNO_EMAIL_API_KEY_HEADER || process.env.BERGTECNO_EMAIL_API_KEY_HEADER || 'x-api-key').trim();
  const templateSendPath = String(process.env.BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH || process.env.BERGTECNO_EMAIL_TEMPLATE_SEND_PATH || '/api/email/send-template').trim();
  const senderEmail = String(process.env.BERGTECHNO_SENDER_EMAIL || process.env.BERGTECNO_SENDER_EMAIL || process.env.BREVO_SENDER_EMAIL || 'info@bergmantri.com').trim();
  const senderName = String(process.env.BERGTECHNO_SENDER_NAME || process.env.BERGTECNO_SENDER_NAME || process.env.BREVO_SENDER_NAME || 'Bergman Triathlon').trim();

  if (!apiBaseUrl) throw new Error('BergTechno API base URL is not configured.');
  if (!apiKey) throw new Error('BergTechno API key is not configured.');

  return {
    url: `${apiBaseUrl.replace(/\/+$/, '')}${templateSendPath.startsWith('/') ? templateSendPath : `/${templateSendPath}`}`,
    apiKey,
    apiKeyHeader,
    senderEmail,
    senderName,
  };
}

function buildAuthHeader(apiKeyHeader: string, apiKey: string): Record<string, string> {
  const header = String(apiKeyHeader || 'x-api-key').trim();
  if (header.toLowerCase() === 'authorization') {
    return { Authorization: apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}` };
  }
  return { [header || 'x-api-key']: apiKey };
}

export async function sendDynamicTemplateEmail(
  templateId: number,
  recipientEmail: string,
  params: Record<string, any>,
  actionLogName: string
): Promise<boolean> {
  if (templateId === 0) {
    console.warn(`[${actionLogName}] Template ID is 0. Email for ${recipientEmail} not sent.`);
    return false;
  }
  
  const actionNameForLog = `EmailService ${actionLogName}`;
  try {
    const cfg = getBergTechnoConfig();
    const response = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeader(cfg.apiKeyHeader, cfg.apiKey),
      },
      body: JSON.stringify({
        templateId,
        to: [{ email: recipientEmail.toLowerCase() }],
        params,
        sender: { email: cfg.senderEmail, name: cfg.senderName },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`BergTechno API error: ${response.status} ${body}`);
    }

    console.info(`[${actionNameForLog}] Successfully sent email to ${recipientEmail}.`);
    return true;
  } catch (error: any) {
    console.error(`[${actionNameForLog}] FAILED email to ${recipientEmail}. Error: ${error.message}`, error.body || error);
    return false;
  }
}

export async function sendFeedbackCouponEmail(
  recipientEmail: string,
  name: string,
  couponCode: string
): Promise<boolean> {
    const templateId = config.brevo.feedbackCouponTemplateId;
    const params = {
        name: name,
        couponCode: couponCode,
        eventname: 'Bergman Ozar', // This seems hardcoded in the main app's version too
    };
    return sendDynamicTemplateEmail(templateId, recipientEmail, params, 'sendFeedbackCouponEmail');
}
