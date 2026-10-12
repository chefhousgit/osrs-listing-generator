// Account credentials file for the Eldorado delivery details: one "email:password:key" per line.
// ACCOUNTS_FILE in .env names it; without that, the .txt file in ACCOUNTS_DIR is used (any name,
// e.g. an EternalFarms accounts-export-*.txt; there should only be one, the newest wins otherwise).
// The file is read fresh on every request (edits show up without a restart) and its contents are
// never logged or written anywhere.

const fs = require('fs/promises');
const path = require('path');

const TXT = /\.txt$/i;

const envPath = (name) => (process.env[name] || '').trim().replace(/^"(.*)"$/, '$1');

// The .txt file directly inside dir (newest if there are several), or null.
async function findTxt(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries
    .filter((e) => e.isFile() && TXT.test(e.name))
    .map(async (e) => {
      const file = path.join(dir, e.name);
      return { file, mtime: (await fs.stat(file)).mtimeMs };
    }));
  files.sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].file : null;
}

async function resolvePath() {
  if (envPath('ACCOUNTS_FILE')) return envPath('ACCOUNTS_FILE');
  if (envPath('ACCOUNTS_DIR')) return findTxt(envPath('ACCOUNTS_DIR'));
  return null;
}

// email = before the first ":", key = after the last ":", password = everything in between,
// so a password containing ":" still parses. Blank or malformed lines are skipped.
function parseLine(line) {
  const text = line.trim();
  const first = text.indexOf(':');
  const last = text.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const email = text.slice(0, first).trim();
  const password = text.slice(first + 1, last);
  const key = text.slice(last + 1).trim();
  if (!email || !password) return null;
  return { email, password, key };
}

function parseText(text) {
  return text.replace(/^﻿/, '').split(/\r?\n/).map(parseLine).filter(Boolean);
}

// null when there is no accounts file to read (not set, and no .txt in ACCOUNTS_DIR).
async function readAccounts() {
  const file = await resolvePath();
  if (!file) return null;
  try {
    return { name: path.basename(file), accounts: parseText(await fs.readFile(file, 'utf8')) };
  } catch (err) {
    throw new Error(`Could not read the accounts file (${err.code || 'error'}). Check ACCOUNTS_FILE in .env.`);
  }
}

module.exports = { readAccounts, parseLine, parseText, findTxt };
