import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public canonical timing reads bypass the authenticated mobile API", async () => {
  const [
    client,
    participantLiveRepository,
    canonicalRepository,
    athleteRepository,
    screen,
  ] = await Promise.all([
    readFile(
      new URL("../../../core/services/api/client.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../core/repositories/participantLive.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../core/repositories/canonicalTracking.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../../core/repositories/athlete.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(client, /canonicalReadApi[\s\S]*liveTrackingEdgeBaseUrl/);
  const canonicalTransport = client.slice(
    client.indexOf("export const canonicalReadApi"),
    client.indexOf("export function canonicalReadUrl"),
  );
  assert.doesNotMatch(
    canonicalTransport,
    /getOptionalFirebaseIdToken|Authorization/,
  );
  assert.doesNotMatch(
    canonicalRepository,
    /getOptionalFirebaseIdToken|backendUrl\(/,
  );
  assert.match(canonicalRepository, /canonicalReadUrl\(path\)/);
  assert.match(canonicalRepository, /\/v1\/events\//);
  assert.match(participantLiveRepository, /liveTrackingEdgeBaseUrl/);
  assert.match(participantLiveRepository, /\/v1\/live-participant\//);
  assert.doesNotMatch(
    participantLiveRepository,
    /getOptionalFirebaseIdToken|Authorization|mobileApiBaseUrl/,
  );
  assert.match(athleteRepository, /await getParticipantLive\(/);
  assert.match(athleteRepository, /participantLiveAsCanonicalEnvelope\(/);
  assert.match(screen, /queryKeys\.canonicalAthlete\(/);
  assert.match(screen, /\[mobile-live-query\]/);
  assert.match(screen, /LIVE_TRACK_RENDER/);
});
