// ============================================
// 🔥 BERGMAN TRIATHLON - FINAL WORKER
// API + REALTIME KV SYNC + CRON (PRODUCTION READY)
// ============================================

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // =========================
      // CORS
      // =========================
      if (request.method === "OPTIONS") return handleCORS();

      // =========================
      // HEALTH
      // =========================
      if (path === "/health") {
        return json({ status: "ok" });
      }

      // =========================
      // 🔥 LIVE STREAMING BACKEND
      // =========================
      if (path === "/api/live/create") return handleLiveCreate(request, env);
      if (path === "/api/live/delete") return handleLiveDelete(request, env);
      if (path === "/api/live/start") return handleLiveStart(request, env);
      if (path === "/api/live/webhook") return handleLiveWebhook(request, env);
      if (path === "/api/live/status") return handleLiveStatus(request, env);
      if (path === "/api/live/player") return handleLivePlayer(request, env);
      if (path === "/api/live/replay") return handleLiveReplay(request, env);
      if (path === "/api/live/analytics") return handleLiveAnalytics(request, env);
      if (path === "/api/live/sync") return handleLiveSync(request, env);

      // =========================
      // 🔥 REALTIME SYNC WEBHOOK
      // =========================
      if (path === "/sync/webhook") {
        return handleWebhook(request, env);
      }

      // =========================
      // ATHLETE ROUTES
      // =========================
      if (path === "/athlete/upcoming") return handleUpcoming(request, env);
      if (path === "/athlete/past") return handlePast(request, env);
      if (path === "/athlete/all") return handleAll(request, env);
      if (path === "/athlete/participant") return handleParticipant(request, env);

      // =========================
      // DEBUG
      // =========================
      if (path === "/debug/kv") return debugKV(env);
      if (path === "/debug/sample") return debugSample(env);
      if (path === "/admin/rebuild-index") return rebuildIndex(env);

      return json({ error: "Route not found", path }, 404);

    } catch (err) {
      console.log("ERROR:", err);
      return json({ error: "Internal Error", message: err.message }, 500);
    }
  },

  // =========================
  // 🔥 SCHEDULED HANDLERS (CRON)
  // =========================
  async scheduled(event, env, ctx) {
    // Birthday campaign cron trigger (IST 04:30 & 04:35 UTC = 10:00 & 10:05 IST)
    console.log("[CRON] Scheduled event triggered:", new Date().toISOString());
    
    try {
      const syncSummary = await syncAllLiveCameras(env);
      console.log("[CRON] Live sync summary:", syncSummary);

      // Call the Next.js API endpoint for birthday campaign
      const baseUrl = env.API_BASE_URL || "https://bergman.live";
      const secret = env.SYNC_SECRET;
      
      if (!secret) {
        console.error("[CRON] SYNC_SECRET not configured");
        return;
      }

      const response = await fetch(`${baseUrl}/api/jobs/birthday-campaign-daily`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      console.log("[CRON] Birthday campaign result:", result);
      
      if (!response.ok) {
        console.error("[CRON] Birthday campaign failed:", result);
      }
    } catch (error) {
      console.error("[CRON] Error executing birthday campaign:", error?.message || error);
    }
  }
};

// ============================================
// 🔥 WEBHOOK (REALTIME SYNC)
// ============================================

function verifyLiveWebhookAuth(request, env) {
  const expected = String(env.SYNC_SECRET || '').trim();
  if (!expected) return false;

  const authorization = String(request.headers.get('authorization') || '').trim();
  const apiKey = String(request.headers.get('x-api-key') || '').trim();

  if (authorization === `Bearer ${expected}`) return true;
  if (apiKey === expected) return true;
  return false;
}

