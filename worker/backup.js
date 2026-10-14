// Off-PC copy of the account folder records: the app sends every Listed / Sold folder's
// listing.json and sale.json (offer ids, titles, prices, dates; never logins) whenever they
// change. KV keeps the latest per PC plus one snapshot per day for SNAPSHOT_DAYS.
//
//   backup:<pc>:latest        the newest copy
//   backup:<pc>:<YYYY-MM-DD>  the last copy of that day (expires after SNAPSHOT_DAYS)

const SNAPSHOT_DAYS = 30;
const MAX_BYTES = 5 * 1024 * 1024;
const PREFIX = 'backup:';

const cleanPc = (pc) => String(pc || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

// { pc, listed: [{ folder, listing }], sold: [{ folder, listing, sale }] } from the app.
export async function saveBackup(env, body) {
  const pc = cleanPc(body && body.pc);
  if (!pc || !Array.isArray(body.listed) || !Array.isArray(body.sold)) return { ok: false, status: 400, error: 'Bad backup.' };
  const at = new Date().toISOString();
  const text = JSON.stringify({ pc, at, listed: body.listed, sold: body.sold });
  if (text.length > MAX_BYTES) return { ok: false, status: 413, error: 'Backup too large.' };
  await env.STATE.put(`${PREFIX}${pc}:latest`, text);
  await env.STATE.put(`${PREFIX}${pc}:${at.slice(0, 10)}`, text, { expirationTtl: SNAPSHOT_DAYS * 24 * 3600 });
  return { ok: true, at, listed: body.listed.length, sold: body.sold.length };
}

// Every stored backup key, newest day first within each PC.
export async function listBackups(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.STATE.list({ prefix: PREFIX, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return { ok: true, keys: keys.sort().reverse() };
}

export async function getBackup(env, key) {
  if (!key || !key.startsWith(PREFIX)) return null;
  return env.STATE.get(key, 'json');
}
