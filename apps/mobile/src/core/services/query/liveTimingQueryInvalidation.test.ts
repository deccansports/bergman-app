import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import test from "node:test";

import {
  invalidateActiveLiveTimingQueries,
  invalidateLiveTimingParticipant,
} from "./queryInvalidation";
import { queryKeys } from "./queryKeys";

function clientWithDefaults() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

test("A: canonical split event invalidates only the affected athlete detail queries", async () => {
  const client = clientWithDefaults();
  const affected = queryKeys.mobileLiveParticipant(
    "event-1",
    "provider-1",
    "race:provider-1:contest:1001",
  );
  const affectedCard = queryKeys.athleteDetail("event-1", {
    participantUuid: "race:provider-1:contest:1001",
    bib: "1001",
  });
  const unrelated = queryKeys.mobileLiveParticipant(
    "event-1",
    "provider-1",
    "race:provider-1:contest:1002",
  );
  client.setQueryData(affected, { splitCount: 1 });
  client.setQueryData(affectedCard, { splitCount: 1 });
  client.setQueryData(unrelated, { splitCount: 1 });

  await invalidateLiveTimingParticipant(client, {
    eventId: "event-1",
    providerEventUuid: "provider-1",
    participantUuid: "race:provider-1:contest:1001",
  });

  assert.equal(client.getQueryState(affected)?.isInvalidated, true);
  assert.equal(client.getQueryState(affectedCard)?.isInvalidated, true);
  assert.equal(client.getQueryState(unrelated)?.isInvalidated, false);
});

test("B: a provider participant identity can refresh the matching selected detail without touching another athlete", async () => {
  const client = clientWithDefaults();
  const selected = queryKeys.athleteDetail("event-1", {
    participantUuid: "race:provider-1:contest:1001",
    providerUuid: "provider-athlete-1",
  });
  const other = queryKeys.athleteDetail("event-1", {
    participantUuid: "race:provider-1:contest:1002",
    providerUuid: "provider-athlete-2",
  });
  client.setQueryData(selected, {});
  client.setQueryData(other, {});

  await invalidateLiveTimingParticipant(client, {
    eventId: "event-1",
    providerParticipantUuid: "provider-athlete-1",
  });

  assert.equal(client.getQueryState(selected)?.isInvalidated, true);
  assert.equal(client.getQueryState(other)?.isInvalidated, false);
});

test("A2: an active affected athlete observer refetches immediately after invalidation", async () => {
  const client = clientWithDefaults();
  const key = queryKeys.mobileLiveParticipant(
    "event-1",
    "provider-1",
    "athlete-1",
  );
  let fetches = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: async () => ({ splitCount: ++fetches }),
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();

  await invalidateLiveTimingParticipant(client, {
    eventId: "event-1",
    providerEventUuid: "provider-1",
    participantUuid: "athlete-1",
  });

  assert.equal(fetches, 2);
  unsubscribe();
});

test("D: foreground recovery refreshes active live timing query families only", async () => {
  const client = clientWithDefaults();
  const live = queryKeys.mobileLiveParticipant(
    "event-1",
    "provider-1",
    "athlete-1",
  );
  const detail = queryKeys.athleteDetail("event-1", {
    participantUuid: "athlete-1",
  });
  const unrelated = queryKeys.profile("user-1");
  client.setQueryData(live, {});
  client.setQueryData(detail, {});
  client.setQueryData(unrelated, {});

  await invalidateActiveLiveTimingQueries(client);

  assert.equal(client.getQueryState(live)?.isInvalidated, true);
  assert.equal(client.getQueryState(detail)?.isInvalidated, true);
  assert.equal(client.getQueryState(unrelated)?.isInvalidated, false);
});