async function handleWebhook(request, env) {
  if (!verifyLiveWebhookAuth(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json();
  const { type, data, id } = body;

  try {
    // ==========================
    // PARTICIPANT
    // ==========================
    if (type === "participant") {
      const key = `event:${data.eventId}:participant:${data.bookingId}`;

      await env.BERGMAN_KV.put(key, JSON.stringify(data));
      await updateAthleteIndex(env, data);
    }

    // ==========================
    // EVENT
    // ==========================
    if (type === "event") {
      const key = `event:${id}`;
      await env.BERGMAN_KV.put(key, JSON.stringify(data));
    }

    // ==========================
    // USER
    // ==========================
    if (type === "user") {
      const key = `user:${id}`;

      await env.BERGMAN_KV.put(key, JSON.stringify({
        name: data.name,
        email: data.email,
        mobile: data.mobile
      }));
    }

    return json({ success: true });

  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// ============================================
// UPCOMING EVENTS
// ============================================

async function handleUpcoming(request, env) {
  const { email, athleteUid } = getParams(request);

  if (!email && !athleteUid) {
    return json({ error: "email or athleteUid required" }, 400);
  }

  const today = getToday();
  const bookings = await getBookingsIndex(email, athleteUid, env);

  const results = [];

  for (const booking of bookings) {
    if (!booking.eventDate) continue;
    if (booking.eventDate < today) continue;

    const data = await getParticipant(env, booking);
    if (!data) continue;

    if (data.ticketStatus && data.ticketStatus !== "Active") continue;

    results.push(formatParticipant(data));
  }

  return json({
    count: results.length,
    events: groupByEvent(results)
  });
}

// ============================================
// PAST EVENTS
// ============================================

async function handlePast(request, env) {
  const { email, athleteUid } = getParams(request);

  const today = getToday();
  const bookings = await getBookingsIndex(email, athleteUid, env);

  const results = [];

  for (const booking of bookings) {
    if (!booking.eventDate) continue;
    if (booking.eventDate >= today) continue;

    const data = await getParticipant(env, booking);
    if (!data) continue;

    results.push(formatParticipant(data));
  }

  return json({
    count: results.length,
    events: groupByEvent(results)
  });
}

// ============================================
// ALL EVENTS
// ============================================

async function handleAll(request, env) {
  const { email, athleteUid } = getParams(request);

  const bookings = await getBookingsIndex(email, athleteUid, env);

  const results = [];

  for (const booking of bookings) {
    const data = await getParticipant(env, booking);
    if (!data) continue;

    results.push(formatParticipant(data));
  }

  return json({
    count: results.length,
    events: groupByEvent(results)
  });
}

// ============================================
// FULL PARTICIPANT
// ============================================

async function handleParticipant(request, env) {
  const { searchParams } = new URL(request.url);

  const eventId = searchParams.get("eventId");
  const bookingId = searchParams.get("bookingId");

  if (!eventId || !bookingId) {
    return json({ error: "eventId & bookingId required" }, 400);
  }

  const data = await env.BERGMAN_KV.get(
    `event:${eventId}:participant:${bookingId}`,
    "json"
  );

  if (!data) return json({ error: "Participant not found" }, 404);

  return json(data);
}

// ============================================
// 🔥 LIVE STREAMING BACKEND
// ============================================

function getLiveCameraKeys(eventId, cameraId) {
  const resolvedEventId = String(eventId || "").trim();
  const resolvedCameraId = String(cameraId || "").trim();

  return [
    resolvedEventId && resolvedCameraId ? `live:${resolvedEventId}:camera:${resolvedCameraId}` : null,
    resolvedCameraId ? `camera:${resolvedCameraId}` : null,
  ].filter(Boolean);
}

function getPlaybackUrl(playbackUid) {
  const uid = String(playbackUid || "").trim();
  return uid ? `https://videodelivery.net/${uid}/manifest/video.m3u8` : null;
}

async function cloudflareStreamRequest(env, path, init = {}) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(env.CLOUDFLARE_API_TOKEN || "").trim();

  if (!accountId || !apiToken) {
    throw new Error("Cloudflare Stream credentials are not configured");
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message = payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || `Cloudflare request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  return payload.result;
}

async function fetchCloudflareLiveInput(env, liveInputUid) {
  const uid = String(liveInputUid || "").trim();
  if (!uid) return null;
  const result = await cloudflareStreamRequest(env, `/stream/live_inputs/${encodeURIComponent(uid)}`, { method: "GET" });
  return result || null;
}

async function fetchCloudflareLifecycle(env, liveInputUid) {
  const uid = String(liveInputUid || "").trim();
  if (!uid) return null;
  const customerCode = String(env.CLOUDFLARE_STREAM_CUSTOMER_CODE || env.CLOUDFLARE_CUSTOMER_CODE || "").trim();
  const lifecycleUrl = customerCode
    ? `https://customer-${customerCode}.cloudflarestream.com/${encodeURIComponent(uid)}/lifecycle`
    : `https://videodelivery.net/${encodeURIComponent(uid)}/lifecycle`; 
  const response = await fetch(lifecycleUrl, { method: 'GET' });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || result?.error || `Cloudflare lifecycle request failed (${response.status})`);
  }
  return result || null;
}

async function fetchCloudflareVideos(env, liveInputUid) {
  const uid = String(liveInputUid || "").trim();
  if (!uid) return [];
  const result = await cloudflareStreamRequest(env, `/stream/live_inputs/${encodeURIComponent(uid)}/videos`, { method: "GET" });
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.videos)) return result.videos;
  return [];
}

function pickLatestVideo(videos) {
  const list = Array.isArray(videos) ? [...videos] : [];
  list.sort((a, b) => {
    const aTime = new Date(a?.created || a?.createdAt || a?.created_at || 0).getTime();
    const bTime = new Date(b?.created || b?.createdAt || b?.created_at || 0).getTime();
    return bTime - aTime;
  });
  return list[0] || null;
}

function buildIframeUrl(videoUID, env) {
  const uid = String(videoUID || "").trim();
  if (!uid) return null;
  const customerCode = String(env?.CLOUDFLARE_STREAM_CUSTOMER_CODE || env?.CLOUDFLARE_CUSTOMER_CODE || "").trim();
  if (!customerCode) return `https://videodelivery.net/${uid}/iframe`;
  return `https://customer-${customerCode}.cloudflarestream.com/${uid}/iframe`;
}

function normalizeRecordingMode(value) {
  return String(value || 'off').trim().toLowerCase() || 'off';
}

function titleCase(value) {
  const text = String(value || '').replace(/_/g, ' ').trim();
  if (!text) return '';
  return text.replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeCloudflareStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'WAITING';
  if (['connected', 'live', 'recording'].includes(raw)) return 'LIVE';
  if (['reconnecting'].includes(raw)) return 'RECONNECTING';
  if (['client_disconnect', 'ttl_exceeded', 'failed_to_connect', 'disconnected', 'offline', 'stopped', 'ended'].includes(raw)) return 'OFFLINE';
  if (['error', 'failed', 'invalid'].includes(raw)) return 'ERROR';
  return 'WAITING';
}

function statusTone(status) {
  if (status === 'LIVE') return 'live';
  if (status === 'RECONNECTING') return 'reconnecting';
  if (status === 'OFFLINE') return 'offline';
  if (status === 'ERROR') return 'error';
  return 'waiting';
}

function getExpectedBitrateKbps(state) {
  const resolution = String(state?.resolution || state?.cloudflare?.resolution || '').trim().toLowerCase();
  if (resolution.includes('1080')) return 6000;
  if (resolution.includes('720')) return 3000;
  if (resolution.includes('480')) return 1500;
  const height = Number(state?.height || state?.videoHeight || state?.cloudflare?.height || 0);
  if (height >= 1080) return 6000;
  if (height >= 720) return 3000;
  if (height >= 480) return 1500;
  return Number(state?.expectedBitrate || state?.targetBitrate || state?.cloudflare?.expectedBitrate || 6000) || 6000;
}

function deriveSignalPercentage(state) {
  const bitrate = Number(state?.bitrate || state?.currentBitrate || state?.cloudflare?.bitrate || 0);
  const expected = getExpectedBitrateKbps(state);
  if (!Number.isFinite(bitrate) || bitrate <= 0) return 0;
  if (!Number.isFinite(expected) || expected <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((bitrate / expected) * 100)));
}

function connectionHealthLabel(signal, live, connected) {
  if (!connected) return 'Offline';
  if (!live) return 'Waiting';
  if (signal >= 85) return 'Excellent';
  if (signal >= 70) return 'Good';
  if (signal >= 40) return 'Fair';
  if (signal > 0) return 'Poor';
  return 'Offline';
}

