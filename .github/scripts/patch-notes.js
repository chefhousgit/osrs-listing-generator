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
//
// Run by hand (workflow_dispatch) it posts .github/patch-notes-history.md instead: one message per
// "## Heading" section, oldest first. That was the one-time catch-up of everything before this
// existed; it can be re-run if the channel ever needs re-filling.

const fs = require('fs');

const webhook = process.env.DISCORD_WEBHOOK_PATCH_NOTES;
if (!webhook) {
  console.log('DISCORD_WEBHOOK_PATCH_NOTES is not set; skipping.');
  process.exit(0);
}

async function post(embed) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
  if (!res.ok) {
    console.error('Discord webhook failed:', res.status, await res.text());
    process.exit(1);
  }
}

if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
  const text = fs.readFileSync('.github/patch-notes-history.md', 'utf8').replace(/\r\n/g, '\n');
  const sections = text.split(/^## /m).map((s) => s.trim()).filter(Boolean);
  (async () => {
    for (const section of sections) {
      const [heading, ...lines] = section.split('\n');
      const bullets = lines.map((l) => l.trim()).filter((l) => /^[-*•]/.test(l)).map((l) => '• ' + l.replace(/^[-*•]\s*/, ''));
      await post({ title: '📝 ' + heading.trim(), description: bullets.join('\n').slice(0, 4000), color: 0xe4b04a });
      await new Promise((r) => setTimeout(r, 1200)); // stay under Discord's webhook rate limit
    }
    console.log(`Posted ${sections.length} history section(s).`);
  })();
  return;
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
