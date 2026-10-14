// Discord alerts from Eldorado, run by the Worker's cron trigger every 5 minutes (24/7).
//
//   #sales    new orders, cancellations, completed orders
//   #disputes disputes (@here); falls back to #sales if DISCORD_WEBHOOK_DISPUTES is not set
//   #summary  once a day at SUMMARY_HOUR in TIMEZONE: last 24h listed / sold / revenue, sold this
//             week, stock (offers + the app's folder counts), stale and soon-expiring offers
//   #price-drops auto price drops (DISCORD_WEBHOOK_PRICE_DROPS; falls back to #listed, then #summary)
//   #errors   also: an offer expiring within EXPIRY_WARN_DAYS (once per offer)
//
// Auto price drops (opt-in per offer from the app's Offers page, stored in KV "autodrop"): from
// DROP_START_DAYS listed, -DROP_PCT every DROP_EVERY_DAYS, never below DROP_FLOOR of the price it
// had when you opted in. A price you lowered yourself below the schedule is left alone.
//   #errors   Eldorado rejecting the API credentials, credentials about to expire, failed checks
//
// Secrets (wrangler secret put): ELDORADO_CLIENT_ID, ELDORADO_CLIENT_SECRET, DISCORD_WEBHOOK_SALES, DISCORD_WEBHOOK_DISPUTES,
// DISCORD_WEBHOOK_SUMMARY, DISCORD_WEBHOOK_ERRORS (old name DISCORD_WEBHOOK_ALERTS still works). Vars (wrangler.toml): TIMEZONE, SUMMARY_HOUR,
// ELDORADO_CREDS_EXPIRE (YYYY-MM-DD, optional). KV binding STATE remembers which orders were already
// announced and when each offer was first seen (Eldorado offers carry no creation date).
// Nothing here posts login details, keys or buyer information.
//
// Eldorado rate-limits the seller API (429 "Quota exceeded"), so each run stays light: the login
// token is reused for its 15 minutes (cached in KV), orders are checked every run, and the offer
// list is refreshed at most hourly (plus right before the summary). A 429 only reaches #errors if
// it keeps happening for RATE_LIMIT_GRACE_HOURS.

const ELDORADO = 'https://www.eldorado.gg';
const IMAGE_BASE = 'https://fileserviceusprod.blob.core.windows.net/offerimages/';
const STALE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OFFERS_EVERY = 55 * 60 * 1000;   // offer list refresh interval
const OFFER_LIFETIME_DAYS = 21;        // Eldorado offers expire this long after listing
const EXPIRY_WARN_DAYS = 2;
const DROP_START_DAYS = 14;
const DROP_EVERY_DAYS = 7;
const DROP_PCT = 0.05;
const DROP_FLOOR = 0.75;
const RATE_LIMIT_GRACE_HOURS = 3;

const COLORS = { sale: 0x5cb85c, dispute: 0xd9534f, cancel: 0x888888, done: 0xe4b04a, summary: 0xe4b04a, alert: 0xd68f3c };

// ---------- Eldorado ----------
async function getToken(env) {
  const res = await fetch(ELDORADO + '/api/authentication/seller/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: env.ELDORADO_CLIENT_ID, clientSecret: env.ELDORADO_CLIENT_SECRET })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.accessToken) {
    throw new Error((body.messages && body.messages.join(' ')) || 'status ' + res.status);
  }
  return body.accessToken;
}

// Login token, reused from KV while it's valid (tokens last 15 minutes).
async function cachedToken(env) {
  const saved = await env.STATE.get('token');
  if (saved) return saved;
  const token = await getToken(env);
  await env.STATE.put('token', token, { expirationTtl: 13 * 60 });
  return token;
}

async function getJson(token, path) {
  const res = await fetch(ELDORADO + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 300);
    try { const j = JSON.parse(body); if (j.messages) detail = j.messages.join(' '); } catch (e) { /* not JSON */ }
    throw Object.assign(new Error(`GET ${path.split('?')[0]} failed (${res.status})${detail ? ': ' + detail : ''}`), { status: res.status });
  }
  return res.json();
}

