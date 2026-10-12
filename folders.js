// Account folders: ACCOUNTS_DIR in .env points at a folder holding one subfolder per account,
// named "<RSN>" plus optional " - <tag>" suffixes: a type (hcim/hc, uim, im/iron, main) and/or "temp"
// for a past temporary ban, e.g. "Zezima - hc - temp". Each subfolder has the screenshots
// for the listing and an optional login.txt ("email:password:key"). After a publish the folder is
// moved into ACCOUNTS_DIR\Listed. Nothing here logs file contents.

const fs = require('fs/promises');
const path = require('path');
const { parseLine } = require('./accounts');

const LISTED_DIR = 'Listed';
const LOGIN_FILE = 'login.txt';
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SUFFIX_TYPES = { hcim: 'hcim', hc: 'hcim', uim: 'uim', im: 'ironman', iron: 'ironman', ironman: 'ironman', main: 'main' };
const BAN_TAGS = ['temp'];

function rootDir() {
  return (process.env.ACCOUNTS_DIR || '').trim().replace(/^"(.*)"$/, '$1');
}

function isConfigured() {
  return Boolean(rootDir());
}

// "Zezima - hc - temp" -> { rsn: 'Zezima', type: 'hcim', tempBan: true };
// "Zezima" -> { rsn: 'Zezima', type: 'auto', tempBan: false }. Unknown suffixes stay part of the name.
function parseFolderName(name) {
  let rest = name.trim();
  let type = 'auto';
  let tempBan = false;
  for (;;) {
    const m = rest.match(/^(.*?)\s+-\s+([a-z]+)\s*$/i);
    const tag = m && m[2].toLowerCase();
    if (tag && SUFFIX_TYPES[tag] && type === 'auto') type = SUFFIX_TYPES[tag];
    else if (tag && BAN_TAGS.includes(tag)) tempBan = true;
    else break;
    rest = m[1].trim();
  }
  return { rsn: rest, type, tempBan };
}

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

async function listFolders() {
  let entries;
  try {
    entries = await fs.readdir(rootDir(), { withFileTypes: true });
  } catch (err) {
    throw new Error(`Could not read ACCOUNTS_DIR (${err.code || 'error'}). Check the path in .env.`);
  }
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== LISTED_DIR).map((e) => e.name).sort(byName);
  return Promise.all(dirs.map(async (name) => {
    const files = await folderFiles(name);
    return {
      name,
      ...parseFolderName(name),
      images: files.images.length,
      hasLogin: files.hasLogin
    };
  }));
}

// Only names that really are subfolders of ACCOUNTS_DIR get through, so a request can't
// reach outside it.
async function resolveFolder(name) {
  const folders = await fs.readdir(rootDir(), { withFileTypes: true });
  const hit = folders.find((e) => e.isDirectory() && e.name === name && e.name !== LISTED_DIR);
  if (!hit) throw Object.assign(new Error('That account folder is gone. Reload the list.'), { status: 404 });
  return path.join(rootDir(), hit.name);
}

async function folderFiles(name) {
  const dir = path.join(rootDir(), name);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  return {
    images: files.filter((f) => IMAGE_TYPES[path.extname(f).toLowerCase()]).sort(byName),
    hasLogin: files.some((f) => f.toLowerCase() === LOGIN_FILE)
  };
}

async function listImages(name) {
  await resolveFolder(name);
  return (await folderFiles(name)).images;
}

async function readImage(name, file) {
  const dir = await resolveFolder(name);
  const { images } = await folderFiles(name);
  if (!images.includes(file)) throw Object.assign(new Error('Image not found.'), { status: 404 });
  return { buffer: await fs.readFile(path.join(dir, file)), type: IMAGE_TYPES[path.extname(file).toLowerCase()] };
}

async function readLogin(name) {
  const dir = await resolveFolder(name);
  const entries = await fs.readdir(dir);
  const file = entries.find((f) => f.toLowerCase() === LOGIN_FILE);
  if (!file) return null;
  const text = await fs.readFile(path.join(dir, file), 'utf8');
  return text.replace(/^﻿/, '').split(/\r?\n/).map(parseLine).find(Boolean) || null;
}

// Move a published account into ACCOUNTS_DIR\Listed, adding " (2)", " (3)"... if the name is taken.
async function moveToListed(name) {
  const from = await resolveFolder(name);
  const listed = path.join(rootDir(), LISTED_DIR);
  await fs.mkdir(listed, { recursive: true });
  let target = path.join(listed, name);
  for (let n = 2; await fs.stat(target).then(() => true, () => false); n++) {
    target = path.join(listed, `${name} (${n})`);
  }
  await fs.rename(from, target);
  return path.relative(rootDir(), target);
}

module.exports = { isConfigured, listFolders, listImages, readImage, readLogin, moveToListed, parseFolderName };
