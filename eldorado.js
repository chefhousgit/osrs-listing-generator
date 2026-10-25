// Eldorado.gg seller API client. Credentials come from .env and never leave this process
// except in the token request to Eldorado itself.
//
// Auth: POST /api/authentication/seller/token { clientId, clientSecret } -> { accessToken, expiresIn }.
// Tokens last 15 minutes; we cache one and refresh a minute before it runs out. Normally the token
// comes from the Worker (shared with the 24/7 checks and the other PC, see "shared token" below).
// There is no sandbox: every call here acts on the live account.

const os = require('os');
const BASE_URL = 'https://www.eldorado.gg';
const OSRS = require('./data/eldorado-osrs.json');

// Delivery times offered in the publish dialog (subset of Eldorado's GuaranteedDeliveryTime enum).
const DELIVERY_TIMES = ['Instant', 'Minute20', 'Hour1', 'Hour5', 'Hour12', 'Day1'];

let cachedToken = null; // { value, expiresAt }

function isConfigured() {
  return Boolean(process.env.ELDORADO_CLIENT_ID && process.env.ELDORADO_CLIENT_SECRET);
}

class EldoradoError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function readBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return text;
  }
}

// Eldorado errors usually look like { code, messages: [...] }; fall back to the raw body.
function describeError(body) {
  if (body && Array.isArray(body.messages) && body.messages.length) return body.messages.join(' ');
  if (body && typeof body === 'object') return JSON.stringify(body).slice(0, 500);
  return String(body || '').slice(0, 500);
}

// ---------- shared token and rate limits (through the Worker, when PROXY_URL is set) ----------
// Eldorado doesn't publish its rate limit and every PC plus the 24/7 checks use the same account,
// so the app takes the Worker's login token instead of logging in itself, and after any 429
// "Quota exceeded" everything (this app, the other PC, the checks) pauses Eldorado calls for a
// while instead of retrying. Without a reachable Worker the app logs in on its own as before.
const COOLDOWN_MS = 15 * 60 * 1000;
let pausedUntil = 0;
let staleToken = null; // a token Eldorado refused (401), so the Worker hands out a fresh one

const hasWorker = () => Boolean(process.env.PROXY_URL && process.env.PROXY_SECRET);

