// Account folders: ACCOUNTS_DIR in .env points at a folder holding one subfolder per account,
// named "<RSN>" plus optional " - <tag>" suffixes: a type (hcim/hc, uim, im/iron, main) and/or "temp"
// for a past temporary ban, e.g. "Zezima - hc - temp". Each subfolder has the screenshots
// for the listing and one .txt file, any name ("email:password:key", e.g. an EternalFarms
// accounts-export-*.txt; the first valid line is used). After a publish the folder is
// moved into LISTED_DIR (default ACCOUNTS_DIR\Listed). Nothing here logs file contents.

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

// Neither the listed folder nor a folder called "Listed" (e.g. from before LISTED_DIR was set) is an account.
const isListedDir = (name) => name.toLowerCase() === 'listed' || path.resolve(rootDir(), name) === listedDir();

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

// First valid line of the folder's .txt file (any name), or null.
async function readLogin(name) {
  const file = await findTxt(await resolveFolder(name));
  if (!file) return null;
  const text = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  return text.split(/\r?\n/).map(parseLine).find(Boolean) || null;
}

// Move a published account into the listed folder, adding " (2)", " (3)"... if the name is taken.
// Returns the full path it ended up at.
async function moveToListed(name) {
  const from = await resolveFolder(name);
  const listed = listedDir();
  await fs.mkdir(listed, { recursive: true });
  let target = path.join(listed, name);
  for (let n = 2; await fs.stat(target).then(() => true, () => false); n++) {
    target = path.join(listed, `${name} (${n})`);
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

module.exports = { isConfigured, listFolders, listImages, readImage, readLogin, moveToListed, parseFolderName, parseLine };
