type LiveWorkerResponse<T> = {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: any } | string;
};

function getWorkerConfig() {
  const baseUrl = String(
    process.env.LIVE_STREAM_WORKER_URL ||
      process.env.NEXT_PUBLIC_LIVE_STREAM_WORKER_URL ||
      '',
  ).trim();
  const apiKey = String(
    process.env.LIVE_STREAM_WORKER_SECRET ||
      process.env.LIVE_STREAM_API_KEY ||
      process.env.SYNC_SECRET ||
      '',
  ).trim();

  return { baseUrl, apiKey };
}

async function workerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, apiKey } = getWorkerConfig();
  if (!baseUrl) {
    throw new Error('Live streaming worker URL is not configured');
  }

  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as LiveWorkerResponse<T> | null;
  if (!response.ok || !payload?.success) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : payload?.error?.message || `Live worker request failed with ${response.status}`;
    throw new Error(message);
  }

  return (payload.data as T) ?? (payload as unknown as T);
}

export async function createLiveInputViaWorker(input: {
  eventId: string;
  cameraId?: string;
  name: string;
  cameraType?: string;
  recordingMode?: 'off' | 'automatic' | 'none';
}) {
  return workerRequest<{
    cameraId: string;
    liveInputUid: string;
    rtmpsUrl: string;
    streamKey: string;
    playbackUid: string | null;
    playbackUrl: string | null;
    recordingMode?: string;
  }>('/api/live/create', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteLiveInputViaWorker(input: {
  eventId?: string;
  cameraId?: string;
  liveInputUid?: string;
}) {
  return workerRequest<{ deleted: boolean }>('/api/live/delete', {
    method: 'DELETE',
    body: JSON.stringify(input),
  });
}

export async function getLiveStatusViaWorker(params: {
  eventId: string;
  cameraId?: string;
}) {
  const query = new URLSearchParams({ eventId: params.eventId });
  if (params.cameraId) query.set('cameraId', params.cameraId);
  return workerRequest<any>(`/api/live/status?${query.toString()}`, { method: 'GET' });
}
