import { NextRequest, NextResponse } from 'next/server';
import { getKV } from '@/lib/cloudflare/kv';
import { serializeValue } from '@/lib/utils';
import { getPlaybackUrl } from '@/lib/cloudflare/stream';

export const dynamic = 'force-dynamic';

function normalizeStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return 'offline';
  return status;
}

function firstArray<T = any>(...values: unknown[]): T[] {
  for (const value of values) {
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function deriveSignalStrength(camera: any, isLive: boolean) {
  const runtimeSignal = Number(camera?.signal || camera?.cloudflare?.signal || 0);
  if (Number.isFinite(runtimeSignal) && runtimeSignal > 0) {
    return Math.max(0, Math.min(100, runtimeSignal));
  }

  const bitrate = Number(camera?.bitrate || camera?.cloudflare?.bitrate || 0);
  const fps = Number(camera?.fps || camera?.cloudflare?.fps || 0);
  if (!isLive) return 0;
  if (bitrate >= 6000 || fps >= 50) return 100;
  if (bitrate >= 3000 || fps >= 30) return 90;
  if (bitrate >= 1500 || fps >= 24) return 80;
  if (bitrate > 0 || fps > 0) return 70;
  return 60;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventId: string } },
) {
  const eventId = String(params?.eventId || '').trim();
  if (!eventId) {
    return NextResponse.json({ success: false, error: 'eventId is required' }, { status: 400 });
  }

  const [eventDataKv, liveDataKv] = await Promise.all([
    getKV<Record<string, any>>(`event:${eventId}:data`, 'api-events-live'),
    getKV<Record<string, any>>(`live:event:${eventId}:data`, 'api-events-live'),
  ]);

  const eventData = serializeValue(eventDataKv || liveDataKv || {}) as Record<string, any>;

  const nestedLivestream = serializeValue(eventData?.livestream || {}) as Record<string, any>;
  const cameraRows = firstArray(
    eventData?.liveCameras,
    nestedLivestream?.cameras,
    eventData?.broadcast?.cameras,
    eventData?.broadcast?.liveCameras,
  );

  const cameras = cameraRows.map((camera: any) => {
    const isLive = ['live', 'recording'].includes(normalizeStatus(camera?.status));
    const liveInputId = firstString(camera?.liveInputId, camera?.cloudflare?.liveInputUid);
    const rawPlaybackUid = firstString(camera?.playbackUid, camera?.cloudflare?.playbackUid);
    const playbackUid = rawPlaybackUid && rawPlaybackUid !== liveInputId ? rawPlaybackUid : '';
    const playbackSourceUid = playbackUid || (isLive ? liveInputId : '');
    const playbackHls = firstString(camera?.playbackHls, camera?.cloudflare?.playbackUrl) || (playbackSourceUid ? getPlaybackUrl(playbackSourceUid) : null);
    const bitrate = Number(camera?.bitrate || camera?.cloudflare?.bitrate || 0);
    const fps = Number(camera?.fps || camera?.cloudflare?.fps || 0);

    return {
      id: String(camera?.id || camera?.cameraId || ''),
      name: firstString(camera?.name, 'Camera'),
      cameraType: firstString(camera?.cameraType, 'custom'),
      provider: firstString(camera?.provider, 'cloudflare'),
      liveInputId,
      playbackHls,
      playbackWebRtc: firstString(camera?.playbackWebRtc, playbackSourceUid)
        ? `https://customer-${process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || ''}.cloudflarestream.com/${firstString(camera?.playbackWebRtc, playbackSourceUid)}/webRTC/play`
        : null,
      status: normalizeStatus(camera?.status),
      isLive,
      viewerCount: Number(camera?.viewerCount || camera?.cloudflare?.viewerCount || 0),
      fps,
      bitrate,
      resolution: firstString(camera?.resolution, ''),
      droppedFrames: Number(camera?.droppedFrames || 0),
      latency: Number(camera?.latency || 0),
      recordingEnabled: Boolean(camera?.recordingEnabled),
      recordingId: firstString(camera?.recordingId, camera?.cloudflare?.recordingUid) || null,
      updatedAt: firstString(camera?.updatedAt) || null,
      signal: deriveSignalStrength(camera, isLive),
    };
  });

  const totalViewers = cameras.reduce((sum, camera) => sum + Number(camera.viewerCount || 0), 0);
  const liveCameras = cameras.filter((camera) => camera.isLive).length;

  const leaderboard = firstArray(
    eventData?.leaderboard,
    eventData?.liveLeaderboard,
    eventData?.feibot?.leaderboard,
    nestedLivestream?.leaderboard,
  );

  const streamHealth =
    firstString(
      nestedLivestream?.streamHealth,
      eventData?.streamHealth,
      liveCameras > 0 ? 'healthy' : 'offline',
    ) || 'offline';

  const payload = {
    eventId,
    status: normalizeStatus(firstString(nestedLivestream?.status, liveCameras > 0 ? 'live' : 'offline')),
    viewerCount: Number(nestedLivestream?.currentViewers || totalViewers || 0),
    peakViewers: Number(nestedLivestream?.peakViewers || nestedLivestream?.totalViewers || totalViewers || 0),
    currentCamera: firstString(
      nestedLivestream?.currentCamera,
      cameras.find((camera) => camera.isLive)?.id,
      cameras[0]?.id,
    ) || null,
    streamHealth,
    recordingEnabled: Boolean(nestedLivestream?.recordingEnabled ?? true),
    totalWatchTime: Number(nestedLivestream?.totalWatchTime || 0),
    cameras,
    leaderboard,
    overlays: {
      athlete: eventData?.feibot?.athleteOverlay ?? nestedLivestream?.athleteOverlay ?? null,
      timing: eventData?.feibot?.timingOverlay ?? nestedLivestream?.timingOverlay ?? null,
    },
    meta: {
      source: 'KV:event:{eventId}:data',
      liveCameras,
      totalCameras: cameras.length,
      refreshedAt: new Date().toISOString(),
    },
  };

  return NextResponse.json({ success: true, data: payload });
}
