import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveScreen = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const mappers = readFileSync(new URL("./mappers.ts", import.meta.url), "utf8");

test("finished athlete detail hydrates ranks with one cached Finish-board query", () => {
  assert.match(liveScreen, /const athleteRankingsQuery = useQuery/);
  assert.match(liveScreen, /split: selectedFinishSplitKey/);
  assert.match(
    liveScreen,
    /queryKeys\.leaderboard\(id, \{[\s\S]*participantUuid: selectedParticipantUuid,[\s\S]*bib: selectedAthleteBib/,
  );
  assert.match(liveScreen, /participantUuid: selectedParticipantUuid/);
  assert.match(liveScreen, /bib: firstText\(/);
  assert.match(liveScreen, /"athlete-detail-ranks"/);
  assert.match(liveScreen, /enabled: Boolean\([\s\S]*athleteExpanded/);
  assert.match(liveScreen, /selectedAthleteCanHaveRank/);
  assert.match(liveScreen, /hasTerminalNonFinishStatus/);
  assert.match(liveScreen, /refetchInterval: false/);
  assert.match(liveScreen, /canonical athlete snapshot is authoritative/);
  assert.match(
    liveScreen,
    /result\.genderRank,[\s\S]*athlete\.genderRank,[\s\S]*rankingRow\.genderRank/,
  );
  assert.match(
    liveScreen,
    /result\.categoryRank,[\s\S]*athlete\.ageGroupRank,[\s\S]*rankingRow\.ageGroupRank/,
  );
  assert.match(
    liveScreen,
    /overallRank: overallRank \?\? athlete\.overallRank/,
  );
  assert.match(liveScreen, /genderRank: genderRank \?\? athlete\.genderRank/);
  assert.match(
    liveScreen,
    /ageGroupRank: ageGroupRank \?\? athlete\.ageGroupRank/,
  );
  assert.match(liveScreen, /rank: overallRank \?\? split\.rank/);
  assert.match(liveScreen, /rankingRow\.paceDisplay/);
  assert.match(liveScreen, /paceSpeed: split\.paceSpeed \?\? rankingPace/);
  assert.match(
    liveScreen,
    /averagePace:[\s\S]*result\.averagePace \?\? rankingPace/,
  );
  assert.match(
    liveScreen,
    /mapAthleteDetail\(selectedAthleteResponseWithRanks\)/,
  );
});

test("rank presentation names age-group rank explicitly", () => {
  assert.match(mappers, /label: "Age Group", value: categoryRank/);
  assert.doesNotMatch(mappers, /label: "Category", value: categoryRank/);
});

test("native timing points remain layer based and visibly distinct", () => {
  const nativeMap = readFileSync(
    new URL(
      "../tracking/course-map/components/CourseMapView.native.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(nativeMap, /bergman-timing-point-inner-rings/);
  assert.match(nativeMap, /bergman-timing-point-centers/);
  assert.match(nativeMap, /filter=\{\["==", \["get", "kind"\], "timing"\]/);
  assert.doesNotMatch(nativeMap, /timing-point[\s\S]{0,120}<MarkerView/);
});
