// Discord alerts from Eldorado, run by the Worker's cron trigger every 5 minutes (24/7).
//
//   #sales    new orders, cancellations
//   #completed completed orders, funds released (DISCORD_WEBHOOK_COMPLETED; falls back to #sales)
//   #disputes disputes (@here); falls back to #sales if DISCORD_WEBHOOK_DISPUTES is not set
//   #summary  once a day at SUMMARY_HOUR in TIMEZONE: last 24h listed / sold / revenue, sold this
//             week, stock (offers + the app's folder counts), stale and soon-expiring offers
//   #price-drops auto price drops (DISCORD_WEBHOOK_PRICE_DROPS; falls back to #listed, then #summary)
//   #reviews  new buyer reviews and changed ratings, @here on a negative one
//             (DISCORD_WEBHOOK_REVIEWS; falls back to #sales)
//   #expiring an Active offer expiring within EXPIRY_WARN_DAYS (once per offer and expiry date)
//             (DISCORD_WEBHOOK_EXPIRING; falls back to #errors)
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
// it keeps happening for RATE_LIMIT_GRACE_HOURS. What the checks read is kept for the app
// (snapshots.js), so the app doesn't read the same thing from Eldorado again.

import { saveOrders, slimOrder, mergeOrders, logCalls, callsBefore, HISTORY_MAX } from './snapshots.js';

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

const COLORS = { positive: 0x5cb85c, negative: 0xd9534f, sale: 0x5cb85c, dispute: 0xd9534f, cancel: 0x888888, done: 0xe4b04a, summary: 0xe4b04a, alert: 0xd68f3c };

// ---------- Eldorado ----------
// Every request to Eldorado goes through here, so each run can log how many it made (callLog).
let calls = 0;
const eldoradoFetch = (url, init) => { calls++; return fetch(url, init); };
export function takeCalls() { const n = calls; calls = 0; return n; }

// Seconds from a 429's Retry-After header, if Eldorado sends one.
const retryAfter = (res) => { const s = Number(res.headers.get('retry-after')); return Number.isFinite(s) && s > 0 ? s : null; };

async function getToken(env) {
  const res = await eldoradoFetch(ELDORADO + '/api/authentication/seller/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: env.ELDORADO_CLIENT_ID, clientSecret: env.ELDORADO_CLIENT_SECRET })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.accessToken) {
    throw Object.assign(new Error((body.messages && body.messages.join(' ')) || 'status ' + res.status), { status: res.status, retryAfter: retryAfter(res) });
  }
  return { value: body.accessToken, expiresIn: Number(body.expiresIn) || 900 };
}

// Login token, kept in KV until a minute before it expires (tokens last 15 minutes) and shared with
// the app through /alerts/token, so the checks and both PCs log in once instead of each on their own.
// stale: a token that Eldorado refused; a fresh one replaces it (unless someone already did).
export async function tokenInfo(env, { stale } = {}) {
  const saved = await env.STATE.get('token2', 'json');
  if (saved && saved.value !== stale && Date.parse(saved.expiresAt) - Date.now() > 60 * 1000) return saved;
  const { value, expiresIn } = await getToken(env);
  const info = { value, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  await env.STATE.put('token2', JSON.stringify(info), { expirationTtl: Math.max(60, expiresIn - 60) });
  return info;
}

const cachedToken = async (env) => (await tokenInfo(env)).value;

// ---------- rate limits ----------
// Eldorado doesn't publish its limit. After any "Quota exceeded" (429), from the checks or the app,
// every Eldorado call pauses for COOLDOWN_MINUTES instead of retrying, and the hit is logged
// (last RATE_LOG_SIZE, shown in the app's setup check) to learn when and where it happens.
const COOLDOWN_MINUTES = 15;
const RATE_LOG_SIZE = 30;

export async function cooldown(env) {
  const c = await env.STATE.get('cooldown', 'json');
  return c && Date.parse(c.until) > Date.now() ? c : null;
}

// retryAfter: seconds Eldorado asked to wait (Retry-After), when it says; the pause is never shorter.
export async function noteRateLimit(env, what, by = 'worker', retryAfterSec = null) {
  const wait = Math.max(COOLDOWN_MINUTES * 60, Number(retryAfterSec) || 0);
  const until = new Date(Date.now() + wait * 1000).toISOString();
  const entry = { at: new Date().toISOString(), what: String(what || '?').slice(0, 80), by: String(by || '?').slice(0, 40) };
  if (retryAfterSec) entry.retryAfter = Number(retryAfterSec);
  await env.STATE.put('cooldown', JSON.stringify({ until, what: entry.what, by: entry.by }), { expirationTtl: wait + 60 });
  const log = (await env.STATE.get('rateLimits', 'json')) || [];
  await env.STATE.put('rateLimits', JSON.stringify([entry, ...log].slice(0, RATE_LOG_SIZE)));
  return { until };
}

async function getJson(token, path) {
  const res = await eldoradoFetch(ELDORADO + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 300);
    try { const j = JSON.parse(body); if (j.messages) detail = j.messages.join(' '); } catch (e) { /* not JSON */ }
    throw Object.assign(new Error(`GET ${path.split('?')[0]} failed (${res.status})${detail ? ': ' + detail : ''}`), { status: res.status, retryAfter: retryAfter(res) });
  }
  return res.json();
}

