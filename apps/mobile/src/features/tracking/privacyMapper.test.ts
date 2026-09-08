import assert from "node:assert/strict";
import test from "node:test";

import type { AthleteModalResponse } from "@/core/types";
import { mapAthleteDetail } from "./mappers";

function anonymousResponse(
  visibility: "ANONYMOUS" | "PRIVATE",
): AthleteModalResponse {
  return {
    success: true,
    eventId: "event",
    visibility,
    athlete: {
      id: "participant-secret",
      athleteUid: "account-secret",
      bib: "1001",
      name: "Private Athlete",
      email: "private@example.com",
      club: "Private Club",
      country: "India",
      city: "Bengaluru",
      photoUrl: "https://example.com/private.jpg",
      trackingVisibility: visibility,
    },
  } as AthleteModalResponse;
}

for (const visibility of ["ANONYMOUS", "PRIVATE"] as const) {
  test(`${visibility === "PRIVATE" ? "legacy PRIVATE alias" : "ANONYMOUS"} cannot leak direct athlete identity`, () => {
    const detail = mapAthleteDetail(anonymousResponse(visibility));

    assert.equal(detail.isAnonymous, true);
    assert.equal(detail.id, "anonymous-athlete");
    assert.equal(detail.header.name, "Anonymous Athlete");
    assert.equal(detail.header.bib, "—");
    assert.equal(detail.header.email, undefined);
    assert.equal(detail.header.athleteUid, undefined);
    assert.equal(detail.header.photo, undefined);
    assert.equal(detail.header.club, undefined);
    assert.equal(detail.header.countryFlag, undefined);
    assert.equal(detail.header.location, undefined);
    assert.equal(detail.header.colorSeed, "anonymous-athlete");
  });
}