function getOrders(token, pageSize) {
  return getJson(token, `/api/v1/orders/me/seller/orders?displayFilter=DisplaySellingOrders&isAscendingDateOrder=false&pageSize=${pageSize}`)
    .then((d) => d.results || []);
}

// All account offers (active and paused), every page. The first request has no page number
// (same as Eldorado's own dashboard); later pages continue from the index it reports.
async function getOffers(token) {
  const base = '/api/flexibleOffers/me/search?category=Account&pageSize=50';
  const first = await getJson(token, base);
  const all = [...(first.results || [])];
  const start = Number(first.pageIndex) || 0;
  for (let n = 1; n < Math.min(Number(first.totalPages) || 1, 20); n++) {
    const d = await getJson(token, `${base}&pageIndex=${start + n}`);
    all.push(...(d.results || []));
  }
  return all;
}

// ---------- Discord ----------
const disputesHook = (env) => env.DISCORD_WEBHOOK_DISPUTES || env.DISCORD_WEBHOOK_SALES;
const errorsHook = (env) => env.DISCORD_WEBHOOK_ERRORS || env.DISCORD_WEBHOOK_ALERTS;
const priceDropsHook = (env) => env.DISCORD_WEBHOOK_PRICE_DROPS || env.DISCORD_WEBHOOK_LISTED || env.DISCORD_WEBHOOK_SUMMARY;