function derivePlaybackSource(state) {
  const isLive = Boolean(state?.live ?? state?.connected ?? ['LIVE', 'RECONNECTING'].includes(normalizeCloudflareStatus(state?.status)));
  const hasVideo = Boolean(state?.videoUID || state?.videoUid || state?.playbackUid || state?.recordingUid);
  const liveInputUid = String(state?.liveInputUid || state?.cloudflare?.liveInputUid || '').trim() || null;
  const videoUID = String(state?.videoUID || state?.videoUid || state?.cloudflare?.videoUid || state?.recordingUid || '').trim() || null;
  return {
    liveInputUid,
    videoUID,
    playbackSource: isLive || !hasVideo ? 'Live Input' : 'Recorded Video',
  };
}

function buildPlaybackSnapshot(state, env) {
  const source = derivePlaybackSource(state);
  const sourceUid = source.playbackSource === 'Live Input' ? source.liveInputUid : (source.videoUID || source.liveInputUid || null);
  const playbackUrl = String(state?.playbackUrl || state?.cloudflare?.playbackUrl || '').trim() || (sourceUid ? getPlaybackUrl(sourceUid) : null);
  const iframeUrl = sourceUid ? buildIframeUrl(sourceUid, env) : null;
  const liveInputUid = source.liveInputUid;
  const recordingVideoUid = source.videoUID;
  const recordingReady = Boolean(recordingVideoUid);
  const replayReady = Boolean(recordingVideoUid);
  return {
    liveInputUid,
    recordingVideoUid,
    playbackSource: source.playbackSource,
    livePlayback: liveInputUid ? 'Ready' : 'Pending',
    recording: recordingReady ? 'Ready' : 'Pending',
    replay: replayReady ? 'Ready' : 'Pending',
    playbackUid: sourceUid,
    playbackUrl,
    iframeUrl,
    manifest: playbackUrl,
    thumbnailUrl: String(state?.thumbnailUrl || state?.cloudflare?.thumbnailUrl || '').trim() || null,
    durationSeconds: Number(state?.durationSeconds || state?.duration || state?.cloudflare?.durationSeconds || 0) || null,
    ready: Boolean(playbackUrl),
  };
}

function deriveSignalStrength(state) {
  const runtimeSignal = Number(state?.signal || state?.cloudflare?.signal || 0);
  if (Number.isFinite(runtimeSignal) && runtimeSignal > 0) {
    return Math.max(0, Math.min(100, runtimeSignal));
  }

  const status = String(state?.status || state?.connectionStatus || state?.cloudflareStatus || 'offline').trim().toLowerCase();
  const connected = Boolean(state?.connected ?? ['connected', 'reconnecting', 'live'].includes(status));
  const bitrate = Number(state?.bitrate || state?.currentBitrate || state?.cloudflare?.bitrate || 0);
  const fps = Number(state?.fps || state?.frameRate || state?.cloudflare?.fps || 0);

  if (!connected) return 0;
  if (bitrate >= 6000 || fps >= 50) return 100;
  if (bitrate >= 3000 || fps >= 30) return 90;
  if (bitrate >= 1500 || fps >= 24) return 80;
  if (bitrate > 0 || fps > 0) return 70;
  return 60;
}

function normalizeCloudflareState(state) {
  const rawStatus = String(state?.status || state?.connectionStatus || state?.cloudflareStatus || '').trim().toLowerCase();
  const status = normalizeCloudflareStatus(rawStatus);
  const live = Boolean(state?.live ?? (status === 'LIVE' || ['LIVE', 'RECONNECTING'].includes(status)));
  const connected = Boolean(state?.connected ?? ['LIVE', 'RECONNECTING'].includes(status));
  const playback = buildPlaybackSnapshot(state, { CLOUDFLARE_STREAM_CUSTOMER_CODE: state?.customerCode || state?.cloudflare?.customerCode });
  const signal = deriveSignalPercentage(state);
  const bitrate = Number(state?.bitrate || state?.currentBitrate || state?.cloudflare?.bitrate || 0);
  const fps = Number(state?.fps || state?.frameRate || state?.cloudflare?.fps || 0);
  const playbackSource = playback.playbackSource;
  return {
    live,
    connected,
    status,
    statusLabel: status,
    connection: connectionHealthLabel(signal, live, connected),
    signal,
    protocol: String(state?.protocol || state?.streamProtocol || 'RTMP').trim() || 'RTMP',
    bitrate,
    fps,
    viewers: Number(state?.viewers || state?.currentViewers || state?.viewerCount || state?.viewer_count || 0),
    currentViewers: Number(state?.currentViewers || state?.viewers || state?.viewerCount || 0),
    peakViewers: Number(state?.peakViewers || state?.viewers || state?.viewerCount || 0),
    averageViewers: Number(state?.averageViewers || state?.currentViewers || state?.viewers || 0),
    playbackUid: playback.playbackUid,
    videoUID: playback.recordingVideoUid,
    playbackSource,
    liveInputUid: playback.liveInputUid,
    playbackUrl: playback.playbackUrl,
    iframeUrl: playback.iframeUrl,
    manifest: playback.manifest,
    thumbnailUrl: playback.thumbnailUrl,
    durationSeconds: playback.durationSeconds,
    recordingReady: playback.ready,
    replayAvailable: playback.ready,
    recordingMode: normalizeRecordingMode(state?.recordingMode || state?.cloudflare?.recordingMode),
    startedAt: state?.startedAt || state?.liveSince || null,
    endedAt: state?.endedAt || null,
    duration: Number(state?.duration || state?.durationSeconds || 0) || null,
    uptime: Number(state?.uptime || state?.cloudflare?.uptime || 0) || null,
  };
}

