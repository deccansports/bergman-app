import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-types runner needs the explicit extension.
import * as selection from "./trackingSelection.ts";

const {
  responseMatchesSelectedParticipant,
  selectionAfterTrackedAthleteRemoval,
} = selection;

test("an older athlete response cannot render after selection changes", () => {
  const athleteA = "race:provider:contest:a";
  const athleteB = "race:provider:contest:b";
  assert.equal(responseMatchesSelectedParticipant(athleteA, athleteB), false);
  assert.equal(responseMatchesSelectedParticipant(athleteB, athleteB), true);
  assert.equal(
    responseMatchesSelectedParticipant(athleteB.toUpperCase(), athleteB),
    true,
  );
});

test("removing the selected middle athlete selects the following athlete", () => {
  assert.deepEqual(
    selectionAfterTrackedAthleteRemoval(["A", "B", "C"], "B", "B"),
    {
      remainingKeys: ["A", "C"],
      nextSelectedKey: "C",
      nextSelectedIndex: 1,
    },
  );
});

test("removing the selected tail selects the previous final athlete", () => {
  assert.deepEqual(
    selectionAfterTrackedAthleteRemoval(["A", "B", "C"], "C", "C"),
    {
      remainingKeys: ["A", "B"],
      nextSelectedKey: "B",
      nextSelectedIndex: 1,
    },
  );
});

test("removing a non-selected athlete preserves selection by identity", () => {
  assert.deepEqual(
    selectionAfterTrackedAthleteRemoval(["A", "B", "C"], "C", "A"),
    {
      remainingKeys: ["B", "C"],
      nextSelectedKey: "C",
      nextSelectedIndex: 1,
    },
  );
});

test("removing the final athlete clears selection", () => {
  assert.deepEqual(selectionAfterTrackedAthleteRemoval(["A"], "A", "A"), {
    remainingKeys: [],
    nextSelectedKey: null,
    nextSelectedIndex: -1,
  });
});
