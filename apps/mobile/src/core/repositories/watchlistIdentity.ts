export function resolveWatchlistDeleteItemId(input: {
  watchlistItemId?: string | null;
  eventId?: string | null;
  athleteId: string;
}): string {
  return (
    String(input.watchlistItemId ?? "").trim() ||
    `${String(input.eventId ?? "").trim()}:${String(input.athleteId).trim()}`
  );
}
