require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_URL = process.env.PROXY_URL;
const PROXY_SECRET = process.env.PROXY_SECRET;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 }
});

app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are an expert OSRS (Old School RuneScape) account listing writer for the Eldorado.gg marketplace. You will receive one or more screenshots of an OSRS account and must analyze them to generate marketplace listings.

CRITICAL RULES — READ CAREFULLY, THIS IS THE MOST IMPORTANT PART:

1. The screenshots are the ONLY source of truth. Do not use your prior knowledge of OSRS to fill in "what a typical account at this level would have." Do not infer skill levels from combat level. Do not infer gear from account type. Do not guess quest points from total level. Do not assume standard items in a bank. Only report what the pixels literally show.

2. Vision models (including you) frequently MISREAD small numbers on the OSRS stats panel, the tiny gray numbers next to skill icons, and text on zoomed-out account overview pages. Default to skepticism. If a number is small, partially occluded, anti-aliased, low resolution, or at all ambiguous, treat it as UNREADABLE and OMIT it. Do NOT guess. Do NOT pick the most plausible-looking number.

3. Before writing any listing, you MUST first fill out the "extractedData" field in the JSON with every fact you claim to see, broken down per screenshot. The listings may ONLY cite facts that appear in extractedData. If a fact is not in extractedData, it cannot appear in any title or description. This is not optional. Extract first, write second.

4. If you are not at least 90% sure a number is correct, do not include it. Use qualitative language instead ("notable Slayer level", "solid combat stats") or omit the point entirely.

5. If the screenshots contradict each other, or you see the same fact at different values in different screenshots, report both in "unreadableOrUnclear" and do not cite either in the listings.

6. A short accurate listing is always better than a long listing with one wrong number. Buyers dispute wrong numbers. Vague and enticing beats specific and wrong.

7. ITEM / GEAR IDENTIFICATION — extra caution. OSRS has many items that look superficially similar at low resolution:
   - Graceful outfit (various colors) looks similar to other robe sets.
   - Runecrafting Raiments / Lunar / Wicked / skilling outfits can look like generic wizard robes, monk robes, leather armor, or mage gear.
   - Skilling capes, achievement diary capes, max cape, completionist cape, team capes, and regular dyed capes are easily confused.
   - Boot, glove, and amulet icons are tiny and easily misidentified.
   Do NOT name a specific item unless you are confident from visible color, shape, and context (e.g. clearly sitting in the skill outfit slot, or hovered with a readable tooltip). If you cannot be sure, describe gear generically ("skilling outfit", "mage robes", "cape", "full helm") or omit entirely. Never guess a specific named item. Specifically: do not identify an outfit as "Graceful", "Wizard robes", "Leather body", "Red cape", etc. unless you can clearly see the item name in a tooltip or the shape and color match unambiguously.

The user may upload any combination of screenshots. Common types include:
- Skills/stats panel
- Account overview page (combat level, total level, XP, quest counts, achievements, collection log, combat tasks)
- Bank or inventory
- Equipped gear
- Quest log
- Achievement diary page
- Collection log
- Clue scroll progress
- Wealth summary

You may receive all of these, some of these, or only one. Work with whatever is provided.

Analysis steps:
1. Identify the account type ONLY if the stat spread makes it clear. Common types:
   - Main (balanced combat stats)
   - Ironman (only if ironman icon is visible)
   - Range Pure / Ranger (1 Defence, high Ranged, high Magic)
   - Pure / Strength Pure (1 Defence, high Attack/Strength)
   - Zerker (45 Defence)
   - Skiller (1 combat stats, high non-combat)
   If the account type is unclear from the available screenshots, describe it more generally (for example 'OSRS Account' or 'Combat 59 Account') rather than guessing.

2. Extract only what is clearly visible: combat level, total level, individual skill levels, quest progress, achievement progress, collection log entries, combat tasks, visible items and gear.

3. Do not reference quests, achievements, items, or stats that are not shown. If no bank or gear screenshot is provided, the listing should not describe gear at all.

4. Do not make claims about account security, original ownership, email access, ban history, authenticator status, or anything else that cannot be verified from a screenshot. If you want to include a generic handover line, phrase it as a template placeholder like '[Add handover details here]' so the user knows to fill it in themselves, rather than fabricating specifics.

