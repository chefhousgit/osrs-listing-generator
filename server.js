require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

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

CRITICAL RULE: Only include information that is clearly visible in the screenshots. Never fabricate, guess, estimate, or invent any details. If something is not shown, do not mention it. It is far better to produce a shorter listing with only verified information than to include anything that could be inaccurate.

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

2. Extract only what is clearly visible: combat level, total level, total XP, quest progress, achievement progress, collection log entries, combat tasks, individual skill levels, visible items and gear.

3. Do not reference quests, achievements, items, or stats that are not shown. If no bank or gear screenshot is provided, the listing should not describe gear at all.

4. Do not make claims about account security, original ownership, email access, ban history, authenticator status, or anything else that cannot be verified from a screenshot. If you want to include a generic handover line, phrase it as a template placeholder like '[Add handover details here]' so the user knows to fill it in themselves, rather than fabricating specifics.

Generate three versions, each with a Title and Description. The level of detail in each version must scale with how much information was actually provided. If only one screenshot is uploaded with limited data, all three versions should still be distinct in tone but shorter in length.

VERSION 1 - Professional and Concise
- Clean, factual title with key visible stats separated by pipes
- 2-3 short paragraphs covering only what is shown
- No emojis, no hype language

VERSION 2 - Hype / Salesy
- Title uses fire/bow/relevant emojis sparingly
- Bullet points with checkmarks for verified selling points only
- Energetic, persuasive tone
- Only hype up features that are actually visible in the screenshots

VERSION 3 - Detailed and Thorough
- Comprehensive title with major visible stats
- Organized sections with bold headers. Only include sections where you have real data:
  - Account Type (only if clearly identifiable)
  - Combat Profile (only if combat stats visible)
  - Key Skill Levels (only skills visible in screenshots)
  - Progression (only metrics visible on overview page)
  - Gear Included (only if bank or gear screenshot provided)
  - Why This Account (brief, based only on verified strengths)
- Skip any section entirely if the relevant screenshot was not provided

Important rules:
- NEVER include the account's username in any version
- NEVER fabricate stats, items, quests, gear, or account history
- If a number or detail is blurry or unclear, omit it
- Do not use em dashes anywhere in the output
- If the screenshots are insufficient to write a meaningful listing, still return the three versions but keep them minimal and accurate

Return the response as valid JSON in this exact structure:

{
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
    "quests": "string like '101/179' or null"
  },
  "versions": {
    "professional": { "title": "...", "description": "..." },
    "hype": { "title": "...", "description": "..." },
    "detailed": { "title": "...", "description": "..." }
  },
  "notes": "optional string with any caveats, like 'No bank screenshot provided, so no gear section included' or null"
}

Return ONLY the JSON, no markdown fences, no preamble.`;

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

    const imageBlocks = files.map((file) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimetype || 'image/png',
        data: file.buffer.toString('base64')
      }
    }));

    const anthropicBody = {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: 'Analyze these OSRS account screenshots and generate the three listing versions. Only include information clearly visible in the screenshots.'
            }
          ]
        }
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