async function syncLiveCameraFromCloudflare(env, state) {
  const current = state || {};
  const liveInputUid = String(current.liveInputUid || current.cloudflare?.liveInputUid || '').trim();
  if (!liveInputUid) return current;
  const previousLive = Boolean(current.live ?? current.connected ?? ['LIVE', 'RECONNECTING'].includes(normalizeCloudflareStatus(current.status)));

  const [liveInput, lifecycle] = await Promise.all([
    fetchCloudflareLiveInput(env, liveInputUid).catch(() => null),
    fetchCloudflareLifecycle(env, liveInputUid).catch(() => null),
  ]);

  const lifecycleLive = Boolean(lifecycle?.live ?? liveInput?.live ?? liveInput?.connected);
  const videos = lifecycleLive ? [] : await fetchCloudflareVideos(env, liveInputUid).catch(() => []);
  const latestVideo = pickLatestVideo(videos);
  const recordingVideoUid = String(lifecycle?.videoUID || lifecycle?.videoUid || latestVideo?.uid || current.videoUID || current.cloudflare?.videoUid || '').trim() || null;
  const nowIso = new Date().toISOString();
  const startedAt = previousLive ? (current.startedAt || liveInput?.startedAt || lifecycle?.startedAt || nowIso) : (lifecycleLive ? (current.startedAt || liveInput?.startedAt || lifecycle?.startedAt || nowIso) : current.startedAt || liveInput?.startedAt || lifecycle?.startedAt || null);
  const endedAt = lifecycleLive ? null : (previousLive ? (current.endedAt || nowIso) : current.endedAt || null);
  const derived = normalizeCloudflareState({
    live: lifecycleLive,
    connected: Boolean(liveInput?.connected ?? lifecycle?.live ?? lifecycle?.connected),
    status: String(liveInput?.status || lifecycle?.status || current.status || 'offline').trim() || 'offline',
    protocol: liveInput?.protocol || lifecycle?.protocol || current.protocol || 'RTMP',
    bitrate: liveInput?.bitrate || lifecycle?.bitrate || current.bitrate || 0,
    fps: liveInput?.fps || lifecycle?.fps || current.fps || 0,
    viewers: liveInput?.viewers || lifecycle?.viewers || current.viewers || 0,
    videoUID: recordingVideoUid,
    playbackUrl: lifecycleLive ? buildPlaybackSnapshot({ ...current, live: true, connected: true, liveInputUid, cloudflare: { ...(current.cloudflare || {}), liveInputUid } }, { CLOUDFLARE_STREAM_CUSTOMER_CODE: env.CLOUDFLARE_STREAM_CUSTOMER_CODE || env.CLOUDFLARE_CUSTOMER_CODE }).playbackUrl : (latestVideo?.uid ? getPlaybackUrl(latestVideo.uid) : current.playbackUrl),
    startedAt,
    endedAt,
    duration: latestVideo?.duration || latestVideo?.durationSeconds || current.duration || null,
    thumbnailUrl: latestVideo?.thumbnail || latestVideo?.thumbnailUrl || current.thumbnailUrl || null,
    recordingMode: String(liveInput?.recording?.mode || lifecycle?.recordingMode || current.cloudflare?.recordingMode || 'off').trim() || 'off',
  });

  const playbackUid = lifecycleLive ? liveInputUid : (derived.videoUID || liveInputUid);
  const playbackSnapshot = buildPlaybackSnapshot({
    ...current,
    ...derived,
    live: lifecycleLive,
    connected: Boolean(liveInput?.connected ?? lifecycle?.live ?? lifecycle?.connected),
    liveInputUid,
    videoUID: recordingVideoUid,
    playbackUid,
    startedAt,
    endedAt,
    bitrate: derived.bitrate,
    fps: derived.fps,
    viewers: derived.viewers,
    recordingMode: derived.recordingMode,
  }, {
    CLOUDFLARE_STREAM_CUSTOMER_CODE: env.CLOUDFLARE_STREAM_CUSTOMER_CODE || env.CLOUDFLARE_CUSTOMER_CODE,
  });

  const analytics = updateAnalyticsSnapshot(current, {
    ...derived,
    live: lifecycleLive,
    connected: Boolean(liveInput?.connected ?? lifecycle?.live ?? lifecycle?.connected),
    startedAt,
    endedAt,
    bitrate: derived.bitrate,
    fps: derived.fps,
    viewers: derived.currentViewers || derived.viewers,
  });

  const nextState = {
    ...current,
    ...derived,
    ...analytics,
    playbackUid,
    videoUID: recordingVideoUid,
    videoUid: recordingVideoUid,
    playbackSource: playbackSnapshot.playbackSource,
    replayReady: derived.recordingReady,
    recordingReady: derived.recordingReady,
    live: lifecycleLive,
    connected: Boolean(liveInput?.connected ?? lifecycle?.live ?? lifecycle?.connected),
    status: lifecycleLive ? 'live' : (recordingVideoUid ? 'recording' : 'offline'),
    connectionStatus: statusTone(normalizeCloudflareStatus(lifecycleLive ? 'connected' : (recordingVideoUid ? 'connected' : String(liveInput?.status || lifecycle?.status || current.status || 'offline')))),
    updatedAt: new Date().toISOString(),
    cloudflare: {
      ...(current.cloudflare || {}),
      liveInputUid,
      playbackUid,
      playbackUrl: playbackSnapshot.playbackUrl,
      playbackIframeUrl: playbackSnapshot.iframeUrl,
      videoUid: recordingVideoUid,
      recordingUid: latestVideo?.uid || recordingVideoUid || current.cloudflare?.recordingUid || null,
      thumbnailUrl: playbackSnapshot.thumbnailUrl,
      durationSeconds: playbackSnapshot.durationSeconds,
      recordingMode: normalizeRecordingMode(liveInput?.recording?.mode || lifecycle?.recordingMode || current.cloudflare?.recordingMode || 'off'),
      liveInputStatus: liveInput?.status || null,
      lifecycleStatus: lifecycle?.status || null,
      signal: playbackSnapshot.signal,
      bitrate: playbackSnapshot.bitrate,
      fps: playbackSnapshot.fps,
      currentViewers: analytics.currentViewers,
      peakViewers: analytics.peakViewers,
      averageViewers: analytics.averageViewers,
      uptime: analytics.uptime,
    },
  };

  if (lifecycleLive && !previousLive) {
    logLiveEvent('[LIVE_CONNECTED]', { eventId: current.eventId, cameraId: current.cameraId, liveInputUid, playbackSource: 'Live Input' });
    nextState.startedAt = startedAt;
    nextState.lastConnectedAt = nowIso;
  }

  if (!lifecycleLive && previousLive) {
    logLiveEvent('[LIVE_DISCONNECTED]', { eventId: current.eventId, cameraId: current.cameraId, liveInputUid, playbackSource: recordingVideoUid ? 'Recorded Video' : 'Live Input' });
    nextState.endedAt = endedAt;
    nextState.lastDisconnectedAt = nowIso;
  }

  if (recordingVideoUid) {
    logLiveEvent('[LIVE_RECORDING_READY]', { eventId: current.eventId, cameraId: current.cameraId, liveInputUid, videoUID: recordingVideoUid });
  }

  if (playbackSnapshot.ready) {
    logLiveEvent('[LIVE_PLAYBACK_READY]', { eventId: current.eventId, cameraId: current.cameraId, liveInputUid, playbackSource: playbackSnapshot.playbackSource, playbackUid });
  }

  return saveLiveCameraState(env, nextState);
}

