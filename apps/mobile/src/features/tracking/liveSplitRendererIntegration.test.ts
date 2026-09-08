import assert from "node:assert/strict";
import test from "node:test";

import { getVisibleLiveSplits, type TimelineSplit } from "./mappers";
import {
  buildLiveSplitTableDiagnostic,
  selectProgressiveSplitTableRows,
} from "./athlete-detail/components/cards/progressiveSplitTable";

function configured(
  key: string,
  name: string,
  distanceLabel: string,
): TimelineSplit {
  return {
    key,
    name,
    splitLabel: name,
    segment: "SWIM",
    distanceLabel,
    state: "upcoming",
    timeLabel: "—",
    timeOfDayLabel: "—",
  };
}

for (const fixture of [
  {
    bib: "101",
    participantUuid: "race:6ueookhs:kids-500:101",
    configuredRows: [
      configured("start", "Start", "0 km"),
      configured("finish", "Finish", "0.5 km"),
    ],
  },
  {
    bib: "4121",
    participantUuid: "race:6ueookhs:swim-4km:4121",
    configuredRows: [
      configured("start", "Start", "0 km"),
      configured("lap-1", "Lap 1", "2 km"),
      configured("finish", "Swim Finish", "4 km"),
    ],
  },
]) {
  test(`BIB ${fixture.bib} mapper and final table both expose Start only`, () => {
    const progressive = getVisibleLiveSplits(
      fixture.configuredRows,
      [],
      "NOT_STARTED",
      "SWIM",
      "START",
    );
    const rendered = selectProgressiveSplitTableRows(progressive, {
      notStarted: true,
    });
    const diagnostic = buildLiveSplitTableDiagnostic(rendered, {
      participantUuid: fixture.participantUuid,
      canonicalVersion: "canonical-swimathon-v1",
      status: "notStarted",
    });

    assert.equal(progressive.length, 1, "mapper row count");
    assert.equal(diagnostic.rowCount, 1, "renderer row count");
    assert.deepEqual(
      diagnostic.rows.map((row) => row.label),
      ["Start"],
    );
    assert.equal(diagnostic.participantUuid, fixture.participantUuid);
    assert.equal(diagnostic.canonicalVersion, "canonical-swimathon-v1");
    assert.equal(diagnostic.source, "progressive_timeline");
  });
}
