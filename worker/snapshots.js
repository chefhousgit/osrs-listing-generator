// What the 24/7 checks already read from Eldorado, kept in KV so the app shows it instead of
// asking Eldorado again (the account's rate limit is shared by the checks and both PCs):
//
//   ordersLatest  your latest 50 orders (every check; written only when something changed)
//   orderHistory  up to HISTORY_MAX orders for Stats / Reviews: new orders merged in by every
//                 check, the whole list re-read once a night one page per check (alerts.js)
//   offersCache   every account offer (hourly, alerts.js), patched by the app after its changes
//   callLog       Eldorado requests per 5-minute block (checks and each PC), last 24 hours,
//                 to learn the rate limit: shown next to each hit in the app's setup check
//
// Orders are slimmed to what the app uses (no buyer names, no chat details).

export const HISTORY_MAX = 500;
const BLOCK = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function slimOrder(o) {
  const d = o.orderOfferDetails || {};
  return {
    id: o.id,
    offerId: o.offerId,
    totalPrice: o.totalPrice || null,
    state: o.state ? { state: o.state.state } : null,
    createdDate: o.createdDate,
    orderOfferDetails: {
      offerTitle: d.offerTitle,
      category: d.category,
      mainOfferImage: d.mainOfferImage || null,
      guaranteedDeliveryTime: d.guaranteedDeliveryTime || null,
      offerAttributesProperties: d.offerAttributesProperties || []
    },
    review: o.review || null
  };
}

// Newest first, one entry per order (entries in `fresh` win), at most HISTORY_MAX.
export function mergeOrders(fresh, older) {
  const byId = new Map();
  [...fresh, ...older].forEach((o) => { if (!byId.has(o.id)) byId.set(o.id, o); });
  return [...byId.values()]
    .sort((a, b) => (Date.parse(b.createdDate) || 0) - (Date.parse(a.createdDate) || 0))
    .slice(0, HISTORY_MAX);
}

// After each order check: keep the latest page, and merge it into the history if there is one.
export async function saveOrders(env, rawOrders) {
  const latest = rawOrders.map(slimOrder);
  const now = new Date().toISOString();
  const prev = await env.STATE.get('ordersLatest', 'json');
  if (!prev || JSON.stringify(prev.orders) !== JSON.stringify(latest)) {
    await env.STATE.put('ordersLatest', JSON.stringify({ at: now, orders: latest }));
  }
  const hist = await env.STATE.get('orderHistory', 'json');
  if (hist) {
    const merged = mergeOrders(latest, hist.orders);
    if (JSON.stringify(merged) !== JSON.stringify(hist.orders)) {
      await env.STATE.put('orderHistory', JSON.stringify({ ...hist, at: now, orders: merged }));
    }
  }
}

// The app changed an order (marked it delivered): show that before the next check sees it.
export async function updateOrder(env, { id, state }) {
  if (!id || !state) return { ok: false, status: 400 };
  for (const key of ['ordersLatest', 'orderHistory']) {
    const snap = await env.STATE.get(key, 'json');
    const hit = snap && snap.orders.find((o) => o.id === id);
    if (hit) {
      hit.state = { state };
      await env.STATE.put(key, JSON.stringify(snap));
    }
  }
  return { ok: true };
}

// The app's changes to offers: { offers } a fresh full list it fetched itself, { replace } one offer
// as Eldorado returned it, { patch: { id, ...fields } }, { remove: id }, or { stale: true } (an offer
// was created: the app re-reads the list on its next load).
export async function updateOffers(env, body) {
  const cache = (await env.STATE.get('offersCache', 'json')) || { at: 0, offers: [] };
  if (Array.isArray(body.offers)) {
    cache.offers = body.offers;
    cache.at = Date.now();
    cache.stale = false;
  } else if (body.replace && body.replace.id) {
    const i = cache.offers.findIndex((o) => o.id === body.replace.id);
    if (i >= 0) cache.offers[i] = body.replace; else cache.offers.push(body.replace);
  } else if (body.patch && body.patch.id) {
    const hit = cache.offers.find((o) => o.id === body.patch.id);
    if (hit) Object.assign(hit, body.patch);
  } else if (body.remove) {
    cache.offers = cache.offers.filter((o) => o.id !== body.remove);
  } else if (body.stale) {
    cache.stale = true;
  } else {
    return { ok: false, status: 400 };
  }
  await env.STATE.put('offersCache', JSON.stringify(cache));
  return { ok: true };
}

// ---------- request counts ----------
const blockOf = (t) => new Date(Math.floor(t / BLOCK) * BLOCK).toISOString().slice(0, 16);

// Add requests to the 5-minute blocks: counts = { [blockStart]: n } (or a number for the current block).
export async function logCalls(env, by, counts) {
  const entries = typeof counts === 'number' ? [[blockOf(Date.now()), counts]] : Object.entries(counts || {});
  const add = entries.filter(([k, n]) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(k) && Number(n) > 0);
  if (!add.length) return { ok: true };
  const who = String(by || '?').slice(0, 40);
  const log = (await env.STATE.get('callLog', 'json')) || {};
  add.forEach(([k, n]) => {
    log[k] = log[k] || {};
    log[k][who] = (log[k][who] || 0) + Math.min(Number(n), 1000);
  });
  const cutoff = blockOf(Date.now() - DAY);
  Object.keys(log).forEach((k) => { if (k < cutoff) delete log[k]; });
  await env.STATE.put('callLog', JSON.stringify(log));
  return { ok: true };
}

// Requests per source in the `minutes` before `at` (whole 5-minute blocks, including at's own).
export function callsBefore(log, at, minutes) {
  const t = Date.parse(at);
  const from = blockOf(t - minutes * 60 * 1000 + BLOCK);
  const to = blockOf(t);
  const out = {};
  Object.entries(log || {}).forEach(([k, bySource]) => {
    if (k < from || k > to) return;
    Object.entries(bySource).forEach(([who, n]) => { out[who] = (out[who] || 0) + n; });
  });
  return out;
}
