import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const screen = await readFile(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const watchlist = await readFile(
  new URL("./watchlist/hooks/useWatchlist.ts", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL("../../app/event/[eventId]/track.tsx", import.meta.url),
  "utf8",
);

test("card visibility requires selected identity membership", () => {
  assert.match(
    screen,
    /selectedTrackedKey && keyedSelectedIndex >= 0[\s\S]*watchedRows\[keyedSelectedIndex\][\s\S]*: undefined/,
  );
  assert.match(screen, /\[tracking-card-visibility\]/);
  assert.match(screen, /mobileLiveCached: Boolean\(selectedAthleteResponse\)/);
  assert.doesNotMatch(screen, /athleteDetailCached/);
  assert.match(screen, /SELECTED_ATHLETE_IDENTITY_MISMATCH/);
});

test("tracked athlete removal updates selection before awaiting DELETE", () => {
  const removal = screen.slice(
    screen.indexOf("const removeTrackedAthlete"),
    screen.indexOf(
      "useEffect(() => {",
      screen.indexOf("const removeTrackedAthlete"),
    ),
  );
  assert.match(removal, /selectionAfterTrackedAthleteRemoval/);
  assert.ok(
    removal.indexOf("setRemovedTrackedKeys") <
      removal.indexOf("await storeToggleWatchlist"),
  );
  assert.ok(
    removal.indexOf("setSelectedTrackedKey") <
      removal.indexOf("await storeToggleWatchlist"),
  );
  assert.match(removal, /\[tracking-close\]/);
});

test("watchlist cache is patched immediately and restored on DELETE failure", () => {
  const toggle = watchlist.slice(
    watchlist.indexOf("const toggle = useCallback"),
    watchlist.indexOf(
      "return {",
      watchlist.indexOf("const toggle = useCallback"),
    ),
  );
  assert.ok(
    toggle.indexOf("storeToggle") <
      toggle.indexOf("await unsubscribeTrackedAthlete"),
  );
  assert.ok(
    toggle.indexOf("setQueryData") <
      toggle.indexOf("await unsubscribeTrackedAthlete"),
  );
  assert.match(toggle, /storeReplaceAthletes\(before\)/);
  assert.doesNotMatch(toggle, /queryClient\.invalidateQueries|\.refetch\(/);
});

test("LiveTrack route and root are not keyed by athlete state", () => {
  assert.doesNotMatch(route, /key=/);
  assert.match(screen, /routeKey = `event:\$\{id \|\| "pending"\}:track`/);
  assert.doesNotMatch(screen, /key=\{selectedTrackedIndex\}|key=\{index\}/);
});
