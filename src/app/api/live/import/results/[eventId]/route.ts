import { NextRequest, NextResponse } from 'next/server';
import { callFeibotAPI } from '@/lib/feibot-integration/api-client';
import { archiveRawResponse } from '@/lib/feibot-integration/kv-archive';
import { getEventFeibotUuids, getFeibotRuntimeSecretsAsync } from '@/lib/feibot-integration/secure-credentials';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const eventId = params.eventId;
    if (!eventId) {
      return NextResponse.json(
        { success: false, message: 'Event ID required' },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const overrideEventUuid = String(body?.eventUuid || '').trim();
    const { eventUuid: savedEventUuid } = await getEventFeibotUuids(eventId);
    const eventUuid = overrideEventUuid || savedEventUuid;

    if (!eventUuid) {
      return NextResponse.json(
        { success: false, message: 'Missing event UUID configuration' },
        { status: 400 }
      );
    }

    const secrets = await getFeibotRuntimeSecretsAsync();

    const result = await callFeibotAPI<any>(
      {
        accountId: secrets.accountId,
        accessKey: secrets.accessKey,
        secretKey: secrets.secretKey,
        apiBaseUrl: secrets.apiBaseUrl,
      },
      '/resultQueryService/queryLatestResults',
      {
        method: 'GET',
        query: { event_uuid: eventUuid },
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          message: [401, 403].includes(result.status)
            ? 'Authentication failed'
            : 'Unable to communicate with timing provider.',
        },
        { status: [401, 403].includes(result.status) ? result.status : 502 }
      );
    }

    const results = result.data || {};

    await archiveRawResponse(
      eventUuid,
      'queryLatestResults',
      '/resultQueryService/queryLatestResults',
      { event_uuid: eventUuid },
      results,
      {
        method: 'GET',
        httpStatus: result.status,
        responseTimeMs: result.diagnostics?.responseTimeMs || 0,
        requestSignature: result.diagnostics?.requestSignature || '',
      },
    );

    return NextResponse.json({
      success: true,
      message: 'Results imported',
      resultCount: Array.isArray((results as any)?.data) ? (results as any).data.length : 0,
    });
  } catch (_error) {
    return NextResponse.json(
      { success: false, message: 'Unable to communicate with timing provider.' },
      { status: 500 }
    );
  }
}