async function workerCall(route, body) {
  const res = await fetch(process.env.PROXY_URL.replace(/\/+$/, '') + route, {
    method: 'POST',
    headers: { 'X-Proxy-Secret': process.env.PROXY_SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(10000)
  });
  return { status: res.status, ok: res.ok, body: await readBody(res) };
}

// ---------- request counts ----------
// Every request this app makes to Eldorado, per 5-minute block, sent to the Worker at most once a
// minute. Next to the Worker's own counts, they show how much traffic came before a rate limit.
const BLOCK_MS = 5 * 60 * 1000;
let unsent = {}; // { "YYYY-MM-DDTHH:MM": n }
let flushTimer = null;

function countCall() {
  const block = new Date(Math.floor(Date.now() / BLOCK_MS) * BLOCK_MS).toISOString().slice(0, 16);
  unsent[block] = (unsent[block] || 0) + 1;
  if (!hasWorker() || flushTimer) return;
  flushTimer = setTimeout(flushCalls, 60 * 1000);
  if (flushTimer.unref) flushTimer.unref();
}

async function flushCalls() {
  flushTimer = null;
  const counts = unsent;
  unsent = {};
  if (!Object.keys(counts).length || !hasWorker()) return;
  try {
    const r = await workerCall('/alerts/calls', { pc: os.hostname(), counts });
    if (!r.ok) throw new Error('status ' + r.status);
  } catch (e) {
    Object.entries(counts).forEach(([k, n]) => { unsent[k] = (unsent[k] || 0) + n; }); // try again later
  }
}

function pausedError() {
  const at = new Date(pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return new EldoradoError(`Eldorado is rate-limiting requests, so Eldorado calls are paused until ${at} (the 24/7 checks pause too). Try again then.`, 429);
}

// A 429 from Eldorado: pause here, and tell the Worker so the checks and the other PC pause too.
// res: the 429 response, for its Retry-After (seconds), if Eldorado sends one.
async function rateLimited(what, res) {
  const retryAfter = res ? Number(res.headers.get('retry-after')) || null : null;
  pausedUntil = Date.now() + Math.max(COOLDOWN_MS, (retryAfter || 0) * 1000);
  if (hasWorker()) {
    try {
      const r = await workerCall('/alerts/ratelimit', { what, pc: os.hostname(), retryAfter });
      if (r.ok && r.body && r.body.until) pausedUntil = Date.parse(r.body.until) || pausedUntil;
    } catch (e) { /* the pause here still holds */ }
  }
  return pausedError();
}

// The Worker's token: a string, or null to log in here (Worker not set up, unreachable or older).
async function tokenFromWorker() {
  let r;
  try {
    r = await workerCall('/alerts/token', { stale: staleToken || undefined, pc: os.hostname() });
  } catch (e) {
    return null;
  }
  if (r.status === 429) {
    pausedUntil = (r.body && Date.parse(r.body.until)) || Date.now() + COOLDOWN_MS;
    throw pausedError();
  }
  if (!r.ok || !r.body || !r.body.token) return null;
  staleToken = null;
  cachedToken = { value: r.body.token, expiresAt: Date.parse(r.body.expiresAt) || Date.now() + 5 * 60 * 1000 };
  return cachedToken.value;
}

async function getToken() {
  if (Date.now() < pausedUntil) throw pausedError();
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60 * 1000) return cachedToken.value;
  if (hasWorker()) {
    const shared = await tokenFromWorker();
    if (shared) return shared;
  }

  countCall();
  const res = await fetch(BASE_URL + '/api/authentication/seller/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.ELDORADO_CLIENT_ID,
      clientSecret: process.env.ELDORADO_CLIENT_SECRET
    })
  });
  const body = await readBody(res);
  if (res.status === 429) throw await rateLimited('login', res);
  if (!res.ok || !body || !body.accessToken) {
    cachedToken = null;
    throw new EldoradoError('Eldorado rejected the API credentials: ' + describeError(body), res.status, body);
  }
  cachedToken = { value: body.accessToken, expiresAt: Date.now() + (Number(body.expiresIn) || 900) * 1000 };
  return cachedToken.value;
}

// Eldorado refused this token: drop it and ask for a fresh one next time.
function refused(token) {
  cachedToken = null;
  staleToken = token;
}

