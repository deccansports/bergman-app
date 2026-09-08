import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("iOS live diagnostics attribute hot-path work without recording secrets", async () => {
  const [
    diagnostics,
    http,
    auth,
    firebase,
    secureStore,
    queryProvider,
    participantLive,
    map,
  ] = await Promise.all([
    readFile(
      new URL(
        "../../core/services/performance/iosLiveDiagnostics.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../core/services/api/http.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../core/auth/authenticatedFetch.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../core/auth/firebase.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../core/auth/secureStore.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../core/providers/QueryProvider.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../core/repositories/participantLive.repository.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "./course-map/components/CourseMapView.native.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(diagnostics, /ATHLETE_SWITCH_START/);
  assert.match(diagnostics, /ATHLETE_SWITCH_RENDER_COMPLETE/);
  assert.match(diagnostics, /API_REQUEST_START/);
  assert.match(diagnostics, /API_REQUEST_END/);
  assert.match(diagnostics, /API_REQUEST_CANCELLED/);
  assert.match(diagnostics, /DUPLICATE_REQUEST/);
  assert.match(diagnostics, /FIREBASE_TOKEN_OPERATION/);
  assert.match(diagnostics, /SECURE_STORE_OPERATION/);
  assert.match(diagnostics, /REACT_QUERY_EVENT/);
  assert.match(diagnostics, /boundedDiagnosticText\(details\.queryHash, 240\)/);
  assert.match(diagnostics, /details\.type === "observerResultsUpdated"/);
  assert.match(diagnostics, /summarizeDiagnosticValue/);
  assert.match(http, /url\.includes\("\/api\/live\/leaderboard\/"\)/);
  assert.match(diagnostics, /JS_EVENT_LOOP_STALL/);
  assert.match(diagnostics, /IOS_LIVE_DIAGNOSTIC_WINDOW/);
  assert.match(diagnostics, /Platform\.OS !== "ios"/);
  assert.doesNotMatch(diagnostics, /Authorization|Bearer|accessToken/);
  assert.match(http, /startDiagnosticRequest/);
  assert.match(http, /finishDiagnosticRequest/);
  assert.match(auth, /getOptionalFirebaseIdToken/);
  assert.match(firebase, /measureFirebaseToken/);
  assert.match(secureStore, /measureSecureStore/);
  assert.match(queryProvider, /getQueryCache\(\)\.subscribe/);
  assert.match(
    participantLive,
    /participantLive\.repository:getParticipantLive/,
  );
  assert.match(participantLive, /mobile-live-participant/);
  assert.doesNotMatch(map, /markerAnimationFrame|setCoordinate/);
  assert.match(
    map,
    /coordinate=\{\[athlete\.position\.lng, athlete\.position\.lat\]\}/,
  );
  assert.match(map, /liveMapUnmount/);
  assert.match(map, /courseSourceUpdate/);
});

test("production disables diagnostics and native development logging is opt-in", async () => {
  const [environment, policy, eas, map] = await Promise.all([
    readFile(new URL("../../core/constants/env.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../core/services/performance/liveDiagnosticsPolicy.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../../eas.json", import.meta.url), "utf8"),
    readFile(
      new URL(
        "./course-map/components/CourseMapView.native.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(environment, /process\.env\.NODE_ENV === ['"]production['"]/);
  assert.equal(
    JSON.parse(eas).build.production.env.EXPO_PUBLIC_ENV,
    "production",
  );
  assert.match(policy, /Platform\.OS === "web"/);
  assert.match(policy, /EXPO_PUBLIC_NATIVE_LIVE_DIAGNOSTICS === "true"/);
  assert.doesNotMatch(map, /requestAnimationFrame|setCoordinate/);
});
