import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("compact map card never leaves pre-start or elapsed timing blank", async () => {
  const screen = await readFile(
    new URL("./LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const start = screen.indexOf("function CompactMapAthleteCard(");
  const end = screen.indexOf("function MapSettingsToggle(", start);
  const card = screen.slice(start, end);
  assert.match(card, /const statusText = firstText\(/);
  assert.match(card, /!detail \|\|/);
  assert.match(card, /scheduledStart=\{scheduledStart \|\| undefined\}/);
  assert.match(card, /startTiming=\{detail\?\.startTiming\}/);
  assert.match(
    card,
    /finished[\s\S]*\? "FINISH TIME"[\s\S]*: effectiveTerminalNonFinish[\s\S]*: "LIVE ELAPSED"/,
  );
  assert.match(card, /minHeight: 58/);

  const countdown = await readFile(
    new URL(
      "../../tracking/athlete-detail/components/cards/RaceStartCountdown.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(countdown, /TIME TO START/);
  assert.match(countdown, /startTiming\?\.waitingForChipStart && !isFuture/);
  assert.match(countdown, /Awaiting start time/);
  assert.match(countdown, /WAITING FOR CHIP START/);
  assert.match(countdown, /START · Waiting for timing mat/);
  assert.match(countdown, /Gun Start · \{startTiming\.gunStartLabel\}/);
  assert.match(countdown, /Your race time starts when you cross START\./);
  assert.doesNotMatch(countdown, /if \(!startAt\) return null/);
});
