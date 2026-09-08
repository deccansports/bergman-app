import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { leaderboardMinuteOwnership } from "../hooks/leaderboardRequestOwnership";
import { queryKeys } from "../../../core/services/query/queryKeys";

const read = (relative: string) =>
  readFileSync(
    resolve(
      process.cwd(),
      "apps/mobile/src/features/tracking/leaderboard",
      relative,
    ),
    "utf8",
  );

const screen = read("./components/LeaderboardScreen.tsx");
const queries = read("../hooks/useTrackingQueries.ts");
const http = read("../../../core/services/api/http.ts");
const diagnostics = read("../liveRequestDiagnostics.ts");
const eventLayout = read("../../../app/event/[eventId]/_layout.tsx");
const leaderboardRepository = read(
  "../../../core/repositories/leaderboard.repository.ts",
);

test("healthy live leaderboard owns one request and no results, tracking, or athlete detail", () => {
  assert.deepEqual(
    leaderboardMinuteOwnership({
      eventPhase: "live",
      socketHealthy: true,
      liveRowCount: 0,
    }),
    {
      liveLeaderboardRequests: 1,
      officialResultsRequests: 0,
      trackingRequests: 0,
      athleteDetailRequests: 0,
      maxConcurrentLeaderboardRequests: 1,
    },
  );
});

test("an empty live leaderboard remains a valid one-request state even with a degraded socket", () => {
  const ownership = leaderboardMinuteOwnership({
    eventPhase: "live",
    socketHealthy: false,
    liveRowCount: 0,
  });
  assert.equal(ownership.liveLeaderboardRequests, 1);
  assert.equal(ownership.officialResultsRequests, 0);
});

test("normalized live endpoint has one owner without legacy overall fallback", () => {
  assert.match(
    leaderboardRepository,
    /\/api\/live\/leaderboard/,
  );
  assert.match(leaderboardRepository, /normalizeLeaderboardResponse/);
  assert.doesNotMatch(
    leaderboardRepository,
    /getCanonicalOverallLeaderboard|\/leaderboard\/\$\{contestId\}\/overall/,
  );
  assert.doesNotMatch(
    leaderboardRepository,
    /athletes\.length\s*===\s*0[\s\S]*fallback/i,
  );
});

test("degraded populated live leaderboard has one bounded fallback owner", () => {
  const ownership = leaderboardMinuteOwnership({
    eventPhase: "live",
    socketHealthy: false,
    liveRowCount: 10,
  });
  assert.equal(ownership.liveLeaderboardRequests, 13);
  assert.equal(ownership.maxConcurrentLeaderboardRequests, 1);
});

test("official results belong only to a finished event", () => {
  const ownership = leaderboardMinuteOwnership({
    eventPhase: "finished",
    socketHealthy: true,
    liveRowCount: 0,
  });
  assert.equal(ownership.liveLeaderboardRequests, 0);
  assert.equal(ownership.officialResultsRequests, 1);
});

test("synthetic transitions use the same leaderboard row summary without tracking", () => {
  const ownership = leaderboardMinuteOwnership({
    eventPhase: "live",
    socketHealthy: true,
    liveRowCount: 10,
  });
  assert.equal(ownership.trackingRequests, 0);
});

test("React Query deduplicates StrictMode/remount requests for one scoped key", async () => {
  const client = new QueryClient();
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const queryKey = queryKeys.leaderboard("event-1", {
    providerEventUuid: "6QTff6CR",
    contestUuid: "k9jmBOom",
    gender: "All",
  });
  const queryFn = async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return [];
  };

  await Promise.all([
    client.fetchQuery({ queryKey, queryFn }),
    client.fetchQuery({ queryKey, queryFn }),
  ]);

  assert.equal(calls, 1);
  assert.equal(maxActive, 1);
  assert.deepEqual(queryKey.slice(0, 4), [
    "live-leaderboard",
    "event-1",
    "6qtff6cr",
    "k9jmboom",
  ]);
  client.clear();
});

test("rapid contest/provider switching aborts the previous scoped request", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const request = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string[]>((resolve, reject) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      const timer = setTimeout(() => {
        active -= 1;
        resolve([]);
      }, 20);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          active -= 1;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  const options = (providerEventUuid: string, contestUuid: string) => ({
    queryKey: queryKeys.leaderboard("event-1", {
      providerEventUuid,
      contestUuid,
      gender: "All" as const,
    }),
    queryFn: request,
  });
  const observer = new QueryObserver(client, options("6QTff6CR", "k9jmBOom"));
  const unsubscribe = observer.subscribe(() => undefined);
  observer.setOptions(options("6QTff6CR", "4QZknKwP"));
  observer.setOptions(options("1xajVfM0", "4FgqiHGd"));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(calls, 3);
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
  unsubscribe();
  client.clear();
});

test("screen has no live official-results or mount/empty refresh owner", () => {
  assert.doesNotMatch(screen, /repositories\.results/);
  assert.doesNotMatch(screen, /auto-refreshing empty leaderboard/);
  assert.doesNotMatch(screen, /mounted\/visible/);
  assert.doesNotMatch(screen, /useEventScreenFocusRefresh/);
  assert.match(screen, /isFinished[\s\S]*refetchOfficialResults/);
  assert.match(
    eventLayout,
    /Boolean\(id && eventQuery\.event\?\.status === "finished"\)/,
  );
});

test("screen scopes socket and leaderboard by provider and contest without athlete-detail ownership", () => {
  assert.match(
    screen,
    /useCanonicalChangeSocket\([\s\S]*leaderboardProviderEventUuid/,
  );
  assert.match(screen, /providerEventUuid: leaderboardProviderEventUuid/);
  assert.match(screen, /contestUuid: leaderboardContestUuid/);
  assert.match(
    screen,
    /leaderboardQueryEnabled = Boolean\([\s\S]*leaderboardProviderEventUuid[\s\S]*leaderboardContestUuid/,
  );
  assert.doesNotMatch(
    screen,
    /useAthleteDetail|getDetail\(|canonicalAthlete\(/,
  );
});

test("split rows use one separately keyed normalized aggregate without snapshot ownership", () => {
  assert.doesNotMatch(screen, /useEventTracking/);
  assert.match(screen, /const splitLeaderboardQuery = useLeaderboard/);
  assert.match(screen, /split: effectiveSplitKey/);
  assert.doesNotMatch(screen, /rankLeaderboardRowsAtSplit/);
  assert.match(queries, /leaderboardRefetchIntervalMs/);
  assert.match(queries, /queryKeys\.leaderboard\(resolvedEventId, filters\)/);
  assert.match(queries, /filters\?\.split \?\? "overall"/);
  assert.match(diagnostics, /activeDiagnosticWindows/);
  assert.match(
    diagnostics,
    /maxSimultaneousLeaderboards: window\.maxActiveLeaderboards/,
  );
});

test("navigation cancellation is preserved without a false network error", () => {
  assert.match(http, /const externallyAborted = signal\?\.aborted === true/);
  assert.match(http, /if \(externallyAborted\) throw e/);
  assert.match(http, /isDevelopment && !externallyAborted/);
});
