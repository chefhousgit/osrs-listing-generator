// The Worker's reviews feed (alerts.js) and backup store (backup.js), with an in-memory KV and
// Discord posts captured instead of sent.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (file) => import(pathToFileURL(path.join(__dirname, '..', 'worker', file)).href);

function fakeKV() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
  };
}

let posts;
let eldoradoOrders = []; // what the fake Eldorado order list returns
let tokenReply = null; // { status, body } for the login request, when a test sets one
let ordersStatus = 200; // status of the order list (429 to simulate a rate limit)
let eldoradoCalls = 0; // every request to Eldorado
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  posts = [];
  eldoradoOrders = [];
  tokenReply = null;
  ordersStatus = 200;
  eldoradoCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://www.eldorado.gg/')) eldoradoCalls++;
    if (String(url) === 'https://www.eldorado.gg/api/authentication/seller/token' && tokenReply) {
      return new Response(JSON.stringify(tokenReply.body), { status: tokenReply.status });
    }
    if (String(url).startsWith('https://www.eldorado.gg/api/v1/orders/me/seller/orders') && ordersStatus !== 200) {
      return new Response(JSON.stringify({ messages: ['Quota exceeded.'] }), { status: ordersStatus });
    }
    if (String(url).startsWith('https://www.eldorado.gg/api/v1/orders/me/seller/orders')) {
      const size = Number(new URL(url).searchParams.get('pageSize'));
      return new Response(JSON.stringify({ results: eldoradoOrders.slice(0, size) }), { status: 200 });
    }
    if (!String(url).startsWith('https://discord.test/')) throw new Error('blocked: ' + url);
    posts.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
});
test.afterEach(() => { globalThis.fetch = realFetch; });

const env = (extra) => ({ STATE: fakeKV(), DISCORD_WEBHOOK_SALES: 'https://discord.test/sales', DISCORD_WEBHOOK_REVIEWS: 'https://discord.test/reviews', ...extra });

const order = (id, review) => ({
  id,
  buyerUsername: 'SecretBuyer42',
  totalPrice: { amount: 30, currency: 'USD' },
  state: { state: 'Completed' },
  orderOfferDetails: { offerTitle: 'Ironman 1500 total' },
  createdDate: '2026-10-10T10:00:00Z',
  review
});
const positive = { feedbackRating: 'Positive', feedbackTags: ['FastDelivery', 'GGWP'], reviewMessage: 'Great seller', isReviewMessageVisible: true };
const negative = { feedbackRating: 'Negative', feedbackTags: ['NotAsDescribed'], reviewMessage: 'Wrong levels', isReviewMessageVisible: true };

// ---------- reviews ----------
test('reviews: the first run records existing reviews without posting', async () => {
  const { announceReviews } = await load('alerts.js');
  const e = env();
  await announceReviews(e, [order('a', positive), order('b', negative)]);
  assert.equal(posts.length, 0);
  assert.deepEqual(await e.STATE.get('reviews', 'json'), { a: 'Positive', b: 'Negative' });
});

test('reviews: a new positive review posts to #reviews once, with tags and message, no buyer name', async () => {
  const { announceReviews } = await load('alerts.js');
  const e = env();
  await announceReviews(e, [order('a', { feedbackRating: 'Unrated' })]);
  await announceReviews(e, [order('a', positive)]);
  await announceReviews(e, [order('a', positive)]);

  assert.equal(posts.length, 1);
  const { url, body } = posts[0];
  assert.equal(url, 'https://discord.test/reviews');
  assert.equal(body.content, undefined, 'no @here for a positive review');
  const embed = body.embeds[0];
  assert.match(embed.title, /Positive review: Ironman 1500 total/);
  assert.match(embed.description, /Great seller/);
  assert.deepEqual(embed.fields.find((f) => f.name === 'Tags').value, 'Fast Delivery, GG WP');
  assert.doesNotMatch(JSON.stringify(body), /SecretBuyer42/);
});

test('reviews: a negative review pings @here', async () => {
  const { announceReviews } = await load('alerts.js');
  const e = env();
  await announceReviews(e, []);
  await announceReviews(e, [order('b', negative)]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.content, '@here');
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: ['everyone'] });
  assert.match(posts[0].body.embeds[0].title, /Negative review/);
});

