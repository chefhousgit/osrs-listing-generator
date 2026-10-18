// Offline checks for the two Eldorado writes never tried live: editing an offer's text
// (updateOfferText) and marking an order delivered (deliverOrder). Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeEldorado, validate, hasSwagger } = require('./helpers/fake-eldorado');
const fx = require('./helpers/fixtures');
const eldorado = require('../eldorado');

let fake;
function setup(opts) {
  if (fake) fake.restore();
  fake = createFakeEldorado(opts).install();
  return fake;
}
test.afterEach(() => { if (fake) fake.restore(); fake = null; });

const detailsPuts = () => fake.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/details'));

// ---------- updateOfferText ----------
test('edit text: changes only the title and description and reports no warnings', async () => {
  setup({ offers: [fx.offer()], secrets: { [fx.OFFER_ID]: [fx.structuredSecret()] } });
  const before = fake.state.offers.get(fx.OFFER_ID);

  const out = await eldorado.updateOfferText(fx.OFFER_ID, '  New title  ', 'New description');

  assert.deepEqual(out.warnings, []);
  assert.equal(out.offer.title, 'New title');
  assert.equal(out.offer.description, 'New description');
  assert.deepEqual(fake.rejected, [], 'the update body fits Eldorado\'s AccountOfferUpdatePrivateDTO');

  const after = fake.state.offers.get(fx.OFFER_ID);
  for (const key of ['pricePerUnit', 'guaranteedDeliveryTime', 'mainOfferImage', 'offerImages', 'quantity', 'hasOriginalEmail', 'attributes']) {
    assert.deepEqual(after[key], before[key], `${key} unchanged`);
  }
});

test('edit text: reads offer and delivery details, writes once, then reads both again', async () => {
  setup({ offers: [fx.offer()], secrets: { [fx.OFFER_ID]: [fx.structuredSecret()] } });
  await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');
  const id = encodeURIComponent(fx.OFFER_ID);
  assert.deepEqual(fake.calls.filter((c) => !c.path.includes('/authentication/')).map((c) => `${c.method} ${c.path}`), [
    `GET /api/flexibleOffers/${id}/private`,
    `GET /api/flexibleOffersUser/me/offers/${id}/secretDetails`,
    `PUT /api/flexibleOffers/account/${id}/details`,
    `GET /api/flexibleOffers/${id}/private`,
    `GET /api/flexibleOffersUser/me/offers/${id}/secretDetails`
  ]);
});

test('edit text: sends the delivery details back unchanged (structured, with their ids)', async () => {
  setup({ offers: [fx.offer()], secrets: { [fx.OFFER_ID]: [fx.structuredSecret()] } });
  await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');

  const body = detailsPuts()[0].body;
  const s = fx.structuredSecret();
  assert.deepEqual(body.accountDetails, []);
  assert.deepEqual(body.accountDeliveryDetails, [{ id: s.id, ...s.structuredDetails }]);
  assert.deepEqual(fake.state.secrets.get(fx.OFFER_ID).map((d) => d.structuredDetails), [s.structuredDetails]);
});

test('edit text: keeps legacy (old site-made) delivery details too', async () => {
  setup({ offers: [fx.offer()], secrets: { [fx.OFFER_ID]: [fx.legacySecret(), fx.structuredSecret()] } });
  const out = await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');

  const body = detailsPuts()[0].body;
  assert.deepEqual(body.accountDetails, [{ id: fx.LEGACY_SECRET_ID, secretDetails: 'old-login:old-password' }]);
  assert.equal(body.accountDeliveryDetails.length, 1);
  assert.deepEqual(out.warnings, []);
  assert.equal(fake.state.secrets.get(fx.OFFER_ID).length, 2);
});

test('edit text: an offer with no delivery details stays without them', async () => {
  setup({ offers: [fx.offer()] });
  const out = await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');
  const body = detailsPuts()[0].body;
  assert.deepEqual(body.accountDetails, []);
  assert.deepEqual(body.accountDeliveryDetails, []);
  assert.deepEqual(out.warnings, []);
});

