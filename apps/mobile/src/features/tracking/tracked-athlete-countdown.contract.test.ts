import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const countdown = readFileSync(
  new URL(
    "./athlete-detail/components/cards/RaceStartCountdown.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("tracked cards use participant-scoped lightweight reads without loading the event roster", () => {
  assert.match(source, /const trackedAthleteLiveQueries = useQueries\(/);
  assert.match(source, /const selectedAthleteQuery = useQuery(?:<[^>]+>)?\(/);
  assert.match(source, /queryKeys\.canonicalAthlete\([\s\S]*athleteDataSource/);
  assert.match(source, /const trackedSummaryDetails = useMemo\(/);
  assert.doesNotMatch(source, /useParticipants|useCanonicalParticipants/);
});

test("tracked cards prefer selected canonical timing and otherwise use cached summaries", () => {
  assert.match(
    source,
    /const response = isSelected \? selectedAthleteResponse : undefined/,
  );
  assert.match(
    source,
    /resolveAthleteTicket\([\s\S]*athlete,[\s\S]*rawDetail\.header\.contest,[\s\S]*canonicalResponse\?\.contestDefinition/,
  );
  assert.match(
    source,
    /const scheduledStart = scheduledStartFromTicket\(\s*athlete as unknown as Record<string, unknown>,\s*ticket \?\? \{\},\s*\)/,
  );
  assert.match(
    source,
    /renderItem=\{\(\{[\s\S]*item: \{ athlete, detail[\s\S]*<RaceStartCountdown[\s\S]*scheduledStart=\{detail\?\.header\.scheduledStart\}/,
  );
});

test("different tracked contests share only BERGMAN 102 display geometry", () => {
  assert.match(
    source,
    /const mapGeometrySelection = useMemo<CourseMapSelection>[\s\S]*bergman102MasterSelection[\s\S]*allowedSegments: allowedGeometrySegments[\s\S]*: courseSelection/,
  );
  assert.match(
    source,
    /const geometryQuery = useCourseGeometry\([\s\S]*mapGeometrySelection/,
  );
  assert.match(
    source,
    /Boolean\(\s*bergman102MasterSelection \|\|[\s\S]*fallbackCourseAthlete/,
  );
  assert.match(
    source,
    /const fallbackCourseAthlete =\s*mapAthlete \?\? verifiedAutoTrackAthlete/,
  );
  assert.match(
    source,
    /bergman102MasterSelection \? "event-config" : "canonical"/,
  );
  assert.doesNotMatch(
    source,
    /\.\.\.master,\s*providerEventUuid:\s*selectedProviderEventUuid/,
  );
  assert.match(
    source,
    /providerEventUuid:\s*bergman102MasterSelection\s*\?\s*undefined\s*:\s*normalizedSelectedProviderEventUuid/,
  );
  assert.match(
    source,
    /const elevationGeometryQuery = useCourseGeometry\([\s\S]*elevationOpen[\s\S]*courseSelection/,
  );
  assert.match(
    source,
    /positionOnCurrentLeg\(\s*detail,\s*estimatedCourseDistanceKm,?\s*\)/,
  );
});

test("compact map card replaces empty live elapsed with the start countdown", () => {
  assert.match(
    source,
    /function CompactMapAthleteCard[\s\S]*\{notStarted \? \([\s\S]*<RaceStartCountdown[\s\S]*scheduledStart=\{scheduledStart \|\| undefined\}[\s\S]*startTiming=\{detail\?\.startTiming\}/,
  );
  assert.match(
    source,
    /finished \? `Finish time: \$\{timeLabel\}` : effectiveTerminalNonFinish[\s\S]*: notStarted \? "Race not started" : `Live elapsed: \$\{timeLabel\}`/,
  );
});

test("live cards show the canonical cutoff below elapsed and keep clocks inside narrow cards", () => {
  const compactCardStart = source.indexOf("function CompactMapAthleteCard(");
  const compactCardEnd = source.indexOf(
    "function MapSettingsToggle(",
    compactCardStart,
  );
  const compactCard = source.slice(compactCardStart, compactCardEnd);
  const elapsedValue = compactCard.indexOf("{timeLabel}");
  const cutoffValue = compactCard.indexOf("{cutoffPresentation.label}");

  assert.match(
    compactCard,
    /resolveCanonicalCutoffPresentation\(\s*detail\?\.activeCutoff,\s*raceClockNowMs,\s*\)/,
  );
  assert.ok(elapsedValue >= 0 && cutoffValue > elapsedValue);
  assert.match(
    compactCard.slice(elapsedValue - 500, cutoffValue),
    /numberOfLines=\{1\}[\s\S]*adjustsFontSizeToFit[\s\S]*minimumFontScale=\{0\.62\}/,
  );
  assert.match(compactCard, /style=\{\{ flex: 1, minWidth: 0 \}\}/);

  const progressStart = source.indexOf("function CompactRaceProgress(");
  const progressEnd = source.indexOf(
    "function parseElapsedClock(",
    progressStart,
  );
  const progressCard = source.slice(progressStart, progressEnd);
  assert.ok(
    progressCard.indexOf("{displayedElapsedTime}") <
      progressCard.indexOf("{cutoffPresentation.label}"),
  );
  assert.match(
    progressCard,
    /maxWidth: "58%",[\s\S]*minWidth: 0,[\s\S]*minimumFontScale=\{0\.62\}/,
  );
});

test("terminal DNF status stops the mobile live clock and replaces live labels", () => {
  const compactCardStart = source.indexOf("function CompactMapAthleteCard(");
  const compactCardEnd = source.indexOf(
    "function MapSettingsToggle(",
    compactCardStart,
  );
  const compactCard = source.slice(compactCardStart, compactCardEnd);

  assert.match(
    compactCard,
    /const terminalNonFinish = \["DNF", "DNS", "DNQ", "DSQ"\]\.includes\(/,
  );
  assert.match(
    compactCard,
    /const raceClockRunning =\s*!terminalNonFinish && canRunAthleteRaceClock\(detail\)/,
  );
  assert.match(
    compactCard,
    /finished[\s\S]*\? "FINISH TIME"[\s\S]*: effectiveTerminalNonFinish[\s\S]*\? effectiveTerminalStatus[\s\S]*: "LIVE ELAPSED"/,
  );
});

test("pre-start countdown is server-corrected and reports its canonical source per input revision", () => {
  assert.match(countdown, /\[PRESTART_CLOCK_SOURCE\]/);
  for (const field of [
    "participantUuid",
    "canonicalContestUuid",
    "scheduledStartAt",
    "waveStartAt",
    "gunStartAt",
    "chipStartAt",
    "serverNow",
    "correctedNow",
    "countdownSeconds",
    "source",
  ]) {
    assert.match(countdown, new RegExp(field));
  }
  assert.match(
    countdown,
    /Date\.now\(\) \+ Number\(startTiming\?\.serverTimeOffsetMs \?\? 0\)/,
  );
  assert.match(source, /participantUuid=\{row\.athlete\.participantUuid\}/);
});
