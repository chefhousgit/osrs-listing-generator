// Settings page (public/settings.html): the account folder paths in .env, changed from the app.
// Saving rewrites only those lines of .env (other settings and comments stay as they are) and
// applies the new paths right away; folders.js reads them on every call, so no restart is needed.
// Browse opens the Windows folder picker on this PC (a web page can't see real folder paths).

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const folders = require('./folders');

// SETTINGS_ENV_FILE: tests point this at a scratch copy instead of the real .env.
const ENV_FILE = process.env.SETTINGS_ENV_FILE || path.join(__dirname, '.env');

const FIELDS = [
  { key: 'ACCOUNTS_DIR', label: 'Accounts folder', hint: 'One subfolder per account to list (screenshots + the .txt login file).' },
  { key: 'LISTED_DIR', label: 'Listed folder', hint: 'Where published accounts are moved. Empty: a Listed folder inside the accounts folder.' },
  { key: 'SOLD_DIR', label: 'Sold folder', hint: 'Where sold accounts are moved. Empty: a Sold folder next to the Listed folder.' }
];
const KEYS = FIELDS.map((f) => f.key);

const unquote = (v) => String(v || '').trim().replace(/^"(.*)"$/, '$1');

async function isDir(p) {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

// What each path is set to, the folder actually used (defaults filled in) and whether it exists.
async function current() {
  const accounts = unquote(process.env.ACCOUNTS_DIR);
  const effective = {
    ACCOUNTS_DIR: accounts ? path.resolve(accounts) : '',
    LISTED_DIR: accounts || process.env.LISTED_DIR ? folders.listedDir() : '',
    SOLD_DIR: accounts || process.env.LISTED_DIR || process.env.SOLD_DIR ? folders.soldDir() : ''
  };
  return {
    canBrowse: process.platform === 'win32',
    fields: await Promise.all(FIELDS.map(async (f) => ({
      ...f,
      value: unquote(process.env[f.key]),
      effective: effective[f.key],
      exists: effective[f.key] ? await isDir(effective[f.key]) : false
    })))
  };
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });

// Checks the new paths: absolute; the accounts folder must exist; Listed / Sold may be created
// later (the first move makes them) but the folder they sit in must exist.
async function validate(values) {
  const clean = {};
  for (const f of FIELDS) {
    if (!(f.key in values)) continue;
    const v = unquote(values[f.key]);
    if (v && !path.isAbsolute(v)) throw bad(`${f.label}: use a full path, like C:\\Accounts.`);
    if (v && f.key === 'ACCOUNTS_DIR' && !(await isDir(v))) throw bad(`${f.label}: "${v}" doesn't exist.`);
    if (v && f.key !== 'ACCOUNTS_DIR' && !(await isDir(v)) && !(await isDir(path.dirname(v)))) {
      throw bad(`${f.label}: neither "${v}" nor the folder it would go in exists.`);
    }
    clean[f.key] = v ? path.resolve(v) : '';
  }
  if (!('ACCOUNTS_DIR' in clean ? clean.ACCOUNTS_DIR : unquote(process.env.ACCOUNTS_DIR))) {
    throw bad('Set the accounts folder first: Listed and Sold default to folders around it.');
  }
  return clean;
}

// Replace KEY=... lines in .env text (the first one; later duplicates removed), appending keys
// that aren't there. Keeps the file's line endings.
function updateEnvText(text, updates) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const done = new Set();
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = m && m[1];
    if (key && key in updates) {
      if (done.has(key)) continue;
      out.push(`${key}=${updates[key]}`);
      done.add(key);
    } else {
      out.push(line);
    }
  }
  const missing = Object.keys(updates).filter((k) => !done.has(k));
  if (missing.length) {
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push(...missing.map((k) => `${k}=${updates[k]}`), '');
  }
  return out.join(eol);
}

async function save(values) {
  const clean = await validate(values || {});
  const text = await fs.readFile(ENV_FILE, 'utf8').catch((err) => (err.code === 'ENOENT' ? '' : Promise.reject(err)));
  await fs.writeFile(ENV_FILE, updateEnvText(text, clean));
  Object.assign(process.env, clean);
  return current();
}