async function api(method, apiPath, payload) {
  const token = await getToken();
  countCall();
  const res = await fetch(BASE_URL + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = await readBody(res);
  if (res.status === 401) refused(token);
  if (res.status === 429) throw await rateLimited(`${method} ${apiPath.split('?')[0]}`, res);
  if (!res.ok) {
    throw new EldoradoError(`Eldorado ${method} ${apiPath} failed (${res.status}): ${describeError(body)}`, res.status, body);
  }
  return body;
}

// Offer images. Not part of the documented seller API: this is the endpoint Eldorado's own
// sell form uses (multipart field "image"). It answers { localPaths: [small, large, original] }
// as "/offerimages/<file>", and offers reference the bare file names.
async function uploadOfferImage(file) {
  const token = await getToken();
  const form = new FormData();
  form.append('image', new Blob([file.buffer], { type: file.mimetype || 'image/png' }), file.originalname || 'main.png');
  countCall();
  const res = await fetch(BASE_URL + '/api/files/me/Offer', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });
  const body = await readBody(res);
  if (res.status === 401) refused(token);
  if (res.status === 429) throw await rateLimited('image upload', res);
  if (!res.ok) {
    throw new EldoradoError(`Eldorado image upload failed (${res.status}): ${describeError(body)}`, res.status, body);
  }
  const paths = body && Array.isArray(body.localPaths) ? body.localPaths.map((p) => String(p).replace(/^\/?offerimages\//, '')) : [];
  if (paths.length < 3) {
    throw new EldoradoError('Eldorado image upload returned an unexpected response: ' + describeError(body), 502, body);
  }
  return { smallImage: paths[0], largeImage: paths[1], originalSizeImage: paths[2] };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Exact-number attribute -> the select whose pick fills it when the number is left blank.
const NUMERIC_FROM_SELECT = { 'osrs-pets-count-numeric': 'osrs-pets' };

// Validate the publish form and turn it into an AccountOfferCreatePrivateDTO.
// Throws EldoradoError(400) with a readable message on bad input.
function buildAccountOffer(input) {
  const bad = (msg) => { throw new EldoradoError(msg, 400); };

  const title = str(input.title, 300);
  const description = str(input.description, 5000);
  if (!title) bad('Title is required.');
  if (!description) bad('Description is required.');

  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) bad('Price must be a number above 0.');

  const deliveryTime = DELIVERY_TIMES.includes(input.deliveryTime) ? input.deliveryTime : null;
  if (!deliveryTime) bad('Pick a delivery time.');

  const build = OSRS.tradeEnvironments.find((t) => t.id === String(input.build));
  if (!build) bad('Pick an account build.');

  // Same shape Eldorado's own sell form sends: the attribute id, with the chosen option(s)
  // in `values` for selects and the exact number in `value` for numerics.
  const chosen = input.attributes || {};
  const offerAttributes = OSRS.attributes.map((attr) => {
    const value = attr.values.find((v) => v.id === chosen[attr.id]);
    if (!value) bad(`Pick a value for ${attr.name}.`);
    return { id: attr.id, type: 'Select', values: [value.id] };
  });
  const numbers = { ...(input.numeric || {}) };
  // A blank exact number falls back to its select when that pick is a plain number: the Pets
  // select defaults to 0 when no pet count is read, but Eldorado requires Pets Count itself.
  Object.entries(NUMERIC_FROM_SELECT).forEach(([numId, selectId]) => {
    const raw = numbers[numId];
    if (raw !== undefined && raw !== null && raw !== '') return;
    const attr = OSRS.attributes.find((a) => a.id === selectId);
    const picked = attr && attr.values.find((v) => v.id === chosen[selectId]);
    if (picked && /^\d+$/.test(picked.name.trim())) numbers[numId] = picked.name.trim();
  });
  OSRS.numericAttributes.forEach((attr) => {
    const raw = numbers[attr.id];
    if (raw === undefined || raw === null || raw === '') return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < attr.min || n > attr.max) bad(`${attr.name} must be a whole number from ${attr.min} to ${attr.max}.`);
    offerAttributes.push({ id: attr.id, type: 'Numeric', value: n });
  });

  const d = input.delivery || {};
  const delivery = {
    accountLogin: str(d.accountLogin, 300),
    accountPassword: str(d.accountPassword, 300),
    emailLogin: str(d.emailLogin, 300),
    emailPassword: str(d.emailPassword, 300),
    emailProviderUrl: str(d.emailProviderUrl, 300),
    additionalInfo: str(d.additionalInfo, 3000)
  };
  // Additional info alone (it starts as the handover template) doesn't count as delivery details.
  const hasDelivery = Boolean(delivery.accountLogin || delivery.accountPassword || delivery.emailLogin || delivery.emailPassword);
  if (hasDelivery && (!delivery.accountLogin || !delivery.accountPassword)) {
    bad('Account login and password are both needed when adding delivery details.');
  }
  // Eldorado treats Instant as automatic delivery and refuses it without the account details.
  if (deliveryTime === 'Instant' && !hasDelivery) {
    bad('Instant delivery needs the account login and password. Fill them in, or pick a manual delivery time (20 minutes or longer).');
  }

  return {
    details: {
      offerTitle: title,
      description,
      guaranteedDeliveryTime: deliveryTime,
      pricing: {
        quantity: 1,
        minQuantity: 1,
        pricePerUnit: { amount: Math.round(price * 100) / 100, currency: 'USD' }
      },
      hasOriginalEmail: Boolean(input.hasOriginalEmail)
    },
    augmentedGame: {
      gameId: OSRS.gameId,
      category: OSRS.category,
      tradeEnvironmentId: build.id,
      offerAttributes
    },
    accountSecretDetails: [],
    // Mirrors Eldorado's sell form: a details group is null when all its fields are empty,
    // otherwise every field is a string ("" for blanks).
    accountDeliveryDetails: hasDelivery
      ? [{
          id: null,
          accountDetails: { accountLogin: delivery.accountLogin, accountPassword: delivery.accountPassword },
          emailDetails: delivery.emailProviderUrl || delivery.emailLogin || delivery.emailPassword
            ? { emailProviderUrl: delivery.emailProviderUrl, emailLogin: delivery.emailLogin, emailPassword: delivery.emailPassword }
            : null,
          mfaDetails: null,
          additionalInfo: delivery.additionalInfo || null
        }]
      : []
  };
}

// Upload the main image and any extra images, create the offer with them, then pause the offer
// right away so it can be checked on Eldorado before going live.
async function publishPausedAccountOffer(input, mainImage, extraImages = []) {
  const offer = buildAccountOffer(input);
  if (!mainImage || !mainImage.buffer || !mainImage.buffer.length) {
    throw new EldoradoError('Eldorado needs a main image. Pick one in the dialog.', 400);
  }
  offer.details.mainOfferImage = await uploadOfferImage(mainImage);
  offer.details.offerImages = [];
  for (const file of extraImages) offer.details.offerImages.push(await uploadOfferImage(file));
  const created = await api('POST', '/api/flexibleOffers/account', offer);
  const offerId = created && created.id;
  if (!offerId) {
    throw new EldoradoError('Eldorado accepted the offer but returned no offer ID. Check your offers on the site.', 502, created);
  }
  // A new offer: the Offers page re-reads the list once instead of showing the copy without it.
  await tellWorker('/alerts/offers/update', { stale: true });

  try {
    await api('PUT', `/api/flexibleOffersUser/me/${encodeURIComponent(offerId)}/pause`);
    return { offerId, paused: true, withDelivery: offer.accountDeliveryDetails.length > 0 };
  } catch (err) {
    return { offerId, paused: false, pauseError: err.message, withDelivery: offer.accountDeliveryDetails.length > 0 };
  }
}

// ---------- offers manager ----------
const IMAGE_BASE = 'https://fileserviceusprod.blob.core.windows.net/offerimages/';
const enc = encodeURIComponent;

// Exact total level when it fits the bracket; offers made on the site often carry the placeholder
// minimum (32) as the exact value, so then the bracket (e.g. 1000-1499) is shown instead.
function totalLevel(numeric, select) {
  const bracket = select && select.value ? select.value.name : '';
  const n = numeric && typeof numeric.value === 'number' ? numeric.value : null;
  const m = bracket.match(/^(\d+)\s*-\s*(\d+)$/);
  if (n !== null && (!m || (n >= Number(m[1]) && n <= Number(m[2])))) return n;
  return bracket;
}

function summarizeOffer(o) {
  const attr = (id) => (o.attributes || []).find((a) => a.id === id);
  const type = attr('osrs-account-type');
  const totalNum = attr('osrs-total-level-numeric');
  const totalSel = attr('osrs-total-level');
  const img = o.mainOfferImage || {};
  return {
    id: o.id,
    title: o.offerTitle || '',
    description: o.description || '',
    state: o.offerState,
    price: o.pricePerUnit ? o.pricePerUnit.amount : null,
    currency: o.pricePerUnit ? o.pricePerUnit.currency : 'USD',
    delivery: o.guaranteedDeliveryTime,
    type: type && type.value ? type.value.name : '',
    total: totalLevel(totalNum, totalSel),
    image: img.smallImage ? IMAGE_BASE + img.smallImage : null,
    imageLarge: img.largeImage ? IMAGE_BASE + img.largeImage : null,
    expires: o.expireDate || null,
    // for the market check: same type + bracket, near this total
    typeId: type && type.value ? type.value.id : null,
    bracketId: totalSel && totalSel.value ? totalSel.value.id : null,
    combatId: attr('osrs-combat-level') && attr('osrs-combat-level').value ? attr('osrs-combat-level').value.id : null,
    totalExact: typeof totalLevel(totalNum, totalSel) === 'number' ? totalLevel(totalNum, totalSel) : null,
    userId: o.userId || null
  };
}

// ---------- the Worker's copies of what its checks read ----------
// The 24/7 checks already read your orders (every 5 minutes), order history (nightly) and offers
// (hourly) and keep them (worker/snapshots.js). Pages show those instead of reading Eldorado again;
// Eldorado is read here only when the Worker isn't reachable, its copy is too old, or you ask
// (Refresh on the Offers page). Changes made here are passed on so the copies show them at once.
const ORDERS_FRESH_MS = 40 * 60 * 1000; // the checks record a run at least every 30 minutes
const OFFERS_FRESH_MS = 70 * 60 * 1000; // the checks re-read offers hourly
const sources = { offers: null, orders: null, history: null }; // where each list last came from

async function fromWorker(route) {
  if (!hasWorker()) return null;
  try {
    const r = await workerCall(route);
    return r.ok && r.body && typeof r.body === 'object' ? r.body : null;
  } catch (e) {
    return null;
  }
}

async function tellWorker(route, body) {
  if (!hasWorker()) return;
  try { await workerCall(route, body); } catch (e) { /* the next check catches up */ }
}

// The order copy is good when the checks ran lately and their order check (or login) didn't fail.
// While paused after a rate limit it is still the latest there is.
function ordersFresh(snap) {
  if (!snap || !Array.isArray(snap.orders) || !snap.lastRun) return false;
  if (Date.now() - Date.parse(snap.lastRun.at) > ORDERS_FRESH_MS) return false;
  return !(snap.lastRun.problems || []).some((p) => /^(orders|login):/.test(p));
}

// Every account offer (active and paused). From the Worker's copy unless live (or no usable copy),
// in which case all pages are read and the fresh list goes to the Worker.
async function listOffers({ live = false } = {}) {
  if (!live) {
    const snap = await fromWorker('/alerts/offers');
    if (snap && Array.isArray(snap.offers) && !snap.stale && Date.now() - Number(snap.at) < OFFERS_FRESH_MS) {
      sources.offers = { from: 'worker', at: new Date(Number(snap.at)).toISOString() };
      return snap.offers.map(summarizeOffer);
    }
  }
  const base = '/api/flexibleOffers/me/search?category=Account&pageSize=50';
  const first = await api('GET', base);
  const all = [...(first.results || [])];
  const start = Number(first.pageIndex) || 0;
  for (let n = 1; n < Math.min(Number(first.totalPages) || 1, 20); n++) {
    const page = await api('GET', `${base}&pageIndex=${start + n}`);
    all.push(...(page.results || []));
  }
  sources.offers = { from: 'eldorado', at: new Date().toISOString() };
  await tellWorker('/alerts/offers/update', { offers: all });
  return all.map(summarizeOffer);
}

async function changePrice(id, amount) {
  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0) throw new EldoradoError('Price must be a number above 0.', 400);
  await api('PUT', `/api/flexibleOffersUser/me/${enc(id)}/changePrice`, { amount: value, currency: 'USD' });
  await tellWorker('/alerts/offers/update', { patch: { id, pricePerUnit: { amount: value, currency: 'USD' } } });
  return { price: value };
}

