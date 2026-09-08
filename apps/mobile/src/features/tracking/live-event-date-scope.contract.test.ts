import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("live-today banner uses the selected athlete ticket date", () => {
  assert.match(
    screen,
    /const selectedRaceDate = firstText\([\s\S]*selectedTrackedRow\?\.athlete\.raceDate[\s\S]*selectedTicketToday\?\.eventDate/,
  );
  assert.match(
    screen,
    /const selectedRaceScheduledToday = selectedTrackedRow[\s\S]*raceDateKey\(selectedRaceDate\) === indiaDateKey\(\)/,
  );
  assert.match(
    screen,
    /const statusBannerLabel =[\s\S]*selectedRaceScheduledToday && !resultsMode/,
  );
});

