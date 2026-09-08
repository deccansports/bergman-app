import assert from "node:assert/strict";
import test from "node:test";

import {
  athletePresentationFingerprint,
  canonicalAthletePresentationIdentity,
  // @ts-expect-error Node strip-types tests require the explicit extension.
} from "./mappers.ts";

test("provider UUID casing creates one canonical presentation identity", () => {
  const response = (providerEventUuid: string) => ({
    success: true,
    eventId: "event-a",
    athlete: {
      participantUuid: "race:6ueookhs:1qkaizpt:101",
      providerEventUuid,
    },
  });
  assert.equal(
    canonicalAthletePresentationIdentity(response("6ueOOKHs") as never),
    canonicalAthletePresentationIdentity(response("6ueookhs") as never),
  );
  assert.equal(
    canonicalAthletePresentationIdentity({
      success: true,
      eventId: "event-a",
      athlete: { bib: "101" },
    } as never),
    null,
  );
});

test("compact canonical age-group arrival invalidates the participant presentation", () => {
  const response = (ageGroup?: string) => ({
    success: true,
    eventId: "event-a",
    activeVersion: "build-a",
    athlete: {
      participantUuid: "race:6ueookhs:1qkaizpt:101",
      providerEventUuid: "6ueOOKHs",
      name: "Aghna H Surya",
      bib: "101",
      ageGroup,
    },
  });

  assert.notEqual(
    athletePresentationFingerprint(response() as never),
    athletePresentationFingerprint(response("under-12") as never),
  );
});
