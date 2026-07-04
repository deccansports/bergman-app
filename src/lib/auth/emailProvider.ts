// src/lib/auth/emailProvider.ts
import { getFirestoreInstance } from '@/lib/firebaseAdmin';

export type EmailAttachment = {
  content?: string;
  name?: string;
  filename?: string;
  data?: string;
  type?: string;
};

type ProviderAttachment = {
  filename: string;
  data: string;
  type?: string;
  mimeType?: string;
  contentType?: string;
};

type LegacyAttachment = {
  filename: string;
  data: string;
  type?: string;
};

function normalizeAttachmentList(input: unknown): ProviderAttachment[] {
  const attachments = Array.isArray(input) ? input : input ? [input] : [];

  return attachments.reduce<ProviderAttachment[]>((acc, item: any) => {
    const content = String(item?.data || item?.content || '').trim();
    if (!content) return acc;

    const name = String(item?.filename || item?.name || 'attachment').trim() || 'attachment';
    const type = String(item?.type || item?.mimeType || item?.contentType || '').trim();

    acc.push({
      filename: name,
      data: content,
      ...(type ? { type, mimeType: type, contentType: type } : {}),
    });
    return acc;
  }, []);
}

function buildAttachmentPayload(input: unknown): Record<string, unknown> {
  const attachments = normalizeAttachmentList(input);
  if (attachments.length === 0) return {};

  const primaryAttachment = attachments[0];

  return {
    attachment: {
      filename: primaryAttachment.filename,
      data: primaryAttachment.data,
      ...(primaryAttachment.type ? { type: primaryAttachment.type } : {}),
    } as LegacyAttachment,
    attachments,
    files: attachments,
  };
}

export interface BergTechnoEmailConfig {
  provider: 'bergtechno';
  apiBaseUrl: string;
  apiKey: string;
  apiKeyHeader: string;
  templateSendPath: string;
  rawSendPath: string;
  senderEmail: string;
  senderName: string;
  timeoutMs: number;
}

type IntegrationDoc = {
  emailProvider?: string;
  bergTechnoEmail?: {
    apiBaseUrl?: string;
    apiKey?: string;
    apiKeyHeader?: string;
    templateSendPath?: string;
    rawSendPath?: string;
    senderEmail?: string;
    senderName?: string;
    timeoutMs?: number;
    enabled?: boolean;
  };
};

let configCache: { value: BergTechnoEmailConfig | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};

function trimToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned.length > 0 ? cleaned : null;
}

function pathWithLeadingSlash(value: string, fallback: string): string {
  const cleaned = trimToNull(value) || fallback;
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function mergeConfig(
  env: Partial<BergTechnoEmailConfig>,
  fromDb: Partial<BergTechnoEmailConfig>
): BergTechnoEmailConfig {
  return {
    provider: 'bergtechno',
    apiBaseUrl: trimToNull(env.apiBaseUrl) || trimToNull(fromDb.apiBaseUrl) || '',
    apiKey: trimToNull(env.apiKey) || trimToNull(fromDb.apiKey) || '',
    apiKeyHeader: trimToNull(env.apiKeyHeader) || trimToNull(fromDb.apiKeyHeader) || 'x-api-key',
    templateSendPath: pathWithLeadingSlash(
      trimToNull(env.templateSendPath) || trimToNull(fromDb.templateSendPath) || '/email/send-template',
      '/email/send-template'
    ),
    rawSendPath: pathWithLeadingSlash(
      trimToNull(env.rawSendPath) || trimToNull(fromDb.rawSendPath) || '/email/send',
      '/email/send'
    ),
    senderEmail:
      trimToNull(env.senderEmail) ||
      trimToNull(fromDb.senderEmail) ||
      trimToNull(process.env.BREVO_SENDER_EMAIL) ||
      'info@bergmantri.com',
    senderName:
      trimToNull(env.senderName) ||
      trimToNull(fromDb.senderName) ||
      trimToNull(process.env.BREVO_SENDER_NAME) ||
      'Bergman Triathlon',
    timeoutMs: Number(env.timeoutMs || fromDb.timeoutMs || 15000),
  };
}

async function readDbIntegrationConfig(): Promise<Partial<BergTechnoEmailConfig>> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.collection('settings').doc('integration').get();
    if (!snap.exists) return {};

    const data = snap.data() as IntegrationDoc;
    const berg = data?.bergTechnoEmail || {};

    if (data?.emailProvider && data.emailProvider !== 'bergtechno') {
      return {};
    }

    return {
      apiBaseUrl: trimToNull(berg.apiBaseUrl) || undefined,
      apiKey: trimToNull(berg.apiKey) || undefined,
      apiKeyHeader: trimToNull(berg.apiKeyHeader) || undefined,
      templateSendPath: trimToNull(berg.templateSendPath) || undefined,
      rawSendPath: trimToNull(berg.rawSendPath) || undefined,
      senderEmail: trimToNull(berg.senderEmail) || undefined,
      senderName: trimToNull(berg.senderName) || undefined,
      timeoutMs: Number(berg.timeoutMs || 15000),
    };
  } catch {
    return {};
  }
}