const ORDERS_PATH = '/api/v1/orders/me/seller/orders?displayFilter=DisplaySellingOrders&isAscendingDateOrder=false&pageSize=';

// One page of orders, newest first: { results, nextPageCursor }.
const getOrderPage = (token, pageSize, cursor) => getJson(token, ORDERS_PATH + pageSize + (cursor ? '&cursorValue=' + encodeURIComponent(cursor) : ''));

function getOrders(token, pageSize) {
  return getOrderPage(token, pageSize).then((d) => d.results || []);
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
const reviewsHook = (env) => env.DISCORD_WEBHOOK_REVIEWS || env.DISCORD_WEBHOOK_SALES;
const completedHook = (env) => env.DISCORD_WEBHOOK_COMPLETED || env.DISCORD_WEBHOOK_SALES;
const expiringHook = (env) => env.DISCORD_WEBHOOK_EXPIRING || errorsHook(env);

// Each Worker channel: its own secret, and where it goes when that isn't set (for the app's setup check).
const CHANNELS = [
  { name: 'sales', key: 'DISCORD_WEBHOOK_SALES' },
  { name: 'disputes', key: 'DISCORD_WEBHOOK_DISPUTES', fallback: 'sales' },
  { name: 'summary', key: 'DISCORD_WEBHOOK_SUMMARY' },
  { name: 'errors', key: 'DISCORD_WEBHOOK_ERRORS', alt: 'DISCORD_WEBHOOK_ALERTS' },
  { name: 'price-drops', key: 'DISCORD_WEBHOOK_PRICE_DROPS', fallback: 'listed / summary' },
  { name: 'completed', key: 'DISCORD_WEBHOOK_COMPLETED', fallback: 'sales' },
  { name: 'reviews', key: 'DISCORD_WEBHOOK_REVIEWS', fallback: 'sales' },
  { name: 'expiring', key: 'DISCORD_WEBHOOK_EXPIRING', fallback: 'errors' }
];

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
    await noteRateLimit(env, key, 'worker', err.retryAfter);
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
  if (err.status === 401) await env.STATE.delete('token2'); // log in again next run
  await alertOnce(env, key, `${text} ${err.message}`);
}

async function clearRateLimit(env, key) {
  const flag = 'ratelimited:' + key;
  if (await env.STATE.get(flag)) await env.STATE.delete(flag);
}