async function post(url, payload) {
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

const money = (p) => (p && p.amount != null
  ? (p.currency && p.currency !== 'USD' ? `${Number(p.amount).toFixed(2)} ${p.currency}` : `$${Number(p.amount).toFixed(2)}`)
  : '?');

function orderEmbed(order, heading, color, footer) {
  const offer = order.orderOfferDetails || {};
  const img = offer.mainOfferImage && (offer.mainOfferImage.smallImage || offer.mainOfferImage.largeImage);
  return {
    title: `${heading}: ${offer.offerTitle || 'Account'}`.slice(0, 250),
    color,
    fields: [
      { name: 'Price', value: money(order.totalPrice), inline: true },
      { name: 'Status', value: (order.state && order.state.state) || '?', inline: true },
      { name: 'Order', value: '`' + order.id + '`', inline: false }
    ],
    thumbnail: img ? { url: IMAGE_BASE + img } : undefined,
    footer: footer ? { text: footer } : undefined,
    timestamp: order.createdDate || undefined
  };
}

// Alerts that would otherwise repeat every 5 minutes: at most once per key per day.
async function alertOnce(env, key, text) {
  const today = new Date().toISOString().slice(0, 10);
  const flag = 'alerted:' + key;
  if ((await env.STATE.get(flag)) === today) return;
  await post(errorsHook(env), { embeds: [{ title: '⚠️ Error', description: text, color: COLORS.alert }] });
  await env.STATE.put(flag, today, { expirationTtl: 2 * 24 * 3600 });
}

// A failed check: rate limits (429) stay quiet unless they last RATE_LIMIT_GRACE_HOURS;
// anything else goes to #errors once a day.
async function reportProblem(env, key, err, text) {
  if (err.status === 429) {
    const flag = 'ratelimited:' + key;
    const since = await env.STATE.get(flag);
    if (!since) {
      await env.STATE.put(flag, new Date().toISOString(), { expirationTtl: 2 * 24 * 3600 });
      return;
    }
    if (Date.now() - Date.parse(since) < RATE_LIMIT_GRACE_HOURS * HOUR) return;
    await alertOnce(env, key, `${text} Eldorado has been rate-limiting it since ${since.slice(11, 16)} UTC (${err.message}).`);
    return;
  }
  if (err.status === 401) await env.STATE.delete('token'); // log in again next run
  await alertOnce(env, key, `${text} ${err.message}`);
}

async function clearRateLimit(env, key) {
  const flag = 'ratelimited:' + key;
  if (await env.STATE.get(flag)) await env.STATE.delete(flag);
}

// ---------- every 5 minutes ----------
const SOLD_STATES = ['Paid', 'Delivered', 'Received', 'Completed', 'PendingReview'];

async function checkOrders(env, token) {
  const orders = await getOrders(token, 25);
  const seen = await env.STATE.get('orders', 'json');
  const next = Object.assign({}, seen || {});
  let changed = !seen;

  for (const order of orders.slice().reverse()) { // oldest first, so Discord reads in order
    const state = order.state && order.state.state;
    const before = seen ? seen[order.id] : undefined;
    if (seen) {
      if (before === undefined && SOLD_STATES.includes(state)) {
        await post(env.DISCORD_WEBHOOK_SALES, { embeds: [orderEmbed(order, '💰 Sold', COLORS.sale, 'Hand over the account, then mark the order delivered.')] });
      } else if (before !== undefined && before !== state) {
        if (state === 'Disputed' || state === 'DeliveredDisputed') {
          const reason = order.latestDispute && order.latestDispute.reason ? ` (${order.latestDispute.reason.replace(/_/g, ' ')})` : '';
          await post(disputesHook(env), {
            content: '@here',
            allowed_mentions: { parse: ['everyone'] },
            embeds: [orderEmbed(order, '🚨 Dispute opened' + reason, COLORS.dispute, 'Reply on Eldorado.')]
          });
        } else if (state === 'Canceled') {
          await post(env.DISCORD_WEBHOOK_SALES, { embeds: [orderEmbed(order, '❌ Order canceled', COLORS.cancel)] });
        } else if (state === 'Completed') {
          await post(env.DISCORD_WEBHOOK_SALES, { embeds: [orderEmbed(order, '✅ Completed', COLORS.done, 'Funds released.')] });
        }
      }
    }
    if (next[order.id] !== state) {
      next[order.id] = state;
      changed = true;
    }
  }

  // Keep the remembered list small: the orders Eldorado returned plus the newest 200 others.
  const ids = Object.keys(next);
  if (ids.length > 250) {
    const keep = new Set(orders.map((o) => o.id).concat(ids.slice(-200)));
    ids.forEach((id) => { if (!keep.has(id)) delete next[id]; });
    changed = true;
  }
  if (changed) await env.STATE.put('orders', JSON.stringify(next));
}

// When an offer was listed: the earlier of when the checks first saw it and its expiry date minus
// Eldorado's offer lifetime (offers listed before these checks existed).
export function listedSince(offer, firstSeen) {
  const seen = firstSeen && firstSeen[offer.id] ? Date.parse(firstSeen[offer.id]) : Infinity;
  const fromExpiry = offer.expireDate ? Date.parse(offer.expireDate) - OFFER_LIFETIME_DAYS * DAY : Infinity;
  const t = Math.min(seen, fromExpiry);
  return Number.isFinite(t) ? t : Date.now();
}

const ageDays = (offer, firstSeen) => Math.floor((Date.now() - listedSince(offer, firstSeen)) / DAY);

// ---------- auto price drops (opt-in) ----------
const round2 = (n) => Math.round(n * 100) / 100;

// The price the schedule wants now, or null before the first drop.
export function scheduledPrice(base, days) {
  if (days < DROP_START_DAYS) return null;
  const steps = 1 + Math.floor((days - DROP_START_DAYS) / DROP_EVERY_DAYS);
  return round2(Math.max(base * Math.pow(1 - DROP_PCT, steps), base * DROP_FLOOR));
}

async function applyPriceDrops(env, token, offers, firstSeen) {
  const plan = (await env.STATE.get('autodrop', 'json')) || {};
  let changed = false;
  for (const [id, entry] of Object.entries(plan)) {
    const offer = offers.find((o) => o.id === id);
    if (!offer) { delete plan[id]; changed = true; continue; } // sold or deleted
    if (offer.offerState !== 'Active' || !offer.pricePerUnit) continue;
    const days = ageDays(offer, firstSeen);
    const target = scheduledPrice(entry.base, days);
    const current = offer.pricePerUnit.amount;
    if (target == null || current <= target + 0.004) continue;
    const res = await fetch(ELDORADO + `/api/flexibleOffersUser/me/${encodeURIComponent(id)}/changePrice`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: target, currency: 'USD' })
    });
    if (!res.ok) {
      await alertOnce(env, 'drop:' + id, `Auto price drop for "${offer.offerTitle}" failed (${res.status}).`);
      continue;
    }
    offer.pricePerUnit = { ...offer.pricePerUnit, amount: target };
    entry.lastDrop = { at: new Date().toISOString(), from: current, to: target };
    changed = true;
    const atFloor = target <= round2(entry.base * DROP_FLOOR);
    await post(priceDropsHook(env), { embeds: [{
      title: `📉 Price drop: ${(offer.offerTitle || 'Account').slice(0, 200)}`,
      color: COLORS.done,
      fields: [
        { name: 'Price', value: `${money({ amount: current })} → **${money({ amount: target })}**`, inline: true },
        { name: 'Listed', value: `${days} days`, inline: true },
        { name: 'Floor', value: money({ amount: round2(entry.base * DROP_FLOOR) }) + (atFloor ? ' (reached)' : ''), inline: true }
      ],
      timestamp: new Date().toISOString()
    }] });
  }
  if (changed) await env.STATE.put('autodrop', JSON.stringify(plan));
}

