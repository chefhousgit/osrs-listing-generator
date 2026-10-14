// Offline stand-in for Eldorado's seller API, for tests. It replaces global fetch, answers the
// calls the app makes from in-memory state shaped like docs/eldorado-seller-swagger.json, and
// refuses every other URL, so a test can never reach the live account (there is no sandbox).
//
// Request bodies are checked against the Swagger schemas when that (gitignored) file is present.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const BASE = 'https://www.eldorado.gg';
const TOKEN = 'fake-token';
const SWAGGER = path.join(__dirname, '..', '..', 'docs', 'eldorado-seller-swagger.json');
const schemas = fs.existsSync(SWAGGER) ? JSON.parse(fs.readFileSync(SWAGGER, 'utf8')).components.schemas : null;

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Swagger validation ----------
// Just enough of OpenAPI 3.0 for Eldorado's DTOs: $ref, type, nullable, enum, required,
// additionalProperties:false, uuid format.
function schemaByName(name) {
  const key = Object.keys(schemas).find((k) => k === name || k.endsWith('.' + name));
  if (!key) throw new Error('No Swagger schema named ' + name);
  return schemas[key];
}

// Swagger lists OfferAttributePrivateDTO with only an id: the real (polymorphic) shape is the one
// offer creation uses live, { id, type: 'Select', values: [optionId] } or { id, type: 'Numeric', value }.
function checkAttribute(a, at, errors) {
  if (!a || typeof a !== 'object') return errors.push(`${at} is not an object`);
  if (typeof a.id !== 'string' || !a.id) errors.push(`${at}.id is missing`);
  if (a.type === 'Select') {
    if (!Array.isArray(a.values) || !a.values.length || !a.values.every((v) => typeof v === 'string')) errors.push(`${at}.values must be option ids`);
  } else if (a.type === 'Numeric') {
    if (typeof a.value !== 'number') errors.push(`${at}.value must be a number`);
  } else {
    errors.push(`${at}.type must be Select or Numeric`);
  }
  return undefined;
}

function check(value, schema, at, errors) {
  if (schema.$ref) {
    // .NET binds null to an object reference; publishing sends empty email/2FA groups as null.
    if (value === null) return;
    const name = schema.$ref.split('/').pop();
    if (name.endsWith('.OfferAttributePrivateDTO')) return checkAttribute(value, at, errors);
    check(value, schemas[name], at, errors);
    return;
  }
  if (value === null) {
    if (!schema.nullable) errors.push(`${at} is null`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join('/')}`);
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return void errors.push(`${at} is not an object`);
      const props = schema.properties || {};
      for (const k of schema.required || []) if (value[k] === undefined) errors.push(`${at}.${k} is required`);
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        if (props[k]) check(v, props[k], `${at}.${k}`, errors);
        else if (schema.additionalProperties === false) errors.push(`${at}.${k} is not a known field`);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return void errors.push(`${at} is not an array`);
      value.forEach((v, i) => check(v, schema.items, `${at}[${i}]`, errors));
      break;
    case 'string':
      if (typeof value !== 'string') errors.push(`${at} is not a string`);
      else if (schema.format === 'uuid' && !UUID.test(value)) errors.push(`${at} is not a uuid`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${at} is not an integer`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${at} is not a number`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${at} is not a boolean`);
      break;
    default:
      break;
  }
}

// Errors for a body against a named Swagger schema; [] when it fits (or when Swagger is absent).
function validate(value, name) {
  if (!schemas) return [];
  const errors = [];
  check(value, schemaByName(name), 'body', errors);
  return errors;
}