async function saveLiveCameraState(env, state) {
  if (!env.BERGMAN_KV) return state;

  const keys = getLiveCameraKeys(state.eventId, state.cameraId);
  const payload = JSON.stringify(state);
  await Promise.all(keys.map((key) => env.BERGMAN_KV.put(key, payload)));
  return state;
}

function logLiveEvent(tag, data) {
  console.log(tag, JSON.stringify({
    timestamp: new Date().toISOString(),
    ...data,
  }));
}

function updateAnalyticsSnapshot(current, next) {
  const previousViewers = Number(current?.currentViewers || current?.viewers || 0);
  const currentViewers = Number(next?.viewers || next?.currentViewers || 0);
  const peakViewers = Math.max(Number(current?.peakViewers || 0), currentViewers);
  const sampleCount = Number(current?.viewerSamples || 0);
  const averageViewers = sampleCount > 0
    ? ((Number(current?.averageViewers || 0) * sampleCount) + currentViewers) / (sampleCount + 1)
    : currentViewers;

  const startedAt = next?.startedAt || current?.startedAt || null;
  const endedAt = next?.endedAt || current?.endedAt || null;
  const uptime = startedAt ? Math.max(0, Math.floor((new Date((endedAt || new Date().toISOString())).getTime() - new Date(startedAt).getTime()) / 1000)) : Number(current?.uptime || 0) || 0;

  return {
    currentViewers,
    peakViewers,
    averageViewers: Math.round(averageViewers),
    bitrate: Number(next?.bitrate || 0),
    fps: Number(next?.fps || 0),
    uptime,
    viewerSamples: sampleCount + 1,
    viewersTotal: Number(current?.viewersTotal || 0) + currentViewers,
    previousViewers,
  };
}

async function syncLiveCameraKey(env, keyName, state) {
  const keys = getLiveCameraKeys(state.eventId, state.cameraId);
  const isMatch = keys.includes(keyName);
  if (!isMatch) return state;
  return syncLiveCameraFromCloudflare(env, state);
}

async function syncAllLiveCameras(env) {
  if (!env.BERGMAN_KV) return { synced: 0 };

  const list = await env.BERGMAN_KV.list({ prefix: 'live:', limit: 1000 });
  let synced = 0;

  for (const key of list.keys) {
    if (!String(key.name || '').includes(':camera:')) continue;
    const state = await env.BERGMAN_KV.get(key.name, 'json');
    if (!state?.liveInputUid) continue;
    try {
      const next = await syncLiveCameraFromCloudflare(env, state);
      if (next) synced++;
    } catch (error) {
      console.warn('[live-sync][camera-sync-failed]', { key: key.name, message: String(error?.message || error || 'Unknown error') });
    }
  }

  return { synced };
}

async function readLiveCameraState(env, eventId, cameraId) {
  if (!env.BERGMAN_KV) return null;

  for (const key of getLiveCameraKeys(eventId, cameraId)) {
    const data = await env.BERGMAN_KV.get(key, "json");
    if (data) return data;
  }

  return null;
}

function parseLiveWebhookBody(body) {
  const eventType = String(body?.type || body?.event || body?.name || "").trim().toLowerCase();
  const meta = body?.data?.meta || body?.meta || {};
  const eventId = String(meta.eventId || body?.data?.eventId || body?.eventId || "").trim();
  const cameraId = String(meta.cameraId || body?.data?.cameraId || body?.cameraId || "").trim();

  return { eventType, eventId, cameraId, meta };
}

async function handleLiveCreate(request, env) {
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== env.SYNC_SECRET) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ success: false, error: "Request body is required" }, 400);

  const eventId = String(body.eventId || "").trim();
  const cameraId = String(body.cameraId || crypto.randomUUID()).trim();
  const name = String(body.name || "").trim();
  const cameraType = String(body.cameraType || "custom").trim();
  const recordingMode = String(body.recordingMode || "off").trim();

  if (!eventId || !name) {
    return json({ success: false, error: "eventId and name are required" }, 400);
  }

  const liveInput = await cloudflareStreamRequest(env, "/stream/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { eventId, cameraId, cameraType, name },
      recording: { mode: recordingMode },
    }),
  });

  console.log("[LIVE_CREATE] Full Cloudflare response:", JSON.stringify(liveInput, null, 2));

  // Check if streamKey is directly available or if we need to construct it
  let streamKey = String(liveInput?.rtmps?.streamKey || "").trim();
  
  // If no streamKey, try to extract from token
  if (!streamKey && liveInput?.rtmps?.token && liveInput?.uid) {
    streamKey = `${liveInput.rtmps.token}${liveInput.uid}`;
    console.log("[LIVE_CREATE] Constructed streamKey from token+uid:", streamKey.substring(0, 16) + "...");
  }

  const result = {
    eventId,
    cameraId,
    liveInputUid: String(liveInput?.uid || "").trim(),
    rtmpsUrl: String(liveInput?.rtmps?.url || "rtmps://live.cloudflare.com:443/live/").trim(),
    streamKey: streamKey,
    playbackUid: null,
    playbackUrl: null,
    recordingMode: String(liveInput?.recording?.mode || recordingMode || "off"),
  };

  console.log("[LIVE_CREATE] Result:", JSON.stringify({
    liveInputUid: result.liveInputUid,
    streamKey: result.streamKey ? result.streamKey.substring(0, 16) + "..." : "MISSING",
  }));
  logLiveEvent('[LIVE_CREATE]', {
    eventId,
    cameraId,
    liveInputUid: result.liveInputUid,
    recordingMode: result.recordingMode,
  });

  await saveLiveCameraState(env, {
    cameraId,
    eventId,
    name,
    cameraType,
    liveInputUid: result.liveInputUid,
    status: "waiting_for_stream",
    connected: false,
    protocol: "RTMP",
    bitrate: 0,
    fps: 0,
    viewers: 0,
    currentViewers: 0,
    peakViewers: 0,
    averageViewers: 0,
    startedAt: null,
    endedAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    playbackUid: null,
    playbackUrl: null,
    videoUID: null,
    videoUid: null,
    recordingReady: false,
    replayAvailable: false,
    recordingMode: result.recordingMode,
    bitrate: 0,
    fps: 0,
    signal: 0,
    protocol: 'RTMP',
    updatedAt: new Date().toISOString(),
  });

  return json({ success: true, data: result });
}

