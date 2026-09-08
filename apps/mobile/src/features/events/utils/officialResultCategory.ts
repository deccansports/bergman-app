type ResultCategoryRow = Record<string, unknown> & {
  contestName?: unknown;
  contest?: unknown;
  raceCategory?: unknown;
  ticketName?: unknown;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function key(value: unknown): string {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

export function normalizeOfficialResultCategory<T extends ResultCategoryRow>(
  row: T,
  eventName: string,
): T {
  const normalizedEventName = key(eventName);
  if (!normalizedEventName) return row;

  const currentCategory = [
    row.contestName,
    row.contest,
    row.raceCategory,
    row.ticketName,
  ]
    .map(text)
    .find(Boolean) ?? "";
  if (key(currentCategory) !== normalizedEventName) return row;

  const specificCategory = [
    row.ticketName,
    row.raceCategory,
    row.contestName,
    row.contest,
  ]
    .map(text)
    .find((candidate) => candidate && key(candidate) !== normalizedEventName);

  if (!specificCategory) return row;

  return {
    ...row,
    contestName: specificCategory,
    contest: specificCategory,
  };
}