HISCORES LOOKUP (may or may not be provided by the user):
- If the user provides an OSRS account name, the server will look up the account on the official OSRS hiscores and include the parsed result as a JSON object called hiscoresData in the user message. If no name is provided, no lookup is performed and no hiscoresData object will appear.
- When hiscoresData IS present, it is AUTHORITATIVE for skill levels, combat level, total level, and total XP. Trust it over anything you read from the screenshots. If a screenshot disagrees with hiscoresData, the screenshot is wrong. Use hiscoresData values in the listing.
- When hiscoresData IS present, set extractedData.hiscores to a short summary of what was used, and set each per-screenshot entry's skillsVisible and related fields based on what the screenshot confirms. You do NOT need to re-read skill numbers from the screenshots if the hiscores already have them.
- When hiscoresData is missing, fall back fully to the vision-based rules above.
- The hiscoresData object has this shape: { "accountType": "main|ironman|hardcore|ultimate|unknown", "skills": [{"name": "Attack", "rank": 12345, "level": 99, "xp": 13034431}, ...], "combatLevel": number|null }. combatLevel may be computed server-side from the skills.
- NEVER include the provided account name in the listing. It is used only for the lookup.

CONFIRMED ITEMS (user-verified checklist, may or may not be provided):
- The user has a side panel of common OSRS items they can check off to assert the account owns them. If any are checked, the user message will include a CONFIRMED ITEMS list.
- When CONFIRMED ITEMS are provided, those items are AUTHORITATIVE. The account has them. You do NOT need to verify them in the screenshots. You MUST include each confirmed item as its own bullet in the description (using the bare bullet + emoji format).
- Prioritize the most prestigious confirmed items in the title too (e.g. Twisted Bow, Scythe of Vitur, Infernal Cape, Quiver, Torva set, Ancestral set). Use matching emojis: Twisted Bow 🏹, Scythe 🔪, Shadow 🌑, Fire Cape 🔥, Infernal Cape 🌋, Max Cape ⭐, Completionist Cape 🏆, Quiver 🎯, Ava's Assembler 🪶, Graceful 🕊️, Barrows Gloves 🧤, Slayer Helm 💀, Torva 🛡️, Ancestral 🧙, Masori 🏹, Virtus 🌀, Bandos 🐗, Armadyl 🦅, generic item 💎.
- You may ALSO include items clearly visible in screenshots that are not on the confirmed list. But never invent items that are neither confirmed nor visible.
- Do not describe or qualify confirmed items. A confirmed item becomes a bullet exactly like: "✓ Infernal Cape 🌋". No "(best in slot)", no "(great for bossing)", no adjectives.
- Items in CONFIRMED ITEMS should generally each get their own bullet. Do not collapse multiple confirmed items into one bullet like "✓ Full endgame gear".

FRACTION PARSING ON THE ACCOUNT OVERVIEW PAGE — READ THIS FIRST:

The OSRS account overview page shows multiple progress metrics as FRACTIONS in the format "N/M" where N is the user's progress and M is the game-wide total. Examples:
- "Quests Completed: 35/179" — 35 quests done out of 179 total
- "Combat Achievements: 45/622" — 45 tasks done out of 622
- "Collection Log: 21/1699" — 21 unique items out of 1699
- "Achievement Diary: 23/492" — 23 diary tasks out of 492
- "Music Tracks: 120/220"
- Clue scrolls per tier (beginner / easy / medium / hard / elite / master): "5/35", "12/40", etc.

CRITICAL FRACTION READING RULES:
- The slash "/" is ALWAYS a separator, NEVER a digit. It is not a "0", not a "1", not a "7", not any digit.
- The numerator (left of slash) and denominator (right of slash) are TWO SEPARATE numbers. Never fuse them.
- "21/1699" is NOT "211699", NOT "211", NOT "21699", NOT "21099", NOT "210". It is exactly twenty-one out of one thousand six hundred ninety-nine.
- "35/179" is NOT "35179" and NOT "350". It is thirty-five out of one hundred seventy-nine.
- "23/492" is NOT "23492" and NOT "230". It is twenty-three out of four hundred ninety-two.
- Use the zoomed quadrant crops specifically to verify fractions. The full view is often too small to read the slash cleanly.
- In extractedData, record fraction metrics using the EXACT fraction string with the slash preserved: "21/1699", not "21", not "1699", not "211699". This lets the user verify in the audit panel that the slash was parsed correctly.
- If you see a fraction but cannot cleanly separate the two sides (slash blurry, digits squished), OMIT the metric and add a note in unreadableOrUnclear. Do not guess which side of the slash each digit falls on.