test('edit text: sends attributes in the create format and keeps the build', async () => {
  setup({ offers: [fx.offer()] });
  await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');
  const game = detailsPuts()[0].body.augmentedGame;
  assert.deepEqual(game, {
    gameId: '10',
    category: 'Account',
    tradeEnvironmentId: '0',
    offerAttributes: [
      { id: 'osrs-account-type', type: 'Select', values: ['ironman'] },
      { id: 'osrs-total-level', type: 'Select', values: ['1000-1499'] },
      { id: 'osrs-combat-level', type: 'Select', values: ['combat-6979'] },
      { id: 'osrs-total-level-numeric', type: 'Numeric', value: 1234 }
    ]
  });
});

test('edit text: null volumeDiscounts / minQuantity from Eldorado become valid values', async () => {
  setup({ offers: [fx.offer({ volumeDiscounts: null, minQuantity: 0 })] });
  await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');
  const pricing = detailsPuts()[0].body.details.pricing;
  assert.deepEqual(pricing.volumeDiscounts, []);
  assert.equal(pricing.minQuantity, 1);
  assert.deepEqual(fake.rejected, []);
});

test('edit text: trims and caps the title (300) and description (5000)', async () => {
  setup({ offers: [fx.offer()] });
  await eldorado.updateOfferText(fx.OFFER_ID, 'x'.repeat(400), ' ' + 'y'.repeat(6000));
  const d = detailsPuts()[0].body.details;
  assert.equal(d.offerTitle.length, 300);
  assert.equal(d.description.length, 5000);
});

test('edit text: empty title or description is refused before any call', async () => {
  setup({ offers: [fx.offer()] });
  await assert.rejects(eldorado.updateOfferText(fx.OFFER_ID, '   ', 'D'), { status: 400, message: /Title and description/ });
  await assert.rejects(eldorado.updateOfferText(fx.OFFER_ID, 'T', undefined), { status: 400 });
  assert.equal(fake.calls.length, 0);
});

test('edit text: unknown offer fails with Eldorado\'s 404 and writes nothing', async () => {
  setup({ offers: [] });
  await assert.rejects(eldorado.updateOfferText('no-such-offer', 'T', 'D'), { status: 404 });
  assert.equal(detailsPuts().length, 0);
});

test('edit text: a rejected update surfaces Eldorado\'s message', async () => {
  // Eldorado refuses the body (e.g. a delivery time it no longer accepts).
  setup({ offers: [fx.offer({ guaranteedDeliveryTime: 'Day999' })] });
  await assert.rejects(eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D'), (err) => {
    assert.equal(err.status, hasSwagger ? 400 : err.status);
    if (hasSwagger) assert.match(err.message, /guaranteedDeliveryTime/);
    return true;
  });
});

// The read-back check: each way Eldorado could quietly change something becomes a warning.
for (const [quirk, pattern] of [
  ['ignoreTitle', /title did not change/],
  ['dropSecrets', /delivery details went from 1 to 0/],
  ['changePrice', /price changed/],
  ['changeAttributes', /offer fields/]
]) {
  test(`edit text: warns when Eldorado ${quirk}`, async () => {
    setup({ offers: [fx.offer()], secrets: { [fx.OFFER_ID]: [fx.structuredSecret()] }, quirks: { [quirk]: true } });
    const out = await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D');
    assert.equal(out.warnings.length, 1, out.warnings.join('; '));
    assert.match(out.warnings[0], pattern);
  });
}

test('edit text: error messages never contain the delivery login or password', async () => {
  setup({ offers: [fx.offer({ guaranteedDeliveryTime: 'Day999' })], secrets: { [fx.OFFER_ID]: [fx.structuredSecret()] } });
  const err = await eldorado.updateOfferText(fx.OFFER_ID, 'T', 'D').catch((e) => e);
  assert.ok(err instanceof Error);
  assert.doesNotMatch(err.message, /not-a-real-password|test-login@example\.test|TESTKEY/);
});