// Windows folder picker, on top of the browser. Paths go in and out through environment
// variables / stdout, never through the command line. Resolves to the picked path or '' (canceled).
const PICKER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:PICK_TITLE
$d.ShowNewFolderButton = $true
if ($env:PICK_START -and (Test-Path -LiteralPath $env:PICK_START)) { $d.SelectedPath = $env:PICK_START }
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
$owner.Dispose()
`;
let picking = null;

function pickFolder(key, start) {
  if (process.platform !== 'win32') return Promise.reject(bad('Browse only works on Windows. Type the path instead.'));
  if (picking) return Promise.reject(Object.assign(new Error('A folder picker is already open. Check the taskbar.'), { status: 409 }));
  const field = FIELDS.find((f) => f.key === key);
  picking = new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', PICKER], {
      env: { ...process.env, PICK_TITLE: `Pick the ${field ? field.label.toLowerCase() : 'folder'}`, PICK_START: unquote(start) },
      timeout: 10 * 60 * 1000,
      // windowsHide would also hide the dialog (it's the process's first window); the app's own
      // console is reused, so no extra window shows anyway.
      windowsHide: false
    }, (err, stdout) => (err ? reject(new Error('The folder picker failed: ' + err.message)) : resolve(stdout.trim())));
  });
  return picking.finally(() => { picking = null; });
}

// ---------- setup check ----------
// One row per part of the setup: status 'ok' | 'warn' | 'bad' | 'off', a one-line text and an
// optional detail. deps come from server.js: worker() asks the Worker's /alerts/health.
const MIN = 60 * 1000;
function ago(iso, now = Date.now()) {
  const m = Math.round((now - Date.parse(iso)) / MIN);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}
const row = (id, label, status, text, detail) => ({ id, label, status, text, detail: detail || '' });
const cleanPc = (pc) => String(pc || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

async function health(deps, now = Date.now()) {
  const rows = [];
  let w = null;

  // Worker
  if (!deps.proxySet) {
    rows.push(row('worker', 'Worker', 'bad', 'Not set up: PROXY_URL / PROXY_SECRET are missing from .env.'));
  } else {
    try {
      w = await deps.worker();
      rows.push(row('worker', 'Worker', 'ok', 'Reachable.'));
    } catch (err) {
      const msg = err.message || '';
      if (/\(404\)/.test(msg)) rows.push(row('worker', 'Worker', 'warn', 'Reachable, but it needs redeploying for this check (npx.cmd wrangler deploy in the worker folder).'));
      else if (/\(401\)/.test(msg)) rows.push(row('worker', 'Worker', 'bad', "PROXY_SECRET in .env doesn't match the Worker's."));
      else rows.push(row('worker', 'Worker', 'bad', "Can't reach the Worker.", msg));
    }
  }
  if (w) {
    const run = w.lastRun;
    const age = run ? now - Date.parse(run.at) : Infinity;
    if (!run) rows.push(row('checks', '24/7 checks', 'warn', 'No run recorded yet. The checks record themselves every 30 minutes.'));
    else if (age > 45 * MIN) rows.push(row('checks', '24/7 checks', 'bad', `Last recorded ${ago(run.at, now)}: the 5-minute checks may have stopped.`, 'Check the Worker in the Cloudflare dashboard (Triggers).'));
    else if (!run.ok) rows.push(row('checks', '24/7 checks', 'warn', `Running, but the last check had problems (${ago(run.at, now)}).`, (run.problems || []).join(' · ')));
    else rows.push(row('checks', '24/7 checks', 'ok', `Running every ${w.runEveryMinutes || 5} minutes (last recorded ${ago(run.at, now)}).`));
  }

  // Eldorado credentials
  const parts = [deps.eldoradoSet ? 'This PC: set.' : 'This PC: not set (ELDORADO_CLIENT_ID / SECRET in .env).'];
  let status = deps.eldoradoSet ? 'ok' : 'bad';
  if (w) {
    if (!w.eldorado) { parts.push('Worker: not set.'); status = 'bad'; }
    const d = w.credsDaysLeft;
    if (d === null || d === undefined) {
      parts.push('Expiry date unknown (ELDORADO_CREDS_EXPIRE in wrangler.toml).');
      if (status === 'ok') status = 'warn';
    } else if (d < 0) {
      parts.push(`Expired on ${w.credsExpire}.`);
      status = 'bad';
    } else {
      parts.push(`Expire in ${d} day${d === 1 ? '' : 's'} (${w.credsExpire}).`);
      if (d <= 7) status = 'bad';
      else if (d <= 30 && status === 'ok') status = 'warn';
    }
  }
  rows.push(row('eldorado', 'Eldorado API', status, parts.join(' ')));

  // Discord: the app's own webhooks, then the Worker's channels
  const appHooks = [['#listed', process.env.DISCORD_WEBHOOK_LISTED], ['#errors', process.env.DISCORD_WEBHOOK_ERRORS || process.env.DISCORD_WEBHOOK_ALERTS]];
  const missingApp = appHooks.filter(([, v]) => !v).map(([n]) => n);
  rows.push(row('discord-app', 'Discord (this PC)', missingApp.length ? 'warn' : 'ok',
    missingApp.length ? `Not set: ${missingApp.join(', ')}.` : '#listed and #errors are set.',
    missingApp.length ? 'Add DISCORD_WEBHOOK_LISTED / DISCORD_WEBHOOK_ERRORS to .env and restart the app.' : ''));
  if (w && Array.isArray(w.channels)) {
    const set = w.channels.filter((c) => c.set).map((c) => '#' + c.name);
    const fallback = w.channels.filter((c) => !c.set && c.fallback);
    const off = w.channels.filter((c) => !c.set && !c.fallback);
    const notes = [
      ...fallback.map((c) => `#${c.name} goes to #${c.fallback} (${c.secret} not set)`),
      ...off.map((c) => `#${c.name} is off (${c.secret} not set)`)
    ];
    rows.push(row('discord-worker', 'Discord (Worker)', off.length ? 'bad' : fallback.length ? 'warn' : 'ok',
      set.length ? `Set: ${set.join(', ')}.` : 'No channels set.', notes.join(' · ')));
  }

  // Folder sync
  const sync = deps.lastSync;
  if (!deps.syncEnabled) rows.push(row('sync', 'Folder sync', 'off', 'Not running: needs the accounts folder (below) and the Eldorado API on this PC.'));
  else if (!sync) rows.push(row('sync', 'Folder sync', 'ok', 'Runs a minute after the app starts, then every hour. Not run yet.'));
  else if (sync.error) rows.push(row('sync', 'Folder sync', 'bad', `Last run ${ago(sync.at, now)} failed.`, sync.error));
  else rows.push(row('sync', 'Folder sync', 'ok', `Last run ${ago(sync.at, now)}: ${sync.moves.length ? sync.moves.length + ' moved' : 'nothing to move'}.`));

  // Backup
  const me = cleanPc(require('os').hostname());
  const local = deps.backupStatus;
  if (w && Array.isArray(w.backups)) {
    const mine = w.backups.find((b) => b.pc === me);
    const others = w.backups.filter((b) => b.pc !== me).map((b) => `${b.pc}: ${ago(b.at, now)} (${b.listed} listed, ${b.sold} sold)`);
    const detail = [local && local.error ? `Last attempt failed: ${local.error}` : '', others.length ? 'Other PCs: ' + others.join(' · ') : ''].filter(Boolean).join(' · ');
    if (local && local.error) rows.push(row('backup', 'Backup', 'bad', mine ? `Last stored ${ago(mine.at, now)}, but the latest attempt failed.` : 'Not stored: the latest attempt failed.', detail));
    else if (mine) rows.push(row('backup', 'Backup', 'ok', `This PC's last stored ${ago(mine.at, now)} (${mine.listed} listed, ${mine.sold} sold). Sent when they change.`, detail));
    else rows.push(row('backup', 'Backup', deps.syncEnabled ? 'warn' : 'off', deps.syncEnabled ? 'Nothing stored for this PC yet: sent with the next folder sync.' : 'Starts once the folder sync runs.', detail));
  } else if (local && local.error) {
    rows.push(row('backup', 'Backup', 'bad', 'The latest backup failed.', local.error));
  }

  return { pc: me, rows };
}

module.exports = { current, save, pickFolder, updateEnvText, health, KEYS };
