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
  const tokenCalls = workerCalls.filter((c) => c.route === '/alerts/token');
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].secret, 'test-secret');
  assert.equal(tokenCalls[0].body.pc, os.hostname());
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
  const eldorado = setup((route) => (route === '/alerts/token' ? { status: 429, body: { error: 'Paused after a rate limit.', until } } : { status: 404, body: {} }));
  await assert.rejects(eldorado.listOrders(), { status: 429, message: /rate-limiting requests, so Eldorado calls are paused until/ });
  await assert.rejects(eldorado.listOrders(), { status: 429 });
  assert.equal(fake.calls.length, 0, 'no Eldorado calls, not even a login');
  assert.equal(workerCalls.filter((c) => c.route === '/alerts/token').length, 1, 'the second call is refused locally');
});

test('a 429 from Eldorado pauses here and tells the Worker', async () => {
  const until = new Date(Date.now() + 15 * 60000).toISOString();
  const eldorado = setup((route) => (route === '/alerts/token' ? sharedToken() : route === '/alerts/ratelimit' ? { status: 200, body: { until } } : { status: 404, body: {} }));
  rateLimitEldorado = true;
  await assert.rejects(eldorado.listOrders(), { status: 429 });
  const report = workerCalls.find((c) => c.route === '/alerts/ratelimit');
  assert.deepEqual(report.body, { what: 'GET /api/v1/orders/me/seller/orders', pc: os.hostname(), retryAfter: null });
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

// ---------- the Worker's copies instead of reading Eldorado ----------
const minsAgoIso = (m) => new Date(Date.now() - m * 60000).toISOString();
const workerWith = (routes) => (route, body) => {
  if (routes[route]) return typeof routes[route] === 'function' ? routes[route](body) : routes[route];
  if (route === '/alerts/token') return sharedToken();
  return { status: 200, body: { ok: true } };
};
const goodRun = { at: minsAgoIso(3), ok: true, problems: [] };

test('orders come from the Worker copy when its checks ran lately', async () => {
  const eldorado = setup(workerWith({ '/alerts/orders': { status: 200, body: { at: minsAgoIso(20), orders: [fx.order()], lastRun: goodRun } } }));
  const orders = await eldorado.listOrders();
  assert.equal(orders[0].id, fx.ORDER_ID);
  assert.equal(orders[0].state, 'Paid');
  assert.equal(fake.calls.length, 0, 'nothing read from Eldorado');
  assert.equal(eldorado.dataSources().orders.from, 'worker');
});

test('orders are read from Eldorado when the copy is old or its order check failed', async () => {
  for (const lastRun of [{ at: minsAgoIso(90), ok: true, problems: [] }, { at: minsAgoIso(3), ok: false, problems: ['orders: GET failed (500)'] }]) {
    const eldorado = setup(workerWith({ '/alerts/orders': { status: 200, body: { at: minsAgoIso(5), orders: [], lastRun } } }));
    const orders = await eldorado.listOrders();
    assert.equal(orders.length, 1, 'the live list');
    assert.equal(eldorado.dataSources().orders.from, 'eldorado');
  }
});

test('while paused after a rate limit, the (latest) copy is still used', async () => {
  const lastRun = { at: minsAgoIso(2), ok: false, problems: ['paused until 17:50 UTC after a rate limit (orders, worker)'] };
  const eldorado = setup(workerWith({ '/alerts/orders': { status: 200, body: { orders: [fx.order()], lastRun } } }));
  await eldorado.listOrders();
  assert.equal(fake.calls.length, 0);
});

test('offers come from the Worker copy; Refresh (live) reads Eldorado and hands the list to the Worker', async () => {
  let pushed = null;
  const eldorado = setup(workerWith({
    '/alerts/offers': { status: 200, body: { at: Date.now() - 10 * 60000, offers: [fx.offer({ offerTitle: 'From the copy' })] } },
    '/alerts/offers/update': (body) => { pushed = body; return { status: 200, body: { ok: true } }; }
  }));
  fake.state.offers.set(fx.OFFER_ID, fx.offer({ offerTitle: 'Live title' }));
  assert.equal((await eldorado.listOffers())[0].title, 'From the copy');
  assert.equal(fake.calls.length, 0);
  assert.equal((await eldorado.listOffers({ live: true }))[0].title, 'Live title');
  assert.equal(pushed.offers[0].offerTitle, 'Live title', 'the fresh list goes to the Worker');
  assert.equal(eldorado.dataSources().offers.from, 'eldorado');
});

test('offers are read live when the copy is marked stale (a new offer) or over an hour old', async () => {
  for (const body of [{ at: Date.now(), offers: [], stale: true }, { at: Date.now() - 2 * 3600000, offers: [] }]) {
    const eldorado = setup(workerWith({ '/alerts/offers': { status: 200, body } }));
    fake.state.offers.set(fx.OFFER_ID, fx.offer());
    assert.equal((await eldorado.listOffers()).length, 1);
  }
});

test('changes made in the app are passed to the Worker copies', async () => {
  const updates = [];
  const eldorado = setup(workerWith({
    '/alerts/offers/update': (b) => { updates.push(['offers', b]); return { status: 200, body: {} }; },
    '/alerts/orders/update': (b) => { updates.push(['orders', b]); return { status: 200, body: {} }; }
  }));
  fake.state.offers.set(fx.OFFER_ID, fx.offer());
  await eldorado.changePrice(fx.OFFER_ID, 19.5);
  await eldorado.pauseOffer(fx.OFFER_ID);
  await eldorado.resumeOffer(fx.OFFER_ID);
  await eldorado.deliverOrder(fx.ORDER_ID);
  await eldorado.deleteOffer(fx.OFFER_ID);
  assert.deepEqual(updates, [
    ['offers', { patch: { id: fx.OFFER_ID, pricePerUnit: { amount: 19.5, currency: 'USD' } } }],
    ['offers', { patch: { id: fx.OFFER_ID, offerState: 'Paused' } }],
    ['offers', { patch: { id: fx.OFFER_ID, offerState: 'Active' } }],
    ['orders', { id: fx.ORDER_ID, state: 'Delivered' }],
    ['offers', { remove: fx.OFFER_ID }]
  ]);
});

test('Stats / Reviews history comes from the Worker; its latest page while the first read runs', async () => {
  let eldorado = setup(workerWith({ '/alerts/history': { status: 200, body: { at: minsAgoIso(30), orders: [fx.order(), fx.order({ id: 'o2' })], complete: true } } }));
  assert.equal((await eldorado.listAllOrders()).length, 2);
  assert.equal(fake.calls.length, 0);
  eldorado = setup(workerWith({
    '/alerts/history': { status: 200, body: { at: null, orders: null, readingNow: 150 } },
    '/alerts/orders': { status: 200, body: { at: minsAgoIso(5), orders: [fx.order()], lastRun: goodRun } }
  }));
  assert.equal((await eldorado.listAllOrders()).length, 1);
  assert.deepEqual(eldorado.dataSources().history.readingNow, 150);
  assert.equal(eldorado.dataSources().history.partial, true);
  assert.equal(fake.calls.length, 0, 'no 10-page read from Eldorado');
});

test('request counts are sent to the Worker per 5-minute block', async () => {
  let sent = null;
  const eldorado = setup(workerWith({
    '/alerts/orders': { status: 404, body: {} },
    '/alerts/calls': (b) => { sent = b; return { status: 200, body: { ok: true } }; }
  }));
  await eldorado.listOrders();
  await eldorado.listOrders();
  await eldorado.flushCalls();
  assert.equal(sent.pc, os.hostname());
  const counts = Object.entries(sent.counts);
  assert.equal(counts.length, 1);
  assert.match(counts[0][0], /^\d{4}-\d\d-\d\dT\d\d:\d[05]$/);
  assert.equal(counts[0][1], 2);
});