// Opt an offer in (base = its current price) or out. Called by the app.
export async function setAutoDrop(env, { offerId, enabled, base }) {
  const plan = (await env.STATE.get('autodrop', 'json')) || {};
  if (enabled) plan[offerId] = { base: Number(base), since: new Date().toISOString() };
  else delete plan[offerId];
  await env.STATE.put('autodrop', JSON.stringify(plan));
  return { ok: true, autodrop: plan[offerId] || null };
}

// ---------- expiry ----------
async function warnExpiring(env, offers) {
  for (const o of offers) {
    if (o.offerState !== 'Active' || !o.expireDate) continue;
    const left = (Date.parse(o.expireDate) - Date.now()) / DAY;
    if (left > EXPIRY_WARN_DAYS || left < -1) continue;
    await alertOnce(env, 'expiry:' + o.id, `⏳ "${o.offerTitle}" expires ${left <= 0 ? 'today' : 'in ' + Math.ceil(left) + (Math.ceil(left) === 1 ? ' day' : ' days')} (${o.expireDate.slice(0, 10)}). Renew it on Eldorado so it stays listed.`);
  }
}

// First-seen time per offer, so the summary can tell new and stale listings apart.
async function trackOffers(env, offers) {
  const seen = (await env.STATE.get('offers', 'json')) || {};
  const now = new Date().toISOString();
  const next = {};
  let changed = false;
  offers.forEach((o) => {
    next[o.id] = seen[o.id] || now;
    if (!seen[o.id]) changed = true;
  });
  if (Object.keys(seen).some((id) => !next[id])) changed = true;
  if (changed) await env.STATE.put('offers', JSON.stringify(next));
  return next;
}

// ---------- daily summary ----------
function localParts(env, date) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