test('reviews: a changed rating is posted as a change', async () => {
  const { announceReviews } = await load('alerts.js');
  const e = env();
  await announceReviews(e, [order('a', positive)]);
  await announceReviews(e, [order('a', negative)]);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.embeds[0].title, /Review changed \(Positive → Negative\)/);
});

test('reviews: without DISCORD_WEBHOOK_REVIEWS they go to #sales', async () => {
  const { announceReviews } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_REVIEWS: undefined });
  await announceReviews(e, []);
  await announceReviews(e, [order('a', positive)]);
  assert.equal(posts[0].url, 'https://discord.test/sales');
});

test('reviews: hidden messages are marked, orders without a review are skipped', async () => {
  const { announceReviews } = await load('alerts.js');
  const e = env();
  await announceReviews(e, []);
  await announceReviews(e, [order('a', { ...positive, isReviewMessageVisible: false }), order('c', null)]);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.embeds[0].description, /^\(hidden on Eldorado\)/);
});

// ---------- sales ----------
// Newest first, like Eldorado: order n was created n hours ago.
const sales = (count) => Array.from({ length: count }, (_, n) => ({
  ...order('s' + n, null),
  state: { state: 'Completed' },
  createdDate: new Date(Date.now() - n * 3600 * 1000).toISOString()
}));
const salePosts = () => posts.filter((p) => p.url === 'https://discord.test/sales');

test('sales: reading more orders than before does not re-announce old ones', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env();
  const all = sales(50);
  // Before: the checks read 25 orders and remembered those.
  await e.STATE.put('orders', JSON.stringify(Object.fromEntries(all.slice(0, 25).map((o) => [o.id, 'Completed']))));
  eldoradoOrders = all;
  await checkOrders(e, 'token');
  assert.equal(salePosts().length, 0, 'orders 26-50 (older than every remembered one) are recorded quietly');
  assert.equal(Object.keys(await e.STATE.get('orders', 'json')).length, 50);
});

test('sales: a new order is still announced, and only once', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env();
  const old = sales(10);
  eldoradoOrders = old;
  await checkOrders(e, 'token'); // first run: remembers, posts nothing
  const fresh = { ...order('new-sale', null), state: { state: 'Paid' }, createdDate: new Date().toISOString() };
  eldoradoOrders = [fresh, ...old];
  await checkOrders(e, 'token');
  await checkOrders(e, 'token');
  assert.equal(salePosts().length, 1);
  assert.match(salePosts()[0].body.embeds[0].title, /💰 Sold/);
});

test('sales: an order created earlier that only shows up now (paid later) is still announced', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env();
  const old = sales(10); // 0-9 hours old, all remembered
  eldoradoOrders = old;
  await checkOrders(e, 'token');
  const late = { ...order('paid-late', null), state: { state: 'Paid' }, createdDate: new Date(Date.now() - 5 * 3600 * 1000).toISOString() };
  eldoradoOrders = [...old.slice(0, 5), late, ...old.slice(5)];
  await checkOrders(e, 'token');
  assert.equal(salePosts().length, 1);
});

test('completed: goes to #completed, new sales and cancellations stay in #sales', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_COMPLETED: 'https://discord.test/completed' });
  const now = new Date().toISOString();
  const a = { ...order('a', null), state: { state: 'Delivered' }, createdDate: now };
  const b = { ...order('b', null), state: { state: 'Paid' }, createdDate: now };
  eldoradoOrders = [a, b];
  await checkOrders(e, 'token');
  const fresh = { ...order('c', null), state: { state: 'Paid' }, createdDate: now };
  eldoradoOrders = [fresh, { ...a, state: { state: 'Completed' } }, { ...b, state: { state: 'Canceled' } }];
  await checkOrders(e, 'token');
  assert.deepEqual(posts.map((p) => [p.url.split('/').pop(), p.body.embeds[0].title.split(':')[0]]).sort(), [
    ['completed', '✅ Completed'],
    ['sales', '❌ Order canceled'],
    ['sales', '💰 Sold']
  ]);
});