// ---------- the fake API ----------
function json(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
const problem = (status, ...messages) => json(status, { code: 'Error', messages });

// Rebuild the response-side attribute list from what an update sent (ids only; names kept where known).
function attributesFrom(sent, before) {
  return (sent || []).map((a) => {
    const old = (before || []).find((b) => b.id === a.id) || {};
    if (a.type === 'Numeric') return { ...old, id: a.id, type: 'Numeric', value: a.value };
    const optionId = a.values[0];
    const name = old.value && old.value.id === optionId ? old.value.name : optionId;
    return { ...old, id: a.id, type: 'Select', value: { id: optionId, name } };
  });
}

// offers: FlexibleOfferPrivateDTO objects. secrets: { offerId: AccountDeliveryDetailsPrivateDTO[] }.
// orders: OrderGetSellerPrivateDTO objects. quirks simulate Eldorado misbehaving on the details
// update: ignoreTitle, dropSecrets, changePrice, changeAttributes.
function createFakeEldorado({ offers = [], secrets = {}, orders = [], quirks = {} } = {}) {
  const state = {
    offers: new Map(offers.map((o) => [o.id, clone(o)])),
    secrets: new Map(Object.entries(clone(secrets))),
    orders: new Map(orders.map((o) => [o.id, clone(o)]))
  };
  const calls = [];
  const rejected = []; // { path, errors } for bodies that failed the Swagger check

  function putDetails(id, body) {
    const before = state.offers.get(id);
    if (!before) return problem(404, 'Offer not found.');
    const errors = validate(body, 'AccountOfferUpdatePrivateDTO');
    if (errors.length) {
      rejected.push({ path: `PUT details ${id}`, errors });
      return problem(400, ...errors);
    }
    const d = body.details;
    const after = {
      ...before,
      offerTitle: quirks.ignoreTitle ? before.offerTitle : d.offerTitle,
      description: d.description,
      mainOfferImage: d.mainOfferImage,
      offerImages: d.offerImages,
      guaranteedDeliveryTime: d.guaranteedDeliveryTime,
      quantity: d.pricing.quantity,
      minQuantity: d.pricing.minQuantity,
      volumeDiscounts: d.pricing.volumeDiscounts,
      pricePerUnit: quirks.changePrice ? { ...d.pricing.pricePerUnit, amount: d.pricing.pricePerUnit.amount + 1 } : d.pricing.pricePerUnit,
      hasOriginalEmail: d.hasOriginalEmail,
      attributes: quirks.changeAttributes ? [] : attributesFrom(body.augmentedGame.offerAttributes, before.attributes),
      offerVersion: (before.offerVersion || 1) + 1
    };
    state.offers.set(id, after);
    // The update replaces the delivery details with exactly what was sent.
    const legacy = (body.accountDetails || []).map((x) => ({ id: x.id || randomUUID(), legacySecretDetails: x.secretDetails, structuredDetails: null }));
    const structured = (body.accountDeliveryDetails || []).map((x) => ({
      id: x.id || randomUUID(),
      legacySecretDetails: null,
      structuredDetails: { accountDetails: x.accountDetails, emailDetails: x.emailDetails, mfaDetails: x.mfaDetails, additionalInfo: x.additionalInfo }
    }));
    state.secrets.set(id, quirks.dropSecrets ? [] : [...legacy, ...structured]);
    return json(200, after);
  }

  function deliver(id) {
    const order = state.orders.get(id);
    if (!order) return problem(404, 'Order not found.');
    if (!order.state || order.state.state !== 'Paid') return problem(400, `Order in state ${order.state && order.state.state} cannot be delivered.`);
    order.state = { ...order.state, state: 'Delivered' };
    order.deliveryStartedDate = order.deliveryStartedDate || new Date().toISOString();
    return json(200, order);
  }

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const isJson = typeof init.body === 'string';
    const body = isJson ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, query: u.search, body });
    if (u.origin !== BASE) throw new Error(`fake-eldorado: blocked a request to ${u.origin} (tests never reach the network)`);

    const p = u.pathname;
    let m;
    if (method === 'POST' && p === '/api/authentication/seller/token') return json(200, { accessToken: TOKEN, expiresIn: 900 });
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    if (auth !== 'Bearer ' + TOKEN) return problem(401, 'Unauthorized');

    if (method === 'GET' && (m = p.match(/^\/api\/flexibleOffers\/([^/]+)\/private$/))) {
      const offer = state.offers.get(decodeURIComponent(m[1]));
      return offer ? json(200, { offer, user: null, userOrderInfo: null, deliveryTime: null }) : problem(404, 'Offer not found.');
    }
    if (method === 'GET' && (m = p.match(/^\/api\/flexibleOffersUser\/me\/offers\/([^/]+)\/secretDetails$/))) {
      const id = decodeURIComponent(m[1]);
      return state.offers.has(id) ? json(200, state.secrets.get(id) || []) : problem(403, 'Not your offer.');
    }
    if (method === 'PUT' && (m = p.match(/^\/api\/flexibleOffers\/account\/([^/]+)\/details$/))) return putDetails(decodeURIComponent(m[1]), body);
    if (method === 'PUT' && (m = p.match(/^\/api\/v1\/orders\/me\/([^/]+)\/deliver$/))) return deliver(decodeURIComponent(m[1]));
    if (method === 'GET' && p === '/api/v1/orders/me/seller/orders') {
      return json(200, { results: [...state.orders.values()], nextPageCursor: null });
    }

    return problem(501, `fake-eldorado has no route for ${method} ${p}`);
  }

  const original = globalThis.fetch;
  return {
    state,
    calls,
    rejected,
    fetch,
    install() { globalThis.fetch = fetch; return this; },
    restore() { globalThis.fetch = original; }
  };
}

module.exports = { createFakeEldorado, validate, hasSwagger: Boolean(schemas) };