async function sendSummary(env, token, offers, firstSeen) {
  const now = Date.now();
  const orders = await getOrders(token, 50);
  const sold = orders.filter((o) => now - Date.parse(o.createdDate) < DAY && o.state && o.state.state !== 'Canceled');
  const revenue = sold.reduce((sum, o) => sum + Number((o.totalPrice && o.totalPrice.amount) || 0), 0);
  const active = offers.filter((o) => o.offerState === 'Active');
  const paused = offers.filter((o) => o.offerState === 'Paused');
  const listed = offers.filter((o) => now - listedSince(o, firstSeen) < DAY);
  const stale = active
    .filter((o) => ageDays(o, firstSeen) >= STALE_DAYS)
    .map((o) => `• ${(o.offerTitle || 'Account').slice(0, 60)} (${money(o.pricePerUnit)}, ${ageDays(o, firstSeen)}d)`);
  const expiring = active
    .filter((o) => o.expireDate && Date.parse(o.expireDate) - now < 3 * DAY)
    .map((o) => `• ${(o.offerTitle || 'Account').slice(0, 60)} (${o.expireDate.slice(5, 10)})`);
  const week = orders.filter((o) => now - Date.parse(o.createdDate) < 7 * DAY && o.state && o.state.state !== 'Canceled');
  const stock = await env.STATE.get('stock', 'json');
  const autodrop = (await env.STATE.get('autodrop', 'json')) || {};

  const fields = [
    { name: 'Listed (24h)', value: String(listed.length), inline: true },
    { name: 'Sold (24h)', value: String(sold.length), inline: true },
    { name: 'Revenue (24h)', value: '$' + revenue.toFixed(2), inline: true },
    { name: 'Sold this week', value: `${week.length} · $${week.reduce((s, o) => s + Number((o.totalPrice && o.totalPrice.amount) || 0), 0).toFixed(2)}`, inline: true },
    { name: 'On Eldorado', value: `${active.length} active · ${paused.length} paused`, inline: true },
    { name: 'Auto price drops', value: `${Object.keys(autodrop).length} offer${Object.keys(autodrop).length === 1 ? '' : 's'}`, inline: true }
  ];
  if (stock) {
    const when = new Date(stock.at).toLocaleTimeString('en-US', { timeZone: env.TIMEZONE || 'UTC', hour: 'numeric', minute: '2-digit' });
    fields.push({ name: 'Account folders', value: `${stock.waiting} waiting to list · ${stock.listed} in Listed · ${stock.sold} in Sold (as of ${when})`, inline: false });
  }
  if (expiring.length) {
    fields.push({ name: `Expiring within 3 days (${expiring.length})`, value: expiring.slice(0, 10).join('\n') + (expiring.length > 10 ? `\n…and ${expiring.length - 10} more` : '') });
  }
  if (stale.length) {
    fields.push({ name: `Listed ${STALE_DAYS}+ days, no sale (${stale.length})`, value: stale.slice(0, 10).join('\n') + (stale.length > 10 ? `\n…and ${stale.length - 10} more` : '') });
  }
  const expiry = credentialDaysLeft(env);
  if (expiry !== null && expiry <= 14) {
    fields.push({ name: 'API credentials', value: expiry < 0 ? 'Expired' : `Expire in ${expiry} day${expiry === 1 ? '' : 's'}` });
  }
  await post(env.DISCORD_WEBHOOK_SUMMARY, { embeds: [{ title: '📊 Daily summary', color: COLORS.summary, fields, timestamp: new Date().toISOString() }] });
}

function credentialDaysLeft(env) {
  if (!env.ELDORADO_CREDS_EXPIRE) return null;
  const t = Date.parse(env.ELDORADO_CREDS_EXPIRE + 'T00:00:00Z');
  return Number.isNaN(t) ? null : Math.ceil((t - Date.now()) / DAY);
}

