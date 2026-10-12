// Eldorado.gg seller API client. Credentials come from .env and never leave this process
// except in the token request to Eldorado itself.
//
// Auth: POST /api/authentication/seller/token { clientId, clientSecret } -> { accessToken, expiresIn }.
// Tokens last 15 minutes; we cache one and refresh a minute before it runs out.
// There is no sandbox: every call here acts on the live account.

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

async function getToken() {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60 * 1000) return cachedToken.value;

  const res = await fetch(BASE_URL + '/api/authentication/seller/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.ELDORADO_CLIENT_ID,
      clientSecret: process.env.ELDORADO_CLIENT_SECRET
    })
  });
  const body = await readBody(res);
  if (!res.ok || !body || !body.accessToken) {
    cachedToken = null;
    throw new EldoradoError('Eldorado rejected the API credentials: ' + describeError(body), res.status, body);
  }
  cachedToken = { value: body.accessToken, expiresAt: Date.now() + (Number(body.expiresIn) || 900) * 1000 };
  return cachedToken.value;
}

async function api(method, apiPath, payload) {
  const token = await getToken();
  const res = await fetch(BASE_URL + apiPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = await readBody(res);
  if (res.status === 401) cachedToken = null;
  if (!res.ok) {
    throw new EldoradoError(`Eldorado ${method} ${apiPath} failed (${res.status}): ${describeError(body)}`, res.status, body);
  }
  return body;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

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
  const numbers = input.numeric || {};
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

// Create the offer, then pause it right away so it never sits live without images.
async function publishPausedAccountOffer(input) {
  const offer = buildAccountOffer(input);
  const created = await api('POST', '/api/flexibleOffers/account', offer);
  const offerId = created && created.id;
  if (!offerId) {
    throw new EldoradoError('Eldorado accepted the offer but returned no offer ID. Check your offers on the site.', 502, created);
  }

  try {
    await api('PUT', `/api/flexibleOffersUser/me/${encodeURIComponent(offerId)}/pause`);
    return { offerId, paused: true, withDelivery: offer.accountDeliveryDetails.length > 0 };
  } catch (err) {
    return { offerId, paused: false, pauseError: err.message, withDelivery: offer.accountDeliveryDetails.length > 0 };
  }
}

module.exports = {
  OSRS,
  DELIVERY_TIMES,
  EldoradoError,
  isConfigured,
  publishPausedAccountOffer
};
