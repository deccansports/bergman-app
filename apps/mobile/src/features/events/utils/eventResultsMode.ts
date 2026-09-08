function token(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

const TERMINAL_EVENT_STATUSES = new Set([
  "finished",
  "completed",
  "complete",
  "ended",
  "past",
  "results",
  "published",
  "results_published",
]);

export function eventUsesResultsMode(
  status: unknown,
  raw?: Record<string, unknown> | null,
): boolean {
  return (
    [status, raw?.status, raw?.eventStatus, raw?.resultState]
      .map(token)
      .some((value) => TERMINAL_EVENT_STATUSES.has(value)) ||
    raw?.resultsPublished === true ||
    raw?.results_published === true ||
    raw?.officialResultsPublished === true ||
    raw?.hasPublishedResults === true
  );
}