test('completed: without DISCORD_WEBHOOK_COMPLETED it stays in #sales', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env();
  const a = { ...order('a', null), state: { state: 'Delivered' }, createdDate: new Date().toISOString() };
  eldoradoOrders = [a];
  await checkOrders(e, 'token');
  eldoradoOrders = [{ ...a, state: { state: 'Completed' } }];
  await checkOrders(e, 'token');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://discord.test/sales');
});

test('sales: an order with no created date is treated as new (never silently dropped)', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env();
  await e.STATE.put('orders', '{}');
  eldoradoOrders = [{ ...order('no-date', null), state: { state: 'Paid' }, createdDate: undefined }];
  await checkOrders(e, 'token');
  assert.equal(salePosts().length, 1);
});

// ---------- login ----------
const errorPosts = () => posts.filter((p) => p.url === 'https://discord.test/errors');
const loginEnv = () => env({ DISCORD_WEBHOOK_ERRORS: 'https://discord.test/errors' });

test('login: a rate limit is not reported as rejected credentials, and stays quiet at first', async () => {
  const { runAlerts } = await load('alerts.js');
  const e = loginEnv();
  tokenReply = { status: 429, body: { messages: ['Whoa! Calm down, cowboy! Quota exceeded. Please try again later.'] } };
  const out = await runAlerts(e);
  assert.equal(out.ok, false);
  assert.equal(errorPosts().length, 0, 'no post for a short rate limit');
  assert.ok(await e.STATE.get('ratelimited:auth'), 'the start of the rate limit is remembered');
  assert.deepEqual((await e.STATE.get('lastRun', 'json')).problems, ['login: Whoa! Calm down, cowboy! Quota exceeded. Please try again later.']);
});

test('login: a rate limit lasting 3+ hours is reported as a rate limit', async () => {
  const { runAlerts } = await load('alerts.js');
  const e = loginEnv();
  await e.STATE.put('ratelimited:auth', new Date(Date.now() - 4 * 3600 * 1000).toISOString());
  tokenReply = { status: 429, body: { messages: ['Quota exceeded.'] } };
  await runAlerts(e);
  assert.equal(errorPosts().length, 1);
  const text = errorPosts()[0].body.embeds[0].description;
  assert.match(text, /Could not log in to Eldorado/);
  assert.match(text, /rate-limiting/);
  assert.doesNotMatch(text, /rejected the API credentials/);
});

test('login: a real refusal (401) is still reported as rejected credentials', async () => {
  const { runAlerts } = await load('alerts.js');
  const e = loginEnv();
  tokenReply = { status: 401, body: { messages: ['Invalid client credentials.'] } };
  await runAlerts(e);
  assert.equal(errorPosts().length, 1);
  assert.match(errorPosts()[0].body.embeds[0].description, /rejected the API credentials \(Invalid client credentials\.\)/);
});

test('login: Eldorado being down (503) says so, not credentials', async () => {
  const { runAlerts } = await load('alerts.js');
  const e = loginEnv();
  tokenReply = { status: 503, body: {} };
  await runAlerts(e);
  assert.equal(errorPosts().length, 1);
  assert.match(errorPosts()[0].body.embeds[0].description, /Could not log in to Eldorado .* status 503/);
});

// ---------- shared token and rate-limit pause ----------
test('token: one login is reused until a minute before it expires', async () => {
  const { tokenInfo } = await load('alerts.js');
  const e = env();
  tokenReply = { status: 200, body: { accessToken: 'tok-1', expiresIn: 900 } };
  const a = await tokenInfo(e);
  tokenReply = { status: 200, body: { accessToken: 'tok-2', expiresIn: 900 } };
  const b = await tokenInfo(e);
  assert.equal(a.value, 'tok-1');
  assert.equal(b.value, 'tok-1');
  assert.equal(eldoradoCalls, 1);
  const left = Date.parse(a.expiresAt) - Date.now();
  assert.ok(left > 890 * 1000 && left <= 900 * 1000, 'expiry from Eldorado expiresIn');
});