// ---------- entry point ----------
// forceSummary: send the summary now (used by the manual test route).
export async function runAlerts(env, { forceSummary = false } = {}) {
  let token;
  try {
    token = await cachedToken(env);
  } catch (err) {
    await alertOnce(env, 'auth', `Eldorado rejected the API credentials (${err.message}). Sales alerts are paused until new credentials are set with \`wrangler secret put\`.`);
    return { ok: false, error: 'auth: ' + err.message };
  }

  const problems = [];
  try {
    await checkOrders(env, token);
    await clearRateLimit(env, 'orders');
  } catch (err) {
    problems.push('orders: ' + err.message);
    await reportProblem(env, 'orders', err, 'Could not check your Eldorado orders (sales / disputes).');
  }

  const local = localParts(env, new Date());
  const summaryHour = Number(env.SUMMARY_HOUR || 21);
  const lastSummary = await env.STATE.get('summaryDay');
  const summaryDue = forceSummary || (local.hour >= summaryHour && lastSummary !== local.day);

  // Offer list: from KV unless it's an hour old or the summary is about to use it.
  let offers = [];
  let firstSeen = {};
  const cache = await env.STATE.get('offersCache', 'json');
  if (cache && !summaryDue && Date.now() - cache.at < OFFERS_EVERY) {
    offers = cache.offers;
  } else {
    try {
      offers = (await getOffers(token)).map((o) => ({ id: o.id, offerState: o.offerState, offerTitle: o.offerTitle, pricePerUnit: o.pricePerUnit, expireDate: o.expireDate }));
      firstSeen = await trackOffers(env, offers);
      await applyPriceDrops(env, token, offers, firstSeen);
      await warnExpiring(env, offers);
      await env.STATE.put('offersCache', JSON.stringify({ at: Date.now(), offers }));
      await clearRateLimit(env, 'offers');
    } catch (err) {
      problems.push('offers: ' + err.message);
      await reportProblem(env, 'offers', err, 'Could not read your Eldorado offers (stock and stale listings in the summary).');
      if (cache) offers = cache.offers; // last known list is better than none
      // Back off: try again in 15 minutes rather than on every 5-minute run.
      await env.STATE.put('offersCache', JSON.stringify({ at: Date.now() - OFFERS_EVERY + 15 * 60 * 1000, offers: cache ? cache.offers : [] }));
    }
  }
  if (!Object.keys(firstSeen).length) firstSeen = (await env.STATE.get('offers', 'json')) || {};

  const days = credentialDaysLeft(env);
  if (days !== null && days <= 7) {
    await alertOnce(env, 'expiry', days < 0
      ? 'Your Eldorado API credentials have expired. Generate new ones on the Seller API page.'
      : `Your Eldorado API credentials expire in ${days} day${days === 1 ? '' : 's'}. Generate new ones on the Seller API page and update ELDORADO_CREDS_EXPIRE.`);
  }

  if (summaryDue) {
    try {
      await sendSummary(env, token, offers, firstSeen);
      if (!forceSummary) await env.STATE.put('summaryDay', local.day);
    } catch (err) {
      problems.push('summary: ' + err.message); // retried on the next run
    }
  }
  return { ok: problems.length === 0, offers: offers.length, problems };
}

// ---------- test posts: one sample message to each Worker webhook ----------
export async function sendTests(env) {
  const sample = {
    id: 'test-order-0000',
    state: { state: 'Paid' },
    createdDate: new Date().toISOString(),
    totalPrice: { amount: 49.99, currency: 'USD' },
    orderOfferDetails: { offerTitle: 'TEST 1007 Total Level HCIM' },
    latestDispute: { reason: 'Items_Missing_From_Account' }
  };
  const sent = [];
  if (env.DISCORD_WEBHOOK_SALES) {
    await post(env.DISCORD_WEBHOOK_SALES, { content: 'Test message, ignore.', embeds: [orderEmbed(sample, '💰 Sold', COLORS.sale, 'Hand over the account, then mark the order delivered.')] });
    sent.push('sales');
  }
  if (disputesHook(env)) {
    await post(disputesHook(env), { content: 'Test message, ignore (a real dispute pings @here).', embeds: [orderEmbed({ ...sample, state: { state: 'Disputed' } }, '🚨 Dispute opened (Items Missing From Account)', COLORS.dispute, 'Reply on Eldorado.')] });
    sent.push(env.DISCORD_WEBHOOK_DISPUTES ? 'disputes' : 'disputes (to #sales: DISCORD_WEBHOOK_DISPUTES not set)');
  }
  if (env.DISCORD_WEBHOOK_SUMMARY) {
    await post(env.DISCORD_WEBHOOK_SUMMARY, { content: 'Test message, ignore.', embeds: [{ title: '📊 Daily summary (test)', color: COLORS.summary, fields: [
      { name: 'Listed (24h)', value: '3', inline: true }, { name: 'Sold (24h)', value: '2', inline: true }, { name: 'Revenue (24h)', value: '$95.00', inline: true },
      { name: 'In stock', value: '12 active · 1 paused' }, { name: 'Listed 14+ days, no sale (1)', value: '• Example account ($60.00, 16d)' }
    ], timestamp: new Date().toISOString() }] });
    sent.push('summary');
  }
  if (errorsHook(env)) {
    await post(errorsHook(env), { content: 'Test message, ignore.', embeds: [{ title: '⚠️ Error (test)', description: 'This is where credential and Eldorado problems from the 24/7 checks show up.', color: COLORS.alert }] });
    sent.push('errors');
  }
  return { ok: true, sent };
}
