import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const socket = readFileSync(
  new URL("./useCanonicalChangeSocket.ts", import.meta.url),
  "utf8",
);
const socketRegistry = readFileSync(
  new URL("./canonicalSocketRegistry.ts", import.meta.url),
  "utf8",
);
const notifications = readFileSync(
  new URL(
    "../../../core/navigation/useNotificationDeepLinks.ts",
    import.meta.url,
  ),
  "utf8",
);
const provider = readFileSync(
  new URL("../../../core/providers/QueryProvider.tsx", import.meta.url),
  "utf8",
);
const screen = readFileSync(
  new URL("../../events/components/LiveTrackScreen.tsx", import.meta.url),
  "utf8",
);

test("C: a foreground split notification refreshes the matching live athlete cache", () => {
  assert.match(notifications, /invalidateLiveTimingParticipant\(queryClient/);
  assert.match(
    notifications,
    /participantUuid = data\.participantUuid \|\| data\.athleteId/,
  );
  assert.match(notifications, /Notifications\.addNotificationReceivedListener/);
});

test("E: socket and notification listeners remain single-owner and clean up", () => {
  assert.match(socket, /lease\.release\("effect_disposed"\)/);
  assert.match(socketRegistry, /entry\.appStateSubscription\.remove\(\)/);
  assert.match(socketRegistry, /entry\.onlineSubscription\(\)/);
  assert.match(socketRegistry, /entry\.socket !== socket/);
  assert.match(notifications, /receivedSub\.remove\(\)/);
  assert.match(notifications, /responseSub\.remove\(\)/);
});

test("F: socket timing changes refetch participant detail and preserve the freshest returned response", () => {
  assert.match(socket, /invalidateLiveTimingParticipant\(queryClient/);
  assert.match(
    socket,
    /change\.providerParticipantUuid === activeParticipantUuid/,
  );
  assert.match(
    screen,
    /structuralSharing: \(current, incoming\)\s*=>\s*preferFreshestAthleteResponse/,
  );
});

test("D2: native background to active invalidates active live timing queries", () => {
  assert.match(provider, /previousState = AppState\.currentState/);
  assert.match(provider, /status === "active" && previousState !== "active"/);
  assert.match(provider, /invalidateActiveLiveTimingQueries\(queryClient\)/);
});