test('token: a refused (stale) token is replaced, unless someone already replaced it', async () => {
  const { tokenInfo } = await load('alerts.js');
  const e = env();
  tokenReply = { status: 200, body: { accessToken: 'tok-1', expiresIn: 900 } };
  await tokenInfo(e);
  tokenReply = { status: 200, body: { accessToken: 'tok-2', expiresIn: 900 } };
  assert.equal((await tokenInfo(e, { stale: 'tok-1' })).value, 'tok-2');
  assert.equal((await tokenInfo(e, { stale: 'tok-1' })).value, 'tok-2', 'an old stale token does not force another login');
  assert.equal(eldoradoCalls, 2);
});

test('rate limit: a 429 pauses every Eldorado call for 15 minutes and is logged', async () => {
  const { runAlerts } = await load('alerts.js');
  const e = env();
  tokenReply = { status: 200, body: { accessToken: 'tok-1', expiresIn: 900 } };
  ordersStatus = 429;
  await runAlerts(e);
  const callsAfterHit = eldoradoCalls;
  assert.equal(callsAfterHit, 2, 'login + orders, then nothing else in that run (no offers, no summary)');

  const pause = await e.STATE.get('cooldown', 'json');
  const left = Date.parse(pause.until) - Date.now();
  assert.ok(left > 14 * 60 * 1000 && left <= 15 * 60 * 1000);
  assert.deepEqual((await e.STATE.get('rateLimits', 'json')).map((h) => [h.what, h.by]), [['orders', 'worker']]);

  ordersStatus = 200;
  const out = await runAlerts(e);
  assert.ok(out.paused, 'the next run is skipped');
  assert.equal(eldoradoCalls, callsAfterHit, 'no Eldorado calls while paused');
  assert.match((await e.STATE.get('lastRun', 'json')).problems[0], /^paused until/);
});

test('rate limit: runs resume once the pause is over', async () => {
  const { runAlerts } = await load('alerts.js');
  const e = env();
  await e.STATE.put('cooldown', JSON.stringify({ until: new Date(Date.now() - 1000).toISOString(), what: 'orders', by: 'worker' }));
  tokenReply = { status: 200, body: { accessToken: 'tok-1', expiresIn: 900 } };
  const out = await runAlerts(e);
  assert.equal(out.paused, undefined);
  assert.ok(eldoradoCalls >= 2);
});

test('health: includes the pause and the rate-limit log', async () => {
  const { health, noteRateLimit } = await load('alerts.js');
  const e = env();
  await noteRateLimit(e, 'login', 'GAMING-PC');
  const h = await health(e, []);
  assert.equal(h.cooldown.what, 'login');
  assert.equal(h.cooldown.by, 'GAMING-PC');
  assert.equal(h.rateLimits.length, 1);
});

// ---------- expiring ----------
const offerExpiring = (id, days, extra = {}) => ({
  id, offerTitle: 'Offer ' + id, offerState: 'Active', pricePerUnit: { amount: 40, currency: 'USD' },
  expireDate: new Date(Date.now() + days * 86400000).toISOString(), ...extra
});

test('expiring: active offers within 2 days post to #expiring once each', async () => {
  const { warnExpiring } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_EXPIRING: 'https://discord.test/expiring', DISCORD_WEBHOOK_ERRORS: 'https://discord.test/errors' });
  const offers = [offerExpiring('soon', 1.5), offerExpiring('later', 5), offerExpiring('paused', 1, { offerState: 'Paused' }), offerExpiring('gone', -3)];
  await warnExpiring(e, offers);
  await warnExpiring(e, offers);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://discord.test/expiring');
  const embed = posts[0].body.embeds[0];
  assert.match(embed.title, /Expiring soon: Offer soon/);
  assert.match(embed.fields[0].value, /^in 2 days \(\d{4}-\d{2}-\d{2}\)$/);
  assert.equal(embed.fields[1].value, '$40.00');
});

test('expiring: a renewed offer (new expiry date) is announced again', async () => {
  const { warnExpiring } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_EXPIRING: 'https://discord.test/expiring' });
  await warnExpiring(e, [offerExpiring('a', 1)]);
  await warnExpiring(e, [offerExpiring('a', 1.9)]);
  assert.equal(posts.length, 2);
});

