import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const resultsCard = readFileSync(
  new URL(
    "./athlete-detail/components/cards/OfficialResultsCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const liveScreen = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const athleteDetailScreen = readFileSync(
  new URL(
    "./athlete-detail/components/AthleteDetailScreen.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("finished card prioritizes identity, result, ranks, summary, then splits", () => {
  const component = resultsCard.slice(
    resultsCard.indexOf("export function OfficialResultsCard"),
  );
  const markup = component.slice(component.indexOf("  return ("));
  const orderedMarkers = [
    "{header.name}",
    "`Bib ${header.bib}`",
    "{statusLabel}",
    '"FINISH TIME"',
    "FINISHED AT",
    "RANKS",
    "RACE COMPLETE",
    "Race Summary",
    "Your Splits",
  ];

  let cursor = -1;
  for (const marker of orderedMarkers) {
    const next = markup.indexOf(marker, cursor + 1);
    assert.ok(next > cursor, `expected ${marker} after the previous section`);
    cursor = next;
  }
});

test("finish time is the dominant metric and finished-at remains secondary", () => {
  assert.match(resultsCard, /finishedTimeValue:[\s\S]*fontSize: 52/);
  assert.match(resultsCard, /finishedAtValue:[\s\S]*fontSize: 18/);
  assert.match(resultsCard, /fontVariant: \["tabular-nums"\]/);
});

test("finished ranks are presentation-only and include supported rank groups", () => {
  assert.match(
    resultsCard,
    /normalized === "overall"[\s\S]*return "Overall Rank"/,
  );
  assert.match(
    resultsCard,
    /normalized === "gender"[\s\S]*return "Gender Rank"/,
  );
  assert.match(resultsCard, /return "Age Group Rank"/);
  assert.match(
    resultsCard,
    /displayedRanks = finished[\s\S]*"Overall Rank", "Gender Rank", "Age Group Rank"/,
  );
  assert.match(resultsCard, /isFinishedResultStatus\(statusLabel\)/);
});

test("finished summary opens before duplicate progress and never enters live widgets", () => {
  assert.match(liveScreen, /!expanded \|\| !terminalOutcome \? \(/);
  assert.match(liveScreen, /\{terminalOutcome && detail\.result \? \(/);
  assert.match(
    liveScreen,
    /detail\.header\.status !== "finished" &&[\s\S]*<PredictionCard/,
  );
});

test("finished details and splits remain inside vertical scroll containers", () => {
  assert.ok(
    liveScreen.indexOf("<ScrollView") <
      liveScreen.indexOf("<SelectedAthletePanel"),
  );
  assert.ok(
    athleteDetailScreen.indexOf("<ScrollView") <
      athleteDetailScreen.indexOf("<OfficialResultsCard"),
  );
});

test("active and not-started branches retain their existing live layout", () => {
  assert.match(liveScreen, /\{isNotStarted \? \([\s\S]*<RaceStartCountdown/);
  assert.match(
    liveScreen,
    /\{!isNotStarted && !terminalOutcome \? \([\s\S]*<CompactLiveTimingSummary/,
  );
  assert.match(liveScreen, /\) : \([\s\S]*<TimelineCard[\s\S]*<PredictionCard/);
});
