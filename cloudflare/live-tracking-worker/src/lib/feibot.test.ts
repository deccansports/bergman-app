import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFeibotRequestUrl,
  buildSortedQueryString,
  createStringToSign,
  getUnixTimestampSeconds,
  hmacSha256Hex,
  signRequest,
} from './signing';
import { callFeibot, FeibotApiError } from './feibot';

const baseConfig = {
  accessKey: 'AK_TEST',
  secretKey: 'SK_TEST',
  eventUuid: '6U7sbSts',
  apiBaseUrl: 'https://apicn.feibot.com',
};

function createMockEnv() {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };

  return {
    env: {
      BERGMAN_KV: kv,
      BERGMAN_R2: {} as any,
      LIVE_RACE_STATE: {} as any,
      BERGMAN_ADMIN_API_BASE: 'https://bergmantri.com',
      BERGMAN_INTERNAL_TOKEN: 'test-token',
    } as any,
    store,
  };
}

test('buildSortedQueryString sorts query keys', () => {
  const query = buildSortedQueryString({ z: 'last', event_uuid: '6U7sbSts', a: 'first' });
  assert.equal(query, 'a=first&event_uuid=6U7sbSts&z=last');
});

test('getUnixTimestampSeconds generates unix seconds', () => {
  assert.equal(getUnixTimestampSeconds(1690000000123), '1690000000');
});

test('createStringToSign matches Feibot specification', () => {
  const stringToSign = createStringToSign({
    method: 'GET',
    path: '/eventConfigFile/timingRulesGet',
    timestamp: '1690000000',
    sortedQueryString: 'event_uuid=6U7sbSts',
    body: '',
  });
  assert.equal(stringToSign, 'GET/eventConfigFile/timingRulesGet1690000000event_uuid=6U7sbSts');
});

test('signRequest returns deterministic signature for same payload', async () => {
  const a = await signRequest({
    method: 'GET',
    path: '/eventConfigFile/timingRulesGet',
    timestamp: '1690000000',
    sortedQueryString: 'event_uuid=6U7sbSts',
    secretKey: 'demo-secret',
  });
  const b = await signRequest({
    method: 'GET',
    path: '/eventConfigFile/timingRulesGet',
    timestamp: '1690000000',
    sortedQueryString: 'event_uuid=6U7sbSts',
    secretKey: 'demo-secret',
  });
  assert.equal(a.payload, b.payload);
  assert.equal(a.signature, b.signature);
  assert.equal(a.signature, await hmacSha256Hex('demo-secret', a.payload));
});

test('buildFeibotRequestUrl creates expected URL', () => {
  const url = buildFeibotRequestUrl('/eventConfigFile/timingRulesGet', 'event_uuid=6U7sbSts');
  assert.equal(url, 'https://apicn.feibot.com/eventConfigFile/timingRulesGet?event_uuid=6U7sbSts');
});

test('callFeibot retries on transient 429 then succeeds', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts < 2) {
      return new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const data = await callFeibot<{ success: boolean }>({
      config: baseConfig,
      endpoint: '/eventConfigFile/timingRulesGet',
      method: 'GET',
      query: { event_uuid: baseConfig.eventUuid },
      context: { maxAttempts: 3 },
    });
    assert.equal(data.success, true);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callFeibot does not retry 401 and throws structured error', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        callFeibot({
          config: baseConfig,
          endpoint: '/eventConfigFile/timingRulesGet',
          method: 'GET',
          query: { event_uuid: baseConfig.eventUuid },
          context: { maxAttempts: 3 },
        }),
      (error: unknown) => {
        assert.ok(error instanceof FeibotApiError);
        assert.equal((error as FeibotApiError).httpStatus, 401);
        assert.equal((error as FeibotApiError).retryable, false);
        return true;
      },
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callFeibot handles timeout with structured 408 error', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    return await new Promise<Response>((_resolve, reject) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          reject({ name: 'AbortError', message: 'timeout' });
        });
      }
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        callFeibot({
          config: baseConfig,
          endpoint: '/eventConfigFile/timingRulesGet',
          method: 'GET',
          query: { event_uuid: baseConfig.eventUuid },
          context: { timeoutMs: 10, maxAttempts: 1 },
        }),
      (error: unknown) => {
        assert.ok(error instanceof FeibotApiError);
        assert.equal((error as FeibotApiError).httpStatus, 408);
        assert.equal((error as FeibotApiError).diagnostics.httpStatus, 408);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callFeibot persists diagnostics and monitoring without secrets', async () => {
  const originalFetch = globalThis.fetch;
  const { env, store } = createMockEnv();

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ event_uuid: '6U7sbSts', timing_rules: { contests: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const payload = await callFeibot<any>({
      config: baseConfig,
      endpoint: '/eventConfigFile/timingRulesGet',
      method: 'GET',
      query: { event_uuid: baseConfig.eventUuid },
      context: {
        env,
        eventId: 'event-1',
        endpointName: 'timingRulesGet',
        maxAttempts: 1,
      },
    });

    assert.equal(payload.event_uuid, '6U7sbSts');

    const diagnosticsRaw = store.get('live:event:event-1:provider-diagnostics');
    const monitoringRaw = store.get('live:event:event-1:monitoring');
    const historyRaw = store.get('live:event:event-1:provider-api-history');

    assert.ok(diagnosticsRaw);
    assert.ok(monitoringRaw);
    assert.ok(historyRaw);

    const diagnostics = JSON.parse(String(diagnosticsRaw));
    const monitoring = JSON.parse(String(monitoringRaw));
    const history = JSON.parse(String(historyRaw));

    assert.equal(diagnostics.authentication, 'verified');
    assert.equal(diagnostics.lastApiCall.endpoint, 'timingRulesGet');
    assert.equal(diagnostics.lastApiCall.status, 200);
    assert.equal(monitoring.lastApiCall.endpoint, 'timingRulesGet');
    assert.equal(monitoring.lastApiCall.httpStatus, 200);
    assert.ok(Array.isArray(history));
    assert.equal(history[history.length - 1].endpoint, 'timingRulesGet');

    const fullDump = `${diagnosticsRaw}\n${monitoringRaw}\n${historyRaw}`;
    assert.equal(fullDump.includes(baseConfig.secretKey), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
