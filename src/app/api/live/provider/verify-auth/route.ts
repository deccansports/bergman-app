import { NextRequest, NextResponse } from 'next/server';
import { callFeibotAPIWithCredentialFallback } from '@/lib/feibot-integration/api-client';
import { getFeibotRuntimeSecretsAsyncForEvent } from '@/lib/feibot-integration/secure-credentials';
import { syncFeibotCloudEventInfo } from '@/lib/feibot-integration/cloud-event-sync';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { provider, eventUuid, apiBaseUrl, eventId, scoreEventUuid } = body;
    const requestedModeRaw = String(body?.mode || body?.credentialType || 'auto').trim().toLowerCase();
    const requestedMode: 'auto' | 'event' | 'account' =
      requestedModeRaw === 'event' || requestedModeRaw === 'account' ? requestedModeRaw : 'auto';

    console.log('[VERIFY-AUTH][Incoming Request]', {
      eventId: String(eventId || '').trim() || null,
      eventUuid: String(eventUuid || '').trim() || null,
      provider: String(provider || '').trim() || null,
      mode: requestedModeRaw,
      credentialType: String(body?.credentialType || '').trim() || null,
    });

    if (provider !== 'feibot') {
      return NextResponse.json(
        {
          success: false,
          reason: 'Unsupported provider',
          error: 'Only feibot provider is supported',
          provider: String(provider || '').trim() || null,
        },
        { status: 400 }
      );
    }

    const uuid = String(eventUuid || '').trim();

    if (!uuid) {
      const response = {
        success: false,
        reason: 'Missing Event UUID',
        error: 'Missing Event UUID',
        request: {
          provider: 'feibot',
          eventId: String(eventId || '').trim() || null,
          eventUuid: null,
          mode: requestedModeRaw,
          credentialType: String(body?.credentialType || '').trim() || null,
        },
      };
      console.error('[VERIFY-AUTH][400]', response);
      return NextResponse.json(response, { status: 400 });
    }

    if (!/^[A-Za-z0-9_-]{6,12}$/.test(uuid)) {
      const response = {
        success: false,
        reason: 'Invalid Event UUID',
        error: 'Invalid Event UUID. Rejecting Firestore IDs.',
        request: {
          provider: 'feibot',
          eventId: String(eventId || '').trim() || null,
          eventUuid: uuid,
          mode: requestedModeRaw,
          credentialType: String(body?.credentialType || '').trim() || null,
        },
      };
      console.error('[VERIFY-AUTH][400]', response);
      return NextResponse.json(response, { status: 400 });
    }

    const runtime = await getFeibotRuntimeSecretsAsyncForEvent({
      eventId: String(eventId || '').trim() || undefined,
      eventUuid: uuid,
      credentialType: requestedMode,
    });
    const baseUrl = String(apiBaseUrl || runtime.apiBaseUrl).trim() || runtime.apiBaseUrl;

    const authContext = {
      provider: 'feibot',
      eventId: String(eventId || '').trim() || null,
      eventUuid: uuid,
      credentialType: String(body?.credentialType || '').trim() || null,
      selectedMode: runtime.selectedMode || null,
      selectedCredentialType: runtime.selectedCredentialType || runtime.credentialType || null,
      actualCredentialType: runtime.actualCredentialType || null,
      resolvedCredentialSource: runtime.resolvedCredentialSource || runtime.source || null,
      mode: requestedModeRaw,
    };

    if (runtime.selectedCredentialType && runtime.actualCredentialType && runtime.selectedCredentialType !== runtime.actualCredentialType) {
      const response = {
        success: false,
        reason: 'Credential Resolver Bug',
        error: 'Credential Resolver Bug',
        ...authContext,
      };
      console.error('[VERIFY-AUTH][400]', response);
      return NextResponse.json(response, { status: 400 });
    }

    const testResponse = await callFeibotAPIWithCredentialFallback<any>(
      '/temporary/participantsGetAll',
      {
        method: 'GET',
        query: { event_uuid: uuid },
      },
      {
        eventId: String(eventId || '').trim() || undefined,
        apiBaseUrl: baseUrl,
        credentialType: requestedMode,
      },
    );

    if (!testResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          reason: testResponse.error || `Feibot API error ${testResponse.status}`,
          error: testResponse.error || `Feibot API error ${testResponse.status}`,
          ...authContext,
          diagnostics: {
            status: testResponse.status,
            unixTimestamp: Number(testResponse.diagnostics?.timestamp || 0),
            stringToSign: testResponse.diagnostics?.stringToSign || '',
            signatureLength: Number((testResponse.diagnostics?.requestSignature || '').length || 0),
            requestBody: body,
            response: testResponse.diagnostics || null,
          },
        },
        { status: testResponse.status || 400 }
      );
    }

    let snapshotSync: { success: boolean; message?: string } | null = null;
    if (uuid && String(eventId || '').trim()) {
      try {
        const synced = await syncFeibotCloudEventInfo({
          eventId: String(eventId || '').trim(),
          eventUuid: uuid,
          apiBaseUrl: baseUrl,
          scoreEventUuid: String(scoreEventUuid || '').trim() || undefined,
          triggeredBy: 'provider-verify-auth',
        });
        snapshotSync = synced.success
          ? { success: true, message: 'Cloud API event information synchronized' }
          : { success: false, message: synced.errorReport?.reason || 'Snapshot synchronization failed' };
      } catch (error) {
        snapshotSync = { success: false, message: error instanceof Error ? error.message : 'Snapshot synchronization failed' };
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Authentication verified',
      ...authContext,
      diagnostics: {
        unixTimestamp: Number(testResponse.diagnostics?.timestamp || 0),
        stringToSign: testResponse.diagnostics?.stringToSign || '',
        signatureLength: Number((testResponse.diagnostics?.requestSignature || '').length || 0),
      },
      snapshotSync,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    console.error('[VERIFY-AUTH][ERROR]', {
      reason: message,
      error,
    });
    return NextResponse.json(
      { success: false, reason: message, error: message },
      { status: 400 }
    );
  }
}
