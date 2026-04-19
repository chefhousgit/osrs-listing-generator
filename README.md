# OSRS Listing Generator

A local web app that analyzes Old School RuneScape (OSRS) account screenshots and generates three marketplace-style listings (Professional, Hype/Salesy, Detailed) in the style used on Eldorado.gg.

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

1. Drag screenshots onto the drop zone, or click to browse. Any combination works: stats panel, bank, gear, quest log, achievements, overview page, collection log, clue scroll progress, etc.
2. Click **Generate Listings**.
3. Three versions appear side by side:
   - **Professional** — clean, factual
   - **Hype / Salesy** — emoji-friendly, energetic
   - **Detailed** — sectioned, comprehensive
4. Use the **Copy Title** and **Copy Description** buttons to grab the text.
5. Hit **Clear** to reset and run another account.

The app only uses information visible in your screenshots. If a section is missing (for example you did not upload a bank screenshot), the listings will skip that section rather than invent details.

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
├── server.js              Express server, forwards requests to the proxy
├── public/
│   ├── index.html         Single-page UI
│   ├── style.css          Dark OSRS-flavored theme
│   └── app.js             Frontend logic, upload handling, rendering
├── worker/
│   ├── worker.js          Cloudflare Worker proxy script
│   └── wrangler.toml      Worker deployment config
└── README.md
```

## License

Personal use. No warranty.