// ---------- every 5 minutes ----------
const SOLD_STATES = ['Paid', 'Delivered', 'Received', 'Completed', 'PendingReview'];
// Returns the page it read ({ results, nextPageCursor }), which also starts a history re-read.
export async function checkOrders(env, token) {
  const page = await getOrderPage(token, 50); // one request either way; 50 so late reviews are still seen
  const orders = page.results || [];
  await saveOrders(env, orders); // for the app's Orders page, folder sync, Stats / Reviews
  await announceReviews(env, orders);
  const seen = await env.STATE.get('orders', 'json');
  const next = Object.assign({}, seen || {});
  let changed = !seen;

  // An unseen order older than every remembered order in this list was just outside what earlier
  // checks read (e.g. after reading more orders per check): history, recorded without a post.
  // New sales always come in above that line, even ones created earlier and paid since.
  const remembered = orders.filter((o) => seen && seen[o.id] !== undefined).map((o) => Date.parse(o.createdDate)).filter(Number.isFinite);
  const floor = remembered.length ? Math.min(...remembered) : -Infinity;
  const isNewSale = (order) => !(Date.parse(order.createdDate) < floor);

  for (const order of orders.slice().reverse()) { // oldest first, so Discord reads in order
    const state = order.state && order.state.state;
    const before = seen ? seen[order.id] : undefined;
    if (seen) {
      if (before === undefined && SOLD_STATES.includes(state) && isNewSale(order)) {
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
          await post(completedHook(env), { embeds: [orderEmbed(order, '✅ Completed', COLORS.done, 'Funds released.')] });
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
  return page;
}

// ---------- order history (for the app's Stats / Reviews) ----------
// Re-read once a night (HISTORY_HOUR in TIMEZONE), or right away when there's none yet, one page per
// check so it never adds a burst: the first page is the one the order check just read, then one
// more request per 5-minute run until HISTORY_MAX orders or the end. Between re-reads, every check
// merges its latest page in (snapshots.js).
const HISTORY_HOUR = 4;

export async function crawlHistory(env, token, firstPage, local) {
  let crawl = await env.STATE.get('historyCrawl', 'json');
  if (!crawl) {
    const hist = await env.STATE.get('orderHistory', 'json');
    const due = !hist || (local.hour === HISTORY_HOUR && hist.rebuiltDay !== local.day);
    if (!due) return;
    crawl = { cursor: firstPage.nextPageCursor || null, orders: (firstPage.results || []).map(slimOrder), startedAt: new Date().toISOString() };
  } else {
    const d = await getOrderPage(token, 50, crawl.cursor);
    const next = d.nextPageCursor && d.nextPageCursor !== crawl.cursor && (d.results || []).length ? d.nextPageCursor : null;
    crawl.orders.push(...(d.results || []).map(slimOrder));
    crawl.cursor = next;
  }
  if (!crawl.cursor || crawl.orders.length >= HISTORY_MAX) {
    // The latest page wins: it has orders that came in (or changed) while this re-read ran.
    const latest = (await env.STATE.get('ordersLatest', 'json')) || { orders: [] };
    await env.STATE.put('orderHistory', JSON.stringify({ at: new Date().toISOString(), rebuiltDay: local.day, complete: true, orders: mergeOrders(latest.orders, crawl.orders) }));
    await env.STATE.delete('historyCrawl');
  } else {
    await env.STATE.put('historyCrawl', JSON.stringify(crawl));
  }
}

// ---------- reviews ----------
// Buyer reviews come on the order (review.feedbackRating Positive / Negative / Unrated), often days
// after the sale, so the latest 50 orders are checked every run. KV "reviews" remembers each order's
// rating; the first run only records what's there. No buyer names are posted.
const prettyTag = (tag) => ({ GGWP: 'GG WP', GOAT: 'GOAT', TOAD: 'TOAD' }[tag] || tag.replace(/([a-z])([A-Z])/g, '$1 $2'));

export function reviewEmbed(order, before) {
  const r = order.review;
  const negative = r.feedbackRating === 'Negative';
  const heading = before ? `Review changed (${before} → ${r.feedbackRating})` : (negative ? '👎 Negative review' : '👍 Positive review');
  const embed = orderEmbed(order, heading, negative ? COLORS.negative : COLORS.positive);
  embed.fields = embed.fields.filter((f) => f.name !== 'Status');
  if (r.feedbackTags && r.feedbackTags.length) embed.fields.splice(1, 0, { name: 'Tags', value: r.feedbackTags.map(prettyTag).join(', '), inline: true });
  if (r.reviewMessage) embed.description = (r.isReviewMessageVisible === false ? '(hidden on Eldorado) ' : '') + '“' + r.reviewMessage.slice(0, 1500) + '”';
  embed.timestamp = new Date().toISOString();
  return embed;
}

export async function announceReviews(env, orders) {
  const seen = await env.STATE.get('reviews', 'json');
  const next = Object.assign({}, seen || {});
  let changed = !seen;
  for (const order of orders.slice().reverse()) { // oldest first
    const rating = order.review && order.review.feedbackRating;
    if (!rating || rating === 'Unrated' || next[order.id] === rating) continue;
    if (seen) {
      await post(reviewsHook(env), {
        ...(rating === 'Negative' ? { content: '@here', allowed_mentions: { parse: ['everyone'] } } : {}),
        embeds: [reviewEmbed(order, next[order.id])]
      });
    }
    next[order.id] = rating;
    changed = true;
  }
  // Keep the remembered list small (oldest dropped first).
  const ids = Object.keys(next);
  if (ids.length > 500) {
    ids.slice(0, ids.length - 400).forEach((id) => delete next[id]);
    changed = true;
  }
  if (changed) await env.STATE.put('reviews', JSON.stringify(next));
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
    const res = await eldoradoFetch(ELDORADO + `/api/flexibleOffersUser/me/${encodeURIComponent(id)}/changePrice`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: target, currency: 'USD' })
    });
    if (res.status === 429) {
      await noteRateLimit(env, 'price drop', 'worker', retryAfter(res));
      break; // the rest wait for the next hourly run
    }
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
const expiresIn = (left) => (left <= 0 ? 'today' : `in ${Math.ceil(left)} day${Math.ceil(left) === 1 ? '' : 's'}`);

export function expiringEmbed(o, left) {
  return {
    title: `⏳ Expiring soon: ${o.offerTitle || 'Account'}`.slice(0, 250),
    color: COLORS.alert,
    fields: [
      { name: 'Expires', value: `${expiresIn(left)} (${o.expireDate.slice(0, 10)})`, inline: true },
      { name: 'Price', value: money(o.pricePerUnit), inline: true },
      { name: 'Offer', value: '`' + o.id + '`', inline: false }
    ],
    footer: { text: 'Renew it on Eldorado so it stays listed.' },
    timestamp: new Date().toISOString()
  };
}

// Active offers expiring within EXPIRY_WARN_DAYS, posted once per offer and expiry date (a renewed
// offer gets a new date, so it's announced again before that one).
export async function warnExpiring(env, offers) {
  for (const o of offers) {
    if (o.offerState !== 'Active' || !o.expireDate) continue;
    const left = (Date.parse(o.expireDate) - Date.now()) / DAY;
    if (left > EXPIRY_WARN_DAYS || left < -1) continue;
    const flag = `expiring:${o.id}:${o.expireDate.slice(0, 10)}`;
    if (await env.STATE.get(flag)) continue;
    await post(expiringHook(env), { embeds: [expiringEmbed(o, left)] });
    await env.STATE.put(flag, '1', { expirationTtl: (EXPIRY_WARN_DAYS + 3) * 24 * 3600 });
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
  // The page this run's order check just saved; read from Eldorado only if it's missing.
  const saved = await env.STATE.get('ordersLatest', 'json');
  const orders = saved ? saved.orders : await getOrders(token, 50);
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
// forceSummary: send the summary now (used by the manual test route). Each run logs how many
// Eldorado requests it made (callLog), so rate-limit hits can be matched against the traffic.
export async function runAlerts(env, opts = {}) {
  try {
    return await runChecks(env, opts);
  } finally {
    const n = takeCalls();
    if (n) await logCalls(env, 'worker', n).catch(() => {});
  }
}

async function runChecks(env, { forceSummary = false } = {}) {
  // Paused after a rate limit (from these checks or the app): no Eldorado calls until it ends.
  const paused = await cooldown(env);
  if (paused) {
    await recordRun(env, [`paused until ${paused.until.slice(11, 16)} UTC after a rate limit (${paused.what}, ${paused.by})`]);
    return { ok: false, paused: paused.until };
  }

  let token;
  try {
    token = await cachedToken(env);
    await clearRateLimit(env, 'auth');
  } catch (err) {
    // Only a refusal (400 / 401 / 403) means bad credentials. A rate limit (429) is quiet unless it
    // lasts RATE_LIMIT_GRACE_HOURS; Eldorado being down or unreachable is reported as just that.
    // Either way the next run (5 minutes later) logs in again.
    if ([400, 401, 403].includes(err.status)) {
      await alertOnce(env, 'auth', `Eldorado rejected the API credentials (${err.message}). Sales alerts are paused until new credentials are set with \`wrangler secret put\`.`);
    } else {
      await reportProblem(env, 'auth', err, 'Could not log in to Eldorado (sales alerts are retried every 5 minutes).');
    }
    await recordRun(env, ['login: ' + err.message]);
    return { ok: false, error: 'auth: ' + err.message };
  }

  const problems = [];
  let page = null;
  try {
    page = await checkOrders(env, token);
    await clearRateLimit(env, 'orders');
  } catch (err) {
    problems.push('orders: ' + err.message);
    await reportProblem(env, 'orders', err, 'Could not check your Eldorado orders (sales / disputes).');
  }

  const local = localParts(env, new Date());

  // Order history for Stats / Reviews: at most one more request per run, never after a rate limit.
  if (page && !(await cooldown(env))) {
    try {
      await crawlHistory(env, token, page, local);
    } catch (err) {
      problems.push('history: ' + err.message);
      await reportProblem(env, 'history', err, 'Could not read your Eldorado order history (Stats / Reviews pages).');
    }
  }
  const summaryHour = Number(env.SUMMARY_HOUR || 21);
  const lastSummary = await env.STATE.get('summaryDay');
  const summaryDue = forceSummary || (local.hour >= summaryHour && lastSummary !== local.day);

  // Offer list: from KV unless it's an hour old or the summary is about to use it. A rate limit
  // earlier in this run means no more Eldorado calls (the summary waits for a later run too).
  let offers = [];
  let firstSeen = {};
  const cache = await env.STATE.get('offersCache', 'json');
  const limited = Boolean(await cooldown(env));
  if (limited) {
    offers = cache ? cache.offers : [];
  } else if (cache && !summaryDue && Date.now() - cache.at < OFFERS_EVERY) {
    offers = cache.offers;
  } else {
    try {
      offers = await getOffers(token); // whole offers: the app's Offers page shows them as they are
      firstSeen = await trackOffers(env, offers);
      await applyPriceDrops(env, token, offers, firstSeen);
      await warnExpiring(env, offers);
      await env.STATE.put('offersCache', JSON.stringify({ at: Date.now(), offers, full: true })); // full: whole offers (older copies were trimmed)
      await clearRateLimit(env, 'offers');
    } catch (err) {
      problems.push('offers: ' + err.message);
      await reportProblem(env, 'offers', err, 'Could not read your Eldorado offers (stock and stale listings in the summary).');
      if (cache) offers = cache.offers; // last known list is better than none
      // Back off: try again in 15 minutes rather than on every 5-minute run.
      await env.STATE.put('offersCache', JSON.stringify({ at: Date.now() - OFFERS_EVERY + 15 * 60 * 1000, offers: cache ? cache.offers : [], full: Boolean(cache && cache.full) }));
    }
  }
  if (!Object.keys(firstSeen).length) firstSeen = (await env.STATE.get('offers', 'json')) || {};

  const days = credentialDaysLeft(env);
  if (days !== null && days <= 7) {
    await alertOnce(env, 'expiry', days < 0
      ? 'Your Eldorado API credentials have expired. Generate new ones on the Seller API page.'
      : `Your Eldorado API credentials expire in ${days} day${days === 1 ? '' : 's'}. Generate new ones on the Seller API page and update ELDORADO_CREDS_EXPIRE.`);
  }

  if (summaryDue && !(await cooldown(env))) {
    try {
      await sendSummary(env, token, offers, firstSeen);
      if (!forceSummary) await env.STATE.put('summaryDay', local.day);
    } catch (err) {
      problems.push('summary: ' + err.message); // retried on the next run
    }
  }
  await recordRun(env, problems);
  return { ok: problems.length === 0, offers: offers.length, problems };
}

// When the checks last ran, for the app's setup check. Written at most every RUN_RECORD_MINUTES
// (or when the outcome or the first problem changes) to keep KV writes low.
const RUN_RECORD_MINUTES = 30;
async function recordRun(env, problems) {
  const last = await env.STATE.get('lastRun', 'json');
  const ok = problems.length === 0;
  const same = last && last.ok === ok && (last.problems || [])[0] === problems[0];
  if (same && Date.now() - Date.parse(last.at) < RUN_RECORD_MINUTES * 60 * 1000) return;
  await env.STATE.put('lastRun', JSON.stringify({ at: new Date().toISOString(), ok, problems: problems.slice(0, 5) }));
}

// The Worker's side of the app's setup check: when the checks last ran, credentials, which
// channels have a webhook (never the URLs), each PC's latest backup, and Eldorado requests: per
// source in the last hour, and in the 5 / 15 / 60 minutes before each rate-limit hit.
export async function health(env, backups) {
  const log = (await env.STATE.get('callLog', 'json')) || {};
  const now = new Date().toISOString();
  const hits = ((await env.STATE.get('rateLimits', 'json')) || []).map((h) => ({
    ...h,
    before: { m5: callsBefore(log, h.at, 5), m15: callsBefore(log, h.at, 15), m60: callsBefore(log, h.at, 60) }
  }));
  const history = await env.STATE.get('orderHistory', 'json');
  const crawl = await env.STATE.get('historyCrawl', 'json');
  return {
    ok: true,
    lastRun: await env.STATE.get('lastRun', 'json'),
    runEveryMinutes: 5,
    eldorado: Boolean(env.ELDORADO_CLIENT_ID && env.ELDORADO_CLIENT_SECRET),
    credsExpire: env.ELDORADO_CREDS_EXPIRE || null,
    credsDaysLeft: credentialDaysLeft(env),
    channels: CHANNELS.map((c) => ({ name: c.name, set: Boolean(env[c.key] || (c.alt && env[c.alt])), secret: c.key, fallback: c.fallback || null })),
    cooldown: await cooldown(env),
    rateLimits: hits,
    calls: { lastHour: callsBefore(log, now, 60), last24h: callsBefore(log, now, 24 * 60) },
    history: { orders: history ? history.orders.length : 0, at: history ? history.at : null, readingNow: crawl ? crawl.orders.length : null, max: HISTORY_MAX },
    backups
  };
}

// ---------- test posts: one sample message to each Worker webhook ----------
// only: send to that one channel (sales, completed, disputes, summary, errors, price-drops, reviews, expiring).
export async function sendTests(env, only) {
  const want = (name) => !only || only === name;
  const sample = {
    id: 'test-order-0000',
    state: { state: 'Paid' },
    createdDate: new Date().toISOString(),
    totalPrice: { amount: 49.99, currency: 'USD' },
    orderOfferDetails: { offerTitle: 'TEST 1007 Total Level HCIM' },
    latestDispute: { reason: 'Items_Missing_From_Account' }
  };
  const sent = [];
  if (want('sales') && env.DISCORD_WEBHOOK_SALES) {
    await post(env.DISCORD_WEBHOOK_SALES, { content: 'Test message, ignore.', embeds: [orderEmbed(sample, '💰 Sold', COLORS.sale, 'Hand over the account, then mark the order delivered.')] });
    sent.push('sales');
  }
  if (want('completed') && completedHook(env)) {
    await post(completedHook(env), { content: 'Test message, ignore.', embeds: [orderEmbed({ ...sample, state: { state: 'Completed' } }, '✅ Completed', COLORS.done, 'Funds released.')] });
    sent.push(env.DISCORD_WEBHOOK_COMPLETED ? 'completed' : 'completed (to #sales: DISCORD_WEBHOOK_COMPLETED not set)');
  }
  if (want('disputes') && disputesHook(env)) {
    await post(disputesHook(env), { content: 'Test message, ignore (a real dispute pings @here).', embeds: [orderEmbed({ ...sample, state: { state: 'Disputed' } }, '🚨 Dispute opened (Items Missing From Account)', COLORS.dispute, 'Reply on Eldorado.')] });
    sent.push(env.DISCORD_WEBHOOK_DISPUTES ? 'disputes' : 'disputes (to #sales: DISCORD_WEBHOOK_DISPUTES not set)');
  }
  if (want('summary') && env.DISCORD_WEBHOOK_SUMMARY) {
    await post(env.DISCORD_WEBHOOK_SUMMARY, { content: 'Test message, ignore.', embeds: [{ title: '📊 Daily summary (test)', color: COLORS.summary, fields: [
      { name: 'Listed (24h)', value: '3', inline: true }, { name: 'Sold (24h)', value: '2', inline: true }, { name: 'Revenue (24h)', value: '$95.00', inline: true },
      { name: 'In stock', value: '12 active · 1 paused' }, { name: 'Listed 14+ days, no sale (1)', value: '• Example account ($60.00, 16d)' }
    ], timestamp: new Date().toISOString() }] });
    sent.push('summary');
  }
  if (want('errors') && errorsHook(env)) {
    await post(errorsHook(env), { content: 'Test message, ignore.', embeds: [{ title: '⚠️ Error (test)', description: 'This is where credential and Eldorado problems from the 24/7 checks show up.', color: COLORS.alert }] });
    sent.push('errors');
  }
  if (want('price-drops') && priceDropsHook(env)) {
    await post(priceDropsHook(env), { content: 'Test message, ignore.', embeds: [{
      title: '📉 Price drop: TEST 1007 Total Level HCIM',
      color: COLORS.done,
      fields: [
        { name: 'Price', value: '$80.00 → **$76.00**', inline: true },
        { name: 'Listed', value: '14 days', inline: true },
        { name: 'Floor', value: '$60.00', inline: true }
      ],
      timestamp: new Date().toISOString()
    }] });
    sent.push(env.DISCORD_WEBHOOK_PRICE_DROPS ? 'price-drops' : 'price-drops (fallback: DISCORD_WEBHOOK_PRICE_DROPS not set)');
  }
  if (want('reviews') && reviewsHook(env)) {
    const review = { feedbackRating: 'Positive', feedbackTags: ['FastDelivery', 'AsDescribed'], reviewMessage: 'Smooth handover, thanks!', isReviewMessageVisible: true };
    await post(reviewsHook(env), { content: 'Test message, ignore (a negative review pings @here).', embeds: [reviewEmbed({ ...sample, review }, null)] });
    sent.push(env.DISCORD_WEBHOOK_REVIEWS ? 'reviews' : 'reviews (to #sales: DISCORD_WEBHOOK_REVIEWS not set)');
  }
  if (want('expiring') && expiringHook(env)) {
    // Your offers expiring within EXPIRY_WARN_DAYS right now (from the hourly offer list, no Eldorado
    // call, not marked as announced), or a sample when none are.
    const cache = await env.STATE.get('offersCache', 'json');
    const now = Date.now();
    const real = ((cache && cache.offers) || [])
      .filter((o) => o.offerState === 'Active' && o.expireDate)
      .map((o) => ({ o, left: (Date.parse(o.expireDate) - now) / DAY }))
      .filter(({ left }) => left <= EXPIRY_WARN_DAYS && left >= -1)
      .sort((a, b) => a.left - b.left);
    const embeds = real.length
      ? real.map(({ o, left }) => expiringEmbed(o, left))
      : [expiringEmbed({ id: 'test-offer-0000', offerTitle: 'TEST 1007 Total Level HCIM', pricePerUnit: { amount: 49.99, currency: 'USD' }, expireDate: new Date(now + DAY).toISOString() }, 1)];
    for (let i = 0; i < embeds.length; i += 10) { // Discord takes up to 10 embeds per message
      await post(expiringHook(env), {
        content: i ? undefined : (real.length ? `Test: your ${real.length} offer${real.length === 1 ? '' : 's'} expiring within ${EXPIRY_WARN_DAYS} days.` : 'Test message, ignore (no offers are expiring right now).'),
        embeds: embeds.slice(i, i + 10)
      });
    }
    sent.push((env.DISCORD_WEBHOOK_EXPIRING ? 'expiring' : 'expiring (to #errors: DISCORD_WEBHOOK_EXPIRING not set)') + ` (${real.length} real)`);
  }
  return { ok: true, sent };
}
