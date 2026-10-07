// Offline tests against the built package (run `npm run build` first).
// fetch is mocked throughout; nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CabalSpy,
  CabalSpyRealtime,
  CabalSpyError,
  RateLimitError,
  DemoLimitError,
  DEMO_API_KEY,
  DEMO_UPGRADE,
} from './dist/index.js';

const UPGRADE = {
  test_key: 'https://apidashboard.cabalspy.xyz/',
  pay_per_call: 'https://www.cabalspy.xyz/x402/',
  docs: 'https://docs.cabalspy.xyz',
};

/** Returns a fetch stub that answers with `responses` in order and records calls. */
function mockFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  fn.calls = calls;
  return fn;
}

const demoBody = {
  success: true,
  data: { wallets: [] },
  pagination: { limit: 5, has_more: false, next_cursor: null },
  meta: { request_id: 'r1', cached: false, cache_age_seconds: 0, version: 'v1', timestamp: '' },
  demo: { notice: 'Demo data, 15 minutes delayed', remaining_today: 19, upgrade: UPGRADE },
};

test('DEMO_API_KEY is "demo"', () => {
  assert.equal(DEMO_API_KEY, 'demo');
  assert.deepEqual(DEMO_UPGRADE, UPGRADE);
});

test('CabalSpy.demo() sends the demo key to the normal base URL', async () => {
  const fetch = mockFetch({ body: demoBody, headers: { 'X-CabalSpy-Demo': 'true', 'X-Demo-Remaining': '19' } });
  const client = CabalSpy.demo({ fetch });
  assert.equal(client.isDemo, true);
  assert.equal(client.baseUrl, 'https://api.cabalspy.xyz/v1');

  const env = await client.wallets.listRaw({ blockchain: 'solana', type: 'kol' });
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].url, /^https:\/\/api\.cabalspy\.xyz\/v1\/wallets\?/);
  assert.equal(fetch.calls[0].init.headers.Authorization, 'Bearer demo');
  assert.equal(env.demo.remaining_today, 19);
  assert.equal(client.lastDemo.remaining_today, 19);
  assert.equal(client.websocketUrl(), 'wss://stream.cabalspy.xyz/?apiKey=demo');
});

test('a normal key is not flagged as demo', async () => {
  const { demo, ...plain } = demoBody;
  const fetch = mockFetch({ body: plain });
  const client = new CabalSpy({ apiKey: 'real-key', fetch });
  assert.equal(client.isDemo, false);
  await client.wallets.list({ blockchain: 'solana', type: 'kol' });
  assert.equal(client.lastDemo, null);
});

test('missing credentials error points to CabalSpy.demo() and the test key', () => {
  const saved = process.env.CABALSPY_API_KEY;
  delete process.env.CABALSPY_API_KEY;
  try {
    assert.throws(
      () => new CabalSpy({ fetch: mockFetch({ body: demoBody }) }),
      (err) => err instanceof CabalSpyError && /CabalSpy\.demo\(\)/.test(err.message) && err.message.includes(UPGRADE.test_key),
    );
  } finally {
    if (saved !== undefined) process.env.CABALSPY_API_KEY = saved;
  }
});

test('429 demo_limit_reached maps to DemoLimitError and is not retried', async () => {
  const fetch = mockFetch({
    status: 429,
    body: {
      success: false,
      error: { code: 'demo_limit_reached', message: 'Demo limit reached', resets_in_seconds: 3600 },
      demo: true,
      upgrade: UPGRADE,
    },
  });
  const client = CabalSpy.demo({ fetch, maxRetries: 2 });
  await assert.rejects(client.wallets.list({ blockchain: 'solana', type: 'kol' }), (err) => {
    assert.ok(err instanceof DemoLimitError);
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.status, 429);
    assert.equal(err.code, 'demo_limit_reached');
    assert.equal(err.resetsInSeconds, 3600);
    assert.equal(err.retryAfter, 3600);
    assert.deepEqual(err.upgrade, UPGRADE);
    return true;
  });
  assert.equal(fetch.calls.length, 1);
});

test('other 429s stay a plain RateLimitError', async () => {
  const fetch = mockFetch({
    status: 429,
    headers: { 'Retry-After': '0' },
    body: { success: false, error: { code: 'rate_limit_exceeded', message: 'Slow down' } },
  });
  const client = new CabalSpy({ apiKey: 'k', fetch, maxRetries: 0 });
  await assert.rejects(client.wallets.list({ blockchain: 'solana', type: 'kol' }), (err) => {
    assert.ok(err instanceof RateLimitError);
    assert.ok(!(err instanceof DemoLimitError));
    assert.equal(err.retryAfter, 0);
    return true;
  });
});

test('CabalSpyRealtime.demo() connects with the demo key', async () => {
  let opened;
  class FakeWS {
    constructor(url) {
      opened = url;
      this.readyState = 1;
      queueMicrotask(() => this.onopen?.({}));
    }
    send() {}
    close() {}
  }
  const rt = CabalSpyRealtime.demo({ WebSocketImpl: FakeWS, pingInterval: 0, reconnect: false });
  await rt.connect();
  assert.equal(opened, 'wss://stream.cabalspy.xyz/?apiKey=demo');
  rt.close();
});
