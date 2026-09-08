export function normalizeProviderEventUuid(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeProviderContestUuid(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}
