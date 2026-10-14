// Made-up Eldorado records in the shapes the API returns. No real ids or logins.

const OFFER_ID = '7d3c1a52-0f4e-4b8e-9a51-2c6f0e8b1d01';
const ORDER_ID = '1b9e7f20-4c3d-4e5f-8a6b-7c8d9e0f1a2b';
const SECRET_ID = 'c0ffee00-1234-4abc-8def-0123456789ab';
const LEGACY_SECRET_ID = 'deadbeef-5678-4abc-8def-0123456789ab';

function offer(overrides = {}) {
  return {
    id: OFFER_ID,
    userId: 'seller-1',
    gameId: '10',
    category: 'Account',
    quantity: 1,
    minQuantity: 1,
    volumeDiscounts: null,
    pricePerUnit: { amount: 24.99, currency: 'USD' },
    guaranteedDeliveryTime: 'Minute20',
    expireDate: '2026-11-04T10:00:00Z',
    offerState: 'Paused',
    offerVersion: 3,
    description: 'Old description',
    tradeEnvironmentValues: [{ id: '0', name: 'Build', value: 'Main', attributeId: null, imageLocation: null }],
    attributes: [
      { id: 'osrs-account-type', name: 'Type', type: 'Select', value: { id: 'ironman', name: 'Ironman' } },
      { id: 'osrs-total-level', name: 'Total Level', type: 'Select', value: { id: '1000-1499', name: '1000-1499' } },
      { id: 'osrs-combat-level', name: 'Combat Level', type: 'Select', value: { id: 'combat-6979', name: '69-79' } },
      { id: 'osrs-total-level-numeric', name: 'Total Level (exact)', type: 'Numeric', value: 1234 }
    ],
    offerTitle: 'Old title',
    mainOfferImage: { smallImage: 'main-s.png', largeImage: 'main-l.png', originalSizeImage: 'main-o.png' },
    offerImages: [{ smallImage: 'bank-s.png', largeImage: 'bank-l.png', originalSizeImage: 'bank-o.png' }],
    hasOriginalEmail: false,
    marketValue: null,
    ...overrides
  };
}

const structuredSecret = () => ({
  id: SECRET_ID,
  secretDetails: null,
  legacySecretDetails: null,
  structuredDetails: {
    accountDetails: { accountLogin: 'test-login@example.test', accountPassword: 'not-a-real-password' },
    emailDetails: null,
    mfaDetails: { mfaLogin: 'TESTKEY234567ABC', mfaPassword: '' },
    additionalInfo: 'Handover notes'
  }
});

const legacySecret = () => ({
  id: LEGACY_SECRET_ID,
  secretDetails: null,
  legacySecretDetails: 'old-login:old-password',
  structuredDetails: null
});

function order(overrides = {}) {
  return {
    id: ORDER_ID,
    offerId: OFFER_ID,
    purchaseQuantity: 1,
    totalPrice: { amount: 24.99, currency: 'USD' },
    state: { state: 'Paid' },
    orderOfferDetails: { offerTitle: 'Old title', category: 'Account', guaranteedDeliveryTime: 'Minute20' },
    createdDate: '2026-10-14T09:00:00Z',
    ...overrides
  };
}

module.exports = { OFFER_ID, ORDER_ID, SECRET_ID, LEGACY_SECRET_ID, offer, structuredSecret, legacySecret, order };
