// Sales stats for the Stats page (public/stats.html), from your Eldorado order history (account
// sales of SMALL_ITEM_PRICE or more, canceled orders left out; cheaper ones like $0.50 logins are
// counted separately as small items) plus the Sold folder's sale.json / listing.json for
// days-to-sell. Cached for 10 minutes. Also the buyer reviews for the Reviews page (public/reviews.html).

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

// Order history from Eldorado, shared by the Stats and Reviews pages (one fetch per 10 minutes).
let history = null;
async function orderHistory() {
  if (history && Date.now() - history.at < CACHE_FOR) return history.orders;
  const orders = await eldorado.listAllOrders(500);
  history = { at: Date.now(), orders };
  return orders;
}

// Reviews page: buyer feedback on account sales, newest first, with totals by tag and account type.
async function reviews() {
  const all = await orderHistory();
  const sales = all.filter((o) => o.category === 'Account' && o.state !== 'Canceled' && o.price > 0);
  const reviewed = sales.filter((o) => o.review);
  const positive = reviewed.filter((o) => o.review.rating === 'Positive').length;
  const now = Date.now();
  const recent = reviewed.filter((o) => now - Date.parse(o.createdDate) < 30 * DAY);
  const recentPositive = recent.filter((o) => o.review.rating === 'Positive').length;

  const tags = new Map();
  reviewed.forEach((o) => o.review.tags.forEach((t) => {
    const g = tags.get(t) || { tag: t, positive: 0, negative: 0 };
    g[o.review.rating === 'Positive' ? 'positive' : 'negative']++;
    tags.set(t, g);
  }));

  const types = new Map();
  sales.forEach((o) => {
    const key = o.type || 'Unknown';
    const g = types.get(key) || { key, sales: 0, positive: 0, negative: 0 };
    g.sales++;
    if (o.review) g[o.review.rating === 'Positive' ? 'positive' : 'negative']++;
    types.set(key, g);
  });

  return {
    totals: {
      sales: sales.length,
      reviewed: reviewed.length,
      positive,
      negative: reviewed.length - positive,
      positivePct: reviewed.length ? round2((positive / reviewed.length) * 100) : null,
      last30: { reviewed: recent.length, positivePct: recent.length ? round2((recentPositive / recent.length) * 100) : null },
      withMessage: reviewed.filter((o) => o.review.message).length
    },
    tags: [...tags.values()].sort((a, b) => (b.positive + b.negative) - (a.positive + a.negative)),
    byType: [...types.values()].sort((a, b) => b.sales - a.sales),
    reviews: reviewed.map((o) => ({ id: o.id, title: o.title, price: o.price, createdDate: o.createdDate, type: o.type, image: o.image, ...o.review })),
    capped: all.length >= 500,
    source: eldorado.dataSources().history
  };
}

async function compute() {
  if (cached && Date.now() - cached.at < CACHE_FOR) return cached.data;
  const all = await orderHistory();
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
    capped: all.length >= 500,
    source: eldorado.dataSources().history
  };
  cached = { at: Date.now(), data };
  return data;
}

module.exports = { compute, reviews };
