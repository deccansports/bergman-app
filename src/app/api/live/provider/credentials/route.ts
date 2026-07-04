/**
 * Secure Feibot Credential Management
 *
 * GET  — returns masked credential status (never exposes AK/SK)
 * PUT  — validates new credentials against Feibot, then stores encrypted in Firestore
 *
 * Storage: Firestore __feibotCredentials/main (server-side only, Admin SDK bypasses security rules)
 * Encryption: AES-256-GCM with BERGMAN_CREDENTIAL_ENCRYPTION_KEY env var (32-byte hex).
 *             Falls back to base64 obfuscation if the key is not set.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { getStoredFeibotEventCredential, getStoredFeibotGlobalCredential } from '@/lib/feibot-integration/credentials';
import { saveFeibotGlobalCredential, saveFeibotEventCredential } from '@/lib/feibot-integration/credentials';
import { loadFeibotIntegration, saveFeibotIntegration } from '@/lib/feibot-integration/integration-store';
import { resolveFeibotRuntimeEventUuid } from '@/lib/feibot-integration/secure-credentials';
import { getCredentialEncryptionKey } from '@/lib/secrets/encryption-key';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CREDS_DOC_PATH = '__feibotCredentials/main';

type CheckStatus = 'PASS' | 'WARNING' | 'FAIL';
type DiagnosticCheck = {
  key: string;
  label: string;
  required: boolean;
  status: CheckStatus;
  httpStatus: number;
  message?: string;
};

async function callWithRetry<T>(
  config: { accountId: string; accessKey: string; secretKey: string; apiBaseUrl: string },
  path: string,
  query: Record<string, any>,
  retries = 1,
) {
  let last: any = null;
  for (let i = 0; i <= retries; i++) {
    const result = await callFeibotAPI<T>(config, path, { method: 'GET', query });
    last = result;
    if (Number(result.status || 0) !== 429) return result;
    if (i < retries) {
      await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
    }
  }
  return last;
}

function classifyOptionalCheck(httpStatus: number, payload: any) {
  if (httpStatus >= 200 && httpStatus < 300) return { status: 'PASS' as CheckStatus, message: 'Reachable' };
  if (httpStatus === 429) return { status: 'WARNING' as CheckStatus, message: 'Rate Limited (Skipped, retry later)' };
  if (httpStatus === 404) return { status: 'WARNING' as CheckStatus, message: 'Endpoint Not Supported (Optional Feature)' };
  if (httpStatus === 403) {
    const body = JSON.stringify(payload || {}).toLowerCase();
    if (body.includes('not enabled') || body.includes('disabled') || body.includes('not support') || body.includes('not supported')) {
      return { status: 'WARNING' as CheckStatus, message: 'Not Enabled (Optional Feature)' };
    }
    return { status: 'WARNING' as CheckStatus, message: 'Forbidden (Optional Feature)' };
  }
  if (httpStatus >= 500) return { status: 'WARNING' as CheckStatus, message: `Server Error (HTTP ${httpStatus})` };
  if (httpStatus >= 400) return { status: 'WARNING' as CheckStatus, message: `Unavailable (HTTP ${httpStatus})` };
  return { status: 'WARNING' as CheckStatus, message: 'Skipped' };
}

function mapEventRow(row: any) {
  const eventUuid = String(row?.event_uuid || row?.eventUuid || row?.uuid || row?.id || '').trim();
  const cloudUuid = String(
    row?.cloud_uuid ||
    row?.cloudUuid ||
    row?.score_event_uuid ||
    row?.scoreEventUuid ||
    row?.score_uuid ||
    row?.scoreUuid ||
    '',
  ).trim();
  return {
    eventUuid,
    cloudUuid: cloudUuid || null,
    eventName: String(row?.name || row?.event_name || row?.eventName || row?.title || 'Unknown Event').trim() || 'Unknown Event',
    eventDate: String(row?.date || row?.event_date || row?.eventDate || '').trim() || null,
  };
}

// ─── Encryption helpers ───────────────────────────────────────────────────────

async function encryptValue(value: string): Promise<string> {
  const key = await getCredentialEncryptionKey();
  if (!key) {
    // Fallback: base64 only (not true encryption, but prevents accidental exposure)
    return `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function decryptValue(value: string): Promise<string> {
  if (value.startsWith('gcm:')) {
    const key = await getCredentialEncryptionKey();
    if (!key) throw new Error('BERGMAN_CREDENTIAL_ENCRYPTION_KEY not configured — cannot decrypt');
    const parts = value.split(':');
    if (parts.length !== 4) throw new Error('Malformed encrypted credential');
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
  if (value.startsWith('b64:')) {
    return Buffer.from(value.slice(4), 'base64').toString('utf8');
  }
  // Legacy plain text
  return value;
}

// ─── Read stored credentials (server-side only) ────────────────────────────

export async function getStoredFeibotCredentials(): Promise<{
  accessKey: string;
  secretKey: string;
  account: string;
  apiBaseUrl: string;
  eventUuid?: string;
} | null> {
  try {
    const db = getFirestoreInstance();
    const snap = await db.doc(CREDS_DOC_PATH).get();
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (!data.accessKey || !data.secretKey) return null;
    return {
      accessKey: await decryptValue(data.accessKey),
      secretKey: await decryptValue(data.secretKey),
      account: String(data.account || 'feibot'),
      apiBaseUrl: String(data.apiBaseUrl || process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com'),
      eventUuid: String(data.eventUuid || '').trim() || undefined,
    };
  } catch {
    return null;
  }
}

// ─── GET — masked status ────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const eventIdFromQuery = String(_req.nextUrl.searchParams.get('eventId') || '').trim();
    const db = getFirestoreInstance();
    const snap = await db.doc(CREDS_DOC_PATH).get();
    const data = snap.exists ? snap.data()! : null;
    const globalCredential = await getStoredFeibotGlobalCredential().catch(() => null);
    const eventCredential = await getStoredFeibotEventCredential(eventIdFromQuery || String(data?.eventId || '').trim()).catch(() => null);
    const linkedEventUuid = String(data?.cloudEventUuid || data?.eventUuid || '').trim() || null;
    const credentialBoundEventUuid = String(data?.credentialBoundEventUuid || eventCredential?.eventUuid || '').trim() || null;
    const credentialType = String(data?.credentialType || (eventCredential ? 'event' : globalCredential ? 'account' : 'auto')).trim() as 'account' | 'event' | 'auto';
    const runtimeResolution = resolveFeibotRuntimeEventUuid({
      endpoint: '/api/live/provider/credentials',
      credentialType,
      credentialBoundEventUuid,
      cloudEventUuid: linkedEventUuid,
      providerEventUuid: String(data?.eventUuid || '').trim() || null,
      manualEventUuid: null,
      requestedEventUuid: null,
    });

    const envHasAk = !!process.env.FEIBOT_ACCESS_KEY?.trim();
    const envHasSk = !!process.env.FEIBOT_SECRET_KEY?.trim();
    const storeHasCreds = !!(data?.accessKey && data?.secretKey);

    const encryptionEnabled = Boolean(await getCredentialEncryptionKey());

    return NextResponse.json({
      configured: envHasAk || storeHasCreds,
      source: envHasAk ? 'env' : storeHasCreds ? 'firestore' : 'none',
      encryptionEnabled,
      account: data?.account ? '****' : null,
      accessKey: storeHasCreds ? '********************' : envHasAk ? '(env)' : null,
      secretKey: storeHasCreds ? '****************************' : envHasSk ? '(env)' : null,
      eventUuid: linkedEventUuid,
      linkedEventUuid,
      cloudEventUuid: linkedEventUuid,
      credentialBoundEventUuid,
      storedBoundEventUuid: credentialBoundEventUuid,
      runtimeEventUuid: runtimeResolution.resolvedEventUuid,
      updatedAt: data?.updatedAt || null,
      updatedBy: data?.updatedBy || null,
      version: data?.version || 0,
      lastAuthResult: data?.lastAuthResult || null,
      lastAuthAt: data?.lastAuthAt || null,
      credentialMode: String(data?.credentialMode || 'auto'),
      eventCredentialConfigured: Boolean(eventCredential?.accessKey && eventCredential?.secretKey),
      accountCredentialConfigured: Boolean(globalCredential?.accessKey && globalCredential?.secretKey),
      currentCredentialInUse: String(data?.credentialMode || data?.credentialType || 'auto'),
      lastSuccessfulCredential: String(data?.lastSuccessfulCredential || data?.currentCredentialInUse || data?.credentialMode || '—'),
      lastFailedCredential: String(data?.lastFailedCredential || '—'),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read credential status' },
      { status: 500 },
    );
  }
}

// ─── PUT — validate then store ─────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const credentialType = String(body?.credentialType || 'auto').trim().toLowerCase();
    const accessKey = String(body?.accessKey ?? '').trim();
    const secretKey = String(body?.secretKey ?? '').trim();
    const account = String(body?.account || 'feibot').trim() || 'feibot';
    const eventId = String(body?.eventId || '').trim();
    const boundEventUuid = String(body?.boundEventUuid || body?.eventUuid || '').trim();
    const updatedBy = String(body?.updatedBy || 'admin').trim() || 'admin';
    const apiBaseUrl = String(body?.apiBaseUrl || process.env.FEIBOT_API_BASE_URL || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';
    const existingIntegration = eventId ? await loadFeibotIntegration(eventId).catch(() => null) : null;

    if (!accessKey || !secretKey) {
      return NextResponse.json({ success: false, message: 'accessKey and secretKey are required' }, { status: 400 });
    }

    if (credentialType === 'event') {
      if (!eventId || !boundEventUuid) {
        return NextResponse.json({ success: false, message: 'eventId and boundEventUuid are required for event credentials' }, { status: 400 });
      }

      await saveFeibotEventCredential({
        eventId,
        boundEventUuid,
        accessKey,
        secretKey,
        apiBaseUrl,
        updatedBy,
      });

      if (eventId) {
        const selectedEvent = {
          uuid: boundEventUuid,
          name: String(existingIntegration?.selectedEvent?.name || 'Configured Event').trim() || 'Configured Event',
          cloudUuid: String(existingIntegration?.cloudEventUuid || existingIntegration?.selectedEvent?.cloudUuid || '').trim() || null,
        };
        const cloudEventUuid = String(existingIntegration?.cloudEventUuid || existingIntegration?.selectedEvent?.cloudUuid || '').trim() || null;
        const saved = await saveFeibotIntegration(eventId, {
          credentialType: 'event',
          authenticated: true,
          credentialsValid: true,
          status: 'ready',
          eventUuid: boundEventUuid,
          credentialBoundEventUuid: boundEventUuid,
          cloudEventUuid,
          selectedEvent,
          events: [selectedEvent],
          eventsCount: 1,
          updatedAt: new Date().toISOString(),
        });
        console.log('Saved Feibot integration document', saved.data);
      }

      return NextResponse.json({
        success: true,
        message: 'Event-scoped Feibot credentials saved successfully',
        data: { credentialType: 'event', eventId, boundEventUuid, updatedBy },
      });
    }

    const clientConfig = { accountId: account, accessKey, secretKey, apiBaseUrl };
    const discoveryResult = await callFeibotAPI<any>(clientConfig, '/eventConfigFile/eventsList', { method: 'GET' });
    const discoveryRows = discoveryResult.ok
      ? Array.isArray((discoveryResult.data as any)?.data)
        ? (discoveryResult.data as any).data
        : Array.isArray(discoveryResult.data)
          ? discoveryResult.data
          : []
      : [];

    const discoveredEvents = discoveryRows
      .map(mapEventRow)
      .filter((row: any) => !!row.eventUuid)
      .map((row: any) => ({
        eventUuid: row.eventUuid,
        cloudUuid: row.cloudUuid || row.eventUuid,
        eventName: row.eventName,
        eventDate: row.eventDate,
      }));

    const selectedEvent = discoveredEvents[0] || null;
  const selectedEventUuid = String(selectedEvent?.cloudUuid || selectedEvent?.eventUuid || '').trim();
  const credentialBoundEventUuid = String(selectedEvent?.eventUuid || '').trim();

    console.log('========== FEIBOT EVENTS ==========');
    console.log('Events returned', discoveredEvents);
    console.log('Events Count', discoveredEvents.length);
  console.log('Selected UUID', selectedEventUuid || null);
  console.log('Credential-bound UUID', credentialBoundEventUuid || null);
    console.log('Selected Name', selectedEvent?.eventName || null);
    console.log('===================================');

    if (!selectedEventUuid) {
      return NextResponse.json({
        success: false,
        message: 'No Feibot Event UUID configured. Authenticate and discover events first.',
      }, { status: 400 });
    }

    console.log('Saving Event UUID', selectedEventUuid);
    console.log('Saving Events Count', discoveredEvents.length);

    const timingRulesResult = await callFeibotAPI<any>(clientConfig, '/eventConfigFile/timingRulesGet', {
      method: 'GET',
      query: { event_uuid: selectedEventUuid },
    });

    if (!timingRulesResult.ok) {
      return NextResponse.json({
        success: false,
        message: timingRulesResult.status === 401 || timingRulesResult.status === 403
          ? 'Authentication failed while calling Feibot timing rules endpoint.'
          : 'Unable to communicate with timing provider.',
        providerStatus: timingRulesResult.status,
      }, { status: timingRulesResult.status === 401 || timingRulesResult.status === 403 ? timingRulesResult.status : 502 });
    }

    const participantsResult = await callFeibotAPI<any>(clientConfig, '/temporary/participantsGetAll', {
      method: 'GET',
      query: { event_uuid: selectedEventUuid },
    });

    const encryptedAccessKey = await encryptValue(accessKey);
    const encryptedSecretKey = await encryptValue(secretKey);
    const db = getFirestoreInstance();
    const now = new Date().toISOString();
    const credsPayload = {
      provider: 'feibot',
      account,
      apiBaseUrl,
      accessKey: encryptedAccessKey,
      secretKey: encryptedSecretKey,
      authenticated: true,
      credentialsValid: true,
      status: 'ready',
      eventUuid: selectedEventUuid,
      cloudEventUuid: selectedEventUuid,
      credentialBoundEventUuid,
      credentialType: 'account',
      selectedEvent,
      events: discoveredEvents,
      eventsCount: discoveredEvents.length,
      updatedAt: now,
      updatedBy,
      lastAuthResult: 'success',
    };

    await saveFeibotGlobalCredential({
      accountId: account,
      accessKey,
      secretKey,
      apiBaseUrl,
      updatedBy,
    });

    await db.doc(CREDS_DOC_PATH).set({
      ...credsPayload,
      version: 1,
      lastAuthAt: now,
      previousVersion: 0,
    }, { merge: true });

    if (eventId) {
      const savedIntegration = await saveFeibotIntegration(eventId, {
        credentialType: 'account',
        authenticated: true,
        credentialsValid: true,
        status: 'ready',
        eventUuid: selectedEventUuid,
        cloudEventUuid: selectedEventUuid,
        credentialBoundEventUuid: String(existingIntegration?.credentialBoundEventUuid || '').trim() || null,
        selectedEvent,
        events: discoveredEvents,
        eventsCount: discoveredEvents.length,
        updatedAt: now,
      });
      console.log('Saved Feibot integration document', savedIntegration.data);
      const rereadIntegration = await loadFeibotIntegration(eventId);
      console.log('Re-read Feibot integration document', rereadIntegration);
    }

    await db.collection('liveTracking').doc('feibot').set({
      provider: 'feibot',
      status: 'ready',
      authenticated: true,
      credentialsValid: true,
      eventUuid: selectedEventUuid,
      cloudEventUuid: selectedEventUuid,
      credentialBoundEventUuid,
      selectedEvent,
      events: discoveredEvents,
      eventsCount: discoveredEvents.length,
      lastUpdated: now,
    }, { merge: true });

    return NextResponse.json({
      success: true,
      status: 'ready',
      credentialsValid: true,
      authResult: 'success',
      eventUuid: selectedEventUuid,
      selectedEvent,
      eventsFound: discoveredEvents.length,
      events: discoveredEvents,
      providerStatus: timingRulesResult.status,
      participantsStatus: participantsResult.status,
      message: 'Credentials encrypted and saved successfully.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Failed to update credentials' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return PUT(req);
}