async function setOfferState(id, action, state) {
  const out = await api('PUT', `/api/flexibleOffersUser/me/${enc(id)}/${action}`);
  await tellWorker('/alerts/offers/update', { patch: { id, offerState: state } });
  return out;
}
const pauseOffer = (id) => setOfferState(id, 'pause', 'Paused');
const resumeOffer = (id) => setOfferState(id, 'resume', 'Active');

async function deleteOffer(id) {
  const out = await api('DELETE', `/api/flexibleOffersUser/me/${enc(id)}`);
  await tellWorker('/alerts/offers/update', { remove: id });
  return out;
}

// The attribute list in the shape the update / create requests take.
function attributesForUpdate(attributes) {
  return (attributes || []).map((a) => (a.type === 'Numeric'
    ? { id: a.id, type: 'Numeric', value: a.value }
    : { id: a.id, type: 'Select', values: a.value && a.value.id ? [a.value.id] : (a.values || []).map((v) => v.id) }));
}

// Eldorado's details update replaces the whole offer, so read everything first (offer, delivery
// details), change only the title / description, send the rest back as it was, then read it again
// to confirm nothing else changed. Delivery details only pass through this process in memory.
async function updateOfferText(id, title, description) {
  title = str(title, 300);
  description = str(description, 5000);
  if (!title || !description) throw new EldoradoError('Title and description are both required.', 400);

  const before = (await api('GET', `/api/flexibleOffers/${enc(id)}/private`)).offer;
  const secrets = (await api('GET', `/api/flexibleOffersUser/me/offers/${enc(id)}/secretDetails`)) || [];
  const tradeEnv = (before.tradeEnvironmentValues || [])[0];

  const update = {
    details: {
      offerTitle: title,
      description,
      mainOfferImage: before.mainOfferImage,
      offerImages: before.offerImages || [],
      guaranteedDeliveryTime: before.guaranteedDeliveryTime,
      pricing: {
        quantity: before.quantity,
        minQuantity: before.minQuantity || 1,
        volumeDiscounts: before.volumeDiscounts || [],
        pricePerUnit: before.pricePerUnit
      },
      hasOriginalEmail: before.hasOriginalEmail
    },
    augmentedGame: {
      gameId: before.gameId,
      category: before.category,
      tradeEnvironmentId: tradeEnv ? tradeEnv.id : null,
      offerAttributes: attributesForUpdate(before.attributes)
    },
    accountDetails: secrets.filter((d) => d.legacySecretDetails).map((d) => ({ id: d.id, secretDetails: d.legacySecretDetails })),
    accountDeliveryDetails: secrets.filter((d) => d.structuredDetails).map((d) => ({
      id: d.id,
      accountDetails: d.structuredDetails.accountDetails,
      emailDetails: d.structuredDetails.emailDetails || null,
      mfaDetails: d.structuredDetails.mfaDetails || null,
      additionalInfo: d.structuredDetails.additionalInfo || null
    }))
  };
  await api('PUT', `/api/flexibleOffers/account/${enc(id)}/details`, update);

  // Check what Eldorado now holds.
  const after = (await api('GET', `/api/flexibleOffers/${enc(id)}/private`)).offer;
  const secretsAfter = (await api('GET', `/api/flexibleOffersUser/me/offers/${enc(id)}/secretDetails`)) || [];
  const warnings = [];
  if (after.offerTitle !== title) warnings.push('the title did not change');
  if ((after.description || '') !== description) warnings.push('the description did not change');
  if (JSON.stringify(attributesForUpdate(after.attributes)) !== JSON.stringify(attributesForUpdate(before.attributes))) warnings.push('the offer fields (type, levels...) changed');
  if (secretsAfter.length !== secrets.length) warnings.push(`delivery details went from ${secrets.length} to ${secretsAfter.length}`);
  if (after.pricePerUnit && before.pricePerUnit && after.pricePerUnit.amount !== before.pricePerUnit.amount) warnings.push('the price changed');
  await tellWorker('/alerts/offers/update', { replace: after });
  return { offer: summarizeOffer(after), warnings };
}

