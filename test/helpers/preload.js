// Loaded with `node -r` before server.js in the route tests. Runs before server.js reads .env:
// blanks every setting that would reach the outside (dotenv never overrides a variable that is
// already set) and swaps fetch for the fake Eldorado, seeded from FAKE_ELDORADO (JSON).

for (const key of [
  'ACCOUNTS_DIR', 'LISTED_DIR', 'SOLD_DIR', 'PROXY_URL', 'PROXY_SECRET',
  'DISCORD_WEBHOOK_ALERTS', 'DISCORD_WEBHOOK_ERRORS', 'DISCORD_WEBHOOK_LISTED'
]) process.env[key] = '';
process.env.ELDORADO_CLIENT_ID = 'fake-client';
process.env.ELDORADO_CLIENT_SECRET = 'fake-secret';

const { createFakeEldorado } = require('./fake-eldorado');
createFakeEldorado(JSON.parse(process.env.FAKE_ELDORADO || '{}')).install();