async function handleLiveDelete(request, env) {
  if (request.method !== "DELETE") return json({ success: false, error: "Method not allowed" }, 405);

  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== env.SYNC_SECRET) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const liveInputUid = String(body.liveInputUid || body.uid || "").trim();
  const eventId = String(body.eventId || "").trim();
  const cameraId = String(body.cameraId || "").trim();

  if (liveInputUid) {
    await cloudflareStreamRequest(env, `/stream/live_inputs/${encodeURIComponent(liveInputUid)}`, { method: "DELETE" });
  }

  if (env.BERGMAN_KV) {
    const keys = getLiveCameraKeys(eventId, cameraId);
    await Promise.all(keys.map((key) => env.BERGMAN_KV.delete(key)));
  }

  return json({ success: true, data: { deleted: true } });
}

async function handleLiveStart(request, env) {
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== env.SYNC_SECRET) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ success: false, error: "Request body is required" }, 400);

  const eventId = String(body.eventId || "").trim();
  const cameraId = String(body.cameraId || "").trim();
  const state = await readLiveCameraState(env, eventId, cameraId);
  const synced = state?.liveInputUid ? await syncLiveCameraFromCloudflare(env, state).catch(() => state) : state;
  const nextState = {
    ...(synced || state || {}),
    eventId,
    cameraId,
    status: String(body.status || synced?.status || state?.status || "waiting_for_stream").trim(),
    connected: true,
    startedAt: synced?.startedAt || state?.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bitrate: Number(body.bitrate || synced?.bitrate || state?.bitrate || 0),
    fps: Number(body.fps || synced?.fps || state?.fps || 0),
    viewers: Number(body.viewers || synced?.viewers || state?.viewers || 0),
  };

  await saveLiveCameraState(env, nextState);
  return json({ success: true, data: nextState });
}

async function handleLiveWebhook(request, env) {
  if (request.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  if (!verifyLiveWebhookAuth(request, env)) return json({ success: false, error: "Unauthorized" }, 401);

  const body = await request.json().catch(() => null);
  if (!body) return json({ success: false, error: "Request body is required" }, 400);

  const { eventType, eventId, cameraId, meta } = parseLiveWebhookBody(body);
  const liveInputUid = String(body?.data?.uid || body?.data?.liveInputUid || meta.liveInputUid || "").trim();
  const state = (await readLiveCameraState(env, eventId, cameraId)) || {
    eventId,
    cameraId,
    liveInputUid,
    status: "offline",
  };

  const updatedAt = new Date().toISOString();
  const nextState = { ...state, eventId, cameraId, liveInputUid, updatedAt };

  if (eventType.includes("connected") || eventType.includes("stream.live_input.connected")) {
    nextState.status = String(body?.data?.status || body?.status || 'connected').trim();
    nextState.connected = true;
    nextState.startedAt = nextState.startedAt || updatedAt;
    nextState.endedAt = null;
    nextState.lastConnectedAt = updatedAt;
    logLiveEvent('[LIVE_CONNECTED]', { eventId, cameraId, liveInputUid });
  } else if (eventType.includes("disconnected") || eventType.includes("stream.live_input.disconnected")) {
    nextState.status = String(body?.data?.status || body?.status || 'disconnected').trim();
    nextState.connected = false;
    nextState.endedAt = updatedAt;
    nextState.lastDisconnectedAt = updatedAt;
    logLiveEvent('[LIVE_DISCONNECTED]', { eventId, cameraId, liveInputUid });
  } else if (eventType.includes("record") || eventType.includes("video")) {
    const videoUID = String(body?.data?.uid || body?.data?.videoUid || nextState.videoUID || nextState.playbackUid || "").trim() || null;
    nextState.recordingReady = true;
    nextState.playbackUid = videoUID;
    nextState.videoUID = videoUID;
    nextState.videoUid = videoUID;
    nextState.playbackUrl = videoUID ? getPlaybackUrl(videoUID) : nextState.playbackUrl || null;
    nextState.thumbnailUrl = String(body?.data?.thumbnail || body?.data?.thumbnailUrl || nextState.thumbnailUrl || "").trim() || null;
    nextState.durationSeconds = Number(body?.data?.duration || body?.data?.durationSeconds || nextState.durationSeconds || 0) || null;
    logLiveEvent('[LIVE_RECORDING_READY]', { eventId, cameraId, liveInputUid, videoUID });
  } else if (eventType.includes("error")) {
    nextState.status = String(body?.data?.status || body?.status || 'error').trim();
    nextState.error = body?.data || body?.error || null;
    logLiveEvent('[LIVE_ERROR]', { eventId, cameraId, liveInputUid, error: String(body?.data?.message || body?.error || 'unknown') });
  }

  await saveLiveCameraState(env, nextState);
  return json({ success: true, data: nextState });
}

async function handleLiveStatus(request, env) {
  if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId") || "";
  const cameraId = searchParams.get("cameraId") || searchParams.get("camera") || "";
  const cached = await readLiveCameraState(env, eventId, cameraId);
  const synced = cached?.liveInputUid ? await syncLiveCameraFromCloudflare(env, cached).catch(() => cached) : cached;
  return json({ success: true, data: normalizeCloudflareState(synced || { status: "offline" }) });
}

async function handleLivePlayer(request, env) {
  if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId") || "";
  const cameraId = searchParams.get("cameraId") || "";
  const state = await readLiveCameraState(env, eventId, cameraId);
  const synced = state?.liveInputUid ? await syncLiveCameraFromCloudflare(env, state).catch(() => state) : state;
  const normalized = normalizeCloudflareState(synced || { status: 'offline' });
  const playback = buildPlaybackSnapshot(synced || {}, env);
  const videoUID = String(normalized.videoUID || normalized.playbackUid || normalized.liveInputUid || '').trim() || null;

  return json({
    success: true,
    data: {
      status: normalized.status || "OFFLINE",
      statusLabel: normalized.statusLabel || normalized.status || 'OFFLINE',
      connection: normalized.connection || 'Offline',
      live: Boolean(normalized.live),
      connected: Boolean(normalized.connected),
      videoUID,
      playbackUid: videoUID,
      liveInputUid: normalized.liveInputUid,
      playbackSource: playback.playbackSource,
      playbackUrl: playback.playbackUrl,
      iframeUrl: playback.iframeUrl,
      viewers: Number(normalized.currentViewers || normalized.viewers || 0),
      recordingReady: Boolean(normalized.recordingReady || videoUID),
      replayAvailable: Boolean(normalized.replayAvailable || videoUID),
      recordingVideoUid: normalized.videoUID || null,
    }
  });
}

async function handleLiveReplay(request, env) {
  if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId") || "";
  const cameraId = searchParams.get("cameraId") || "";
  const state = await readLiveCameraState(env, eventId, cameraId);
  const synced = state?.liveInputUid ? await syncLiveCameraFromCloudflare(env, state).catch(() => state) : state;
  const normalized = normalizeCloudflareState(synced || { status: 'offline' });
  const playback = buildPlaybackSnapshot(synced || {}, env);
  const videoUID = String(normalized.videoUID || '').trim() || null;
  const replayUrl = videoUID ? getPlaybackUrl(videoUID) : null;

  return json({
    success: true,
    data: {
      replayReady: Boolean(videoUID),
      live: Boolean(normalized.live),
      connected: Boolean(normalized.connected),
      videoUID,
      playbackUid: videoUID,
      liveInputUid: normalized.liveInputUid,
      playbackSource: playback.playbackSource,
      replayUrl,
      playbackUrl: replayUrl,
      iframeUrl: playback.iframeUrl,
      thumbnailUrl: playback.thumbnailUrl,
      durationSeconds: Number(playback.durationSeconds || 0) || null,
    }
  });
}

async function handleLiveAnalytics(request, env) {
  if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId") || "";
  const cameraId = searchParams.get("cameraId") || "";
  const state = await readLiveCameraState(env, eventId, cameraId);
  const synced = state?.liveInputUid ? await syncLiveCameraFromCloudflare(env, state).catch(() => state) : state;
  const normalized = normalizeCloudflareState(synced || { status: 'offline' });

  return json({
    success: true,
    data: {
      currentViewers: Number(normalized.currentViewers || 0),
      peakViewers: Number(normalized.peakViewers || normalized.currentViewers || 0),
      averageViewers: Number(normalized.averageViewers || normalized.currentViewers || 0),
      bitrate: Number(normalized.bitrate || 0),
      fps: Number(normalized.fps || 0),
      protocol: normalized.protocol || "RTMP",
      status: normalized.status || "OFFLINE",
      statusLabel: normalized.statusLabel || normalized.status || "OFFLINE",
      connection: normalized.connection || "Offline",
      live: Boolean(normalized.live),
      connected: Boolean(normalized.connected),
      videoUID: String(normalized.videoUID || normalized.playbackUid || '').trim() || null,
      playbackUid: String(normalized.playbackUid || '').trim() || null,
      playbackSource: normalized.playbackSource || 'Live Input',
      recordingReady: Boolean(normalized.recordingReady),
      replayAvailable: Boolean(normalized.replayAvailable),
      startedAt: normalized.startedAt || null,
      endedAt: normalized.endedAt || null,
      duration: Number(normalized.duration || normalized.durationSeconds || 0) || null,
      uptime: Number(normalized.uptime || 0) || null,
    }
  });
}

async function handleLiveSync(request, env) {
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== env.SYNC_SECRET) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  if (body?.cameraId && body?.eventId) {
    const state = await readLiveCameraState(env, body.eventId, body.cameraId);
    if (!state) return json({ success: true, data: { synced: 0 } });
    const synced = await syncLiveCameraFromCloudflare(env, state).catch(() => state);
    return json({ success: true, data: synced });
  }

  const summary = await syncAllLiveCameras(env);
  return json({ success: true, data: summary });
}