// ---------- orders ----------
function summarizeOrder(o) {
  const offer = o.orderOfferDetails || {};
  const img = offer.mainOfferImage || {};
  return {
    id: o.id,
    offerId: o.offerId,
    title: offer.offerTitle || '',
    category: offer.category || null,
    price: o.totalPrice ? o.totalPrice.amount : null,
    currency: o.totalPrice ? o.totalPrice.currency : 'USD',
    state: o.state ? o.state.state : null,
    createdDate: o.createdDate,
    image: img.smallImage ? IMAGE_BASE + img.smallImage : null,
    delivery: offer.guaranteedDeliveryTime || null
  };
}

// Your latest 50 sales (newest first): the Worker's copy (at most 5 minutes old) unless live or
// there's no usable copy.
async function listOrders({ live = false } = {}) {
  if (!live) {
    const snap = await fromWorker('/alerts/orders');
    if (ordersFresh(snap)) {
      sources.orders = { from: 'worker', at: snap.lastRun.at };
      return snap.orders.map(summarizeOrder);
    }
  }
  const d = await api('GET', '/api/v1/orders/me/seller/orders?displayFilter=DisplaySellingOrders&isAscendingDateOrder=false&pageSize=50');
  sources.orders = { from: 'eldorado', at: new Date().toISOString() };
  return (d.results || []).map(summarizeOrder);
}

