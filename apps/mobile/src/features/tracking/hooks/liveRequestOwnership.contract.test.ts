import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const authProvider = read("../../../core/auth/AuthProvider.tsx");
const watchlistHook = read("../watchlist/hooks/useWatchlist.ts");
const liveScreen = read("../../events/components/LiveTrackScreen.tsx");
const courseRepository = read(
  "../../../core/repositories/course.repository.ts",
);
const courseScreen = read("../course-map/components/CourseMapScreen.tsx");
const eventExperience = read("../../events/hooks/useEventExperience.ts");
const trackingQueries = read("./useTrackingQueries.ts");
const courseConfig = read("../course-map/courseConfig.ts");
const http = read("../../../core/services/api/http.ts");
const eventsHook = read("../../events/hooks/useEvents.ts");
const eventsRepository = read(
  "../../../core/repositories/events.repository.ts",
);
const eventDetailsScreen = read(
  "../../events/components/EventDetailsScreen.tsx",
);
const eventScreenInitialization = read(
  "../../events/hooks/useEventScreenInitialization.ts",
);

test("the authenticated session is the only watchlist GET owner", () => {
  assert.match(authProvider, /useQuery\(\{[\s\S]*accountWatchlist/);
  assert.match(authProvider, /staleTime: 0/);
  assert.match(authProvider, /refetchOnMount: "always"/);
  assert.match(authProvider, /Boolean\(accessToken\)/);
  assert.match(authProvider, /\[WATCHLIST_READ\]/);
  assert.match(authProvider, /reason: watchlistReadReasonRef\.current/);
  assert.match(authProvider, /"initial_restore" \| "foreground_reconcile"/);
  assert.doesNotMatch(watchlistHook, /trackingSubscriptions\.list\(/);
  assert.doesNotMatch(watchlistHook, /refetchInterval|refetchOnWindowFocus/);
  assert.match(watchlistHook, /setQueryData\([\s\S]*accountWatchlist/);
});

test("tracked cards own compact participant reads while only the selected athlete owns full presentation state", () => {
  assert.match(liveScreen, /const selectedIdentityQuery = useQuery\(/);
  assert.doesNotMatch(
    liveScreen,
    /const trackedAthleteDetailQueries = useQueries\(/,
  );
  assert.doesNotMatch(liveScreen, /useParticipants\(/);
  assert.match(
    liveScreen,
    /const selectedAthleteQuery = useQuery(?:<[^>]+>)?\(/,
  );
  assert.match(liveScreen, /queryKeys\.canonicalAthlete\(/);
  assert.match(liveScreen, /canonicalSocket\.isConnected/);
  assert.match(liveScreen, /selectedAthleteFallbackMs/);
  assert.match(liveScreen, /staleTime: Infinity/);
  assert.match(liveScreen, /refetchOnReconnect: false/);
  assert.match(liveScreen, /\[mobile-live-query\]/);
  assert.match(liveScreen, /SOCKET_DISCONNECTED_FALLBACK/);
  const selectedAthleteQuery = liveScreen.match(
    /const selectedAthleteQuery = useQuery(?:<[^>]+>)?\(\{[\s\S]*?\n  \}\);/,
  );
  assert.ok(selectedAthleteQuery);
  assert.match(selectedAthleteQuery[0], /enabled: Boolean\([\s\S]*?authReady/);
  assert.doesNotMatch(
    selectedAthleteQuery[0],
    /authStatus === "authenticated"/,
  );
  assert.doesNotMatch(selectedAthleteQuery[0], /authToken/);
  assert.match(
    liveScreen,
    /const selectedIdentityQuery = useQuery\([\s\S]*identityHydrationBudget\.includes\(fullDetailIndex\)[\s\S]*authReady/,
  );
  assert.match(liveScreen, /const trackedAthleteLiveQueries = useQueries\(/);
  assert.match(
    liveScreen,
    /trackedForEvent\.map\([\s\S]*queryKeys\.canonicalAthlete\([\s\S]*"athleteOnly"/,
  );
  assert.match(
    liveScreen,
    /const response = trackedAthleteLiveQueries\[index\]\?\.data/,
  );
  assert.match(liveScreen, /const trackedSummaryDetails = useMemo\(/);
  assert.match(liveScreen, /trackedSummaryDetailCacheRef\.current/);
  assert.match(liveScreen, /cached\?\.fingerprint === fingerprint/);
  assert.doesNotMatch(liveScreen, /index !== fullDetailIndex &&\s*lookup/);
  assert.doesNotMatch(
    liveScreen,
    /if \(index === fullDetailIndex\) return selectedDetailAthlete/,
  );
  assert.doesNotMatch(liveScreen, /queryKeys\.mobileLiveParticipant\(/);
  assert.match(
    read("../../../core/services/query/queryKeys.ts"),
    /CANONICAL_ATHLETE_VIEW_SCHEMA_VERSION = "split-flow-v2"/,
  );
  assert.doesNotMatch(courseScreen, /useQueries\(|getDetail\(/);
});

test("live startup never owns the tracking roster or registered-athlete probe", () => {
  assert.doesNotMatch(liveScreen, /liveParticipantsQuery/);
  assert.doesNotMatch(liveScreen, /registeredAthleteSearch/);
  assert.doesNotMatch(liveScreen, /registeredAthleteBib/);
});

test("browser visibility cannot activate a hidden nested event route", () => {
  assert.match(
    eventScreenInitialization,
    /const \[routeFocused, setRouteFocused\]/,
  );
  assert.match(
    eventScreenInitialization,
    /const \[appVisible, setAppVisible\]/,
  );
  assert.match(
    eventScreenInitialization,
    /const focused = routeFocused && appVisible/,
  );
  assert.doesNotMatch(
    eventScreenInitialization,
    /handleWindowFocus[\s\S]{0,160}setRouteFocused\(true\)/,
  );
});

test("live course resources are scoped and never couple course-index", () => {
  const resources = courseRepository.match(
    /async getCourseMapResources[\s\S]*?\n  },\n  async getCourseConfig/,
  );
  assert(resources);
  assert.match(resources[0], /PROVIDER_EVENT_UUID_REQUIRED/);
  assert.match(
    resources[0],
    /loadCourseMap\([\s\S]*providerEventUuid,[\s\S]*providerContestUuid/,
  );
  assert.doesNotMatch(resources[0], /loadCourseIndex\(/);
  assert.doesNotMatch(liveScreen, /canonical-live-rankings/);
  assert.doesNotMatch(eventDetailsScreen, /useEventCourseIndex/);
  assert.doesNotMatch(eventDetailsScreen, /courseIndexQuery/);
  assert.match(
    courseRepository,
    /providerEventUuid: providerEventUuid\.trim\(\)/,
  );
  assert.doesNotMatch(
    courseRepository,
    /providerEventUuid: providerEventUuid\.trim\(\)\.toLowerCase\(\)/,
  );
  assert.match(
    liveScreen,
    /eventQuery\.event &&[\s\S]*selectedProviderEventUuid &&[\s\S]*!configuredBergman102MasterSelection/,
  );
});

test("public watchlists remain device-local while authenticated accounts synchronize", () => {
  assert.match(
    watchlistHook,
    /if \(isAuthenticated\) \{[\s\S]*subscribeTrackedAthlete\(/,
  );
  assert.match(
    watchlistHook,
    /if \(!isAuthenticated\) return true;[\s\S]*unsubscribeTrackedAthlete\(/,
  );
});

test("authenticated watchlist hydration cannot reset the selected athlete", () => {
  assert.match(watchlistHook, /hydrated,/);
  assert.match(liveScreen, /hydrated: watchlistHydrated/);
  assert.match(
    liveScreen,
    /if \(!watchlistHydrated\) return;[\s\S]*if \(!selectedTrackedKey\) return;/,
  );
});

test("event metadata is not a focus refresh dependency", () => {
  assert.doesNotMatch(liveScreen, /useEventScreenFocusRefresh/);
  assert.doesNotMatch(liveScreen, /eventQuery\.refetch/);
});

test("the event list does not poll while athlete detail is open", () => {
  assert.match(eventsHook, /staleTime: 5 \* 60_000/);
  assert.match(eventsHook, /refetchInterval: false/);
  assert.match(eventsHook, /refetchOnMount: false/);
});

test("route viewing never mutates watchlist membership", () => {
  const routeSelection = liveScreen.slice(
    liveScreen.indexOf("// Route params can outlive"),
    liveScreen.indexOf("const panelVisible"),
  );
  assert.match(routeSelection, /Route navigation is view-only/);
  assert.doesNotMatch(routeSelection, /addAthlete\(/);
});

test("authenticated tracking waits for restored auth state and token", () => {
  assert.match(eventExperience, /const authReady =/);
  assert.match(eventExperience, /sessionStatus === "authenticated"/);
  assert.match(eventExperience, /Boolean\(accessToken\)/);
  assert.match(
    eventExperience,
    /enabled: enabled && validEventId && authReady/,
  );
});

test("late event GPX metadata invalidates only fallback geometry identity", () => {
  assert.match(liveScreen, /const fallbackCourseConfig = useMemo/);
  assert.match(trackingQueries, /courseAssetMetadataVersion\(fallbackConfig\)/);
  assert.match(
    trackingQueries,
    /compactQueryFingerprint\(canonicalCourseVersion\)/,
  );
  assert.match(
    trackingQueries,
    /compactQueryFingerprint\(fallbackCourseVersion\)/,
  );
});

test("fallback GPX waits for a settled canonical ownership decision", () => {
  assert.match(courseConfig, /export function courseGeometryOwner/);
  assert.match(courseConfig, /if \(!courseRequestSucceeded\) return "pending"/);
  assert.match(
    trackingQueries,
    /source === "event-config"[\s\S]*courseGeometryOwner\(/,
  );
  assert.match(
    trackingQueries,
    /geometryOwner === "canonical"[\s\S]*resolveCourseGeometry\([\s\S]*courseMap/,
  );
  assert.match(
    trackingQueries,
    /geometryOwner === "fallback" && Boolean\(fallbackConfig\)/,
  );
});

test("canonical athlete diagnostics use the current public response shape", () => {
  assert.match(http, /data\?\.identity \?\? record\.identity/);
  assert.match(http, /data\?\.status \?\? record\.status/);
  assert.match(http, /Array\.isArray\(data\?\.splits\)/);
  assert.doesNotMatch(http, /data\?\.contestContext/);
});

test("auth and live event mounts have stable development IDs and aborts stay silent", () => {
  assert.match(authProvider, /AUTH_PROVIDER_MOUNT/);
  assert.match(authProvider, /AUTH_PROVIDER_UNMOUNT/);
  assert.match(authProvider, /mountId: mountIdRef\.current/);
  assert.match(liveScreen, /LIVE_TRACK_MOUNT/);
  assert.match(liveScreen, /LIVE_TRACK_UNMOUNT/);
  assert.match(eventsHook, /if \(isAbortError\(error\)\) return false/);
  assert.match(eventsHook, /!isAbortError\(query\.error\)/);
  assert.match(
    eventsRepository,
    /name\?: unknown[\s\S]*AbortError[\s\S]*throw error/,
  );
});
