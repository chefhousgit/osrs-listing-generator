// Discord alerts from Eldorado, run by the Worker's cron trigger every 5 minutes (24/7).
//
//   #sales    new orders, cancellations, completed orders
//   #disputes disputes (@here); falls back to #sales if DISCORD_WEBHOOK_DISPUTES is not set
//   #summary  once a day at SUMMARY_HOUR in TIMEZONE: last 24h listed / sold / revenue, stock,
//             accounts listed STALE_DAYS+ days without a sale
//   #alerts   Eldorado rejecting the API credentials, credentials about to expire
//
// Secrets (wrangler secret put): ELDORADO_CLIENT_ID, ELDORADO_CLIENT_SECRET, DISCORD_WEBHOOK_SALES, DISCORD_WEBHOOK_DISPUTES,
// DISCORD_WEBHOOK_SUMMARY, DISCORD_WEBHOOK_ALERTS. Vars (wrangler.toml): TIMEZONE, SUMMARY_HOUR,
// ELDORADO_CREDS_EXPIRE (YYYY-MM-DD, optional). KV binding STATE remembers which orders were already
// announced and when each offer was first seen (Eldorado offers carry no creation date).
// Nothing here posts login details, keys or buyer information.

const ELDORADO = 'https://www.eldorado.gg';
const IMAGE_BASE = 'https://fileserviceusprod.blob.core.windows.net/offerimages/';
const STALE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

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

async function getJson(token, path) {
  const res = await fetch(ELDORADO + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 300);
    try { const j = JSON.parse(body); if (j.messages) detail = j.messages.join(' '); } catch (e) { /* not JSON */ }
    throw new Error(`GET ${path.split('?')[0]} failed (${res.status})${detail ? ': ' + detail : ''}`);
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
  await post(env.DISCORD_WEBHOOK_ALERTS, { embeds: [{ title: '⚠️ Listing alert', description: text, color: COLORS.alert }] });
  await env.STATE.put(flag, today, { expirationTtl: 2 * 24 * 3600 });
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
  const listed = offers.filter((o) => now - Date.parse(firstSeen[o.id]) < DAY);
  const stale = active
    .filter((o) => now - Date.parse(firstSeen[o.id]) > STALE_DAYS * DAY)
    .map((o) => `• ${(o.offerTitle || 'Account').slice(0, 60)} (${money(o.pricePerUnit)}, ${Math.floor((now - Date.parse(firstSeen[o.id])) / DAY)}d)`);

  const fields = [
    { name: 'Listed (24h)', value: String(listed.length), inline: true },
    { name: 'Sold (24h)', value: String(sold.length), inline: true },
    { name: 'Revenue (24h)', value: '$' + revenue.toFixed(2), inline: true },
    { name: 'In stock', value: `${active.length} active · ${paused.length} paused`, inline: false }
  ];
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
    token = await getToken(env);
  } catch (err) {
    await alertOnce(env, 'auth', `Eldorado rejected the API credentials (${err.message}). Sales alerts are paused until new credentials are set with \`wrangler secret put\`.`);
    return { ok: false, error: 'auth: ' + err.message };
  }

  const problems = [];
  try {
    await checkOrders(env, token);
  } catch (err) {
    problems.push('orders: ' + err.message);
    await alertOnce(env, 'orders', 'Could not check your Eldorado orders: ' + err.message);
  }
  let offers = [];
  let firstSeen = {};
  try {
    offers = await getOffers(token);
    firstSeen = await trackOffers(env, offers);
  } catch (err) {
    problems.push('offers: ' + err.message);
    await alertOnce(env, 'offers', 'Could not read your Eldorado offers (stock and stale listings in the summary): ' + err.message);
  }

  const days = credentialDaysLeft(env);
  if (days !== null && days <= 7) {
    await alertOnce(env, 'expiry', days < 0
      ? 'Your Eldorado API credentials have expired. Generate new ones on the Seller API page.'
      : `Your Eldorado API credentials expire in ${days} day${days === 1 ? '' : 's'}. Generate new ones on the Seller API page and update ELDORADO_CREDS_EXPIRE.`);
  }

  const local = localParts(env, new Date());
  const summaryHour = Number(env.SUMMARY_HOUR || 21);
  const lastSummary = await env.STATE.get('summaryDay');
  if (forceSummary || (local.hour >= summaryHour && lastSummary !== local.day)) {
    await sendSummary(env, token, offers, firstSeen);
    if (!forceSummary) await env.STATE.put('summaryDay', local.day);
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
  if (env.DISCORD_WEBHOOK_ALERTS) {
    await post(env.DISCORD_WEBHOOK_ALERTS, { content: 'Test message, ignore.', embeds: [{ title: '⚠️ Listing alert (test)', description: 'This is where credential and Eldorado problems from the 24/7 checks show up.', color: COLORS.alert }] });
    sent.push('alerts');
  }
  return { ok: true, sent };
}
