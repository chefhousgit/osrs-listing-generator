// App-side pieces that work on local files: the Settings page's .env editing, the folder record
// backup (what it sends and when), restoring a backup, and the Reviews page numbers.
// Everything runs in a temporary folder; the real .env and account folders are never touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osrs-local-test-'));
process.env.SETTINGS_ENV_FILE = path.join(tmp, 'test.env');
const KEYS = ['ACCOUNTS_DIR', 'LISTED_DIR', 'SOLD_DIR'];
const savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
KEYS.forEach((k) => { process.env[k] = ''; });

const settings = require('../settings');
const folders = require('../folders');
const orders = require('../orders');
const { plan } = require('../scripts/backup');
const { createFakeEldorado } = require('./helpers/fake-eldorado');

test.after(() => {
  KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
  fs.rmSync(tmp, { recursive: true, force: true });
});

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// ---------- .env editing ----------
test('env: replaces only the given keys and keeps comments and other settings', () => {
  const text = '# proxy\nPROXY_URL=https://x\nACCOUNTS_DIR=C:\\Old\n# listed\nLISTED_DIR=\n';
  assert.equal(settings.updateEnvText(text, { ACCOUNTS_DIR: 'D:\\New', LISTED_DIR: 'D:\\New\\Listed' }),
    '# proxy\nPROXY_URL=https://x\nACCOUNTS_DIR=D:\\New\n# listed\nLISTED_DIR=D:\\New\\Listed\n');
});

test('env: keeps Windows line endings, appends missing keys, drops duplicates', () => {
  const text = 'PROXY_URL=https://x\r\nSOLD_DIR=a\r\nSOLD_DIR=b\r\n';
  assert.equal(settings.updateEnvText(text, { SOLD_DIR: 'C:\\Sold', ACCOUNTS_DIR: 'C:\\Acc' }),
    'PROXY_URL=https://x\r\nSOLD_DIR=C:\\Sold\r\nACCOUNTS_DIR=C:\\Acc\r\n');
});

test('env: works on an empty file', () => {
  assert.equal(settings.updateEnvText('', { ACCOUNTS_DIR: 'C:\\Acc' }), 'ACCOUNTS_DIR=C:\\Acc\n');
});

// ---------- settings save ----------
test('settings: refuses relative paths, a missing accounts folder, and Listed with no accounts folder', async () => {
  await assert.rejects(settings.save({ ACCOUNTS_DIR: 'relative\\dir' }), { status: 400, message: /full path/ });
  await assert.rejects(settings.save({ ACCOUNTS_DIR: path.join(tmp, 'nope') }), { status: 400, message: /doesn't exist/ });
  await assert.rejects(settings.save({ LISTED_DIR: path.join(tmp) }), { status: 400, message: /accounts folder first/ });
  assert.equal(fs.existsSync(process.env.SETTINGS_ENV_FILE), false, 'nothing written');
});

test('settings: saves to the .env file, applies right away, defaults Listed / Sold', async () => {
  const accounts = path.join(tmp, 'Accounts');
  fs.mkdirSync(accounts);
  write(process.env.SETTINGS_ENV_FILE, 'PROXY_URL=https://x\n');

  const out = await settings.save({ ACCOUNTS_DIR: accounts });
  assert.equal(process.env.ACCOUNTS_DIR, accounts);
  assert.equal(fs.readFileSync(process.env.SETTINGS_ENV_FILE, 'utf8'), `PROXY_URL=https://x\nACCOUNTS_DIR=${accounts}\n`);
  const f = Object.fromEntries(out.fields.map((x) => [x.key, x]));
  assert.equal(f.ACCOUNTS_DIR.exists, true);
  assert.equal(f.LISTED_DIR.effective, path.join(accounts, 'Listed'));
  assert.equal(f.LISTED_DIR.value, '');
  assert.equal(f.SOLD_DIR.effective, path.join(accounts, 'Sold'));
  assert.equal(folders.listedDir(), path.join(accounts, 'Listed'), 'folders.js sees the new path without a restart');
});

test('settings: a Listed folder that does not exist yet is fine if its parent does', async () => {
  await settings.save({ LISTED_DIR: path.join(tmp, 'Accounts', 'Listed') });
  await assert.rejects(settings.save({ SOLD_DIR: path.join(tmp, 'no', 'such', 'Sold') }), { status: 400 });
});

// ---------- setup check ----------
const NOW = Date.parse('2026-10-15T12:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const workerHealth = (extra = {}) => ({
  ok: true, runEveryMinutes: 5, eldorado: true, credsExpire: '2027-10-12', credsDaysLeft: 362,
  lastRun: { at: minsAgo(12), ok: true, problems: [] },
  channels: [
    { name: 'sales', set: true, secret: 'DISCORD_WEBHOOK_SALES', fallback: null },
    { name: 'expiring', set: false, secret: 'DISCORD_WEBHOOK_EXPIRING', fallback: 'errors' }
  ],
  backups: [{ pc: os.hostname().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40), at: minsAgo(90), listed: 4, sold: 9 }, { pc: 'OTHER-PC', at: minsAgo(300), listed: 2, sold: 1 }],
  ...extra
});
const deps = (extra = {}) => ({
  worker: async () => workerHealth(), proxySet: true, eldoradoSet: true, syncEnabled: true,
  lastSync: { at: minsAgo(30), moves: [{}], error: null }, backupStatus: { at: minsAgo(30), error: null }, ...extra
});
const rowsOf = async (d) => Object.fromEntries((await settings.health(d, NOW)).rows.map((r) => [r.id, r]));