// ============================================
// 🔥 LIVE TRACKING - TIMING INGEST
// ============================================

async function handleTimingIngest(request, env) {
  try {
    const body = await request.json();

    /*
    EXPECTED FORMAT FROM TIMING PARTNER:

    {
      "eventId": "event123",
      "bibNumber": "101",
      "timestamp": "2026-04-01T06:45:00Z",
      "lat": 18.5204,
      "lng": 73.8567,
      "speed": 28,
      "distance": 12.5,
      "checkpoint": "bike_20km"
    }
    */

    const {
      eventId,
      bibNumber,
      timestamp,
      lat,
      lng,
      speed,
      distance,
      checkpoint
    } = body;

    if (!eventId || !bibNumber) {
      return json({ error: "Missing fields" }, 400);
    }

    // =========================
    // 🔥 STORE LATEST POSITION
    // =========================
    const positionKey = `live:${eventId}:athlete:${bibNumber}`;

    const positionData = {
      bibNumber,
      lat,
      lng,
      speed,
      distance,
      checkpoint,
      timestamp
    };

    await env.BERGMAN_KV.put(positionKey, JSON.stringify(positionData));

    // =========================
    // 🔥 STORE IN LEADERBOARD
    // =========================
    const leaderboardKey = `live:${eventId}:leaderboard`;

    let leaderboard =
      (await env.BERGMAN_KV.get(leaderboardKey, "json")) || [];

    // remove old entry
    leaderboard = leaderboard.filter(a => a.bibNumber !== bibNumber);

    // add updated
    leaderboard.push({
      bibNumber,
      distance,
      checkpoint,
      timestamp
    });

    // sort by distance
    leaderboard.sort((a, b) => b.distance - a.distance);

    await env.BERGMAN_KV.put(leaderboardKey, JSON.stringify(leaderboard));

    return json({ success: true });

  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// ============================================
// 🔥 LIVE TRACKING - POSITIONS (MAP)
// ============================================

async function getLivePositions(request, env) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");

  if (!eventId) {
    return json({ error: "eventId required" }, 400);
  }

  const list = await env.BERGMAN_KV.list({
    prefix: `live:${eventId}:athlete:`,
    limit: 1000
  });

  const positions = [];

  for (const key of list.keys) {
    const data = await env.BERGMAN_KV.get(key.name, "json");
    if (data) positions.push(data);
  }

  return json({
    count: positions.length,
    positions
  });
}

// ============================================
// 🔥 LIVE TRACKING - LEADERBOARD
// ============================================

async function getLeaderboard(request, env) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");

  if (!eventId) {
    return json({ error: "eventId required" }, 400);
  }

  const leaderboard =
    await env.BERGMAN_KV.get(`live:${eventId}:leaderboard`, "json");

  return json({
    leaderboard: leaderboard || []
  });
}