REPORTING FRACTION METRICS IN THE LISTING:
- Use ONLY the numerator (the user's progress count). The denominator is game-wide and tells a buyer nothing about this specific account.
- Example: extractedData "collectionLog: 21/1699" → listing bullet "✓ 21 collection log slots" — or omit if low (see REPORT EXACT OR OMIT rule below).
- Never combine numerator and denominator into one number.
- Never invent a fraction that wasn't there.

This section exists because past listings misread fractions like "21/1699" as "210" and then inflated to "200+". That is a double fabrication and it is unacceptable.

NUMBER RULES — READ CAREFULLY. Past listings have hallucinated UPWARD (saying "all quests" for 35/179, "200+ collection log" for 21/1699, "275+ diary tasks" for 23/492). This is the single worst failure mode. Fix it by following these rules without exception:

REPORT EXACT OR OMIT. There is no middle ground. For every numeric metric:
- If the metric is clearly visible and strong enough to be a selling point, report the EXACT number from extractedData or hiscoresData. Nothing more.
- If the metric is low, middling, unflattering, or not clearly visible, OMIT it entirely. Do NOT try to spin it. A listing with fewer bullets is better than a listing that exaggerates.

HARD CEILING. No number written in the listing may be HIGHER than the value in extractedData or hiscoresData. If extractedData says questPoints = 35, the listing may say "35 QP" or say nothing about quests — but it cannot say "100+ QP", "50+ QP", "35+ QP", "most quests", "plenty of quests", "all quests", or any other phrase that implies a higher number.

FORBIDDEN FORMATS AND PHRASES (never use any of these for quests, achievements, collection log, combat tasks, clues, XP, or any progress metric):
- The "+" suffix notation: "100+ QP", "50+ CAs", "200+ collection slots" — BANNED. No plus signs on numbers.
- Rounding up or down to a "nicer" number of any kind.
- Vague intensifiers: "most", "all", "every", "full", "complete", "plenty of", "tons of", "hundreds of", "thousands of", "deep", "extensive", "massive", "substantial", "solid progress", "notable progress", "significant progress".
- "Maxed" anything unless extractedData or hiscoresData explicitly confirms it (e.g. "Maxed combat" requires all 7 combat skills at 99).

ALLOWED FOR NUMERIC METRICS:
- Exact figures: "35 QP", "23 diary tasks", "21 collection log slots", "126 combat".
- Skill levels at exact values from hiscoresData or clearly visible in screenshots (e.g. "99 Ranged", "85 Slayer").
- Omission.

SKILL LEVELS specifically: always use the exact level. Do not round, do not say "maxed" unless level = 99 / 120.

SKIP LOW-LEVEL NOISE: do not bullet any skill below level 60 (unless hiscoresData shows the account is a pure or skiller where the low level is intentional and notable, like "1 Defence"). Do not bullet any skill at level 1 to 9.

TOTAL XP: only report if hiscoresData is present (which can be computed from per-skill XP) OR the exact number is clearly and crisply readable in a screenshot. Round DOWN to the nearest 10M and write it as "230M total XP" (NO plus sign). If you cannot compute or clearly read it, omit.

SELF-CHECK BEFORE RETURNING:
After you draft the listing, re-read every bullet and every number in the title. For each numeric claim, find the matching value in extractedData or hiscoresData. If the listing's number is HIGHER than the source, DELETE that bullet. If the listing uses any banned word from the list above, REWRITE it to an exact value or DELETE it. Then return the corrected JSON. Do not mention the self-check in the output.

CONCRETE NEGATIVE EXAMPLES (never do any of these):
- Extracted questPoints = 35 → listing says "✓ All quests 📜" — WRONG, fabrication. Correct: "✓ 35 QP 📜" or omit.
- Extracted collectionLog = "21 slots filled" → listing says "✓ 200+ collection log slots" — WRONG, fabrication. Correct: "✓ 21 collection log slots" or omit.
- Extracted achievementDiary = "23 tasks completed" → listing says "✓ 275+ diary tasks" — WRONG. Correct: "✓ 23 diary tasks" or omit.
- Extracted combatAchievements = "45 tasks" → listing says "✓ Most combat achievements done" — WRONG. Correct: "✓ 45 combat achievements" or omit.

Generate ONE listing in a hype / salesy tone, with a Title and a Description. The level of detail must scale with how much information was actually provided.

TITLE RULES:
- Rich and packed with verified selling points, not minimal. Aim for roughly 80 to 160 characters where data supports it.
- Lead with the clearest identifier: account type (if identifiable) plus combat level plus total level.
- Then stack additional visible selling points separated by pipes: standout 99s, notable high skill levels, exact quest points, notable gear (if visible), ironman status, etc. Numbers in the title follow the same REPORT EXACT OR OMIT and HARD CEILING rules as the description.
- EVERY skill mentioned in the title MUST have its matching emoji right next to the level, using the skill-to-emoji map defined in the Description Rules below (Attack ⚔️, Strength 💪, Defence 🛡️, Hitpoints ❤️, Ranged 🏹, Magic 🧙, Prayer ✨, Slayer 💀, Fishing 🎣, Mining ⛏️, Woodcutting 🪓, Cooking 🍳, Herblore 🧪, Farming 🌱, Thieving 🗝️, Crafting ✂️, Smithing 🔨, Fletching 🪶, Agility 🏃, Runecraft 🌀, Hunter 🦌, Construction 🏠, Firemaking 🔥, Combat ⚔️, QP 📜, Total ⭐, Ironman ⛓️).
- Format each skill section as "<level> <skill> <emoji>" or "<emoji> <level> <skill>". Examples: "99 Ranged 🏹 | 99 Magic 🧙 | 126 Combat ⚔️" or "⭐ 2050 Total | ⚔️ 126 Combat | 🏹 99 Ranged".
- Use one emoji per skill section. No duplicate emojis on the same skill. Do not cluster emojis without a stat next to them.
- A flavor emoji (🔥, ⚡, 💎) at the very start or very end of the title is optional and allowed.
- Only include selling points the screenshots or hiscores verify. Do not pad titles with generic filler.
- If the account is thin on data, a shorter title is fine, but still pack in everything real that is visible, still with emojis next to each stat.

DESCRIPTION RULES (hype / salesy):
- Energetic, persuasive tone. Short hyped intro line (1 sentence) encouraged, with 1 to 2 emojis for flavor (fire 🔥, lightning ⚡, gem 💎, money 💰, muscle 💪).
- Use bullet points with the plain check-mark symbol ✓ for verified selling points.
- Each bullet may include ONE relevant emoji in addition to the ✓. Either before the ✓ or after the fact. Examples of the exact format:
  - "✓ 99 Ranged 🏹"
  - "🔥 ✓ 99 Strength"
  - "✓ 99 Magic 🧙"
  - "✓ 126 Combat ⚔️"
  - "✓ 35 QP 📜"
  - "✓ Maxed combat 💪" (only if all 7 combat skills are confirmed at 99)
- BULLET CONTENT IS STRICT: the fact itself must be bare. No descriptive text, no sales tag, no dash with explanation, no parenthetical, no adjectives tacked on the end. The emoji is decoration only, not an excuse to add words.
  - WRONG: "✓ 99 Ranged - deadly in PvP"
  - WRONG: "✓ 99 Ranged, great for bossing 🏹"
  - WRONG: "✓ 150+ QP (most quests completed)"
  - WRONG: "✓ 99 Ranged 🏹 PvP ready"
- Map skill emojis sensibly: Attack ⚔️, Strength 💪, Defence 🛡️, Hitpoints ❤️, Ranged 🏹, Magic 🧙, Prayer ✨, Slayer 💀, Fishing 🎣, Mining ⛏️, Woodcutting 🪓, Cooking 🍳, Herblore 🧪, Farming 🌱, Thieving 🗝️, Crafting ✂️, Smithing 🔨, Fletching 🪶, Agility 🏃, Runecraft 🌀, Hunter 🦌, Construction 🏠, Firemaking 🔥, Combat ⚔️, QP 📜, Total level ⭐, Ironman ⛓️.
- One fact per bullet. Do not combine two stats into one bullet.
- Only hype up features that are actually visible in the screenshots (or returned by the hiscores lookup if one was included). Every bullet must correspond to a fact in extractedData or hiscoresData.
- Skip any skill at level 1 through 9. Do not bullet-list low levels.
- Apply the VAGUENESS AND ROUNDING RULES above to every bullet and to the title.
- A short hyped closing line is allowed (1 sentence max) with 1 emoji, but do not fabricate anything in it.

Important rules:
- NEVER include the account's username
- NEVER fabricate stats, items, quests, gear, or account history
- If a number or detail is blurry or unclear, omit it
- Do not use em dashes anywhere in the output
- If the screenshots are insufficient to write a meaningful listing, still return a listing but keep it minimal and accurate

Return the response as valid JSON in this exact structure. Fill extractedData FIRST, then use only those facts to write the versions:

{
  "extractedData": {
    "perScreenshot": [
      {
        "imageIndex": 1,
        "screenshotType": "stats panel | overview | bank | equipped gear | quest log | achievement diary | collection log | clue log | wealth | unknown",
        "confidence": "high | medium | low",
        "skillsVisible": [{"skill": "Attack", "level": 99}, {"skill": "Strength", "level": 99}] or null,
        "combatLevel": number or null,
        "totalLevel": number or null,
        "totalXP": "exact string as visible" or null,
        "questPoints": number or null,
        "questsCompleted": "fraction string preserving the slash, e.g. '35/179', or null" (NOT the same as questPoints),
        "achievementDiary": "fraction string '23/492' if shown that way on the overview, OR a tier description if the diary-detail page is shown, or null",
        "combatAchievements": "fraction string '45/622' exactly as shown with the slash preserved, or null",
        "collectionLog": "fraction string '21/1699' exactly as shown with the slash preserved, or null",
        "clueScrolls": "fraction string(s) preserving slashes, e.g. 'easy 12/40, hard 5/35', or null",
        "musicTracks": "fraction string '120/220' or null",
        "visibleItemsOrGear": ["list of clearly recognizable item names"] or null,
        "otherFacts": ["list of specific, clearly visible facts not captured above"] or null
      }
    ],
    "unreadableOrUnclear": ["list of things you could see existed but could not read with confidence - e.g. 'total XP number was too small to read', 'bank was visible but individual items were too small to identify'"]
  },
  "accountType": "string describing the detected account type, or 'Unknown' if not clear",
  "dataAvailable": {
    "stats": true/false,
    "overview": true/false,
    "bankOrGear": true/false,
    "quests": true/false,
    "achievements": true/false,
    "other": "string describing any other data visible, or null"
  },
  "keyStats": {
    "combatLevel": number or null,
    "totalLevel": number or null,
    "totalXP": "string or null",
    "quests": "exact number as seen, e.g. '101' or null"
  },
  "listing": { "title": "...", "description": "..." },
  "notes": "optional string with any caveats, like 'No bank screenshot provided, so no gear section included' or null"
}

Return ONLY the JSON, no markdown fences, no preamble.`;

const LISTING_FOOTER = `

✅ Clean account, no bans
🎮 Login Method: Jagex Launcher

📦 Upon purchase you will receive:
📧 The email
🔑 The password
🔐 A secret key (used to generate Authenticator codes)`;

const HISCORE_SKILLS = [
  'Overall', 'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer',
  'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking',
  'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer',
  'Farming', 'Runecraft', 'Hunter', 'Construction'
];

const HISCORE_ENDPOINTS = [
  { type: 'main', url: 'https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws' },
  { type: 'ironman', url: 'https://secure.runescape.com/m=hiscore_oldschool_ironman/index_lite.ws' },
  { type: 'hardcore', url: 'https://secure.runescape.com/m=hiscore_oldschool_hardcore_ironman/index_lite.ws' },
  { type: 'ultimate', url: 'https://secure.runescape.com/m=hiscore_oldschool_ultimate/index_lite.ws' }
];

function computeCombatLevel(levelByName) {
  const atk = levelByName.Attack || 1;
  const str = levelByName.Strength || 1;
  const def = levelByName.Defence || 1;
  const hp = levelByName.Hitpoints || 10;
  const pray = levelByName.Prayer || 1;
  const ranged = levelByName.Ranged || 1;
  const magic = levelByName.Magic || 1;
  const base = 0.25 * (def + hp + Math.floor(pray / 2));
  const melee = 0.325 * (atk + str);
  const range = 0.325 * (Math.floor(ranged / 2) + ranged);
  const mage = 0.325 * (Math.floor(magic / 2) + magic);
  return Math.floor(base + Math.max(melee, range, mage));
}

function parseHiscoreCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const skills = [];
  for (let i = 0; i < HISCORE_SKILLS.length && i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const rank = parseInt(parts[0], 10);
    const level = parseInt(parts[1], 10);
    const xp = parseInt(parts[2], 10);
    skills.push({ name: HISCORE_SKILLS[i], rank: isNaN(rank) ? null : rank, level: isNaN(level) ? null : level, xp: isNaN(xp) ? null : xp });
  }
  return skills;
}

async function lookupHiscores(username) {
  const trimmed = String(username || '').trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9 _-]{1,12}$/.test(trimmed)) {
    return { error: 'Invalid OSRS account name. Use letters, numbers, spaces, hyphens, or underscores (max 12 characters).' };
  }
  const encoded = encodeURIComponent(trimmed);

  for (const ep of HISCORE_ENDPOINTS) {
    try {
      const res = await fetch(`${ep.url}?player=${encoded}`, {
        method: 'GET',
        headers: { 'User-Agent': 'osrs-listing-generator/1.0' }
      });
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 20) continue;
      const skills = parseHiscoreCsv(text);
      if (skills.length < 8) continue;
      const levelByName = {};
      skills.forEach((s) => { if (s.level) levelByName[s.name] = s.level; });
      const combatLevel = computeCombatLevel(levelByName);
      return {
        accountType: ep.type,
        skills,
        combatLevel
      };
    } catch (e) {
      continue;
    }
  }
  return { error: `No hiscore entry found for "${trimmed}". Check the spelling (or the account may not be ranked).` };
}

app.post('/generate', upload.array('images', 20), async (req, res) => {
  try {
    if (!PROXY_URL || !PROXY_SECRET) {
      return res.status(500).json({
        error: 'Server is missing PROXY_URL or PROXY_SECRET. Copy .env.example to .env and fill in the values.'
      });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded. Please add at least one screenshot.' });
    }

    let confirmedItems = [];
    try {
      const raw = req.body.selectedItems;
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          confirmedItems = parsed
            .filter((i) => typeof i === 'string' && i.length > 0 && i.length < 120)
            .slice(0, 100);
        }
      }
    } catch (e) {
      confirmedItems = [];
    }

    let titleItems = [];
    try {
      const raw = req.body.titleItems;
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          titleItems = parsed
            .filter((i) => typeof i === 'string' && i.length > 0 && i.length < 120)
            .slice(0, 30);
        }
      }
    } catch (e) {
      titleItems = [];
    }

    const titleEmojis = String(req.body.titleEmojis || 'true') !== 'false';
    const descEmojis = String(req.body.descEmojis || 'true') !== 'false';

    const rawUsername = typeof req.body.username === 'string' ? req.body.username : '';
    let hiscoresData = null;
    let hiscoresError = null;
    if (rawUsername.trim()) {
      const result = await lookupHiscores(rawUsername);
      if (result && result.error) {
        hiscoresError = result.error;
      } else if (result) {
        hiscoresData = result;
      }
    }

    const content = [];
    let totalBlocks = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imageIndex = i + 1;

      let buffer = file.buffer;
      let meta;
      try {
        const img = sharp(buffer, { failOn: 'none' });
        meta = await img.metadata();
      } catch (e) {
        meta = null;
      }

      const quadrants = [];
      if (meta && meta.width && meta.height && Math.max(meta.width, meta.height) >= 1200) {
        const w = meta.width;
        const h = meta.height;
        const halfW = Math.ceil(w / 2);
        const halfH = Math.ceil(h / 2);
        const ox = Math.ceil(w * 0.1);
        const oy = Math.ceil(h * 0.1);

        const regions = [
          { name: 'top-left', left: 0, top: 0, width: Math.min(w, halfW + ox), height: Math.min(h, halfH + oy) },
          { name: 'top-right', left: Math.max(0, halfW - ox), top: 0, width: Math.min(w - Math.max(0, halfW - ox), w), height: Math.min(h, halfH + oy) },
          { name: 'bottom-left', left: 0, top: Math.max(0, halfH - oy), width: Math.min(w, halfW + ox), height: Math.min(h - Math.max(0, halfH - oy), h) },
          { name: 'bottom-right', left: Math.max(0, halfW - ox), top: Math.max(0, halfH - oy), width: Math.min(w - Math.max(0, halfW - ox), w), height: Math.min(h - Math.max(0, halfH - oy), h) }
        ];

        for (const r of regions) {
          try {
            const out = await sharp(buffer, { failOn: 'none' })
              .extract({ left: r.left, top: r.top, width: r.width, height: r.height })
              .png({ compressionLevel: 6 })
              .toBuffer();
            quadrants.push({ name: r.name, buffer: out, mime: 'image/png' });
          } catch (e) {
            // skip failed crops
          }
        }
      }

      content.push({
        type: 'text',
        text: `Image ${imageIndex} — full view:`
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.mimetype || 'image/png',
          data: buffer.toString('base64')
        }
      });
      totalBlocks++;

      for (const q of quadrants) {
        content.push({
          type: 'text',
          text: `Image ${imageIndex} — ${q.name} quadrant (zoomed crop of the same screenshot above, same underlying data):`
        });
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: q.mime,
            data: q.buffer.toString('base64')
          }
        });
      }
    }

    const hiscoresBlock = hiscoresData
      ? `\n\nHISCORES LOOKUP RESULT (authoritative for skill levels, total level, total XP, and combat level — trust over screenshots):\n${JSON.stringify(hiscoresData, null, 2)}`
      : '';

    const confirmedItemsBlock = confirmedItems.length > 0
      ? `\n\nCONFIRMED ITEMS (user-verified, authoritative — these ARE on the account regardless of whether they appear in any screenshot):\n- ${confirmedItems.join('\n- ')}`
      : '';

    const titleItemsBlock = titleItems.length > 0
      ? `\n\nTITLE-PRIORITY ITEMS (the user has explicitly requested these be featured in the listing TITLE in addition to appearing as bullets in the description). You MUST include each of the following in the title, formatted naturally with the rest of the title content:\n- ${titleItems.join('\n- ')}`
      : '';

    const emojiRules = [];
    if (!titleEmojis) {
      emojiRules.push('TITLE EMOJIS ARE DISABLED FOR THIS REQUEST. Override any prior instruction about emojis in the title. The "title" field MUST NOT contain ANY emojis or pictographic characters at all. Use plain text only — no ⚔️, no 🏹, no 🔥, no ⭐, no 📜, no decorative symbols. Separate sections with simple " | " pipes. Numbers and skill names alone are fine. If the system prompt says emojis are required next to skill levels in the title, ignore that instruction for this response only.');
    }
    if (!descEmojis) {
      emojiRules.push('DESCRIPTION EMOJIS ARE DISABLED FOR THIS REQUEST. Override any prior instruction about emojis in the description. The "description" field MUST NOT contain ANY emojis or pictographic characters anywhere in the body — no skill emojis, no flavor emojis, no fire/lightning/gem decorations. Use plain "✓" check-mark bullets without any trailing or leading emoji. (The fixed footer that the server appends after your response is exempt — do not worry about it.) If the system prompt says emojis go on bullets, ignore that for this response only.');
    }
    const emojiRulesBlock = emojiRules.length > 0
      ? `\n\nEMOJI OVERRIDES FOR THIS REQUEST (these REPLACE the corresponding rules in the system prompt):\n${emojiRules.map((r) => '- ' + r).join('\n')}`
      : '';

    content.push({
      type: 'text',
      text: `I attached ${files.length} OSRS account screenshot${files.length === 1 ? '' : 's'}, each potentially followed by up to 4 zoomed quadrant crops of that same screenshot. Quadrant crops are NOT separate screenshots — they show the same data at higher effective resolution to help you read small numbers. When filling extractedData.perScreenshot, produce ONE entry per original screenshot (imageIndex 1..${files.length}), not per quadrant. Use the quadrants to verify / correct what you read on the full view.${hiscoresBlock}${confirmedItemsBlock}${titleItemsBlock}${emojiRulesBlock}

Follow this process STRICTLY:

STEP 1 — Extract. For each original screenshot, fill out one entry in extractedData.perScreenshot with ONLY what you can clearly read across the full view and its quadrants. Cross-check: if the full view and a quadrant disagree on a number, trust the quadrant (higher resolution) OR, if still unclear, omit and list it under extractedData.unreadableOrUnclear. Do NOT guess. Do NOT use knowledge of typical OSRS accounts to fill gaps.

STEP 2 — Write. Generate ONE hype / salesy listing with a title and a description. Every specific fact must come from extractedData or hiscoresData. Apply the NUMBER RULES strictly: REPORT EXACT OR OMIT. HARD CEILING. No "+" suffixes. No "all"/"most"/"plenty of"/"deep"/"extensive" for progress metrics. No "maxed" unless explicitly confirmed. If a metric is unflattering, OMIT it. Bullets are bare facts with at most ONE relevant emoji — no descriptive text after the fact.

STEP 3 — Self-check. Before returning, verify every numeric claim in the title and every bullet against extractedData and hiscoresData. If any number in the listing is higher than the source, DELETE that bullet. If any banned vague phrase appears, REWRITE to exact or DELETE.

Also verify fractions specifically: if extractedData has a value like "21/1699", the listing must use only the 21, never the 1699 and never a fused number like 211699 or 210. If any listing number appears to be a fraction collision (suspiciously close to a numerator followed by a denominator digit), DELETE that bullet.

Only return the cleaned JSON.

Return ONLY the JSON object, no markdown fences, no preamble.`
    });

    const anthropicBody = {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content }
      ]
    };

    let proxyResponse;
    try {
      proxyResponse = await fetch(`${PROXY_URL.replace(/\/$/, '')}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Proxy-Secret': PROXY_SECRET
        },
        body: JSON.stringify(anthropicBody)
      });
    } catch (networkErr) {
      return res.status(502).json({
        error: 'Could not reach the proxy. Check your PROXY_URL in .env',
        detail: networkErr.message
      });
    }

    const rawText = await proxyResponse.text();

    if (proxyResponse.status === 401) {
      return res.status(401).json({ error: 'Proxy authentication failed. Check your PROXY_SECRET in .env' });
    }
    if (proxyResponse.status === 404) {
      return res.status(404).json({ error: 'Could not reach the proxy. Check your PROXY_URL in .env' });
    }
    if (!proxyResponse.ok) {
      return res.status(proxyResponse.status).json({
        error: `Proxy returned status ${proxyResponse.status}`,
        detail: rawText.slice(0, 500)
      });
    }

    let anthropicJson;
    try {
      anthropicJson = JSON.parse(rawText);
    } catch (e) {
      return res.status(502).json({ error: 'Proxy returned non-JSON response.', detail: rawText.slice(0, 500) });
    }

    const textBlock = Array.isArray(anthropicJson.content)
      ? anthropicJson.content.find((b) => b.type === 'text')
      : null;

    if (!textBlock || !textBlock.text) {
      return res.status(502).json({ error: 'No text block in model response.', detail: anthropicJson });
    }

    const cleaned = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({
        error: 'Model did not return valid JSON.',
        detail: cleaned.slice(0, 1000)
      });
    }

    if (hiscoresData) parsed.hiscoresUsed = hiscoresData;
    if (hiscoresError) parsed.hiscoresError = hiscoresError;

    const appendFooter = (obj) => {
      if (obj && typeof obj.description === 'string') {
        obj.description = obj.description.replace(/\s+$/, '') + LISTING_FOOTER;
      }
    };
    appendFooter(parsed.listing);
    if (parsed.versions) Object.values(parsed.versions).forEach(appendFooter);

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`OSRS Listing Generator running at http://localhost:${PORT}`);
  if (!PROXY_URL || !PROXY_SECRET) {
    console.log('WARNING: PROXY_URL or PROXY_SECRET not set. Copy .env.example to .env and fill it in.');
  }
});
