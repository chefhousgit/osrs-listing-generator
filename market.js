// Market price check for the Offers page. Eldorado gives no market value for OSRS accounts, so
// this compares each offer with other sellers' live listings on Eldorado's public search:
// same account type, total-level bracket and combat bracket ("close"). When fewer than
// MIN_COMPETITORS match, it widens to type + total bracket ("broad") and says so. Your own
// listings are left out. Results are cached for an hour per filter.

const PUBLIC_SEARCH = 'https://www.eldorado.gg/api/flexibleOffers?gameId=10&category=Account&pageSize=50';
const CACHE_FOR = 60 * 60 * 1000;
const MIN_COMPETITORS = 3;
const MAX_PAGES = 4;

const cache = new Map(); // filter query -> { at, listings: [{ price, userId }] }

async function listingsFor(filters) {
  const query = Object.entries(filters).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('');
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_FOR) return hit.listings;

  const listings = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${PUBLIC_SEARCH}${query}&pageIndex=${page}`, { headers: { 'User-Agent': 'osrs-listing-generator/1.0' } });
    if (!res.ok) throw new Error(`Eldorado market search failed (${res.status})`);
    const d = await res.json();
    (d.results || []).forEach((r) => {
      const o = r.offer || r;
      const price = o.pricePerUnitInUSD ? o.pricePerUnitInUSD.amount : o.pricePerUnit && o.pricePerUnit.amount;
      if (price > 0 && (!o.offerState || o.offerState === 'Active')) listings.push({ price, userId: o.userId });
    });
    if (!d.totalPages || page >= d.totalPages) break;
  }
  cache.set(query, { at: Date.now(), listings });
  return listings;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

// { offerId: { median, low, high, count, scope: 'close' | 'broad', gapPct } } for offers from listOffers.
async function marketFor(offers) {
  const out = {};
  const mine = new Set(offers.map((o) => o.userId).filter(Boolean));
  const others = (list) => list.filter((l) => !mine.has(l.userId));
  for (const o of offers) {
    if (!o.typeId || !o.bracketId) continue;
    try {
      const broadFilter = { 'osrs-account-type': o.typeId, 'osrs-total-level': o.bracketId };
      let scope = 'close';
      let pool = o.combatId ? others(await listingsFor({ ...broadFilter, 'osrs-combat-level': o.combatId })) : [];
      if (pool.length < MIN_COMPETITORS) {
        scope = 'broad';
        pool = others(await listingsFor(broadFilter));
      }
      if (!pool.length) {
        out[o.id] = { count: 0, scope };
        continue;
      }
      const prices = pool.map((l) => l.price).sort((a, b) => a - b);
      const median = percentile(prices, 0.5);
      out[o.id] = {
        median,
        low: percentile(prices, 0.25),
        high: percentile(prices, 0.75),
        count: prices.length,
        scope,
        gapPct: o.price ? Math.round(((o.price - median) / median) * 100) : null
      };
    } catch (err) {
      out[o.id] = { error: err.message };
    }
  }
  return out;
}

module.exports = { marketFor };
