import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOfficialResultCategory } from "../src/features/events/utils/officialResultCategory";

test("mobile replaces a legacy event-name category with the uploaded ticket", () => {
  const row = normalizeOfficialResultCategory(
    {
      contestName: "BERGMAN BENGALURU 2026",
      raceCategory: "BERGMAN BENGALURU 2026",
      ticketName: "Bergman Swimathon Blr - 2 Km",
    },
    "BERGMAN BENGALURU 2026",
  );

  assert.equal(row.contestName, "Bergman Swimathon Blr - 2 Km");
  assert.equal(row.contest, "Bergman Swimathon Blr - 2 Km");
});

test("mobile preserves a genuine uploaded race category", () => {
  const row = {
    contestName: "Bergman Olympic Triathlon",
    ticketName: "Bergman Olympic Triathlon",
  };

  assert.equal(
    normalizeOfficialResultCategory(row, "BERGMAN BENGALURU 2026"),
    row,
  );
});

test("mobile does not guess when no ticket category is available", () => {
  const row = { raceCategory: "BERGMAN BENGALURU 2026" };

  assert.equal(
    normalizeOfficialResultCategory(row, "BERGMAN BENGALURU 2026"),
    row,
  );
});
