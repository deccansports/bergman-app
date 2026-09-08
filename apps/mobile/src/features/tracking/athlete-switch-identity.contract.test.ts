import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("route athlete selection is initial-only and carousel selection then wins", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const routeIndex = screen.indexOf("const routedTrackedIndex");
  const requestedIndex = screen.indexOf("const requestedTrackedIndex");
  const detailAthlete = screen.indexOf("const persistedSelectedAthlete");
  assert.ok(routeIndex >= 0 && requestedIndex > routeIndex);
  assert.ok(detailAthlete > requestedIndex);
  assert.match(
    screen.slice(routeIndex - 500, requestedIndex),
    /routedSelectionPending[\s\S]*autoTrackKeyRef\.current !== routedAthleteKey/,
  );
  assert.match(
    screen.slice(requestedIndex, detailAthlete),
    /selectedTrackedKey[\s\S]*routedTrackedIndex/,
  );
  assert.doesNotMatch(
    screen.slice(detailAthlete, screen.indexOf("const selectedIdentityLookup")),
    /routedTrackedIndex/,
  );
  assert.match(
    screen,
    /const selectTrackedAthlete = useCallback\([\s\S]*const nextAthlete = watchedRows\[bounded\]\.athlete;[\s\S]*const nextKey = stableAthleteKey\(nextAthlete, id\);[\s\S]*selectedTrackedAthleteRef\.current = nextAthlete;[\s\S]*setSelectedTrackedKey\(nextKey\)/,
  );
  assert.match(
    screen,
    /navigationRouteKey: `\$\{id\}:\$\{selectedParticipantUuid \|\| "none"\}`/,
  );
});

test("course identity remains independent of participant identity", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const identity = screen.match(
    /const courseIdentity = useMemo\(([\s\S]*?)\n  \);/,
  );
  assert(identity);
  assert.match(identity[1], /providerEventUuid/);
  assert.match(identity[1], /contestId/);
  assert.match(identity[1], /courseVersion/);
  assert.doesNotMatch(identity[1], /participantUuid|selectedTrackedKey/);
});

test("athlete UI never exposes the internal TP fallback label", async () => {
  const timelineCard = await readFile(
    new URL(
      "./athlete-detail/components/cards/TimelineCard.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(timelineCard, /title: "Race Timing", icon: "TP"/);
  assert.match(timelineCard, /title: "Race Progress"/);
});
