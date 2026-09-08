import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mobileCard = readFileSync(
  new URL("./components/cards/OfficialResultsCard.tsx", import.meta.url),
  "utf8",
);
const webCard = readFileSync(
  new URL(
    "../../../../../../src/components/live-tracking/CompactAthleteTimingPanel.tsx",
    import.meta.url,
  ),
  "utf8",
);
const athleteRepository = readFileSync(
  new URL("../../../core/repositories/athlete.repository.ts", import.meta.url),
  "utf8",
);

test("finished mobile result mirrors the web result hierarchy and branding", () => {
  assert.match(mobileCard, /alt="Bergman logo"/);
  assert.match(mobileCard, /Congratulations, \{header\.name\}!/);
  assert.match(mobileCard, /Every kilometre tested you/);
  assert.match(mobileCard, /TIMING METHOD/);
  assert.match(mobileCard, /CHIP TIME/);
  assert.match(mobileCard, /GUN TIME/);
  assert.match(mobileCard, /AVERAGE PACE \/ SPEED/);
  assert.match(mobileCard, /metaValue\(result\.meta, "Age Group"\)/);
  assert.match(mobileCard, /"Overall Rank", "Gender Rank", "Age Group Rank"/);
  assert.match(mobileCard, /isFinishedResultStatus\(statusLabel\)/);
  assert.match(mobileCard, /adjustsFontSizeToFit/);
  assert.match(mobileCard, /minimumFontScale=\{0\.68\}/);
  assert.match(mobileCard, /\[\.\.\.result\.splits\][\s\S]*split\.paceSpeed/);
  assert.match(webCard, /<Image[\s\S]*src="\/Bmlogowhite\.png"/);
});

test("mobile and web remain projections of the canonical live athlete read", () => {
  assert.match(athleteRepository, /\/canonical\/athlete/);
  assert.doesNotMatch(
    athleteRepository,
    /const endpoints = \[[\s\S]*athlete-modal/,
  );
});
