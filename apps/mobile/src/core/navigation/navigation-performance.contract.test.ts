import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootTabs = readFileSync(
  new URL("../../app/(tabs)/_layout.tsx", import.meta.url),
  "utf8",
);
const eventTabs = readFileSync(
  new URL("../../app/event/[eventId]/_layout.tsx", import.meta.url),
  "utf8",
);
const liveTrack = readFileSync(
  new URL(
    "../../features/events/components/LiveTrackScreen.tsx",
    import.meta.url,
  ),
  "utf8",
);
const leaderboard = readFileSync(
  new URL(
    "../../features/tracking/leaderboard/components/LeaderboardScreen.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("blurred tabs are frozen and tab animations do not compete with maps", () => {
  for (const source of [rootTabs, eventTabs]) {
    assert.match(source, /lazy: true/);
    assert.match(source, /freezeOnBlur: true/);
    assert.match(source, /animation: ["']none["']/);
  }
});

test("blurred event tabs stop visual work but retain provider-level socket ownership", () => {
  assert.match(
    liveTrack,
    /useCanonicalChangeSocket\([\s\S]*eventScreen\.queryEnabled/,
  );
  assert.match(liveTrack, /if \(!eventScreen\.focused\) return null/);
  assert.match(
    leaderboard,
    /useCanonicalChangeSocket\([\s\S]*leaderboardProviderEventUuid[\s\S]*eventScreen\.queryEnabled[\s\S]*isLive/,
  );
});
