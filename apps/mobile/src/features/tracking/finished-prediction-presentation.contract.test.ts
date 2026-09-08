import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveScreen = readFileSync(
  new URL("../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);
const predictionCard = readFileSync(
  new URL(
    "./athlete-detail/components/cards/PredictionCard.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("finished presentation is gated by canonical header state, not result presence", () => {
  assert.match(
    liveScreen,
    /const finished = detail\.header\.status === "finished"/,
  );
  assert.match(liveScreen, /!isNotStarted && !terminalOutcome/);
  assert.match(liveScreen, /finished=\{finished\}/);
  assert.match(liveScreen, /\{terminalOutcome && detail\.result \? \(/);
});

test("prediction UI has mapper and component suppression guards", () => {
  assert.match(
    liveScreen,
    /detail\.header\.status !== "finished" &&[\s\S]*detail\.predictionState\?\.suppressed !== true/,
  );
  assert.match(predictionCard, /predictionState\?\.suppressed/);
  assert.match(predictionCard, /predictionState\?\.raceState === "FINISHED"/);
});

test("finished map markers are pinned to the terminal course distance", () => {
  assert.match(
    liveScreen,
    /const isFinished =[\s\S]*detail\?\.header\.status === "finished"/,
  );
  assert.match(
    liveScreen,
    /let estimatedCourseDistanceKm = isFinished[\s\S]*detail\?\.track\?\.totalKm/,
  );
  assert.match(
    liveScreen,
    /raceState: isFinished[\s\S]*\? "FINISHED"[\s\S]*const distanceKm = projection\.distanceKm/,
  );
  assert.match(
    liveScreen,
    /nextCheckpointLabel: detail\?\.nextSplit\?\.checkpoint/,
  );
});

test("estimated clock and elapsed values have separate visible labels", () => {
  assert.match(predictionCard, /EST\. TIME OF DAY/);
  assert.match(predictionCard, /EST\. RACE ELAPSED/);
  assert.match(predictionCard, /EST\. FINISH AT/);
  assert.doesNotMatch(predictionCard, /Projected Race Time|Expected at/);
});
