import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_SOCKET_RELEASE_GRACE_MS,
  canonicalSocketRegistrySnapshot,
  subscribeCanonicalSocket,
} from "./canonicalSocketRegistry";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static opens = 0;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose:
    | ((event: { code: number; reason: string; wasClean: boolean }) => void)
    | null = null;
  onerror: (() => void) | null = null;
  closeCalls = 0;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
    FakeWebSocket.opens += 1;
    this.onopen?.();
  }

  message(data: string) {
    this.onmessage?.({ data });
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  transportClose(code = 1006, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: false });
  }
}

(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;

const callbacks = {
  onHealth: () => undefined,
  onMessage: () => undefined,
  onRecovery: () => undefined,
};

const waitForFinalRelease = () =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, CANONICAL_SOCKET_RELEASE_GRACE_MS + 25),
  );

test("athlete/card/tab churn reuses one provider socket and final release closes once", async () => {
  FakeWebSocket.instances = [];
  FakeWebSocket.opens = 0;
  const track = subscribeCanonicalSocket({
    eventId: "event-a",
    providerEventUuid: "Provider-A",
    consumerId: "track",
    participantUuid: "athlete-101",
    ...callbacks,
  });
  assert.equal(FakeWebSocket.instances.length, 1);
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[0].message("pong");

  for (let index = 0; index < 20; index += 1) {
    track.updateParticipantUuid(`athlete-${index}`);
  }
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(FakeWebSocket.instances[0].closeCalls, 0);

  // Five FULL/MINIMIZED/HIDDEN/restore actions do not touch the transport.
  for (let index = 0; index < 5; index += 1) {
    assert.equal(canonicalSocketRegistrySnapshot()[0].refCount, 1);
  }

  // Three Track <-> Leaders transitions reuse the same provider entry while
  // the event-level Track consumer remains mounted.
  for (let index = 0; index < 3; index += 1) {
    const tabConsumer = subscribeCanonicalSocket({
      eventId: "event-a",
      providerEventUuid: "provider-a",
      consumerId: `leaders-transition-${index}`,
      ...callbacks,
    });
    assert.equal(FakeWebSocket.instances.length, 1);
    tabConsumer.release("leaders_tab_blurred");
    assert.equal(FakeWebSocket.instances[0].closeCalls, 0);
  }

  const leaders = subscribeCanonicalSocket({
    eventId: "event-a",
    providerEventUuid: "provider-a",
    consumerId: "leaders",
    ...callbacks,
  });
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(FakeWebSocket.opens, 1);
  assert.equal(canonicalSocketRegistrySnapshot()[0].refCount, 2);
  assert.equal(canonicalSocketRegistrySnapshot()[0].socketGeneration, 1);

  track.release("track_tab_blurred");
  assert.equal(FakeWebSocket.instances[0].closeCalls, 0);
  leaders.release("event_screen_unmounted");
  await waitForFinalRelease();
  assert.equal(FakeWebSocket.instances[0].closeCalls, 1);
  assert.deepEqual(canonicalSocketRegistrySnapshot(), []);
});

test("provider changes close the old socket once and open one new identity", async () => {
  FakeWebSocket.instances = [];
  FakeWebSocket.opens = 0;
  const oldProvider = subscribeCanonicalSocket({
    eventId: "event-provider-change",
    providerEventUuid: "provider-a",
    consumerId: "screen-old",
    ...callbacks,
  });
  const newProvider = subscribeCanonicalSocket({
    eventId: "event-provider-change",
    providerEventUuid: "provider-b",
    consumerId: "screen-new",
    ...callbacks,
  });
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[1].open();
  assert.equal(FakeWebSocket.opens, 2);
  oldProvider.release("provider_changed");
  await waitForFinalRelease();
  assert.equal(FakeWebSocket.instances[0].closeCalls, 1);
  assert.equal(FakeWebSocket.instances[1].closeCalls, 0);
  newProvider.release("final_consumer");
  await waitForFinalRelease();
  assert.equal(FakeWebSocket.instances[1].closeCalls, 1);
});

test("event changes close the old socket once and open one new identity", async () => {
  FakeWebSocket.instances = [];
  FakeWebSocket.opens = 0;
  const oldEvent = subscribeCanonicalSocket({
    eventId: "event-a-change",
    providerEventUuid: "provider-a",
    consumerId: "event-old",
    ...callbacks,
  });
  const newEvent = subscribeCanonicalSocket({
    eventId: "event-b-change",
    providerEventUuid: "provider-a",
    consumerId: "event-new",
    ...callbacks,
  });
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[1].open();
  assert.equal(FakeWebSocket.opens, 2);
  oldEvent.release("event_changed");
  await waitForFinalRelease();
  assert.equal(FakeWebSocket.instances[0].closeCalls, 1);
  newEvent.release("final_consumer");
  await waitForFinalRelease();
  assert.equal(FakeWebSocket.instances[1].closeCalls, 1);
});

test("an unhealthy socket retains the bounded reconnect path", async () => {
  FakeWebSocket.instances = [];
  const lease = subscribeCanonicalSocket({
    eventId: "event-reconnect",
    providerEventUuid: "provider-a",
    consumerId: "reconnect-owner",
    ...callbacks,
  });
  FakeWebSocket.instances[0].transportClose();
  await new Promise<void>((resolve) => setTimeout(resolve, 1_100));
  assert.equal(FakeWebSocket.instances.length, 2);
  lease.release("final_consumer");
  await waitForFinalRelease();
  assert.equal(FakeWebSocket.instances[1].closeCalls, 1);
});
