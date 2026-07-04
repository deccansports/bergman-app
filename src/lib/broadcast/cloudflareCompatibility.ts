import { sha256Hex } from '@/lib/broadcast/security';

export type CloudflareCredentialValidation = {
  valid: boolean;
  pattern: string;
  prefix: string;
  uidSuffix: string;
  separator: string;
  streamKeyLength: number;
  uidLength: number;
  sha256: {
    uid: string;
    streamKey: string;
    prefix: string;
    uidSuffix: string;
  };
  warnings: string[];
};

function getResultValue(liveInput: any, path: Array<string>) {
  let current = liveInput;
  for (const key of path) {
    current = current?.[key];
  }
  return current;
}

export function validateCloudflareCredentials(liveInput: any): CloudflareCredentialValidation {
  const uid = String(
    liveInput?.uid ??
    liveInput?.liveInputUid ??
    getResultValue(liveInput, ['result', 'uid']) ??
    ''
  );
  const rtmpsUrl = String(
    getResultValue(liveInput, ['rtmps', 'url']) ??
    liveInput?.rtmpsUrl ??
    ''
  );
  const streamKey = String(
    getResultValue(liveInput, ['rtmps', 'streamKey']) ??
    liveInput?.streamKey ??
    ''
  );

  const warnings: string[] = [];
  if (!uid) warnings.push('Missing live input uid.');
  if (!rtmpsUrl) warnings.push('Missing RTMPS URL.');
  if (!streamKey) warnings.push('Missing stream key.');

  const separator = streamKey.includes('k') ? 'k' : '';
  const endsWithUid = Boolean(uid) && streamKey.endsWith(uid);
  const uidSuffix = endsWithUid ? uid : '';
  const separatorIndex = endsWithUid && uid ? streamKey.length - uid.length - 1 : -1;
  const prefix = separatorIndex > -1 ? streamKey.slice(0, separatorIndex) : '';
  const patternDetected = Boolean(uid && streamKey && endsWithUid && separatorIndex > -1 && streamKey.charAt(separatorIndex) === 'k');
  const pattern = patternDetected ? '<Token32Hex>k<LiveInputUID>' : 'unknown';

  if (streamKey && !endsWithUid) warnings.push('Stream key does not end with the live input uid.');
  if (streamKey && !separator) warnings.push('Stream key does not contain the expected k separator.');
  if (streamKey && streamKey.length < 33) warnings.push('Stream key is unexpectedly short.');
  if (uid && uid.length !== 32) warnings.push('Live input uid length is not 32 characters.');
  if (streamKey && streamKey.length !== 65 && endsWithUid) warnings.push('Composite key length differs from the expected 65-character format.');

  const result = {
    valid: Boolean(uid && rtmpsUrl && streamKey && endsWithUid && separator === 'k'),
    pattern,
    prefix,
    uidSuffix,
    separator,
    streamKeyLength: streamKey.length,
    uidLength: uid.length,
    sha256: {
      uid: sha256Hex(uid),
      streamKey: sha256Hex(streamKey),
      prefix: sha256Hex(prefix),
      uidSuffix: sha256Hex(uidSuffix),
    },
    warnings,
  };

  // === DETAILED VALIDATION BREAKDOWN ===
  console.info('[cloudflare-compatibility][validation-breakdown]', {
    message: 'Credential pattern validation analysis',
    uid,
    rtmpsUrl,
    streamKey,
    checks: {
      hasUid: Boolean(uid),
      hasRtmpsUrl: Boolean(rtmpsUrl),
      hasStreamKey: Boolean(streamKey),
      endsWithUid,
      separatorIsK: separator === 'k',
      allChecksPassed: result.valid,
    },
    separatorDetails: {
      separatorFound: separator,
      separatorIndex,
      expectedSeparatorChar: 'k',
    },
    lengths: {
      uid: uid.length,
      streamKey: streamKey.length,
      prefix: prefix.length,
      uidSuffix: uidSuffix.length,
    },
    warnings,
  });

  if (endsWithUid && separator === 'k') {
    console.info('[cloudflare-compatibility][detected]', {
      message: "Cloudflare returned composite credential format (token + 'k' + uid)",
      uid,
      streamKey,
      prefix,
      uidSuffix,
      separator,
      streamKeyLength: streamKey.length,
      uidLength: uid.length,
      sha256: result.sha256,
      warnings,
    });
  } else if (streamKey && uid) {
    console.warn('[cloudflare-compatibility][pattern-mismatch]', {
      message: 'Stream key does not match expected Cloudflare composite format',
      uid,
      streamKey,
      endsWithUid,
      separator,
      separatorIndex,
      prefix,
      warnings,
    });
  }

  return result;
}
