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

0. Optional, with `ACCOUNTS_DIR` set (see **Account folders** below): pick the account under **Account folder** at the top. It loads that folder's screenshots and fills in the account name, account type and ban history for you.
1. Optionally type the OSRS account name. Skill levels are then pulled from the official hiscores and trusted over the screenshots. The name is never shown in the listing.
2. Drag screenshots onto the drop zone, or click to browse. Any combination works: stats panel, bank, gear, quest log, achievements, overview page, collection log, clue scroll progress, etc.
3. Pick the options that apply:
   - **Account type** — Auto works it out: with an account name, from the official hiscores (the most specific of the ultimate / hardcore / ironman boards whose total XP still matches the main board, so a dead HCIM counts as Ironman and a de-ironed account as Main); without one, the model decides from the screenshots. Main / Ironman / HCIM / UIM force it: the title leads with the type (for example `1007 Total Level Hardcore Ironman | HCIM | ...`) and the description calls it that kind of account.
   - **Ban history** — Clean (default) puts `✅ Clean account, no bans` at the top of the footer; Had a ban before leaves it out.
   - **Login method** — picks the handover lines in the footer. Legacy email lists the login email and legacy password; Jagex Launcher lists email, password, and authenticator key.
   - **Title / Description emojis** — toggle emojis on or off for each.
   - **Gear** (side tab) — tick items the account actually has. These override anything the model might misread. The ★ Title pill forces an item into the title.
4. Optionally black out skills. Click **Redact skills** on a stats-tab preview:
   - The first time, drag one box from the top-left corner of the Attack cell to the bottom-right corner of the Sailing cell (bottom-right of the grid). The grid is remembered in your browser for later screenshots.
   - Click skill names to black out their cells, or drag anywhere on the image to draw a box. Undo and Clear all are available.
   - **Save image** downloads the redacted PNG. **Apply to upload** swaps the redacted image in for the original, so the model never sees the hidden skills. They are also removed from any hiscores data and the model is told not to mention them.
5. Click **Generate Listings**.
6. Copy the **Title** and the **Description** (editable before copying). With Eldorado set up, these live in the **Publish to Eldorado** panel instead (see below). The description is a fixed sentence (`Great foundation for a main account / an ironman account / a hardcore ironman account / an ultimate ironman account with many skills trained and resources banked.`, using the forced or detected account type) followed by the fixed footer: handover details (per login method) and terms and conditions. The same footer is used for every account type.
7. Under the description, **Images to upload with the listing** shows each screenshot as the model saw it, with a **Save image** button.
8. Optionally click **Build listing card** (next to Generate; works as soon as screenshots are uploaded) to combine them into one OSRS-style framed image: stone border, afkVault logo next to the title, yellow tags, optional "Member till" date and price, your chosen screenshots side by side (up to 3, redacted ones pre-selected and used as redacted), and a faded afkVault watermark over the panel. Opacity slider and tags are remembered in your browser. **Save image** downloads the PNG.
9. After the sale, open **Buyer handover message** (under the option pills), paste the 2FA secret key, and hit **Copy message**. The RSN fills in from the account name box.
10. Hit **Clear** to reset and run another account.

## Account folders (optional)

Keep one folder per account you want to list inside a main folder, and point the app at it in `.env`:

```
ACCOUNTS_DIR=C:\Users\you\Desktop\Accounts
```

- **Folder name** = the account name (RSN), optionally followed by ` - <tag>` suffixes, in any order:
  - type: `hcim` or `hc` (HCIM), `uim`, `im` / `iron` (Ironman), `main`. No type tag = Auto (worked out from the hiscores).
  - `temp`: the account had a temporary ban, so Ban history is set to **Had a ban before**.
  - Examples: `Zezima`, `Zezima - hc`, `Zezima - hc - temp`.
