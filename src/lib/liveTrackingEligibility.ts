const PUBLIC_ALLOWED_STATUSES = new Set([
  'confirmed',
  'checked in',
  'checked-in',
  'checkedin',
  'started',
  'racing',
  'finished',
  'dnf',
  'dns',
  'dsq',
  'active',
  'on course',
]);

const PUBLIC_BLOCKED_STATUS_HINTS = [
  'deferred',
  'cancel',
  'refund',
  'payment pending',
  'payment failed',
  'registration incomplete',
  'expired',
  'deleted',
  'transferred',
  'test',
];

export function normalizeTrackingText(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeTrackingStatus(value: unknown) {
  return normalizeTrackingText(value).toLowerCase();
}

export function isHiddenByRegistrationStatus(value: unknown) {
  const status = normalizeTrackingStatus(value);
  if (!status) return true;
  return PUBLIC_BLOCKED_STATUS_HINTS.some((hint) => status.includes(hint));
}

export function isPublicEligibleRegistrationStatus(value: unknown) {
  const status = normalizeTrackingStatus(value);
  if (!status) return false;
  if (isHiddenByRegistrationStatus(status)) return false;
  return PUBLIC_ALLOWED_STATUSES.has(status);
}

export function isMappedProviderParticipant(row: Record<string, any> | null | undefined) {
  if (!row || typeof row !== 'object') return false;
  return Boolean(
    row?.provider?.mapped
    || row?.mapped
    || row?.mappingStatus === 'matched'
    || row?.mappingStatus === 'mapped'
    || row?.mappingStatus === 'eligible'
    || row?.participantUuid
    || row?.providerParticipantUuid
  );
}

export function isPublicTrackingEligibleParticipant(row: Record<string, any> | null | undefined) {
  if (!row || typeof row !== 'object') return false;
  const registrationStatus = row?.registrationStatus || row?.ticketStatus || row?.registration?.status || row?.registration?.ticketStatus;
  const contestUuid = normalizeTrackingText(row?.contestUuid || row?.contest_uuid || row?.provider?.contestUuid || row?.liveTracking?.contestUuid);

  return Boolean(
    isMappedProviderParticipant(row)
    && contestUuid
    && isPublicEligibleRegistrationStatus(registrationStatus)
    && !isHiddenByRegistrationStatus(registrationStatus)
    && row?.isActive !== false
  );
}

export function isPublicTrackingVisibleParticipant(row: Record<string, any> | null | undefined) {
  if (!row || typeof row !== 'object') return false;
  return isPublicTrackingEligibleParticipant(row);
}
