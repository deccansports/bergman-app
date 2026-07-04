import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { getKV } from '@/lib/cloudflare/kv';
import { getFeibotRuntimeSecretsAsyncForEvent } from '@/lib/feibot-integration/secure-credentials';
import { getStoredFeibotEventCredential, getStoredFeibotGlobalCredential } from '@/lib/feibot-integration/credentials';
import { loadSplitIndex } from '@/lib/splitIndex';

export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

async function loadProviderConfig(eventId: string) {
  const db = getFirestoreInstance();
  const eventSnap = await db.collection('events').doc(eventId).get().catch(() => null);
  const eventData = eventSnap?.exists ? eventSnap.data() || {} : {};
  const hub = (eventData as any)?.liveTrackingHub || {};
  const feibotConfig = hub?.feibotConfig || {};
  const cloud = feibotConfig?.cloud || {};
  const score = feibotConfig?.score || {};

  const providerConfig =
    (await getKV<Record<string, any>>(`live:event:${eventId}:provider-config`, 'api-live-provider-status').catch(() => null)) ||
    (await getKV<Record<string, any>>(`live:event:${eventId}:config`, 'api-live-provider-status').catch(() => null)) ||
    null;

  return {
    trackingConfig: {
      enabled: Boolean(hub?.trackingConfig?.enabled ?? true),
      showOnHomepage: Boolean(hub?.trackingConfig?.showOnHomepage ?? eventData?.showLiveTrackingOnHomepage ?? false),
    },
    feibotConfig: {
      hasCredentials: Boolean(providerConfig?.feibotConfig?.cloud?.hasCredentials ?? feibotConfig?.cloud?.hasCredentials ?? false),
      credentialsSource: normalize(providerConfig?.feibotConfig?.credentialsSource || feibotConfig?.credentialsSource || 'none') || 'none',
      eventUuid: normalize(cloud?.eventUuid || feibotConfig?.eventUuid),
      resolvedEventUuid: normalize(cloud?.eventUuid || feibotConfig?.eventUuid),
      legacyEventUuid: normalize(feibotConfig?.legacyEventUuid || ''),
      apiBaseUrl: normalize(cloud?.apiBaseUrl || feibotConfig?.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
      cloud: {
        eventUuid: normalize(cloud?.eventUuid || ''),
        apiBaseUrl: normalize(cloud?.apiBaseUrl || 'https://apicn.feibot.com') || 'https://apicn.feibot.com',
        hasCredentials: Boolean(providerConfig?.feibotConfig?.cloud?.hasCredentials ?? feibotConfig?.cloud?.hasCredentials ?? false),
      },
      score: {
        eventUuid: normalize(score?.eventUuid || ''),
        overviewUrl: normalize(score?.overviewUrl || ''),
        progressUrl: normalize(score?.progressUrl || ''),
        available: Boolean(score?.available),
      },
      timingRuleSource: normalize(feibotConfig?.timingRuleSource || 'cloud') || 'cloud',
    },
    providerState: providerConfig?.providerState || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = normalize(searchParams.get('eventId'));

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const providerConfig = await loadProviderConfig(eventId);
    const runtime = await getFeibotRuntimeSecretsAsyncForEvent({
      eventId,
      eventUuid: providerConfig.feibotConfig?.eventUuid || providerConfig.feibotConfig?.resolvedEventUuid || undefined,
      credentialType: 'auto',
    }).catch(() => null);
    const eventCredential = await getStoredFeibotEventCredential(eventId).catch(() => null);
    const accountCredential = await getStoredFeibotGlobalCredential().catch(() => null);
    const splitIndex = await loadSplitIndex(eventId).catch(() => null);

    const timingConfiguration =
      (await getKV<Record<string, any>>(`event:${eventId}:timingConfiguration`, 'api-live-provider-status').catch(() => null)) ||
      (await getKV<Record<string, any>>(`live:event:${eventId}:timingConfiguration`, 'api-live-provider-status').catch(() => null)) ||
      null;

    const timingRulesAvailable = Boolean(timingConfiguration);
    const participantsAvailable = Boolean(
      (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants:index`, 'api-live-provider-status').catch(() => null)) ||
      (await getKV<Record<string, any>>(`event:${eventId}:providerParticipants:index`, 'api-live-provider-status').catch(() => null)) ||
      (await getKV<Record<string, any>>(`live:event:${eventId}:providerParticipants`, 'api-live-provider-status').catch(() => null)) ||
      (await getKV<Record<string, any>>(`event:${eventId}:providerParticipants`, 'api-live-provider-status').catch(() => null))
    );

    return NextResponse.json({
      success: true,
      eventId,
      providerConnected: Boolean(providerConfig.feibotConfig.eventUuid || providerConfig.feibotConfig.resolvedEventUuid),
      credentialSource: runtime?.source || providerConfig.feibotConfig.credentialsSource || 'none',
      credentialMode: runtime?.credentialType || 'auto',
      akPresent: Boolean(String(runtime?.accessKey || '').trim()),
      skPresent: Boolean(String(runtime?.secretKey || '').trim()),
      eventCredentialConfigured: Boolean(eventCredential?.accessKey && eventCredential?.secretKey),
      accountCredentialConfigured: Boolean(accountCredential?.accessKey && accountCredential?.secretKey),
      lastAuthentication: providerConfig.providerState?.authentication || null,
      timingRulesAvailable,
      participantsAvailable,
      contestCount: Number(splitIndex?.contestCount || 0),
      splitCount: Number(splitIndex?.splitCount || 0),
      timingPointCount: Number(splitIndex?.timingPointCount || 0),
      providerConfig,
      splitIndex: splitIndex || null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to load provider status' }, { status: 500 });
  }
}
