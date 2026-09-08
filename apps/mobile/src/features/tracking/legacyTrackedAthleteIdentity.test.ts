import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCanonicalTrackedAthleteIdentity,
  legacyTrackedAthleteLookup,
  resolveLegacyTrackedAthlete,
  resolvedTrackedAthleteForLiveState,
  // @ts-expect-error Node's strip-types test runner requires the explicit .ts extension.
} from "./legacyTrackedAthleteIdentity.ts";

const canonical = {
  id: "race:6qtff6cr:k9jmboom:2001",
  participantUuid: "race:6qtff6cr:k9jmboom:2001",
  providerEventUuid: "6QTff6CR",
  providerContestUuid: "k9jmBOom",
  canonicalContestUuid: "k9jmBOom",
  bib: "2001",
  name: "Vaibhav",
};

test("a legacy BIB watchlist row hydrates to exact canonical scope", () => {
  const legacy = { id: "bib:2001", bib: " 02001 ", name: "Vaibhav" };
  const lookup = legacyTrackedAthleteLookup(legacy);
  assert.deepEqual(lookup, { value: "02001", mode: "bib", kind: "bib" });
  const resolved = resolveLegacyTrackedAthlete(legacy, [canonical], lookup!);
  assert.equal(resolved?.bib, "2001");
  assert.equal(resolved?.participantUuid, canonical.participantUuid);
  assert.equal(resolved?.providerEventUuid, "6QTff6CR");
  assert.equal(hasCanonicalTrackedAthleteIdentity(resolved), true);
});

test("an opaque legacy identity resolves only to its matching candidate", () => {
  const legacy = {
    id: "legacy-provider-athlete",
    bib: "",
    name: "Vaibhav",
    providerAthleteUuid: "provider-athlete-42",
  };
  const lookup = legacyTrackedAthleteLookup(legacy);
  const resolved = resolveLegacyTrackedAthlete(
    legacy,
    [canonical, { ...canonical, providerAthleteUuid: "provider-athlete-42" }],
    lookup!,
  );
  assert.equal(resolved?.participantUuid, canonical.participantUuid);
  assert.equal(resolved?.bib, "2001");
});

test("a name-only legacy row is never guessed when multiple athletes match", () => {
  const legacy = { id: "Vaibhav", bib: "", name: "Vaibhav" };
  const lookup = legacyTrackedAthleteLookup(legacy);
  const resolved = resolveLegacyTrackedAthlete(
    legacy,
    [canonical, { ...canonical, participantUuid: "race:other:c:9" }],
    lookup!,
  );
  assert.equal(resolved, null);
});

test("a persisted canonical-looking row is revalidated by BIB after provider scope replacement", () => {
  const historical = {
    ...canonical,
    id: "race:1xajvfm0:2z0u7pwv:4121",
    participantUuid: "race:1xajvfm0:2z0u7pwv:4121",
    providerEventUuid: "1xajVfM0",
    providerContestUuid: "2z0u7pwv",
    canonicalContestUuid: "",
    bib: "4121",
  };
  const current = {
    ...canonical,
    id: "race:6ueookhs:7yc3etju:4121",
    participantUuid: "race:6ueookhs:7yc3etju:4121",
    providerEventUuid: "6ueOOKHs",
    providerContestUuid: "7Yc3etJU",
    bib: "4121",
  };

  const lookup = legacyTrackedAthleteLookup(historical);
  assert.deepEqual(lookup, { value: "4121", mode: "bib", kind: "bib" });
  const resolved = resolveLegacyTrackedAthlete(historical, [current], lookup!);
  assert.equal(resolved?.participantUuid, current.participantUuid);
  assert.equal(resolved?.providerEventUuid, "6ueOOKHs");
  assert.equal(resolved?.providerContestUuid, "7Yc3etJU");
});

test("a canonical row without a BIB does not create an unsafe broad search", () => {
  assert.equal(legacyTrackedAthleteLookup({ ...canonical, bib: "" }), null);
});

test("historical provider identity cannot enter live state before migration", () => {
  const historical = {
    ...canonical,
    participantUuid: "race:1xajvfm0:2z0u7pwv:4121",
    providerEventUuid: "1xajvfm0",
    canonicalContestUuid: "",
    bib: "4121",
  };
  assert.equal(resolvedTrackedAthleteForLiveState(historical, null), null);
});

test("stale BIB migrates only with one authoritative current-provider match", () => {
  const historical = {
    ...canonical,
    participantUuid: "race:1xajvfm0:2z0u7pwv:4121",
    providerEventUuid: "1xajvfm0",
    canonicalContestUuid: "",
    bib: "4121",
  };
  const current = {
    ...canonical,
    participantUuid: "race:6ueookhs:7yc3etju:4121",
    providerEventUuid: "6ueOOKHs",
    bib: "4121",
  };
  const lookup = legacyTrackedAthleteLookup(historical)!;
  const migrated = resolveLegacyTrackedAthlete(historical, [current], lookup);
  assert.equal(
    resolvedTrackedAthleteForLiveState(historical, migrated)?.participantUuid,
    current.participantUuid,
  );
  assert.equal(
    resolveLegacyTrackedAthlete(
      historical,
      [current, { ...current, participantUuid: "race:6ueookhs:other:4121" }],
      lookup,
    ),
    null,
  );
  assert.equal(
    resolvedTrackedAthleteForLiveState(historical, { ...current, bib: "9999" }),
    null,
  );
});

test("current provider identity remains unchanged after exact resolution", () => {
  assert.equal(legacyTrackedAthleteLookup(canonical), null);
  assert.deepEqual(
    resolvedTrackedAthleteForLiveState(canonical, null),
    canonical,
  );
});
