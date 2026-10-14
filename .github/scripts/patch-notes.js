// Posts patch notes to Discord for a push to main (run by .github/workflows/patch-notes.yml).
//
// Each commit can carry a plain-English section in its message:
//
//   Patch notes:
//   - Listing card no longer shows a price
//   - Fewer Eldorado requests overnight
//
// The section ends at the first blank line or trailer (e.g. Co-Authored-By). Commits without it
// (internal fixes, docs) are skipped; if no commit in the push has notes, nothing is posted.
// The webhook URL comes from the DISCORD_WEBHOOK_PATCH_NOTES repository secret.

const fs = require('fs');

const webhook = process.env.DISCORD_WEBHOOK_PATCH_NOTES;
if (!webhook) {
  console.log('DISCORD_WEBHOOK_PATCH_NOTES is not set; skipping.');
  process.exit(0);
}

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const commits = event.commits || [];

function notesFrom(message) {
  const lines = message.split(/\r?\n/);
  const start = lines.findIndex((l) => /^patch notes:\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const notes = [];
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (!text || /^[A-Za-z-]+: /.test(text) && !/^[-*•]/.test(text)) break; // blank line or trailer
    notes.push(text.replace(/^[-*•]\s*/, ''));
  }
  return notes;
}

const notes = commits.flatMap((c) => notesFrom(c.message || ''));
if (!notes.length) {
  console.log(`No patch notes in ${commits.length} commit(s); nothing to post.`);
  process.exit(0);
}

const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' });
let description = notes.map((n) => '• ' + n).join('\n');
if (description.length > 4000) description = description.slice(0, 3990) + '\n…';

fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    embeds: [{
      title: `📝 Patch notes · ${date}`,
      description,
      color: 0xe4b04a,
      footer: { text: 'Run update.bat to get the latest version.' },
      timestamp: new Date().toISOString()
    }]
  })
}).then(async (res) => {
  if (!res.ok) {
    console.error('Discord webhook failed:', res.status, await res.text());
    process.exit(1);
  }
  console.log(`Posted ${notes.length} patch note(s).`);
});