// ============================================
// INDEX FETCH
// ============================================

async function getBookingsIndex(email, athleteUid, env) {
  let index = null;

  if (email) {
    index = await env.BERGMAN_KV.get(`athlete:email:${email}`, "json");
  }

  if (!index && athleteUid) {
    index = await env.BERGMAN_KV.get(`athlete:uid:${athleteUid}`, "json");
  }

  return Array.isArray(index?.bookings) ? index.bookings : [];
}

// ============================================
// PARTICIPANT FETCH
// ============================================

async function getParticipant(env, booking) {
  const direct = await env.BERGMAN_KV.get(
    `event:${booking.eventId}:participant:${booking.bookingId}`,
    "json"
  );

  if (direct) return direct;

  // Self-heal fallback: if individual participant keys were removed, recover from full event index.
  const fullIndex = await env.BERGMAN_KV.get(
    `event:${booking.eventId}:participants:index`,
    "json"
  );

  if (Array.isArray(fullIndex)) {
    const recovered = fullIndex.find((item) => {
      const candidateBookingId = String(item?.bookingId || item?.id || "");
      return candidateBookingId === String(booking.bookingId || "");
    }) || null;

    if (recovered) {
      // Best effort restore of the missing individual participant key.
      await env.BERGMAN_KV.put(
        `event:${booking.eventId}:participant:${booking.bookingId}`,
        JSON.stringify(recovered)
      );
      return recovered;
    }
  }

  return null;
}

// ============================================
// GROUP EVENTS
// ============================================

function groupByEvent(list) {
  const map = new Map();

  for (const item of list) {
    if (!map.has(item.eventId)) {
      map.set(item.eventId, {
        eventId: item.eventId,
        eventName: item.eventName,
        eventDate: item.eventDate,
        registrations: []
      });
    }

    map.get(item.eventId).registrations.push(item);
  }

  return Array.from(map.values()).sort((a, b) =>
    (a.eventDate || "").localeCompare(b.eventDate || "")
  );
}

// ============================================
// FORMAT PARTICIPANT
// ============================================

function formatParticipant(data) {
  return {
    eventId: data.eventId,
    eventName: data.eventName,
    eventDate: data.eventDate,
    bookingId: data.bookingId,
    participantId: data.bookingId,
    ticketName: data.ticketName,
    ticketId: data.ticketId || null,
    bibNumber: data.bibNumber,
    name: data.name,
    email: data.email,
    status: data.ticketStatus || "Active"
  };
}

// ============================================
// ATHLETE INDEX (SINGLE SOURCE)
// ============================================

async function updateAthleteIndex(env, data) {
  const booking = {
    eventId: data.eventId,
    bookingId: data.bookingId,
    eventDate: data.eventDate
  };

  const email = data.email?.toLowerCase()?.trim();

  if (email) {
    const key = `athlete:email:${email}`;
    const existing =
      (await env.BERGMAN_KV.get(key, "json")) || { bookings: [] };

    if (!Array.isArray(existing.bookings)) existing.bookings = [];

    if (!existing.bookings.find(b => b.bookingId === booking.bookingId)) {
      existing.bookings.push(booking);
      await env.BERGMAN_KV.put(key, JSON.stringify(existing));
    }
  }

  if (data.athleteUid) {
    const key = `athlete:uid:${data.athleteUid}`;
    const existing =
      (await env.BERGMAN_KV.get(key, "json")) || { bookings: [] };

    if (!Array.isArray(existing.bookings)) existing.bookings = [];

    if (!existing.bookings.find(b => b.bookingId === booking.bookingId)) {
      existing.bookings.push(booking);
      await env.BERGMAN_KV.put(key, JSON.stringify(existing));
    }
  }
}

// ============================================
// DEBUG
// ============================================

async function debugKV(env) {
  const list = await env.BERGMAN_KV.list({ prefix: "" });

  return json({
    totalKeys: list.keys.length,
    sample: list.keys.slice(0, 20)
  });
}

async function debugSample(env) {
  const list = await env.BERGMAN_KV.list({ prefix: "event:", limit: 10 });

  const out = [];

  for (const key of list.keys) {
    const data = await env.BERGMAN_KV.get(key.name, "json");

    out.push({
      key: key.name,
      eventId: data?.eventId,
      bookingId: data?.bookingId
    });
  }

  return json(out);
}

// ============================================
// INDEX REBUILD
// ============================================

async function rebuildIndex(env) {
  const list = await env.BERGMAN_KV.list({ prefix: "event:" });

  let processed = 0;
  let restoredParticipants = 0;

  for (const key of list.keys) {
    if (key.name.endsWith(":participants:index")) {
      const fullIndex = await env.BERGMAN_KV.get(key.name, "json");
      const eventId = key.name.split(":")[1];

      if (!Array.isArray(fullIndex) || !eventId) continue;

      for (const participant of fullIndex) {
        if (!participant?.bookingId && !participant?.id) continue;

        const bookingId = String(participant.bookingId || participant.id || "");
        const normalized = {
          ...participant,
          eventId: participant.eventId || eventId,
          bookingId,
        };

        await env.BERGMAN_KV.put(
          `event:${eventId}:participant:${bookingId}`,
          JSON.stringify(normalized)
        );
        await updateAthleteIndex(env, normalized);
        processed++;
        restoredParticipants++;
      }
      continue;
    }

    if (!key.name.includes(":participant:")) continue;

    const data = await env.BERGMAN_KV.get(key.name, "json");
    if (!data) continue;

    await updateAthleteIndex(env, data);
    processed++;
  }

  return json({ processed, restoredParticipants });
}

// ============================================
// HELPERS
// ============================================

function getParams(request) {
  const { searchParams } = new URL(request.url);

  return {
    email: searchParams.get("email")?.toLowerCase()?.trim(),
    athleteUid: searchParams.get("athleteUid")
  };
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,PUT,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}