// ---------- deliverOrder ----------
test('mark delivered: PUTs to the v1 deliver endpoint with no body and the order becomes Delivered', async () => {
  setup({ orders: [fx.order()] });
  const out = await eldorado.deliverOrder(fx.ORDER_ID);

  const call = fake.calls.find((c) => c.method === 'PUT');
  assert.equal(call.path, `/api/v1/orders/me/${fx.ORDER_ID}/deliver`);
  assert.equal(call.body, undefined);
  assert.equal(out.state.state, 'Delivered');
  assert.equal(fake.state.orders.get(fx.ORDER_ID).state.state, 'Delivered');
});

test('mark delivered: an order that is not Paid fails with Eldorado\'s message', async () => {
  setup({ orders: [fx.order({ state: { state: 'Delivered' } })] });
  await assert.rejects(eldorado.deliverOrder(fx.ORDER_ID), { status: 400, message: /cannot be delivered/ });
});

test('mark delivered: unknown order fails with 404', async () => {
  setup({ orders: [] });
  await assert.rejects(eldorado.deliverOrder('nope'), { status: 404 });
});

test('mark delivered: order ids are URL-encoded', async () => {
  setup({ orders: [] });
  await eldorado.deliverOrder('a/b?c').catch(() => {});
  assert.equal(fake.calls.find((c) => c.method === 'PUT').path, '/api/v1/orders/me/a%2Fb%3Fc/deliver');
});

// ---------- the fake itself ----------
test('fake Eldorado: refuses requests to any other host', async () => {
  setup();
  await assert.rejects(fetch('https://discord.com/api/webhooks/x'), /blocked/);
});

test('fake Eldorado: the Swagger check catches unknown and missing fields', { skip: !hasSwagger && 'docs/eldorado-seller-swagger.json not on this PC' }, () => {
  const errors = validate({ details: { offerTitle: 'x', bogus: 1 }, augmentedGame: { gameId: '10' } }, 'AccountOfferUpdatePrivateDTO');
  assert.ok(errors.some((e) => /bogus is not a known field/.test(e)));
  assert.ok(errors.some((e) => /accountDetails is required/.test(e)));
  assert.ok(errors.some((e) => /category is required/.test(e)));
});

// ---------- buildAccountOffer: Pets Count ----------
// 2026-10-17: "Required attribute 'Pets Count' is not set" while the Pets select showed 0: the
// exact-number box was blank (no pet count read from the screenshots), so nothing was sent.
function offerInput(over = {}) {
  const attributes = Object.fromEntries(eldorado.OSRS.attributes.map((a) => [a.id, a.values[0].id]));
  return {
    title: 'T', description: 'D', price: '10', deliveryTime: eldorado.DELIVERY_TIMES.find((d) => d !== 'Instant'),
    build: eldorado.OSRS.tradeEnvironments[0].id,
    attributes: { ...attributes, ...(over.attributes || {}) },
    numeric: { 'osrs-total-level-numeric': '1007', ...(over.numeric || {}) }
  };
}
const numericValue = (offer, id) => {
  const a = offer.augmentedGame.offerAttributes.find((x) => x.id === id);
  return a ? a.value : undefined;
};

test('offer: a blank Pets Count takes the number picked in the Pets select (0)', () => {
  const offer = eldorado.buildAccountOffer(offerInput({ attributes: { 'osrs-pets': 'pets-0' }, numeric: { 'osrs-pets-count-numeric': '' } }));
  assert.equal(numericValue(offer, 'osrs-pets-count-numeric'), 0);
});

test('offer: a blank Pets Count takes a plain-number Pets pick (3)', () => {
  const offer = eldorado.buildAccountOffer(offerInput({ attributes: { 'osrs-pets': 'pets-3' } }));
  assert.equal(numericValue(offer, 'osrs-pets-count-numeric'), 3);
});

test('offer: a typed Pets Count wins over the Pets select', () => {
  const offer = eldorado.buildAccountOffer(offerInput({ attributes: { 'osrs-pets': 'pets-0' }, numeric: { 'osrs-pets-count-numeric': '2' } }));
  assert.equal(numericValue(offer, 'osrs-pets-count-numeric'), 2);
});
