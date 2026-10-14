// The app's own routes for editing offer text and marking an order delivered, run against the
// fake Eldorado: starts server.js in a child process with test/helpers/preload.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const fx = require('./helpers/fixtures');

const ROOT = path.join(__dirname, '..');

function startServer(seed) {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ['-r', './test/helpers/preload.js', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), FAKE_ELDORADO: JSON.stringify(seed) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start:\n' + output)), 15000);
    const onData = (d) => {
      output += d;
      if (output.includes('running at')) {
        clearTimeout(timer);
        resolve({
          url: `http://localhost:${port}`,
          stop: () => new Promise((r) => { child.once('exit', r); child.kill(); })
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n` + output)); });
  });
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json() };
}

let server;
test.before(async () => {
  server = await startServer({
    offers: [fx.offer()],
    secrets: { [fx.OFFER_ID]: [fx.structuredSecret()] },
    orders: [fx.order(), fx.order({ id: 'already-done', state: { state: 'Delivered' } })]
  });
});
test.after(() => server && server.stop());

// What public/offers.js saveText() reads: data.offer.title, data.offer.description, data.warnings.
test('POST /eldorado/offers/:id/text returns the saved offer and no warnings', async () => {
  const { status, data } = await post(`${server.url}/eldorado/offers/${fx.OFFER_ID}/text`, { title: 'Route title', description: 'Route description' });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.offer.title, 'Route title');
  assert.equal(data.offer.description, 'Route description');
  assert.deepEqual(data.warnings, []);
});

test('POST /eldorado/offers/:id/text with a blank title answers 400 with a message', async () => {
  const { status, data } = await post(`${server.url}/eldorado/offers/${fx.OFFER_ID}/text`, { title: '', description: 'x' });
  assert.equal(status, 400);
  assert.match(data.error, /Title and description/);
});

test('POST /eldorado/offers/:id/text for an unknown offer passes Eldorado\'s 404 through', async () => {
  const { status, data } = await post(`${server.url}/eldorado/offers/missing/text`, { title: 'T', description: 'D' });
  assert.equal(status, 404);
  assert.ok(data.error);
});

// What public/orders.js markDelivered() reads: out.state.
test('POST /orders/:id/deliver marks a Paid order Delivered', async () => {
  const { status, data } = await post(`${server.url}/orders/${fx.ORDER_ID}/deliver`);
  assert.equal(status, 200, JSON.stringify(data));
  assert.deepEqual(data, { state: 'Delivered' });
});

test('POST /orders/:id/deliver on an order already delivered answers 400 with Eldorado\'s message', async () => {
  const { status, data } = await post(`${server.url}/orders/already-done/deliver`);
  assert.equal(status, 400);
  assert.match(data.error, /cannot be delivered/);
});
