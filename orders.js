// Sold orders: matches Eldorado orders to account folders and keeps the folders in step.
// Every hour while the app runs (and a minute after it starts), an account whose offer sold is
// moved Listed -> Sold with a sale.json; a canceled order moves it back. The Orders page
// (public/orders.html) shows the same data and can run the sync on demand.

const eldorado = require('./eldorado');
const folders = require('./folders');

const SOLD_STATES = ['Paid', 'Delivered', 'Received', 'Completed', 'PendingReview', 'Disputed', 'DeliveredDisputed'];
const SYNC_EVERY = 60 * 60 * 1000;

let lastSync = null; // { at, moves: [...], error }
let running = null;

function enabled() {
  return eldorado.isConfigured() && folders.isConfigured();
}

async function sync() {
  if (!enabled()) return { at: new Date().toISOString(), moves: [], error: 'Needs Eldorado and ACCOUNTS_DIR set in .env.' };
  if (running) return running; // one at a time
  running = (async () => {
    const moves = [];
    try {
      const orders = (await eldorado.listOrders()).slice().reverse(); // oldest first
      const listed = await folders.listedFolders();
      const sold = await folders.soldFolders();
      const listedByOffer = new Map(listed.filter((f) => f.listing && f.listing.offerId).map((f) => [f.listing.offerId, f]));

      for (const o of orders) {
        if (SOLD_STATES.includes(o.state)) {
          const f = listedByOffer.get(o.offerId);
          if (!f) continue;
          await folders.moveListedToSold(f.name, {
            orderId: o.id,
            offerId: o.offerId,
            title: o.title,
            price: o.price,
            currency: o.currency,
            soldAt: o.createdDate,
            movedAt: new Date().toISOString()
          });
          listedByOffer.delete(o.offerId);
          moves.push({ folder: f.name, to: 'Sold', order: o.id, title: o.title });
        } else if (o.state === 'Canceled') {
          const f = sold.find((s) => s.sale && s.sale.orderId === o.id);
          if (!f) continue;
          await folders.moveSoldToListed(f.name);
          moves.push({ folder: f.name, to: 'Listed', order: o.id, title: o.title });
        }
      }
      lastSync = { at: new Date().toISOString(), moves, error: null };
    } catch (err) {
      console.error('Orders sync failed:', err.message);
      lastSync = { at: new Date().toISOString(), moves, error: err.message };
    }
    moves.forEach((m) => console.log(`Orders sync: "${m.folder}" moved to ${m.to}`));
    return lastSync;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

// Orders with the folder each one belongs to (Listed or Sold), for the Orders page.
async function ordersWithFolders() {
  const [orders, listed, sold] = await Promise.all([eldorado.listOrders(), folders.listedFolders(), folders.soldFolders()]);
  const byOffer = new Map();
  listed.forEach((f) => { if (f.listing && f.listing.offerId) byOffer.set(f.listing.offerId, { name: f.name, rsn: f.rsn, where: 'listed' }); });
  sold.forEach((f) => {
    const offerId = (f.sale && f.sale.offerId) || (f.listing && f.listing.offerId);
    if (offerId) byOffer.set(offerId, { name: f.name, rsn: f.rsn, where: 'sold' });
  });
  return {
    orders: orders.map((o) => ({ ...o, folder: byOffer.get(o.offerId) || null })),
    unlinked: listed.filter((f) => !(f.listing && f.listing.offerId)).map((f) => f.name),
    lastSync
  };
}

// RSN + 2FA key for the buyer handover message of one order.
async function handover(orderId) {
  const { orders } = await ordersWithFolders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });
  if (!order.folder) throw Object.assign(new Error('This order has no account folder linked.'), { status: 404 });
  const login = await folders.readListedOrSoldLogin(order.folder.where, order.folder.name);
  return { rsn: order.folder.rsn, key: login ? login.key : '' };
}

// Link a listed folder to the offer of an order, then sync (so a sold one moves right away).
async function link(orderId, folderName) {
  const { orders } = await ordersWithFolders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });
  await folders.linkListedFolder(folderName, { offerId: order.offerId, title: order.title });
  return sync();
}

function start() {
  if (!enabled()) return;
  setTimeout(sync, 60 * 1000);
  setInterval(sync, SYNC_EVERY);
}

module.exports = { sync, ordersWithFolders, handover, link, start, enabled, getLastSync: () => lastSync };
