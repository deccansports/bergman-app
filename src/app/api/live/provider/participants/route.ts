import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { fetchParticipants, fetchParticipantsQuery } from '@/lib/feibot-integration/api-client';
import { archiveRawResponse } from '@/lib/feibot-integration/kv-archive';
import { loadFeibotIntegrationSecrets } from '@/lib/feibot-integration/integration-store';

export const dynamic = 'force-dynamic';

async function loadCachedParticipantsForEventId(eventId: string) {
  const cached =
    (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants:index`, 'api-live-provider-participants-cache')) ||
    (await getKV<Record<string, any>>(`event:${eventId}:providerParticipants:index`, 'api-live-provider-participants-cache')) ||
    (await getKV<Record<string, any>>(`event:${eventId}:providerParticipants`, 'api-live-provider-participants-cache')) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-live-provider-participants-cache')) ||
    null;

  const participants = Array.isArray(cached?.participants)
    ? cached.participants
    : Array.isArray(cached?.data)
      ? cached.data
      : [];

  if (!participants.length) return null;

  return { eventId, participants, cached };
}

async function loadCachedParticipantsForEventUuid(eventUuid: string) {
  const uuid = String(eventUuid || '').trim();
  if (!uuid) return null;

  const cached =
    (await getKV<Record<string, any>>(`live:event:${uuid}:providerParticipants:index`, 'api-live-provider-participants-cache')) ||
    (await getKV<Record<string, any>>(`event:${uuid}:providerParticipants:index`, 'api-live-provider-participants-cache')) ||
    (await getKV<Record<string, any>>(`event:${uuid}:providerParticipants`, 'api-live-provider-participants-cache')) ||
    (await getKV<Record<string, any>>(`live:event:${uuid}:providerParticipants`, 'api-live-provider-participants-cache')) ||
    null;

  const participants = Array.isArray(cached?.participants)
    ? cached.participants
    : Array.isArray(cached?.data)
      ? cached.data
      : [];

  if (!participants.length) return null;

  return { eventId: uuid, participants, cached };
}

export async function GET(req: NextRequest) {
  let upstreamCallSucceeded = false;
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const refresh = ['1', 'true', 'yes'].includes(String(searchParams.get('refresh') || '').toLowerCase());
    const rawMode = ['1', 'true', 'yes', 'raw'].includes(String(searchParams.get('raw') || searchParams.get('debug') || '').toLowerCase());
    const bib = String(searchParams.get('bib') || '').trim();
    const chipCode = String(searchParams.get('chip_code') || '').trim();
    const name = String(searchParams.get('name') || '').trim();
    const idCode = String(searchParams.get('id_code') || '').trim();
    const hasParticipantFilters = Boolean(bib || chipCode || name || idCode);

    const secrets = eventId ? await loadFeibotIntegrationSecrets(eventId) : null;
    const resolvedEventUuid = String(secrets?.eventUuid || '').trim();

    if (!resolvedEventUuid) {
      return NextResponse.json(
        { success: false, message: 'No Feibot Event UUID configured. Authenticate and discover events first.' },
        { status: 400 }
      );
    }

    if (!secrets) {
      return NextResponse.json(
        { success: false, message: 'No Feibot credentials configured for this event.' },
        { status: 400 }
      );
    }

    const config = {
      accountId: secrets.accountId,
      accessKey: secrets.accessKey,
      secretKey: secrets.secretKey,
      apiBaseUrl: secrets.apiBaseUrl,
    };
    const credentialType = secrets.credentialType === 'account' ? 'account' : 'event';

    const result = hasParticipantFilters
      ? await fetchParticipantsQuery(config, {
          event_uuid: String(resolvedEventUuid),
          ...(bib ? { bib } : {}),
          ...(chipCode ? { chip_code: chipCode } : {}),
          ...(name ? { name } : {}),
          ...(idCode ? { id_code: idCode } : {}),
        }, { eventId: eventId || undefined, credentialType })
        : await fetchParticipants(config, String(resolvedEventUuid), { eventId: eventId || undefined, credentialType });

    if (!result.ok) {
      const cached = refresh ? null : eventId ? await loadCachedParticipantsForEventId(String(eventId)) : await loadCachedParticipantsForEventUuid(String(resolvedEventUuid));
      if (cached?.participants?.length) {
        console.warn('[provider/participants] upstream unavailable, using cached participants', {
          eventUuid: resolvedEventUuid,
          cachedEventId: cached.eventId,
          count: cached.participants.length,
          status: result.status,
        });
        return NextResponse.json({
          success: true,
          cached: true,
          source: 'cache',
          eventId: cached.eventId,
          participants: cached.participants,
          count: cached.participants.length,
          message: 'Using cached participants because the provider is unavailable.',
        });
      }

      return NextResponse.json(
        {
          success: false,
          message: [401, 403].includes(result.status)
            ? 'Authentication failed'
            : 'Unable to communicate with timing provider.',
          diagnostics: {
            requestUrl: result.diagnostics?.requestUrl || result.diagnostics?.endpoint || null,
            status: result.status,
            authAudit: result.diagnostics?.authAudit || null,
            responseBodyText: result.diagnostics?.responseBodyText || null,
          },
        },
        { status: [401, 403].includes(result.status) ? result.status : 502 }
      );
    }

    upstreamCallSucceeded = true;

    const response = result.data;
    const downloadUrl = hasParticipantFilters ? null : (response as any)?.download_url;
    const queryParticipants = Array.isArray((response as any)?.data)
      ? (response as any).data
      : Array.isArray(response)
        ? response
        : [];

    if (hasParticipantFilters) {
      await archiveRawResponse(
        String(resolvedEventUuid),
        'participantsQuery',
        '/temporary/participantsQuery',
        {
          event_uuid: String(resolvedEventUuid),
          ...(bib ? { bib } : {}),
          ...(chipCode ? { chip_code: chipCode } : {}),
          ...(name ? { name } : {}),
          ...(idCode ? { id_code: idCode } : {}),
        },
        response,
        {
          method: 'GET',
          httpStatus: result.status,
          responseTimeMs: result.diagnostics?.responseTimeMs || 0,
          requestSignature: result.diagnostics?.requestSignature || '',
        },
      );
    }

    if (rawMode || hasParticipantFilters) {
      return NextResponse.json({
        success: true,
        raw: Boolean(rawMode),
        queryMode: hasParticipantFilters,
        resolvedEventUuid,
        source: 'integration-store',
        cloudEventUuid: null,
        legacyEventUuid: null,
        downloadUrl: downloadUrl || null,
        upstream: response,
        participants: hasParticipantFilters ? queryParticipants : undefined,
        count: hasParticipantFilters ? queryParticipants.length : undefined,
        selectedQuery: hasParticipantFilters ? {
          event_uuid: String(resolvedEventUuid),
          ...(bib ? { bib } : {}),
          ...(chipCode ? { chip_code: chipCode } : {}),
          ...(name ? { name } : {}),
          ...(idCode ? { id_code: idCode } : {}),
        } : null,
        diagnostics: {
          status: result.status,
          responseTimeMs: result.diagnostics?.responseTimeMs || 0,
          requestUrl: result.diagnostics?.requestUrl || result.diagnostics?.endpoint || null,
          sortedQuery: result.diagnostics?.sortedQuery || null,
          rawQueryString: result.diagnostics?.rawQueryString || null,
          bodyHash: result.diagnostics?.bodyHash || null,
          signatureLength: result.diagnostics?.signatureLength || null,
          responseBodyText: result.diagnostics?.responseBodyText || null,
          requestHeaders: result.diagnostics?.requestHeaders || null,
          responseHeaders: result.diagnostics?.responseHeaders || null,
          authAudit: result.diagnostics?.authAudit || null,
        },
      });
    }

    if (!downloadUrl) {
      const cached = refresh ? null : eventId ? await loadCachedParticipantsForEventId(String(eventId)) : await loadCachedParticipantsForEventUuid(String(resolvedEventUuid));
      if (cached?.participants?.length) {
        console.warn('[provider/participants] download_url missing, using cached participants', {
          eventUuid: resolvedEventUuid,
          cachedEventId: cached.eventId,
          count: cached.participants.length,
        });
        return NextResponse.json({
          success: true,
          cached: true,
          source: 'cache',
          eventId: cached.eventId,
          participants: cached.participants,
          count: cached.participants.length,
          message: 'Using cached participants because the provider response was incomplete.',
        });
      }
      throw new Error('Feibot did not return download_url');
    }

    const participantResponse = await fetch(downloadUrl);

    if (!participantResponse.ok) {
      throw new Error(`Unable to download participant file (${participantResponse.status})`);
    }

    const participantJson = await participantResponse.json();

  const data = participantJson || {};

    await archiveRawResponse(
      String(resolvedEventUuid),
      hasParticipantFilters ? 'participantsQuery' : 'participantsGetAll',
      hasParticipantFilters ? '/temporary/participantsQuery' : '/temporary/participantsGetAll',
      hasParticipantFilters
        ? {
            event_uuid: String(resolvedEventUuid),
            ...(bib ? { bib } : {}),
            ...(chipCode ? { chip_code: chipCode } : {}),
            ...(name ? { name } : {}),
            ...(idCode ? { id_code: idCode } : {}),
          }
        : { event_uuid: String(resolvedEventUuid) },
      data,
      {
        method: 'GET',
        httpStatus: result.status,
        responseTimeMs: result.diagnostics?.responseTimeMs || 0,
        requestSignature: result.diagnostics?.requestSignature || '',
      },
    );

    const participants = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

    return NextResponse.json({
      success: true,
      participants,
      count: participants.length,
      resolvedEventUuid,
      source: 'integration-store',
      cloudEventUuid: null,
      legacyEventUuid: null,
    });
  } catch (_error) {
    if (upstreamCallSucceeded) {
      return NextResponse.json(
        { success: false, message: 'Provider participant payload could not be processed.' },
        { status: 500 }
      );
    }

    try {
      const url = new URL(req.url);
      const eventId = url.searchParams.get('eventId');
      if (eventId) {
        const cached = await loadCachedParticipantsForEventId(String(eventId));
        if (cached?.participants?.length) {
          return NextResponse.json({
            success: true,
            cached: true,
            source: 'cache',
            eventId: cached.eventId,
            participants: cached.participants,
            count: cached.participants.length,
            message: 'Using cached participants because the provider request failed.',
          });
        }
      }
    } catch {
      // ignore cache fallback errors
    }
    return NextResponse.json(
      { success: false, message: 'Unable to communicate with timing provider.' },
      { status: 500 }
    );
  }
}
