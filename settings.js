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

module.exports = { current, save, pickFolder, updateEnvText, KEYS };
