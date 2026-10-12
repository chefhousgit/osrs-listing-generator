// Account credentials file for the Eldorado delivery details: one "email:password:key" per line.
// The path comes from ACCOUNTS_FILE in .env. The file is read fresh on every request (edits show up
// without a restart) and its contents are never logged or written anywhere.

const fs = require('fs/promises');

function filePath() {
  return (process.env.ACCOUNTS_FILE || '').trim().replace(/^"(.*)"$/, '$1');
}

function isConfigured() {
  return Boolean(filePath());
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

async function readAccounts() {
  let text;
  try {
    text = await fs.readFile(filePath(), 'utf8');
  } catch (err) {
    throw new Error(`Could not read ACCOUNTS_FILE (${err.code || 'error'}). Check the path in .env.`);
  }
  return text.replace(/^﻿/, '').split(/\r?\n/).map(parseLine).filter(Boolean);
}

module.exports = { isConfigured, readAccounts, parseLine };
