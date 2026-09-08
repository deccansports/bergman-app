import assert from "node:assert/strict";
import test from "node:test";

import {
  createSingleFlight,
  observeSharedRequest,
  // @ts-expect-error Node strip-types tests require the explicit extension.
} from "./singleFlight.ts";

test("concurrent event-detail consumers share exactly one network request", async () => {
  let requests = 0;
  let release!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const request = createSingleFlight(async (key: string) => {
    requests += 1;
    return pending.then((value) => `${key}:${value}`);
  });
  const consumers = [request("event-a"), request("event-a"), request("event-a")];
  assert.equal(requests, 1);
  release("ok");
  assert.deepEqual(await Promise.all(consumers), [
    "event-a:ok",
    "event-a:ok",
    "event-a:ok",
  ]);
});

test("one aborted consumer does not cancel shared event metadata work", async () => {
  const controller = new AbortController();
  let release!: (value: string) => void;
  const shared = new Promise<string>((resolve) => {
    release = resolve;
  });
  const cancelled = observeSharedRequest(shared, controller.signal);
  const retained = observeSharedRequest(shared);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  release("ok");
  assert.equal(await retained, "ok");
});
