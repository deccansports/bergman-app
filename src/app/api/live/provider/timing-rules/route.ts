import { NextRequest, NextResponse } from 'next/server';
import { fetchTimingRules } from '@/lib/feibot-integration/api-client';
import { archiveRawResponse } from '@/lib/feibot-integration/kv-archive';
import { loadFeibotIntegration, loadFeibotIntegrationSecrets } from '@/lib/feibot-integration/integration-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get('eventId');
    const integrationSecrets = eventId ? await loadFeibotIntegrationSecrets(eventId) : null;
    const integration = eventId ? await loadFeibotIntegration(eventId) : null;
    const cloudEventUuid = String(integration?.cloudEventUuid || integration?.selectedEvent?.cloudUuid || integration?.eventUuid || integrationSecrets?.cloudEventUuid || '').trim();
    const credentialBoundEventUuid = String(integration?.credentialBoundEventUuid || integration?.eventUuid || integrationSecrets?.credentialBoundEventUuid || '').trim();
    const eventUuid = String(integrationSecrets?.eventUuid || cloudEventUuid || '').trim();
    const credentialType = integrationSecrets?.credentialType || integration?.credentialType || null;

    console.log('[REBUILD] Event', eventId || '(no-event-id)');

    if (!eventUuid) {
      return NextResponse.json(
        { success: false, message: 'No Feibot Event UUID configured. Authenticate and discover events first.' },
        { status: 400 }
      );
    }

    const secrets = integrationSecrets || await loadFeibotIntegrationSecrets(eventId || '').catch(() => null);
    if (!secrets) {
      return NextResponse.json({ success: false, message: 'No Feibot Event UUID configured. Authenticate and discover events first.' }, { status: 400 });
    }

    console.log('[TIMING RULES REQUEST]', {
      eventId: eventId || null,
      eventUuid,
      cloudEventUuid: cloudEventUuid || null,
      credentialBoundEventUuid: credentialBoundEventUuid || null,
      provider: 'feibot',
      credentialsLoaded: Boolean(secrets),
      credentialsSource: 'integration-store',
      credentialType: credentialType || 'event',
      accessKeyPresent: Boolean(String(secrets?.accessKey || '').trim()),
      secretKeyPresent: Boolean(String(secrets?.secretKey || '').trim()),
    });

    const tryTimingRules = async (uuid: string) => fetchTimingRules(
      {
        accountId: secrets.accountId,
        accessKey: secrets.accessKey,
        secretKey: secrets.secretKey,
        apiBaseUrl: secrets.apiBaseUrl,
      },
      String(uuid),
      { eventId: eventId || undefined, credentialType: credentialType === 'account' ? 'account' : 'event' },
    );

    let result = await tryTimingRules(cloudEventUuid || eventUuid);
    let usedEventUuid = cloudEventUuid || eventUuid;
    let usedSource: 'cloudEventUuid' | 'credentialBoundEventUuid' = 'cloudEventUuid';

    const needsRetry = !result.ok && ([401, 403].includes(result.status) || !result.data);
    if (needsRetry && credentialBoundEventUuid && credentialBoundEventUuid !== usedEventUuid) {
      console.warn('[TIMING RULES REQUEST] retrying with credential-bound UUID', {
        eventId: eventId || null,
        cloudEventUuid: cloudEventUuid || null,
        credentialBoundEventUuid,
      });
      const retryResult = await tryTimingRules(credentialBoundEventUuid);
      if (retryResult.ok) {
        result = retryResult;
        usedEventUuid = credentialBoundEventUuid;
        usedSource = 'credentialBoundEventUuid';
      }
    }

    if (!result.ok) {
      const providerBodyText = String(result?.diagnostics?.responseBodyText || '').trim();
      const providerBodyPreview = providerBodyText ? providerBodyText.slice(0, 2000) : null;
      return NextResponse.json(
        {
          success: false,
          message: [401, 403].includes(result.status)
            ? 'Authentication failed while calling Feibot timing rules endpoint.'
            : 'Unable to communicate with timing provider.',
          providerStatus: result.status,
          providerResponse: providerBodyPreview,
          diagnostics: {
            requestUrl: result?.diagnostics?.requestUrl || result?.diagnostics?.endpoint || null,
            path: result?.diagnostics?.path || null,
            method: result?.diagnostics?.method || null,
            timestamp: result?.diagnostics?.timestamp || null,
            sortedQuery: result?.diagnostics?.sortedQuery || null,
            signatureLength: result?.diagnostics?.signatureLength || null,
            bodyHash: result?.diagnostics?.bodyHash || null,
            accessKey: result?.diagnostics?.masked?.['X-Feibot-AK'] || null,
            credentialsSource: secrets?.source || 'unknown',
            authAudit: result?.diagnostics?.authAudit || null,
            attemptedEventUuids: [cloudEventUuid || null, credentialBoundEventUuid || null].filter(Boolean),
          },
        },
        { status: [401, 403].includes(result.status) ? result.status : 502 }
      );
    }

    const data: any = result.data || {};

    await archiveRawResponse(
      String(usedEventUuid),
      'timingRulesGet',
      '/eventConfigFile/timingRulesGet',
      { event_uuid: String(usedEventUuid) },
      data,
      {
        method: 'GET',
        httpStatus: result.status,
        responseTimeMs: result.diagnostics?.responseTimeMs || 0,
        requestSignature: result.diagnostics?.requestSignature || '',
      },
    );

    const meta = data?.timing_rules?.meta || data?.timingRules?.meta || data?.meta || {};

    const timingRulesPayload = data?.timing_rules || data?.timingRules || data?.data?.timing_rules || data?.data?.timingRules || data;
    const timingRules = {
      contests: Array.isArray(timingRulesPayload?.contests)
        ? timingRulesPayload.contests
        : Array.isArray(data?.contests)
          ? data.contests
          : Array.isArray(data?.data?.contests)
            ? data.data.contests
            : [],
      splits: Array.isArray(timingRulesPayload?.splits)
        ? timingRulesPayload.splits
        : Array.isArray(data?.splits)
          ? data.splits
          : Array.isArray(data?.data?.splits)
            ? data.data.splits
            : [],
      timingPoints: Array.isArray(timingRulesPayload?.timing_points)
        ? timingRulesPayload.timing_points
        : Array.isArray(timingRulesPayload?.timingPoints)
          ? timingRulesPayload.timingPoints
          : Array.isArray(data?.timing_points)
            ? data.timing_points
            : Array.isArray(data?.timingPoints)
              ? data.timingPoints
              : Array.isArray(data?.data?.timing_points)
                ? data.data.timing_points
                : [],
      ageGroups: Array.isArray(timingRulesPayload?.age_groups)
        ? timingRulesPayload.age_groups
        : Array.isArray(timingRulesPayload?.ageGroups)
          ? timingRulesPayload.ageGroups
          : Array.isArray(data?.age_groups)
            ? data.age_groups
            : Array.isArray(data?.ageGroups)
              ? data.ageGroups
              : Array.isArray(data?.data?.age_groups)
                ? data.data.age_groups
                : [],
      legs: Array.isArray(timingRulesPayload?.legs)
        ? timingRulesPayload.legs
        : Array.isArray(data?.legs)
          ? data.legs
          : [],
      updatedAt: Number(meta?.updated_at || meta?.updatedAt || timingRulesPayload?.updated_at || timingRulesPayload?.updatedAt || data?.updated_at || data?.updatedAt || 0) || new Date().toISOString(),
    };

    console.log('[REBUILD] Contests', timingRules.contests.length);
    for (const contest of timingRules.contests as any[]) {
      const contestName = String(contest?.contest_name || contest?.contestName || contest?.name || contest?.Name || contest?.contest_uuid || contest?.contestUuid || 'Unknown Contest');
      const contestUuid = String(contest?.contest_uuid || contest?.contestUuid || contest?.uuid || contest?.id || '').trim();
      const generatedSplits = (timingRules.splits as any[]).filter((split) => {
        const splitContestUuid = String(split?.contest_uuid || split?.contestUuid || split?.contest_id || split?.contestId || '').trim();
        return contestUuid && splitContestUuid ? splitContestUuid === contestUuid : false;
      });
      console.log('[REBUILD]', contestName, generatedSplits.length);
    }

    return NextResponse.json({
      success: true,
      timingRules,
      resolvedEventUuid: usedEventUuid,
      usedEventUuidSource: usedSource,
      source: 'integration-store',
      cloudEventUuid: cloudEventUuid || null,
      legacyEventUuid: credentialBoundEventUuid || null,
    });
  } catch (error) {
    console.error('[TIMING RULES ROUTE ERROR]', error);
    return NextResponse.json(
      { success: false, message: 'Unable to communicate with timing provider.' },
      { status: 500 }
    );
  }
}