- **Inside each folder**: the screenshots (png / jpg / webp, loaded in file-name order) and one `.txt` file with an `email:password:key` line. Any name works (for example an EternalFarms `accounts-export-....txt`); the first valid line is used.
- Picking a folder in **Account folder** clears the page, loads the screenshots, and sets the account name, type and ban history. After Generate, the publish panel fills the login, password and 2FA key from that `.txt` file (the key also goes into the buyer handover message).
- After a successful publish the folder is moved to `ACCOUNTS_DIR\Listed\` (with ` (2)` added if the name is taken), so the picker only shows accounts still to list. **Reload** re-reads the main folder.

## Publishing to Eldorado (optional)

With Eldorado seller API credentials in `.env`, every generated listing opens straight into a **Publish to Eldorado** panel in the results, already filled in. It builds the listing card, uploads it as the offer's main image, creates the listing as an OSRS account offer, and pauses it straight away so you can check it before it goes live.

1. On Eldorado, open **Dashboard → Seller API** and generate credentials. The client secret is shown only once.
2. Add them to `.env` and restart the app:
   ```
   ELDORADO_CLIENT_ID=...
   ELDORADO_CLIENT_SECRET=...
   ```
3. Generate a listing; the panel appears with the title and description (both editable). Enter a **price**. Everything else is filled in from the listing: type, login method, and the exact total level, combat level, quest points and pet count (from the hiscores, the model's read of the screenshots, or combat worked out from visible skill levels), which set Eldorado's brackets. Typing an exact number updates its bracket. Fields outlined in amber are best guesses (Regular, 0-99 QP, 0 pets) because nothing in the listing said otherwise; red ones still need picking.
4. With account folders (see **Account folders** above), the login, password and 2FA key fill in from the folder's `.txt` file; the key also goes on the `2FA Secret Key:` line of the **Buyer handover message**. Otherwise type them in.
   Fill in the delivery details (account login and password, email, additional info) for **Instant** delivery: Eldorado treats Instant as automatic delivery and refuses it without them. To deliver by hand instead, leave them empty and pick a delivery time of 20 minutes or longer. They go straight to Eldorado, are never written to disk, and are wiped when the dialog closes. Additional info starts as the buyer handover message.
5. The **Main image** is the listing card, built automatically from your screenshots (redacted ones as redacted) with the price on it. **Edit card** opens the card builder (**Use this card** hands it back); **Use a file instead** picks any image. Eldorado requires a main image.
6. Click **Create offer (paused)**, check the offer on Eldorado (add more images if you like), then resume it there. Images go through the same upload endpoint Eldorado's own sell form uses; it is not part of the documented seller API, so if Eldorado changes it the panel shows the upload error. Clear or a new Generate wipes the delivery details.

There is no Eldorado sandbox: every publish creates a real offer on your account.

The app only uses information visible in your screenshots or returned by the hiscores. Numbers are reported exactly or omitted; nothing is rounded up or invented. If a number looks off, open the **Debug** panel under the listing to see what the model claims to have read.

## Security notes

- The Anthropic API key is **never** stored on this machine. It lives only on the Cloudflare Worker as an encrypted secret.
- The local `.env` file contains only the proxy URL and the shared secret password.
- `.env` is gitignored so it will never be committed. It may also hold the Eldorado seller API client ID and secret.
- Eldorado delivery details typed into the publish panel are passed straight to Eldorado and never logged or stored.
- Account folders stay where you put them; the server reads the screenshots and the `.txt` login file on request and never logs or copies them. `accounts*.txt` and `login*.txt` are gitignored in case one ends up in the project folder.
- Uploaded screenshots are held in memory during the request and are not written to disk.

## Troubleshooting

- **"Proxy authentication failed"** — your `PROXY_SECRET` in `.env` does not match the one set on the Cloudflare Worker. Regenerate or re-copy it.
- **"Could not reach the proxy"** — check `PROXY_URL` in `.env`. It should be the full `https://...workers.dev` URL, no trailing slash, no `/generate` suffix.
- **"Eldorado rejected the API credentials"** — the client ID/secret in `.env` is wrong, expired, or revoked. Generate new ones on the Seller API page.
- **No Publish to Eldorado panel** — `ELDORADO_CLIENT_ID` or `ELDORADO_CLIENT_SECRET` is missing from `.env`, or the app wasn't restarted after adding them.
- **Server starts but generation fails silently** — check the terminal running `npm start` for error logs.

## Project layout

```
osrs-listing-generator/
├── .env.example
├── .gitignore
├── package.json
├── server.js              Express server: prompt, hiscores lookup, quadrant crops, footer, proxy call
├── eldorado.js            Eldorado seller API client: token cache, offer payload, create + pause
├── folders.js             ACCOUNTS_DIR account folders: name/type/ban from the folder name, screenshots, the .txt login file, move to Listed
├── data/
│   └── eldorado-osrs.json OSRS account builds and required offer attributes on Eldorado
├── start.bat / update.bat Windows helpers: launch the app / git pull latest
├── public/
│   ├── index.html         Single-page UI
│   ├── style.css          Dark OSRS-flavored theme
│   ├── app.js             Frontend logic: uploads, options, gear drawer, results
│   ├── eldorado.js        Publish to Eldorado panel
│   └── redact.js          Skill blackout tool (calibrated skills grid + free-hand boxes)
├── worker/
│   ├── worker.js          Cloudflare Worker proxy script
│   └── wrangler.toml      Worker deployment config
└── README.md
```

## License

Personal use. No warranty.
