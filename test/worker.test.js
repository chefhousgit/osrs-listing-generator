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
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  posts = [];
  eldoradoOrders = [];
  globalThis.fetch = async (url, init) => {
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

test('sales: an order with no created date is treated as new (never silently dropped)', async () => {
  const { checkOrders } = await load('alerts.js');
  const e = env();
  await e.STATE.put('orders', '{}');
  eldoradoOrders = [{ ...order('no-date', null), state: { state: 'Paid' }, createdDate: undefined }];
  await checkOrders(e, 'token');
  assert.equal(salePosts().length, 1);
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
