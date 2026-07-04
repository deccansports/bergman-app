export type GoProConfiguration = {
  mode: 'A' | 'B' | 'C' | 'D' | 'E';
  label: string;
  server: string;
  streamKey: string;
  combinedUrl: string;
};

function normalizeServer(server: string) {
  return String(server || '');
}

function combine(server: string, streamKey: string) {
  const normalized = normalizeServer(server);
  if (!normalized || !streamKey) return '';
  return normalized.endsWith('/') ? `${normalized}${streamKey}` : `${normalized}/${streamKey}`;
}

export function buildGoProConfigurations(params: { streamKey: string; liveInputUid?: string; rtmpsServer?: string }) {
  const fullKey = String(params.streamKey || '');
  const uid = String(params.liveInputUid || '');
  const serverWithPort = 'rtmps://live.cloudflare.com:443/live/';
  const serverWithoutPort = 'rtmps://live.cloudflare.com/live/';
  const serverBarePort = 'rtmps://live.cloudflare.com:443';
  const serverBare = 'rtmps://live.cloudflare.com';

  return [
    {
      mode: 'A',
      label: 'Server + full key',
      server: serverWithPort,
      streamKey: fullKey,
      combinedUrl: combine(serverWithPort, fullKey),
    },
    {
      mode: 'B',
      label: 'Server + full key (no port)',
      server: serverWithoutPort,
      streamKey: fullKey,
      combinedUrl: combine(serverWithoutPort, fullKey),
    },
    {
      mode: 'C',
      label: 'Single URL',
      server: serverWithPort,
      streamKey: fullKey,
      combinedUrl: combine(serverWithPort, fullKey),
    },
    {
      mode: 'D',
      label: 'Host only + /live/fullkey',
      server: serverBarePort,
      streamKey: `/live/${fullKey}`,
      combinedUrl: combine(serverBarePort, `/live/${fullKey}`),
    },
    {
      mode: 'E',
      label: 'Bare host + live/fullkey',
      server: serverBare,
      streamKey: `live/${fullKey}`,
      combinedUrl: combine(serverBare, `live/${fullKey}`),
    },
  ];
}