test('expiring: without DISCORD_WEBHOOK_EXPIRING they go to #errors', async () => {
  const { warnExpiring } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_ERRORS: 'https://discord.test/errors' });
  await warnExpiring(e, [offerExpiring('a', 1)]);
  assert.equal(posts[0].url, 'https://discord.test/errors');
});

test('expiring test route: posts your real expiring offers without marking them announced', async () => {
  const { sendTests, warnExpiring } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_EXPIRING: 'https://discord.test/expiring' });
  await e.STATE.put('offersCache', JSON.stringify({ at: Date.now(), offers: [offerExpiring('a', 0.5), offerExpiring('b', 1.8), offerExpiring('c', 9)] }));
  const out = await sendTests(e, 'expiring');
  assert.deepEqual(out.sent, ['expiring (2 real)']);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.embeds.map((x) => x.title), ['⏳ Expiring soon: Offer a', '⏳ Expiring soon: Offer b']);
  assert.match(posts[0].body.content, /^Test: your 2 offers/);
  await warnExpiring(e, [offerExpiring('a', 0.5)]);
  assert.equal(posts.length, 2, 'the real alert still goes out later');
});

test('expiring test route: a sample when nothing is expiring', async () => {
  const { sendTests } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_EXPIRING: 'https://discord.test/expiring' });
  const out = await sendTests(e, 'expiring');
  assert.deepEqual(out.sent, ['expiring (0 real)']);
  assert.match(posts[0].body.embeds[0].title, /TEST 1007/);
});

// ---------- health ----------
test('health: which channels are set and their fallbacks, never the webhook URLs', async () => {
  const { health } = await load('alerts.js');
  const e = env({ DISCORD_WEBHOOK_REVIEWS: undefined, ELDORADO_CREDS_EXPIRE: '2027-10-12', ELDORADO_CLIENT_ID: 'x', ELDORADO_CLIENT_SECRET: 'y' });
  const h = await health(e, []);
  const byName = Object.fromEntries(h.channels.map((c) => [c.name, c]));
  assert.equal(byName.sales.set, true);
  assert.equal(byName.reviews.set, false);
  assert.equal(byName.reviews.fallback, 'sales');
  assert.equal(byName.expiring.secret, 'DISCORD_WEBHOOK_EXPIRING');
  assert.equal(h.eldorado, true);
  assert.equal(h.credsExpire, '2027-10-12');
  assert.doesNotMatch(JSON.stringify(h), /discord\.test/);
});

// ---------- backup ----------
test('backup: saves latest and a dated snapshot per PC, lists and reads them back', async () => {
  const { saveBackup, listBackups, getBackup } = await load('backup.js');
  const e = env();
  const out = await saveBackup(e, { pc: 'GAMING-PC', listed: [{ folder: 'Zezima', listing: { offerId: 'o1' } }], sold: [] });
  assert.equal(out.ok, true);
  const day = out.at.slice(0, 10);
  assert.deepEqual((await listBackups(e)).keys, [`backup:GAMING-PC:latest`, `backup:GAMING-PC:${day}`]);
  const latest = await getBackup(e, 'backup:GAMING-PC:latest');
  assert.equal(latest.listed[0].listing.offerId, 'o1');
  assert.equal(latest.pc, 'GAMING-PC');
});

test('backup: refuses bad bodies and keys outside backups', async () => {
  const { saveBackup, getBackup } = await load('backup.js');
  const e = env();
  await e.STATE.put('token', 'secret-token');
  assert.equal((await saveBackup(e, { pc: '../../x', listed: 'nope', sold: [] })).status, 400);
  assert.equal((await saveBackup(e, null)).status, 400);
  assert.equal(await getBackup(e, 'token'), null);
});

test('backup: the PC name is cleaned before it becomes a key', async () => {
  const { saveBackup } = await load('backup.js');
  const e = env();
  await saveBackup(e, { pc: 'My PC:/latest', listed: [], sold: [] });
  assert.ok(e.STATE.m.has('backup:MyPClatest:latest'));
});
