import { NextRequest, NextResponse } from 'next/server';
import { getFirestoreInstance } from '@/lib/firebaseAdmin';
import { serializeValue, toDateStringSafe, toIsoStringSafe } from '@/lib/utils';
import type { LiveTrackingHubConfig } from '@/lib/types/event';
import { decryptProviderSecret, isEncryptedSecret } from '@/lib/liveTrackingSecret';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest) {
  const expectedToken = process.env.LIVE_TRACKING_INTERNAL_TOKEN;
  if (!expectedToken) return true;
  const token = req.headers.get('x-bergman-internal-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return token === expectedToken;
}

function normalizeLiveTrackingHub(data: Record<string, any>): LiveTrackingHubConfig | null {
  const hub = serializeValue(data.liveTrackingHub || null);
  if (hub) {
    if (hub?.provider === 'feibot' && hub?.feibotConfig) {
      const legacyEncryptedSecret = String(hub.feibotConfig.secretKey || '').trim();
      hub.feibotConfig.secretKey = isEncryptedSecret(legacyEncryptedSecret)
        ? decryptProviderSecret(legacyEncryptedSecret)
        : legacyEncryptedSecret;
      hub.feibotConfig.secretKeyEncrypted = legacyEncryptedSecret;

      const cloud = hub.feibotConfig.cloud || {};
      const cloudEncryptedSecret = String(cloud.secretKey || '').trim();
      const cloudDecryptedSecret = isEncryptedSecret(cloudEncryptedSecret)
        ? decryptProviderSecret(cloudEncryptedSecret)
        : cloudEncryptedSecret;

      const cloudEventUuid = String(cloud.eventUuid || hub.feibotConfig.eventUuid || '').trim();
      const apiBaseUrl = String(cloud.apiBaseUrl || hub.feibotConfig.apiBaseUrl || 'https://apicn.feibot.com').trim() || 'https://apicn.feibot.com';
      const accessKey = String(cloud.accessKey || hub.feibotConfig.accessKey || '').trim();

      hub.feibotConfig.eventUuid = cloudEventUuid;
      hub.feibotConfig.apiBaseUrl = apiBaseUrl;
      hub.feibotConfig.accessKey = accessKey;
      hub.feibotConfig.secretKey = cloudDecryptedSecret || hub.feibotConfig.secretKey;
      hub.feibotConfig.cloud = {
        ...cloud,
        eventUuid: cloudEventUuid,
        apiBaseUrl,
        accessKey,
        secretKey: cloudDecryptedSecret,
        secretKeyEncrypted: cloudEncryptedSecret,
      };

      const scoreEventUuid = String(hub?.feibotConfig?.score?.eventUuid || '').trim();
      hub.feibotConfig.score = {
        ...(hub.feibotConfig.score || {}),
        eventUuid: scoreEventUuid,
        overviewUrl: scoreEventUuid ? `https://score.feibot.com/?id=${encodeURIComponent(scoreEventUuid)}` : '',
        progressUrl: scoreEventUuid
          ? `https://score.feibot.com/onlineDateQuery/index.html#/progress/event?event_uuid=${encodeURIComponent(scoreEventUuid)}`
          : '',
        available: !!scoreEventUuid,
      };
    }
    return hub as LiveTrackingHubConfig;
  }

  const legacy = serializeValue(data.liveTracking || null);
  if (!legacy || typeof legacy !== 'object') return null;

  return {
    ...legacy,
    provider: legacy.provider || 'manual',
    trackingConfig: {
      enabled: legacy.enabled ?? legacy.trackingConfig?.enabled ?? false,
      showOnHomepage: data.showLiveTrackingOnHomepage ?? legacy.trackingConfig?.showOnHomepage ?? false,
      edgeCacheSeconds: legacy.trackingConfig?.edgeCacheSeconds ?? 15,
      spectatorSoftLimit: legacy.trackingConfig?.spectatorSoftLimit,
      enableAthleteSearch: legacy.trackingConfig?.enableAthleteSearch,
      enableReplayMode: legacy.trackingConfig?.enableReplayMode,
      enableClubRankings: legacy.trackingConfig?.enableClubRankings,
    },
  } as LiveTrackingHubConfig;
}

function getParticipantBib(participant: Record<string, any>) {
  return String(participant.bibNumber || participant.bib || participant.bib_no || participant.number || '').trim();
}

function getParticipantChip(participant: Record<string, any>) {
  return String(participant.timingChipId || participant.chipCode || participant.chip || participant.chipId || '').trim();
}

function isCancelledParticipant(participant: Record<string, any>) {
  const status = String(participant.ticketStatus || participant.status || participant.registrationStatus || '').trim().toLowerCase();
  return status === 'cancelled' || status === 'canceled' || status === 'refunded';
}

function countDuplicateValues(values: string[]) {
  const seen = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  let duplicates = 0;
  for (const count of seen.values()) {
    if (count > 1) duplicates += count - 1;
  }
  return duplicates;
}

export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const eventId = String(params.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ success: false, message: 'eventId is required' }, { status: 400 });
    }

    const db = getFirestoreInstance();
    const eventRef = db.collection('events').doc(eventId);
    const snap = await eventRef.get();
    if (!snap.exists) {
      return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    }

    const data = snap.data() || {};
    const serializedData = serializeValue(data);
    const hub = normalizeLiveTrackingHub(data);

    const participantsSnapshot = await eventRef.collection('participants').get();
    const participants = participantsSnapshot.docs.map((participantDoc) => serializeValue({
      id: participantDoc.id,
      ...participantDoc.data(),
    })) as Array<Record<string, any>>;

    const activeParticipants = participants.filter((participant) => !isCancelledParticipant(participant));
    const registeredBibNumbers = activeParticipants.map(getParticipantBib).filter(Boolean);
    const missingChips = activeParticipants.filter((participant) => !getParticipantChip(participant)).length;
    const duplicates = countDuplicateValues(registeredBibNumbers);

    const event = {
      id: eventId,
      eventName: serializedData.eventName || serializedData.name || 'Untitled Event',
      raceDate: toDateStringSafe(data.eventDate || data.raceDate || null),
      startTime: serializedData.eventStartTime || serializedData.startTime || null,
      phase: serializedData.phase || null,
      status: serializedData.status || serializedData.eventStatus || 'upcoming',
      updatedAt: toIsoStringSafe(data.updatedAt || null),
      liveTrackingEnabled: hub?.trackingConfig?.enabled ?? Boolean((serializedData.liveTracking || serializedData.liveTrackingHub)?.enabled),
    };

    return NextResponse.json({
      success: true,
      eventId,
      liveTrackingHub: hub,
      liveTracking: serializeValue(data.liveTracking || null),
      liveDataSource: data.liveDataSource || 'none',
      liveTimingConfig: null,
      event,
      eventName: event.eventName,
      eventDate: event.raceDate,
      eventStartTime: event.startTime,
      status: event.status,
      updatedAt: event.updatedAt,
      registrationStats: {
        registered: activeParticipants.length,
        totalDocuments: participants.length,
        cancelled: Math.max(participants.length - activeParticipants.length, 0),
        withBib: registeredBibNumbers.length,
        bibNumbers: registeredBibNumbers,
        duplicates,
        missingChips,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to load config',
    }, { status: 500 });
  }
}
