const ACCEPTED_SPLIT_EVIDENCE_STATUSES = new Set([
  "ACCEPTED",
  "CONFIRMED",
  "CORRECTED",
  "FIXED",
  "MANUAL_CORRECTED",
  "OFFICIAL",
  "VALID",
]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** Scheduled/presentation rows are not evidence when canonical acceptance is
 * explicitly false, even if they carry a display timestamp or COMPLETED label. */
export function hasAcceptedSplitEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const split = value as Record<string, unknown>;
  if (split.accepted === false || split.isAccepted === false) return false;
  const status = text(
    split.progressStatus ??
      split.timingStatus ??
      split.resultStatus ??
      split.status ??
      split.validity,
  ).toUpperCase();
  const accepted =
    split.accepted === true ||
    split.isAccepted === true ||
    split.valid === true ||
    split.isValid === true ||
    ACCEPTED_SPLIT_EVIDENCE_STATUSES.has(status);
  const acceptedAt =
    split.readAt ??
    split.acceptedAt ??
    split.acceptedTimestamp ??
    split.absoluteTimestamp ??
    split.timestamp ??
    split.occurredAt ??
    split.readerTimestamp ??
    split.detectedAt;
  return accepted && Boolean(text(acceptedAt));
}
