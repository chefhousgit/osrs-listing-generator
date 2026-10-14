// Sales stats for the Stats page (public/stats.html), from your Eldorado order history (account
// sales of SMALL_ITEM_PRICE or more, canceled orders left out; cheaper ones like $0.50 logins are
// counted separately as small items) plus the Sold folder's sale.json / listing.json for
// days-to-sell. Cached for 10 minutes.

const eldorado = require('./eldorado');
const folders = require('./folders');

const DAY = 86400000;
const WEEKS = 16;
const CACHE_FOR = 10 * 60 * 1000;
const SMALL_ITEM_PRICE = 5;
let cached = null;

const round2 = (n) => Math.round(n * 100) / 100;

// Monday 00:00 (local time) of the week containing t.
function weekStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function group(orders, keyOf) {
  const map = new Map();
  orders.forEach((o) => {
    const key = keyOf(o) || 'Unknown';
    const g = map.get(key) || { key, count: 0, revenue: 0 };
    g.count++;
    g.revenue += o.price || 0;
    map.set(key, g);
  });
  return [...map.values()]
    .map((g) => ({ ...g, revenue: round2(g.revenue), avgPrice: round2(g.revenue / g.count) }))
    .sort((a, b) => b.count - a.count);
}

async function daysToSell() {
  try {
    const sold = await folders.soldFolders();
    const days = sold
      .filter((f) => f.listing && f.listing.listedAt && f.sale && f.sale.soldAt)
      .map((f) => (Date.parse(f.sale.soldAt) - Date.parse(f.listing.listedAt)) / DAY)
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);
    if (!days.length) return null;
    return { count: days.length, median: round2(days[Math.floor(days.length / 2)]), avg: round2(days.reduce((s, d) => s + d, 0) / days.length) };
  } catch (e) {
    return null;
  }
}

async function compute() {
  if (cached && Date.now() - cached.at < CACHE_FOR) return cached.data;
  const all = await eldorado.listAllOrders(500);
  const paid = all.filter((o) => o.category === 'Account' && o.state !== 'Canceled' && o.price > 0);
  const sales = paid.filter((o) => o.price >= SMALL_ITEM_PRICE);
  const small = paid.filter((o) => o.price < SMALL_ITEM_PRICE);
  const now = Date.now();
  const revenue = sales.reduce((s, o) => s + o.price, 0);
  const since = (days) => sales.filter((o) => now - Date.parse(o.createdDate) < days * DAY);
  const sum = (list) => round2(list.reduce((s, o) => s + o.price, 0));

  // Last WEEKS weeks, oldest first, empty weeks included.
  const thisWeek = weekStart(now);
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = thisWeek - i * 7 * DAY;
    const inWeek = sales.filter((o) => { const t = Date.parse(o.createdDate); return t >= start && t < start + 7 * DAY; });
    weeks.push({ start: new Date(start).toISOString(), count: inWeek.length, revenue: sum(inWeek) });
  }

  const data = {
    totals: {
      sales: sales.length,
      revenue: round2(revenue),
      avgPrice: sales.length ? round2(revenue / sales.length) : 0,
      last7: { count: since(7).length, revenue: sum(since(7)) },
      last30: { count: since(30).length, revenue: sum(since(30)) },
      firstSale: sales.length ? sales[sales.length - 1].createdDate : null,
      canceled: all.filter((o) => o.category === 'Account' && o.state === 'Canceled').length,
      smallItems: { count: small.length, revenue: round2(small.reduce((t, o) => t + o.price, 0)), under: SMALL_ITEM_PRICE }
    },
    weeks,
    byType: group(sales, (o) => o.type),
    byBracket: group(sales, (o) => o.bracket),
    daysToSell: await daysToSell(),
    capped: all.length >= 500
  };
  cached = { at: Date.now(), data };
  return data;
}

module.exports = { compute };