export async function getActiveEmailProviderConfig(forceRefresh = false): Promise<BergTechnoEmailConfig> {
  const now = Date.now();
  if (!forceRefresh && configCache.value && configCache.expiresAt > now) {
    return configCache.value;
  }

  const envConfig: Partial<BergTechnoEmailConfig> = {
    apiBaseUrl: process.env.BERGTECHNO_EMAIL_API_BASE_URL || process.env.BERGTECNO_EMAIL_API_BASE_URL,
    apiKey: process.env.BERGTECHNO_EMAIL_API_KEY || process.env.BERGTECNO_EMAIL_API_KEY,
    apiKeyHeader: process.env.BERGTECHNO_EMAIL_API_KEY_HEADER || process.env.BERGTECNO_EMAIL_API_KEY_HEADER,
    templateSendPath: process.env.BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH || process.env.BERGTECNO_EMAIL_TEMPLATE_SEND_PATH,
    rawSendPath: process.env.BERGTECHNO_EMAIL_RAW_SEND_PATH || process.env.BERGTECNO_EMAIL_RAW_SEND_PATH,
    senderEmail: process.env.BERGTECHNO_SENDER_EMAIL || process.env.BERGTECNO_SENDER_EMAIL,
    senderName: process.env.BERGTECHNO_SENDER_NAME || process.env.BERGTECNO_SENDER_NAME,
    timeoutMs: (process.env.BERGTECHNO_EMAIL_TIMEOUT_MS || process.env.BERGTECNO_EMAIL_TIMEOUT_MS)
      ? Number(process.env.BERGTECHNO_EMAIL_TIMEOUT_MS || process.env.BERGTECNO_EMAIL_TIMEOUT_MS)
      : undefined,
  };

  const dbConfig = await readDbIntegrationConfig();
  const merged = mergeConfig(envConfig, dbConfig);

  if (!merged.apiBaseUrl) {
    throw new Error('BergTechno email API base URL is not configured. Set BERGTECHNO_EMAIL_API_BASE_URL or save it in Integration settings.');
  }
  if (!merged.apiKey) {
    throw new Error('BergTechno email API key is not configured. Set BERGTECHNO_EMAIL_API_KEY or save it in Integration settings.');
  }

  configCache = {
    value: merged,
    expiresAt: now + 60_000,
  };

  return merged;
}

function buildUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function buildCandidateUrls(baseUrl: string, path: string): string[] {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const origin = cleanBase.replace(/\/api$/i, '');

  const candidates = new Set<string>();
  candidates.add(`${cleanBase}${cleanPath}`);

  if (!cleanPath.startsWith('/api/')) {
    candidates.add(`${origin}/api${cleanPath}`);
  }

  if (cleanPath.includes('/email/')) {
    const plural = cleanPath.replace('/email/', '/emails/');
    candidates.add(`${cleanBase}${plural}`);
    if (!plural.startsWith('/api/')) candidates.add(`${origin}/api${plural}`);
  }

  if (cleanPath.includes('/emails/')) {
    const singular = cleanPath.replace('/emails/', '/email/');
    candidates.add(`${cleanBase}${singular}`);
    if (!singular.startsWith('/api/')) candidates.add(`${origin}/api${singular}`);
  }

  return Array.from(candidates).filter(Boolean);
}

