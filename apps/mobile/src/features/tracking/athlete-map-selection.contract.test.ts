import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("late canonical responses cannot replace the newly selected athlete", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    screen,
    /const currentSelectedAthlete = selectedTrackedKey[\s\S]*!sameAthleteSelection\(currentSelectedAthlete, responseIdentity\)[\s\S]*ignored stale athlete response[\s\S]*return;/,
  );
  assert.match(
    screen,
    /const resolvedSelectedIdentity = useMemo\([\s\S]*resolvedTrackedAthleteForLiveState\([\s\S]*persistedSelectedAthlete,[\s\S]*selectedIdentityQuery\.data/,
  );
  assert.match(
    screen,
    /responseMatchesSelectedParticipant\([\s\S]*responseParticipantUuid,[\s\S]*selectedParticipantUuid/,
  );
  assert.match(
    screen,
    /const response = isSelected \? selectedAthleteResponse : undefined/,
  );
});

test("canonical key promotion preserves athlete identity without mixing card and watchlist indexes", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const reconciliation = screen.slice(
    screen.indexOf("const equivalentIndex"),
    screen.indexOf("const routedAthleteKey"),
  );

  assert.match(reconciliation, /sameAthleteSelection/);
  assert.match(reconciliation, /stableAthleteKey\(equivalent, id\)/);
  assert.doesNotMatch(reconciliation, /trackedForEvent\[nextIndex\]/);
});

test("native map refocuses only when the selected athlete identity changes", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );
  const nativeMap = await readFile(
    new URL(
      "./course-map/components/CourseMapView.native.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(screen, /followSelectedAthlete\s*\n/);
  const initialFit = nativeMap.slice(
    nativeMap.indexOf('const key = `${map.name}:'),
    nativeMap.indexOf('useEffect(() => {', nativeMap.indexOf('const key = `${map.name}:') + 1),
  );
  assert.doesNotMatch(initialFit, /activeAthlete|sourceSignature/);
  assert.match(initialFit, /lastFitKeyRef\.current === key/);
  assert.match(
    nativeMap,
    /state\.gestures\.isGestureActive[\s\S]*setFollowEnabled\(false\)/,
  );
});

test("arrow taps lock the next identity and cannot be swallowed by the swipe dead zone", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    screen,
    /const selectAdjacentTrackedAthlete = useCallback\([\s\S]*selectedTrackedAthleteRef\.current = nextAthlete;[\s\S]*setSelectedTrackedKey\(nextKey\)/,
  );
  assert.match(
    screen,
    /onPrevious=\{\(\) => selectAdjacentTrackedAthlete\(-1\)\}/,
  );
  assert.match(screen, /onNext=\{\(\) => selectAdjacentTrackedAthlete\(1\)\}/);
  assert.doesNotMatch(
    screen,
    /horizontalDistance > 18[\s\S]*horizontalDistance < 45/,
  );
});

test("direct athlete and map-marker taps lock the requested canonical identity", async () => {
  const screen = await readFile(
    new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    screen,
    /const selectTrackedAthlete = useCallback\([\s\S]*const nextKey = stableAthleteKey\(nextAthlete, id\);[\s\S]*selectedTrackedAthleteRef\.current = nextAthlete;[\s\S]*setSelectedTrackedKey\(nextKey\)/,
  );
  assert.match(
    screen,
    /onAthletePress=\{\(athlete\) => \{[\s\S]*stableAthleteKey\(row\.athlete, id\) === athlete\.id[\s\S]*sameAthleteSelection\(row\.athlete, athlete\)[\s\S]*selectTrackedAthlete\(index\)/,
  );
  assert.match(
    screen,
    /<TrackedAthleteListCard[\s\S]*onOpen=\{\(\) => \{\s*selectTrackedAthlete\(index\);/,
  );
});
