import assert from "node:assert/strict";
import test from "node:test";

import { resolveEventLifecycleStatus } from "./eventLifecycle";

const bengaluru = {
  status: "upcoming",
  eventDate: "2026-09-06",
  feibotRaceDates: ["2026-09-05", "2026-09-06"],
  startAt: "2026-09-05T01:45:00.000Z",
  timezone: "Asia/Kolkata",
};

test("multi-day event becomes live at startAt and remains live through eventDate", () => {
  assert.equal(
    resolveEventLifecycleStatus(
      bengaluru,
      new Date("2026-09-05T01:44:59.000Z"),
    ),
    "upcoming",
  );
  assert.equal(
    resolveEventLifecycleStatus(
      bengaluru,
      new Date("2026-09-05T01:45:00.000Z"),
    ),
    "live",
  );
  assert.equal(
    resolveEventLifecycleStatus(
      bengaluru,
      new Date("2026-09-06T12:00:00.000Z"),
    ),
    "live",
  );
  assert.equal(
    resolveEventLifecycleStatus(
      bengaluru,
      new Date("2026-09-06T18:30:00.000Z"),
    ),
    "finished",
  );
});

test("date-only events use the configured event timezone", () => {
  const event = {
    ticketDefinitions: [{ eventDate: "2026-09-05" }],
    timezone: "Asia/Kolkata",
  };
  assert.equal(
    resolveEventLifecycleStatus(event, new Date("2026-09-04T18:29:59.000Z")),
    "upcoming",
  );
  assert.equal(
    resolveEventLifecycleStatus(event, new Date("2026-09-04T18:30:00.000Z")),
    "live",
  );
  assert.equal(
    resolveEventLifecycleStatus(event, new Date("2026-09-05T18:30:00.000Z")),
    "finished",
  );
});

test("Feibot race date overrides a later parent and ticket date", () => {
  const event = {
    eventDate: "2026-09-06",
    ticketDefinitions: [{ eventDate: "2026-09-06" }],
    feibotRaceDates: ["2026-09-05"],
    timezone: "Asia/Kolkata",
  };
  assert.equal(
    resolveEventLifecycleStatus(event, new Date("2026-09-05T04:00:00.000Z")),
    "live",
  );
  assert.equal(
    resolveEventLifecycleStatus(event, new Date("2026-09-05T18:30:00.000Z")),
    "finished",
  );
});

test("BERGMAN ticket date is used when Feibot date is unavailable", () => {
  const event = {
    eventDate: "2026-09-06",
    ticketDefinitions: [{ eventDate: "2026-09-05" }],
    timezone: "Asia/Kolkata",
  };
  assert.equal(
    resolveEventLifecycleStatus(event, new Date("2026-09-05T04:00:00.000Z")),
    "live",
  );
});

test("parent event date classifies a completed event when scoped race dates are unavailable", () => {
  assert.equal(
    resolveEventLifecycleStatus(
      { status: "upcoming", eventDate: "2026-09-05", timezone: "Asia/Kolkata" },
      new Date("2026-09-05T18:30:00.000Z"),
    ),
    "finished",
  );
});

test("parent event date remains upcoming until its local calendar day", () => {
  assert.equal(
    resolveEventLifecycleStatus(
      { eventDate: "2026-09-06", timezone: "Asia/Kolkata" },
      new Date("2026-09-05T18:29:59.000Z"),
    ),
    "upcoming",
  );
});

test("explicit terminal and live statuses remain authoritative", () => {
  assert.equal(
    resolveEventLifecycleStatus({
      status: "completed",
      eventDate: "2099-01-01",
    }),
    "finished",
  );
  assert.equal(
    resolveEventLifecycleStatus({
      status: "in_progress",
      eventDate: "2099-01-01",
    }),
    "live",
  );
});
