export type EventLifecycleStatus = "upcoming" | "live" | "finished";

type EventLifecycleInput = {
  status?: unknown;
  eventStatus?: unknown;
  startAt?: unknown;
  countdownTargetAt?: unknown;
  startDate?: unknown;
  dateStart?: unknown;
  eventDate?: unknown;
  date?: unknown;
  endAt?: unknown;
  endDate?: unknown;
  dateEnd?: unknown;
  timezone?: unknown;
  timeZone?: unknown;
  liveTracking?: unknown;
  feibotRaceDates?: unknown;
  ticketRaceDates?: unknown;
  lifecycleRaceDates?: unknown;
  ticketDefinitions?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(...values: unknown[]): string {
  return values.map(text).find(Boolean) || "";
}

function calendarDate(value: unknown): string | null {
  const valueText = text(value);
  const match = valueText.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function dateValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(dateValues);
  const parsed = calendarDate(value);
  return parsed ? [parsed] : [];
}

function configuredRaceDates(input: EventLifecycleInput): string[] {
  const explicitFeibot = dateValues(input.feibotRaceDates);
  if (explicitFeibot.length > 0)
    return Array.from(new Set(explicitFeibot)).sort();
  const explicitLifecycle = dateValues(input.lifecycleRaceDates);
  if (explicitLifecycle.length > 0)
    return Array.from(new Set(explicitLifecycle)).sort();
  const ticketDates = [
    ...dateValues(input.ticketRaceDates),
    ...(Array.isArray(input.ticketDefinitions)
      ? input.ticketDefinitions
      : []
    ).flatMap((ticket) => {
      if (!ticket || typeof ticket !== "object") return [];
      const row = ticket as Record<string, unknown>;
      return dateValues(
        row.raceDate ?? row.eventDate ?? row.ticketEventDate ?? row.date,
      );
    }),
  ];
  const uniqueTicketDates = Array.from(new Set(ticketDates)).sort();
  if (uniqueTicketDates.length > 0) return uniqueTicketDates;

  // Some mobile event payloads have no provider or ticket-level dates. The
  // parent event date is still authoritative for list lifecycle and must not
  // leave an already-finished event classified as upcoming.
  const eventDates = [
    ...dateValues(input.startDate ?? input.dateStart),
    ...dateValues(input.eventDate ?? input.date),
    ...dateValues(input.endDate ?? input.dateEnd),
  ];
  return Array.from(new Set(eventDates)).sort();
}

function instant(value: unknown): number | null {
  const valueText = text(value);
  if (!valueText || /^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
  const parsed = Date.parse(valueText);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeTimezone(value: unknown): string {
  const candidate = text(value) || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "Asia/Kolkata";
  }
}

function dateKeyAt(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function configuredStatus(input: EventLifecycleInput): string {
  const liveTracking =
    input.liveTracking && typeof input.liveTracking === "object"
      ? (input.liveTracking as Record<string, unknown>)
      : null;
  return [input.status, input.eventStatus, liveTracking?.raceStatus]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Resolves event-list lifecycle using the event's local calendar days. */
export function resolveEventLifecycleStatus(
  input: EventLifecycleInput,
  referenceDate = new Date(),
): EventLifecycleStatus {
  const stored = configuredStatus(input);
  if (/finish|complete|done|closed|ended|result/.test(stored)) {
    return "finished";
  }
  if (/live|ongoing|in[ _-]?progress|started|running/.test(stored)) {
    return "live";
  }

  const timezone = safeTimezone(input.timezone ?? input.timeZone);
  const now = referenceDate.getTime();
  const today = dateKeyAt(referenceDate, timezone);
  const raceDates = configuredRaceDates(input);
  const startDay = raceDates[0] ?? null;
  const endDay = raceDates.at(-1) ?? startDay;
  const candidateStart = instant(
    firstText(input.startAt, input.countdownTargetAt),
  );
  const candidateEnd = instant(input.endAt);
  const exactStart =
    candidateStart !== null &&
    startDay &&
    dateKeyAt(new Date(candidateStart), timezone) === startDay
      ? candidateStart
      : null;
  const exactEnd =
    candidateEnd !== null &&
    endDay &&
    dateKeyAt(new Date(candidateEnd), timezone) === endDay
      ? candidateEnd
      : null;

  if (exactStart !== null && now < exactStart) return "upcoming";
  if (exactEnd !== null && now > exactEnd) return "finished";
  if (startDay && today < startDay) return "upcoming";
  if (endDay && today > endDay) return "finished";
  if (startDay || exactStart !== null) return "live";

  return "upcoming";
}
