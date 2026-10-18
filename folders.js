// Account folders: ACCOUNTS_DIR in .env points at a folder holding one subfolder per account,
// named "<RSN>" plus optional " - <tag>" suffixes: a type (hcim/hc, uim, im/iron, main) and/or "temp"
// for a past temporary ban, e.g. "Zezima - hc - temp". Each subfolder has the screenshots
// for the listing and one .txt file, any name ("email:password:key", e.g. an EternalFarms
// accounts-export-*.txt; the first valid line is used). After a publish the folder is
// moved into LISTED_DIR (default ACCOUNTS_DIR\Listed) with a listing.json naming its Eldorado
// offer; once that offer sells it moves on to SOLD_DIR (default: a Sold folder next to Listed)
// with a sale.json, and back to Listed if the order is canceled. Nothing here logs file contents.

const fs = require('fs/promises');
const path = require('path');

const TXT = /\.txt$/i;

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
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SUFFIX_TYPES = { hcim: 'hcim', hc: 'hcim', uim: 'uim', im: 'ironman', iron: 'ironman', ironman: 'ironman', main: 'main' };
const BAN_TAGS = ['temp'];

function rootDir() {
  return (process.env.ACCOUNTS_DIR || '').trim().replace(/^"(.*)"$/, '$1');
}

function isConfigured() {
  return Boolean(rootDir());
}

// Where published account folders go: LISTED_DIR in .env, or ACCOUNTS_DIR\Listed.
function listedDir() {
  const custom = (process.env.LISTED_DIR || '').trim().replace(/^"(.*)"$/, '$1');
  return path.resolve(custom || path.join(rootDir(), 'Listed'));
}

// Where sold accounts go: SOLD_DIR in .env, or a Sold folder next to the listed folder.
function soldDir() {
  const custom = (process.env.SOLD_DIR || '').trim().replace(/^"(.*)"$/, '$1');
  return path.resolve(custom || path.join(path.dirname(listedDir()), 'Sold'));
}

// Not accounts to list: the listed / sold folders, or folders called "Listed" / "Sold".
const isListedDir = (name) => ['listed', 'sold'].includes(name.toLowerCase())
  || [listedDir(), soldDir()].includes(path.resolve(rootDir(), name));

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
  const dirs = entries.filter((e) => e.isDirectory() && !isListedDir(e.name)).map((e) => e.name).sort(byName);
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
  const hit = folders.find((e) => e.isDirectory() && e.name === name && !isListedDir(e.name));
  if (!hit) throw Object.assign(new Error('That account folder is gone. Reload the list.'), { status: 404 });
  return path.join(rootDir(), hit.name);
}

async function folderFiles(name) {
  const dir = path.join(rootDir(), name);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  return {
    images: files.filter((f) => IMAGE_TYPES[path.extname(f).toLowerCase()]).sort(byName),
    hasLogin: files.some((f) => TXT.test(f))
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

// First valid line of the .txt file in dir (any name), or null.
async function readLoginAt(dir) {
  const file = await findTxt(dir);
  if (!file) return null;
  const text = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  return text.split(/\r?\n/).map(parseLine).find(Boolean) || null;
}

async function readLogin(name) {
  return readLoginAt(await resolveFolder(name));
}

// Move dir into toDir under name, adding " (2)", " (3)"... if taken. Returns the new path.
async function moveDir(from, toDir, name) {
  await fs.mkdir(toDir, { recursive: true });
  let target = path.join(toDir, name);
  for (let n = 2; await fs.stat(target).then(() => true, () => false); n++) {
    target = path.join(toDir, `${name} (${n})`);
  }
  try {
    await fs.rename(from, target);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // Different drive: copy, then remove the original.
    await fs.cp(from, target, { recursive: true, errorOnExist: true });
    await fs.rm(from, { recursive: true });
  }
  return target;
}

const LISTING_FILE = 'listing.json';
const SALE_FILE = 'sale.json';

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');

// Move a published account into the listed folder, recording its offer (listing.json) so a later
// sale can be matched to it. Returns the full path it ended up at.
// The listing card used as the offer's main image, kept in the account folder (so it moves to
// Listed with it). Returns the file written.
const CARD_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
async function saveCard(name, image) {
  const dir = await resolveFolder(name);
  const file = path.join(dir, 'listing-card' + (CARD_EXT[image.mimetype] || '.png'));
  await fs.writeFile(file, image.buffer);
  return file;
}

async function moveToListed(name, listing) {
  const target = await moveDir(await resolveFolder(name), listedDir(), name);
  if (listing) await writeJson(path.join(target, LISTING_FILE), listing);
  return target;
}

// Account folders inside dir with their listing.json / sale.json.
async function foldersIn(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return Promise.all(entries.filter((e) => e.isDirectory()).map(async (e) => {
    const full = path.join(dir, e.name);
    return {
      name: e.name,
      rsn: parseFolderName(e.name.replace(/\s+\(\d+\)$/, '')).rsn,
      listing: await readJson(path.join(full, LISTING_FILE)),
      sale: await readJson(path.join(full, SALE_FILE))
    };
  }));
}

const listedFolders = () => foldersIn(listedDir());
const soldFolders = () => foldersIn(soldDir());

// A real subfolder of dir, by exact name (requests can't reach anywhere else).
async function subfolder(dir, name) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  if (!entries.some((e) => e.isDirectory() && e.name === name)) {
    throw Object.assign(new Error(`"${name}" is no longer in ${path.basename(dir)}. Refresh.`), { status: 404 });
  }
  return path.join(dir, name);
}

// An offer sold: Listed -> Sold, with the sale recorded.
async function moveListedToSold(name, sale) {
  const target = await moveDir(await subfolder(listedDir(), name), soldDir(), name);
  await writeJson(path.join(target, SALE_FILE), sale);
  return target;
}

// The order was canceled: Sold -> Listed, sale record removed; the offer link is kept (or
// restored from the sale record) so the account is matched again if it sells later.
async function moveSoldToListed(name) {
  const target = await moveDir(await subfolder(soldDir(), name), listedDir(), name);
  const sale = await readJson(path.join(target, SALE_FILE));
  const listing = await readJson(path.join(target, LISTING_FILE));
  if (!listing && sale && sale.offerId) await writeJson(path.join(target, LISTING_FILE), { offerId: sale.offerId, title: sale.title });
  await fs.rm(path.join(target, SALE_FILE), { force: true });
  return target;
}

// Tie a listed folder (from before listing.json existed) to its Eldorado offer.
async function linkListedFolder(name, listing) {
  const dir = await subfolder(listedDir(), name);
  const current = (await readJson(path.join(dir, LISTING_FILE))) || {};
  await writeJson(path.join(dir, LISTING_FILE), { ...current, ...listing, linkedAt: new Date().toISOString() });
}

// Login of a listed or sold folder (for the buyer handover message).
async function readListedOrSoldLogin(where, name) {
  return readLoginAt(await subfolder(where === 'sold' ? soldDir() : listedDir(), name));
}

module.exports = {
  isConfigured, listFolders, listImages, readImage, readLogin, saveCard, moveToListed, parseFolderName, parseLine,
  listedDir, soldDir, listedFolders, soldFolders, moveListedToSold, moveSoldToListed, linkListedFolder, readListedOrSoldLogin
};
