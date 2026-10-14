// Backups of the account folder records (listing.json / sale.json), kept on the Worker.
// The app sends them during its hourly folder sync; this script gets them back.
//
//   npm run backup -- list                  every stored backup (per PC: latest + one per day, 30 days)
//   npm run backup -- pull [key]            save one to backups\ (default: this PC's latest)
//   npm run backup -- restore <file>        show what restoring that file would write
//   npm run backup -- restore <file> --apply   write it: missing listing.json / sale.json only,
//                                          into the Listed / Sold folders set on this PC
//
// Restore never overwrites a file that exists. A folder that's gone is recreated with just its
// .json records (enough for the Orders page and Stats; screenshots and logins aren't backed up).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const folders = require('../folders');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

async function worker(route) {
  const url = (process.env.PROXY_URL || '').replace(/\/+$/, '');
  if (!url || !process.env.PROXY_SECRET) throw new Error('PROXY_URL / PROXY_SECRET are not set in .env.');
  const res = await fetch(url + route, { method: 'POST', headers: { 'X-Proxy-Secret': process.env.PROXY_SECRET } });
  if (!res.ok) throw new Error(`Worker ${route.split('?')[0]} failed (${res.status})`);
  return res.json();
}

const thisPc = () => os.hostname().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

async function list() {
  const { keys } = await worker('/alerts/backup/list');
  if (!keys.length) return console.log('No backups yet. The app sends one during its hourly folder sync.');
  keys.forEach((k) => console.log(k));
}

async function pull(key) {
  key = key || `backup:${thisPc()}:latest`;
  const data = await worker('/alerts/backup/get?key=' + encodeURIComponent(key));
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, key.replace(/[^A-Za-z0-9_-]+/g, '_') + '.json');
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`Saved ${key} (${data.listed.length} listed, ${data.sold.length} sold, from ${data.at}) to ${file}`);
}

// Folder names come from the backup: keep them to one plain folder name.
const safeName = (name) => typeof name === 'string' && name && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..';

// [{ file, data }] that restoring would write (only missing files).
async function plan(backup) {
  const writes = [];
  const add = async (dir, folder, name, data) => {
    if (!data || !safeName(folder)) return;
    const file = path.join(dir, folder, name);
    const exists = await fs.stat(file).then(() => true, () => false);
    if (!exists) writes.push({ file, data });
  };
  for (const r of backup.listed || []) await add(folders.listedDir(), r.folder, 'listing.json', r.listing);
  for (const r of backup.sold || []) {
    await add(folders.soldDir(), r.folder, 'listing.json', r.listing);
    await add(folders.soldDir(), r.folder, 'sale.json', r.sale);
  }
  return writes;
}

async function restore(file, apply) {
  if (!file) throw new Error('Which file? Pull one first: npm run backup -- pull');
  if (!folders.isConfigured()) throw new Error('Set the accounts folder first (Settings page or ACCOUNTS_DIR in .env).');
  const backup = JSON.parse(await fs.readFile(file, 'utf8'));
  const writes = await plan(backup);
  if (!writes.length) return console.log('Nothing to restore: every record in the backup is already on disk.');
  writes.forEach((w) => console.log((apply ? 'write  ' : 'would write  ') + w.file));
  if (!apply) return console.log(`\n${writes.length} file(s). Run again with --apply to write them.`);
  for (const w of writes) {
    await fs.mkdir(path.dirname(w.file), { recursive: true });
    await fs.writeFile(w.file, JSON.stringify(w.data, null, 2) + '\n', { flag: 'wx' }); // wx: never overwrite
  }
  console.log(`\nRestored ${writes.length} file(s).`);
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  if (cmd === 'list') return list();
  if (cmd === 'pull') return pull(arg);
  if (cmd === 'restore') return restore(arg, rest.includes('--apply') || arg === '--apply');
  console.log('Usage: npm run backup -- list | pull [key] | restore <file> [--apply]');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { plan };
