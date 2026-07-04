import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateWaitlistCodeAction,
  listWaitlistEntriesAction,
  submitWaitlistEntryAction,
  upsertWaitlistFormAction,
  validateWaitlistCodeAction,
  consumeWaitlistCodeForRegistrationAction,
} from '@/lib/actions/waitlistActions';

type KVMap = Map<string, string>;

function createCloudflareKvFetchMock(store: KVMap): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const keyMatch = url.match(/\/values\/(.+)$/);
    const key = keyMatch ? decodeURIComponent(keyMatch[1]) : '';

    if (!key) {
      return new Response('Bad key', { status: 400 });
    }

    if (method === 'GET') {
      if (!store.has(key)) return new Response('', { status: 404 });
      return new Response(store.get(key) as string, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'PUT') {
      const body = typeof init?.body === 'string' ? init.body : '';
      store.set(key, body);
      return new Response('', { status: 200 });
    }

    if (method === 'DELETE') {
      store.delete(key);
      return new Response('', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405 });
  }) as typeof fetch;
}

test('waitlist entry submission -> code generation -> validate -> consume flow', async () => {
  const kvStore: KVMap = new Map();
  const originalFetch = global.fetch;

  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_KV_NAMESPACE_ID = 'test-namespace';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';

  global.fetch = createCloudflareKvFetchMock(kvStore);

  try {
    const formResult = await upsertWaitlistFormAction({
      eventId: 'evt_1',
      eventName: 'Bergman Test Event',
      slug: 'bergman-test-event',
      isActive: true,
      actor: 'test',
    });
    assert.equal(formResult.success, true);

    const entryResult = await submitWaitlistEntryAction({
      eventId: 'evt_1',
      eventName: 'Bergman Test Event',
      ticketId: 'ticket_1',
      ticketName: 'Olympic Triathlon',
      athleteName: 'Test Athlete',
      email: 'athlete@example.com',
      mobile: '+919999999999',
      message: 'Please invite me if slot opens',
    });

    assert.equal(entryResult.success, true);
    assert.ok(entryResult.entry?.id);

    const listedPending = await listWaitlistEntriesAction({ eventId: 'evt_1', status: 'pending' });
    assert.equal(listedPending.success, true);
    assert.equal((listedPending.entries || []).length, 1);

    const generatedCode = await generateWaitlistCodeAction({
      entryId: String(entryResult.entry?.id),
      usageLimit: 1,
      createdBy: 'test',
    });

    assert.equal(generatedCode.success, true);
    assert.ok(generatedCode.code?.code?.startsWith('WL-'));

    const valid = await validateWaitlistCodeAction({
      code: String(generatedCode.code?.code),
      email: 'athlete@example.com',
      eventId: 'evt_1',
      ticketId: 'ticket_1',
    });
    assert.equal(valid.success, true);

    const consume = await consumeWaitlistCodeForRegistrationAction({
      code: String(generatedCode.code?.code),
      email: 'athlete@example.com',
      eventId: 'evt_1',
      ticketId: 'ticket_1',
      registrationAttemptId: 'attempt_1',
      participantId: 'participant_1',
    });

    assert.equal(consume.success, true);
    assert.equal(consume.code?.status, 'used');

    const invalidAfterUse = await validateWaitlistCodeAction({
      code: String(generatedCode.code?.code),
      email: 'athlete@example.com',
      eventId: 'evt_1',
      ticketId: 'ticket_1',
    });

    assert.equal(invalidAfterUse.success, false);

    const listedRegistered = await listWaitlistEntriesAction({ eventId: 'evt_1', status: 'registered' });
    assert.equal(listedRegistered.success, true);
    assert.equal((listedRegistered.entries || []).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('waitlist code remains scoped to invited email and ticket', async () => {
  const kvStore: KVMap = new Map();
  const originalFetch = global.fetch;

  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_KV_NAMESPACE_ID = 'test-namespace';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';

  global.fetch = createCloudflareKvFetchMock(kvStore);

  try {
    await upsertWaitlistFormAction({
      eventId: 'evt_2',
      eventName: 'Scoped Event',
      slug: 'scoped-event',
      isActive: true,
      actor: 'test',
    });

    const entry = await submitWaitlistEntryAction({
      eventId: 'evt_2',
      eventName: 'Scoped Event',
      ticketId: 'ticket_scoped',
      ticketName: 'Sprint',
      athleteName: 'Scoped Athlete',
      email: 'scoped@example.com',
      mobile: '+910000000000',
    });

    assert.equal(entry.success, true);

    const generated = await generateWaitlistCodeAction({ entryId: String(entry.entry?.id), usageLimit: 2, createdBy: 'test' });
    assert.equal(generated.success, true);

    const wrongEmail = await validateWaitlistCodeAction({
      code: String(generated.code?.code),
      email: 'wrong@example.com',
      eventId: 'evt_2',
      ticketId: 'ticket_scoped',
    });
    assert.equal(wrongEmail.success, false);

    const wrongTicket = await validateWaitlistCodeAction({
      code: String(generated.code?.code),
      email: 'scoped@example.com',
      eventId: 'evt_2',
      ticketId: 'another_ticket',
    });
    assert.equal(wrongTicket.success, false);

    const rightScope = await validateWaitlistCodeAction({
      code: String(generated.code?.code),
      email: 'scoped@example.com',
      eventId: 'evt_2',
      ticketId: 'ticket_scoped',
    });
    assert.equal(rightScope.success, true);
  } finally {
    global.fetch = originalFetch;
  }
});