// One order of the sales history, with account type, total-level bracket and the buyer's review.
function historyEntry(o) {
  const attrs = (o.orderOfferDetails && o.orderOfferDetails.offerAttributesProperties) || [];
  const attr = (id) => attrs.find((a) => a.attributeId === id);
  const type = attr('osrs-account-type');
  const bracket = attr('osrs-total-level');
  const r = o.review;
  return {
    ...summarizeOrder(o),
    type: type ? (type.values || [])[0] || type.id : null,
    bracket: bracket ? (bracket.values || [])[0] || bracket.id : null,
    // Buyer feedback (no buyer name): rating Positive / Negative, null when not reviewed yet.
    review: r && r.feedbackRating && r.feedbackRating !== 'Unrated'
      ? {
          rating: r.feedbackRating,
          tags: r.feedbackTags || [],
          message: r.reviewMessage || '',
          hidden: r.isReviewMessageVisible === false,
          changed: typeof r.wasInitialRatingPositive === 'boolean' && r.wasInitialRatingPositive !== (r.feedbackRating === 'Positive')
        }
      : null
  };
}

// Sales history for the Stats / Reviews pages, newest first (up to max orders). From the Worker's
// copy; while its first read is still going, its latest page. Read from Eldorado (every page,
// following the cursor) only without a reachable, up-to-date Worker.
async function listAllOrders(max = 500) {
  const snap = await fromWorker('/alerts/history');
  if (snap && Array.isArray(snap.orders)) {
    sources.history = { from: 'worker', at: snap.at, partial: false };
    return snap.orders.slice(0, max).map(historyEntry);
  }
  if (snap) {
    const latest = await fromWorker('/alerts/orders');
    if (latest && Array.isArray(latest.orders)) {
      sources.history = { from: 'worker', at: latest.at, partial: true, readingNow: snap.readingNow };
      return latest.orders.map(historyEntry);
    }
  }
  const base = '/api/v1/orders/me/seller/orders?displayFilter=DisplaySellingOrders&isAscendingDateOrder=false&pageSize=50';
  const all = [];
  let cursor = null;
  while (all.length < max) {
    const d = await api('GET', base + (cursor ? '&cursorValue=' + enc(cursor) : ''));
    all.push(...(d.results || []));
    if (!d.nextPageCursor || !(d.results || []).length || d.nextPageCursor === cursor) break;
    cursor = d.nextPageCursor;
  }
  sources.history = { from: 'eldorado', at: new Date().toISOString(), partial: false };
  return all.map(historyEntry);
}

async function deliverOrder(id) {
  const out = await api('PUT', `/api/v1/orders/me/${enc(id)}/deliver`);
  await tellWorker('/alerts/orders/update', { id, state: 'Delivered' });
  return out;
}

module.exports = {
  listOrders,
  listAllOrders,
  deliverOrder,
  OSRS,
  DELIVERY_TIMES,
  EldoradoError,
  isConfigured,
  publishPausedAccountOffer,
  buildAccountOffer,
  listOffers,
  changePrice,
  pauseOffer,
  resumeOffer,
  deleteOffer,
  updateOfferText,
  dataSources: () => ({ ...sources }),
  flushCalls
};
