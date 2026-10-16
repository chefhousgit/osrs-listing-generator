// The app's side of the shared Eldorado token and the rate-limit pause (eldorado.js), against the
// fake Eldorado plus a fake Worker. eldorado.js is loaded fresh for each test (its state is per process).

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { createFakeEldorado } = require('./helpers/fake-eldorado');
const fx = require('./helpers/fixtures');

process.env.PROXY_URL = 'https://worker.test';
process.env.PROXY_SECRET = 'test-secret';

let fake;
let workerCalls;
let workerReply; // (route, body) => { status, body } | 'down'
let rateLimitEldorado; // answer Eldorado API calls (not the login) with 429

function setup(reply) {
  fake = createFakeEldorado({ orders: [fx.order()] });
  workerCalls = [];
  workerReply = reply;
  rateLimitEldorado = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.origin === 'https://worker.test') {
      const body = JSON.parse(init.body || '{}');
      workerCalls.push({ route: u.pathname, body, secret: init.headers['X-Proxy-Secret'] });
      const r = workerReply(u.pathname, body);
      if (r === 'down') throw new Error('fetch failed');
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (rateLimitEldorado && !u.pathname.includes('/authentication/')) {
      fake.calls.push({ method: init.method || 'GET', path: u.pathname });
      return new Response(JSON.stringify({ messages: ['Whoa! Calm down, cowboy! Quota exceeded.'] }), { status: 429 });
    }
    return fake.fetch(url, init);
  };
  delete require.cache[require.resolve('../eldorado')];
  return require('../eldorado');
}

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const logins = () => fake.calls.filter((c) => c.path === '/api/authentication/seller/token').length;
const sharedToken = () => ({ status: 200, body: { token: 'fake-token', expiresAt: new Date(Date.now() + 14 * 60000).toISOString() } });

test('uses the Worker token instead of logging in, and reuses it', async () => {
  const eldorado = setup((route) => (route === '/alerts/token' ? sharedToken() : { status: 404, body: {} }));
  await eldorado.listOrders();
  await eldorado.listOrders();
  assert.equal(logins(), 0, 'no login of its own');
  assert.equal(workerCalls.filter((c) => c.route === '/alerts/token').length, 1);
  assert.equal(workerCalls[0].secret, 'test-secret');
  assert.equal(workerCalls[0].body.pc, os.hostname());
});

test('logs in itself when the Worker is older (404) or unreachable', async () => {
  let eldorado = setup(() => ({ status: 404, body: 'Not found' }));
  await eldorado.listOrders();
  assert.equal(logins(), 1);
  eldorado = setup(() => 'down');
  await eldorado.listOrders();
  assert.equal(logins(), 1);
});

test('while the Worker says paused, nothing reaches Eldorado and the error says until when', async () => {
  const until = new Date(Date.now() + 10 * 60000).toISOString();
  const eldorado = setup(() => ({ status: 429, body: { error: 'Paused after a rate limit.', until } }));
  await assert.rejects(eldorado.listOrders(), { status: 429, message: /rate-limiting requests, so Eldorado calls are paused until/ });
  await assert.rejects(eldorado.listOrders(), { status: 429 });
  assert.equal(fake.calls.length, 0, 'no Eldorado calls, not even a login');
  assert.equal(workerCalls.length, 1, 'the second call is refused locally');
});

test('a 429 from Eldorado pauses here and tells the Worker', async () => {
  const until = new Date(Date.now() + 15 * 60000).toISOString();
  const eldorado = setup((route) => (route === '/alerts/token' ? sharedToken() : { status: 200, body: { until } }));
  rateLimitEldorado = true;
  await assert.rejects(eldorado.listOrders(), { status: 429 });
  const report = workerCalls.find((c) => c.route === '/alerts/ratelimit');
  assert.deepEqual(report.body, { what: 'GET /api/v1/orders/me/seller/orders', pc: os.hostname() });
  rateLimitEldorado = false;
  const before = fake.calls.length;
  await assert.rejects(eldorado.deliverOrder(fx.ORDER_ID), { status: 429 });
  assert.equal(fake.calls.length, before, 'paused: the next call never reaches Eldorado');
});

test('a 429 on its own login (no Worker) also pauses', async () => {
  const eldorado = setup(() => 'down');
  globalThis.fetch = ((inner) => async (url, init) => (String(url).endsWith('/api/authentication/seller/token')
    ? new Response(JSON.stringify({ messages: ['Quota exceeded.'] }), { status: 429 })
    : inner(url, init)))(globalThis.fetch);
  await assert.rejects(eldorado.listOrders(), { status: 429, message: /paused until/ });
  await assert.rejects(eldorado.listOrders(), { status: 429 });
});

test('a refused token (401) is reported as stale so the Worker hands out a fresh one', async () => {
  let n = 0;
  const eldorado = setup((route, body) => {
    if (route !== '/alerts/token') return { status: 404, body: {} };
    n++;
    return { status: 200, body: { token: n === 1 ? 'old-token' : 'fake-token', expiresAt: new Date(Date.now() + 14 * 60000).toISOString(), stale: body.stale } };
  });
  await assert.rejects(eldorado.listOrders(), { status: 401 }); // the fake refuses "old-token"
  await eldorado.listOrders();
  const tokenCalls = workerCalls.filter((c) => c.route === '/alerts/token');
  assert.equal(tokenCalls.length, 2);
  assert.equal(tokenCalls[0].body.stale, undefined);
  assert.equal(tokenCalls[1].body.stale, 'old-token');
});
