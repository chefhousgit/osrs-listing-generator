# OSRS Listing Generator

A local web app that analyzes Old School RuneScape (OSRS) account screenshots and generates an Eldorado.gg-style listing: a stat-packed title, a one-sentence description with a fixed handover/terms footer, and the screenshots to attach (with any skills you chose to black out).

Runs on Claude Sonnet 5 through a Cloudflare Worker proxy.

The app never talks to the Anthropic API directly. Instead, it forwards requests to a Cloudflare Worker proxy that holds the Anthropic API key as an encrypted secret. Your local machine only needs the proxy URL and a shared secret.

## How it works

```
Browser  →  Local Express server  →  Cloudflare Worker proxy  →  Anthropic API
```

- The Anthropic API key lives only on the Cloudflare Worker.
- Your local `.env` contains the proxy URL and a shared secret password.
- Screenshots are uploaded to the local server, base64-encoded, wrapped into an Anthropic messages request, and sent to the proxy.

## Prerequisites

- Node.js 18 or later (needs native `fetch`)
- A deployed Cloudflare Worker proxy (see `CLOUDFLARE_SETUP.md` for that side of things)
- The proxy URL and shared secret from that deployment

## Setup

1. Clone the repo:
   ```
   git clone https://github.com/<your-username>/osrs-listing-generator.git
   cd osrs-listing-generator
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Copy the example environment file:
   ```
   cp .env.example .env
   ```

4. Open `.env` and fill in:
   - `PROXY_URL` — your Cloudflare Worker URL, for example `https://osrs-proxy.your-subdomain.workers.dev`
   - `PROXY_SECRET` — the long random string you configured on the Worker as the `PROXY_SECRET` secret

5. Start the app:
   ```
   npm start
   ```

6. Open http://localhost:3000 in your browser.

## How to use

1. Optionally type the OSRS account name. Skill levels are then pulled from the official hiscores and trusted over the screenshots. The name is never shown in the listing.
2. Drag screenshots onto the drop zone, or click to browse. Any combination works: stats panel, bank, gear, quest log, achievements, overview page, collection log, clue scroll progress, etc.
3. Pick the options that apply:
   - **Account type** — Auto lets the model decide from the screenshots. Main / Ironman / HCIM / UIM force it: the title leads with the type (for example `1007 Total Level Hardcore Ironman | HCIM | ...`) and the description calls it that kind of account.
   - **Login method** — picks the handover lines in the footer. Legacy email lists the login email and legacy password; Jagex Launcher lists email, password, and authenticator key.
   - **Title / Description emojis** — toggle emojis on or off for each.
   - **Gear** (side tab) — tick items the account actually has. These override anything the model might misread. The ★ Title pill forces an item into the title.
4. Optionally black out skills. Click **Redact skills** on a stats-tab preview:
   - The first time, drag one box from the top-left corner of the Attack cell to the bottom-right corner of the Sailing cell (bottom-right of the grid). The grid is remembered in your browser for later screenshots.
   - Click skill names to black out their cells, or drag anywhere on the image to draw a box. Undo and Clear all are available.
   - **Save image** downloads the redacted PNG. **Apply to upload** swaps the redacted image in for the original, so the model never sees the hidden skills. They are also removed from any hiscores data and the model is told not to mention them.
5. Click **Generate Listings**.
6. Copy the **Title** and the **Description** (editable before copying). The description is one general sentence followed by the fixed footer: clean-account line, handover details, and terms and conditions.
7. Under the description, **Images to upload with the listing** shows each screenshot as the model saw it, with a **Save image** button.
8. Hit **Clear** to reset and run another account.

The app only uses information visible in your screenshots or returned by the hiscores. Numbers are reported exactly or omitted; nothing is rounded up or invented. If a number looks off, open the **Debug** panel under the listing to see what the model claims to have read.

## Security notes

- The Anthropic API key is **never** stored on this machine. It lives only on the Cloudflare Worker as an encrypted secret.
- The local `.env` file contains only the proxy URL and the shared secret password.
- `.env` is gitignored so it will never be committed.
- Uploaded screenshots are held in memory during the request and are not written to disk.

## Troubleshooting

- **"Proxy authentication failed"** — your `PROXY_SECRET` in `.env` does not match the one set on the Cloudflare Worker. Regenerate or re-copy it.
- **"Could not reach the proxy"** — check `PROXY_URL` in `.env`. It should be the full `https://...workers.dev` URL, no trailing slash, no `/generate` suffix.
- **Server starts but generation fails silently** — check the terminal running `npm start` for error logs.

## Project layout

```
osrs-listing-generator/
├── .env.example
├── .gitignore
├── package.json
├── server.js              Express server: prompt, hiscores lookup, quadrant crops, footer, proxy call
├── start.bat / update.bat Windows helpers: launch the app / git pull latest
├── public/
│   ├── index.html         Single-page UI
│   ├── style.css          Dark OSRS-flavored theme
│   ├── app.js             Frontend logic: uploads, options, gear drawer, results
│   └── redact.js          Skill blackout tool (calibrated skills grid + free-hand boxes)
├── worker/
│   ├── worker.js          Cloudflare Worker proxy script
│   └── wrangler.toml      Worker deployment config
└── README.md
```

## License

Personal use. No warranty.