test('setup check: a healthy setup', async () => {
  const r = await rowsOf(deps());
  assert.equal(r.worker.status, 'ok');
  assert.equal(r.checks.text, 'Running every 5 minutes (last recorded 12 min ago).');
  assert.equal(r.eldorado.status, 'ok');
  assert.match(r.eldorado.text, /Expire in 362 days \(2027-10-12\)/);
  assert.equal(r['discord-worker'].status, 'warn');
  assert.match(r['discord-worker'].detail, /#expiring goes to #errors \(DISCORD_WEBHOOK_EXPIRING not set\)/);
  assert.equal(r.sync.text, 'Last run 30 min ago: 1 moved.');
  assert.equal(r.backup.status, 'ok');
  assert.match(r.backup.text, /last stored 2 hours ago \(4 listed, 9 sold\)/);
  assert.match(r.backup.detail, /OTHER-PC: 5 hours ago/);
});

test('setup check: worker unreachable, wrong secret, or not redeployed', async () => {
  assert.equal((await rowsOf(deps({ worker: async () => { throw new Error('fetch failed'); } }))).worker.status, 'bad');
  assert.match((await rowsOf(deps({ worker: async () => { throw new Error('Worker /alerts/health failed (401)'); } }))).worker.text, /PROXY_SECRET/);
  const old = await rowsOf(deps({ worker: async () => { throw new Error('Worker /alerts/health failed (404)'); } }));
  assert.equal(old.worker.status, 'warn');
  assert.match(old.worker.text, /redeploying/);
  assert.equal((await rowsOf(deps({ proxySet: false }))).worker.status, 'bad');
});

test('setup check: stopped checks, expiring credentials, sync off, failed backup', async () => {
  const r = await rowsOf(deps({
    worker: async () => workerHealth({ lastRun: { at: minsAgo(120), ok: true }, credsDaysLeft: 5 }),
    syncEnabled: false, lastSync: null, backupStatus: { at: minsAgo(5), error: 'Worker /alerts/backup failed (500)' }
  }));
  assert.equal(r.checks.status, 'bad');
  assert.equal(r.eldorado.status, 'bad');
  assert.equal(r.sync.status, 'off');
  assert.equal(r.backup.status, 'bad');
  assert.match(r.backup.detail, /failed \(500\)/);
});

test('setup check: rate limits row (none, recent hits, paused now)', async () => {
  const none = await rowsOf(deps({ worker: async () => workerHealth({ rateLimits: [{ at: minsAgo(60 * 24 * 8), what: 'orders', by: 'worker' }], cooldown: null }) }));
  assert.equal(none.ratelimits.status, 'ok', 'older than 7 days does not count');
  const hits = await rowsOf(deps({ worker: async () => workerHealth({ rateLimits: [{ at: minsAgo(300), what: 'login', by: 'worker' }, { at: minsAgo(900), what: 'GET /api/x', by: 'OTHER-PC' }], cooldown: null }) }));
  assert.equal(hits.ratelimits.status, 'warn');
  assert.match(hits.ratelimits.text, /Hit 2 times in the last 7 days/);
  assert.match(hits.ratelimits.detail, /login \(worker\).*GET \/api\/x \(OTHER-PC\)/);
  const paused = await rowsOf(deps({ worker: async () => workerHealth({ rateLimits: [], cooldown: { until: new Date(NOW + 600000).toISOString(), what: 'login', by: 'worker' } }) }));
  assert.match(paused.ratelimits.text, /paused until .* \(login, worker\)/);
});

// ---------- backup ----------
test('backup: sends only listing.json / sale.json, only when something changed', async () => {
  const accounts = process.env.ACCOUNTS_DIR;
  const listed = path.join(accounts, 'Listed');
  const sold = path.join(accounts, 'Sold');
  write(path.join(listed, 'Zezima - hc', 'listing.json'), JSON.stringify({ offerId: 'o1', title: 'HCIM', price: 40 }));
  write(path.join(listed, 'Zezima - hc', 'login.txt'), 'me@example.test:hunter2-password:TOTPKEY');
  write(path.join(sold, 'Lynx', 'listing.json'), JSON.stringify({ offerId: 'o2' }));
  write(path.join(sold, 'Lynx', 'sale.json'), JSON.stringify({ orderId: 'r2', price: 25 }));

  const sent = [];
  orders.onBackup(async (b) => { sent.push(b); });
  const run = async () => orders.backup(await folders.listedFolders(), await folders.soldFolders());

  assert.equal(await run(), true);
  assert.equal(await run(), false, 'unchanged: not sent again');
  write(path.join(sold, 'Lynx', 'sale.json'), JSON.stringify({ orderId: 'r2', price: 26 }));
  assert.equal(await run(), true, 'changed: sent');

  assert.equal(sent.length, 2);
  const b = sent[1];
  assert.equal(b.pc, os.hostname());
  assert.deepEqual(b.listed, [{ folder: 'Zezima - hc', listing: { offerId: 'o1', title: 'HCIM', price: 40 } }]);
  assert.deepEqual(b.sold, [{ folder: 'Lynx', listing: { offerId: 'o2' }, sale: { orderId: 'r2', price: 26 } }]);
  assert.doesNotMatch(JSON.stringify(sent), /hunter2|TOTPKEY|example\.test/);
});

test('restore: plans only missing files, never unsafe folder names', async () => {
  const accounts = process.env.ACCOUNTS_DIR;
  const backup = {
    listed: [
      { folder: 'Zezima - hc', listing: { offerId: 'o1' } }, // already on disk
      { folder: 'Gone', listing: { offerId: 'o3' } },
      { folder: '..', listing: { offerId: 'bad' } },
      { folder: 'a\\..\\..\\x', listing: { offerId: 'bad' } }
    ],
    sold: [{ folder: 'Lynx', listing: { offerId: 'o2' }, sale: { orderId: 'r2' } }, { folder: 'Old', listing: null, sale: { orderId: 'r9' } }]
  };
  const writes = (await plan(backup)).map((w) => path.relative(accounts, w.file));
  assert.deepEqual(writes, [path.join('Listed', 'Gone', 'listing.json'), path.join('Sold', 'Old', 'sale.json')]);
});

// ---------- reviews page ----------
test('reviews page: positive rate, tags, by type; unreviewed and canceled sales left out of the list', async () => {
  const sale = (id, review, extra = {}) => ({
    id, offerId: 'o-' + id, totalPrice: { amount: 30, currency: 'USD' }, state: { state: 'Completed' },
    createdDate: new Date().toISOString(), buyerUsername: 'SecretBuyer42',
    orderOfferDetails: { offerTitle: 'Acc ' + id, category: 'Account', offerAttributesProperties: [{ attributeId: 'osrs-account-type', id: 'ironman', values: ['Ironman'] }] },
    review, ...extra
  });
  const fake = createFakeEldorado({ orders: [
    sale('1', { feedbackRating: 'Positive', feedbackTags: ['FastDelivery'], reviewMessage: 'nice', isReviewMessageVisible: true, wasInitialRatingPositive: true }),
    sale('2', { feedbackRating: 'Negative', feedbackTags: ['FastDelivery', 'Rude'], reviewMessage: '', isReviewMessageVisible: true, wasInitialRatingPositive: true }),
    sale('3', { feedbackRating: 'Unrated', feedbackTags: null, reviewMessage: null, isReviewMessageVisible: true }),
    sale('4', { feedbackRating: 'Negative', feedbackTags: [], reviewMessage: 'x', isReviewMessageVisible: true }, { state: { state: 'Canceled' } })
  ] }).install();
  try {
    const d = await require('../stats').reviews();
    assert.deepEqual(d.totals, { sales: 3, reviewed: 2, positive: 1, negative: 1, positivePct: 50, last30: { reviewed: 2, positivePct: 50 }, withMessage: 1 });
    assert.deepEqual(d.tags, [{ tag: 'FastDelivery', positive: 1, negative: 1 }, { tag: 'Rude', positive: 0, negative: 1 }]);
    assert.deepEqual(d.byType, [{ key: 'Ironman', sales: 3, positive: 1, negative: 1 }]);
    assert.deepEqual(d.reviews.map((r) => [r.id, r.rating, r.changed]), [['1', 'Positive', false], ['2', 'Negative', true]]);
    assert.doesNotMatch(JSON.stringify(d), /SecretBuyer42/);
  } finally {
    fake.restore();
  }
});