function stringifyForLog(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function attachmentCountFromPayload(payload: Record<string, unknown>): number {
  const attachment = (payload as any)?.attachment;
  const attachments = (payload as any)?.attachments;
  const files = (payload as any)?.files;
  if (Array.isArray(attachment)) return attachment.length;
  if (Array.isArray(attachments)) return attachments.length;
  if (Array.isArray(files)) return files.length;
  if (attachment || attachments || files) return 1;
  return 0;
}

function normalizeAuthHeaders(apiKeyHeader: string, apiKey: string): Record<string, string> {
  const headerName = String(apiKeyHeader || 'x-api-key').trim();
  if (!headerName) {
    return { 'x-api-key': apiKey };
  }
  if (headerName.toLowerCase() === 'authorization') {
    return {
      Authorization: apiKey.toLowerCase().startsWith('bearer ') ? apiKey : `Bearer ${apiKey}`,
    };
  }
  return { [headerName]: apiKey };
}

function extractErrorDetail(body: any, fallback: string): string {
  if (body === null || body === undefined) return fallback;
  if (typeof body === 'string') return body || fallback;
  if (typeof body === 'object') {
    const candidate = body?.message ?? body?.error ?? body?.detail ?? body?.errors ?? body;
    return stringifyForLog(candidate) || fallback;
  }
  return String(body) || fallback;
}

async function sendRequest(url: string, apiKeyHeader: string, apiKey: string, payload: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  try {
    const attachmentCount = attachmentCountFromPayload(payload);
    const attachmentInfo = attachmentCount > 0 ? ` [📎 ${attachmentCount} attachment(s)]` : '';

    console.debug(`[EmailProvider] Sending request to ${url}${attachmentInfo}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...normalizeAuthHeaders(apiKeyHeader, apiKey),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });

    const rawBody = await response.text().catch(() => '');
    let body: any = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    if (!response.ok) {
      const detail = extractErrorDetail(body, `${response.status} ${response.statusText}`);
      throw new Error(`BergTechno API error: ${detail}`);
    }

    if (body?.success === false) {
      throw new Error(`BergTechno API rejected request: ${body?.message || 'unknown error'}`);
    }

    // Log full response so we can verify actual delivery (not just HTTP 200)
    console.info(`[EmailProvider] ✅ sendRequest SUCCESS → ${url} | HTTP ${response.status}${attachmentInfo} | response: ${stringifyForLog(body)}`);
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTemplateEmailViaProvider(args: {
  templateId: number;
  recipientEmail: string;
  params: Record<string, any>;
  senderEmail?: string;
  senderName?: string;
  attachment?: EmailAttachment[];
  tags?: string[];
}): Promise<boolean> {
  try {
    const config = await getActiveEmailProviderConfig();
    const recipientEmail = args.recipientEmail.toLowerCase().trim();
    const senderEmail = args.senderEmail || config.senderEmail;
    const senderName = args.senderName || config.senderName;
    const urls = buildCandidateUrls(config.apiBaseUrl, config.templateSendPath);

    const year = new Date().getFullYear();
    const mergedParams = {
      ...args.params,
      year: (args.params as any)?.year ?? year,
    } as Record<string, any>;

    const nestedAndFlatVars = {
      ...mergedParams,
      params: mergedParams,
    } as Record<string, any>;

    const payloads: Record<string, unknown>[] = [
      {
        templateId: args.templateId,
        to: [{ email: recipientEmail }],
        params: nestedAndFlatVars,
        variables: nestedAndFlatVars,
        data: nestedAndFlatVars,
        templateData: nestedAndFlatVars,
        sender: { email: senderEmail, name: senderName },
        ...buildAttachmentPayload(args.attachment),
        ...(Array.isArray(args.tags) && args.tags.length > 0 ? { tags: args.tags } : {}),
      },
      {
        templateId: args.templateId,
        to: recipientEmail,
        recipientEmail,
        params: nestedAndFlatVars,
        variables: nestedAndFlatVars,
        data: nestedAndFlatVars,
        templateData: nestedAndFlatVars,
        senderEmail,
        senderName,
        ...buildAttachmentPayload(args.attachment),
      },
      {
        template_id: args.templateId,
        to: recipientEmail,
        data: nestedAndFlatVars,
        variables: nestedAndFlatVars,
        sender: { email: senderEmail, name: senderName },
        ...buildAttachmentPayload(args.attachment),
      },
    ];

    const errors: string[] = [];
    for (const url of urls) {
      for (const payload of payloads) {
        try {
          await sendRequest(url, config.apiKeyHeader, config.apiKey, payload, config.timeoutMs);
          console.info(`[EmailProvider] ✅ Template email sent. templateId=${args.templateId} to=${recipientEmail} url=${url}`);
          return true;
        } catch (error: any) {
          errors.push(`${url} -> ${error?.message || 'unknown error'} | payloadKeys=${Object.keys(payload).join(',')}`);
        }
      }
    }

    console.error('[EmailProvider] sendTemplateEmailViaProvider attempts failed:', stringifyForLog(errors));
    return false;
  } catch (error: any) {
    console.error('[EmailProvider] sendTemplateEmailViaProvider failed:', error?.message || stringifyForLog(error));
    return false;
  }
}

export async function sendRawEmailViaProvider(args: {
  recipientEmail: string;
  subject: string;
  htmlContent: string;
  senderEmail?: string;
  senderName?: string;
  attachment?: EmailAttachment[];
}): Promise<boolean> {
  try {
    const config = await getActiveEmailProviderConfig();
    const recipientEmail = args.recipientEmail.toLowerCase().trim();
    const senderEmail = args.senderEmail || config.senderEmail;
    const senderName = args.senderName || config.senderName;
    const cleanBase = String(config.apiBaseUrl || '').trim().replace(/\/+$/, '');
    const cleanPath = String(config.rawSendPath || '/email/send').trim().startsWith('/')
      ? String(config.rawSendPath || '/email/send').trim()
      : `/${String(config.rawSendPath || '/email/send').trim()}`;
    const origin = cleanBase.replace(/\/api$/i, '');
    // Prefer exact raw endpoint first to avoid long fallback chains/timeouts.
    const preferredUrls = [
      `${cleanBase}${cleanPath}`,
      !cleanPath.startsWith('/api/') ? `${origin}/api${cleanPath}` : null,
    ].filter(Boolean) as string[];
    const urls = Array.from(new Set([...preferredUrls, ...buildCandidateUrls(config.apiBaseUrl, config.rawSendPath)])).slice(0, 2);

    const payloads: Record<string, unknown>[] = [
      {
        to: recipientEmail,
        subject: args.subject,
        html: args.htmlContent,
        sender: { email: senderEmail, name: senderName },
        ...buildAttachmentPayload(args.attachment),
      },
      {
        to: [{ email: recipientEmail }],
        subject: args.subject,
        htmlContent: args.htmlContent,
        sender: { email: senderEmail, name: senderName },
        ...buildAttachmentPayload(args.attachment),
      },
      {
        to: recipientEmail,
        recipientEmail,
        subject: args.subject,
        html: args.htmlContent,
        htmlContent: args.htmlContent,
        senderEmail,
        senderName,
        ...buildAttachmentPayload(args.attachment),
      }
    ];

    const errors: string[] = [];
    const rawTimeoutMs = Math.max(25000, Number(config.timeoutMs || 15000));
    for (const url of urls) {
      for (const payload of payloads) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await sendRequest(url, config.apiKeyHeader, config.apiKey, payload, rawTimeoutMs);
            return true;
          } catch (error: any) {
            const msg = String(error?.message || 'unknown error');
            const isTransientAbort = /aborted|abort|timed out|timeout/i.test(msg);
            if (attempt < 2 && isTransientAbort) {
              await new Promise((r) => setTimeout(r, 300 * attempt));
              continue;
            }
            errors.push(`${url} -> ${msg} | payloadKeys=${Object.keys(payload).join(',')}`);
            break;
          }
        }
      }
    }

    console.error('[EmailProvider] sendRawEmailViaProvider attempts failed:', stringifyForLog(errors));
    return false;
  } catch (error: any) {
    console.error('[EmailProvider] sendRawEmailViaProvider failed:', error?.message || stringifyForLog(error));
    return false;
  }
}

export function __buildTemplatePayloadForTest(args: {
  templateId: number;
  recipientEmail: string;
  params: Record<string, any>;
  senderEmail: string;
  senderName: string;
}) {
  return {
    templateId: args.templateId,
    to: [{ email: args.recipientEmail.toLowerCase().trim() }],
    params: args.params,
    sender: { email: args.senderEmail, name: args.senderName },
  };
}
