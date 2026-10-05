# Sigmabone

Share **BONELAB** mod collections as a single link — no server, no accounts.

- **Build** a collection from mod.io *and* Thunderstore — SDK mods + code mods
  in one link (dependencies are auto-added)
- **Share** one URL — the entire collection is compressed into the link itself
- **Two folders supported**: `LocalLow\…\BONELAB\Mods` (SDK mods) and the game
  folder (code mods). Pick any folder — the app detects which type it is.
- **One-click install**: sees what's missing and extracts it into the right
  folder (Chrome/Edge)

## How it works

| Piece | Implementation |
| --- | --- |
| Hosting | Static site — deploy `dist/` anywhere (GitHub Pages, Cloudflare Pages…) |
| Sharing | Collection JSON → deflate → base64url → `#c=…` hash |
| SDK mods | [mod.io REST API](https://docs.mod.io), CORS-enabled, `X-Modio-Platform: windows` |
| Code mods | [Thunderstore package index](https://thunderstore.io/c/bonelab/) (one ~2MB JSON, client-side search + dependency graph) |
| "What's installed" | File System Access API scans both folders; `.sigmabone.json` manifest keeps exact records |
| Installing | Fetch zip → unzip in-browser (fflate) → write into the folder |

## The two folders

- **SDK mods** → `C:\Users\<you>\AppData\LocalLow\Stress Level Zero\BONELAB\Mods`
- **Code mods** → the BONELAB game folder (`steamapps\common\BONELAB`) *or* its
  `Mods\` dir directly — either works; the app auto-detects which you picked by
  sniffing for `.dll`s / `Mods\` subdirs.

## API key

The app needs a free **read-only mod.io API key** (Thunderstore needs none).

- **Deployed on Cloudflare**: set it once as a secret and every visitor is
  keyless — the `/api/modio` route injects it server-side.
- **Anywhere else**: visitors paste their own key (stored in `localStorage`
  only), or bake one into the build via `.env` → `VITE_MODIO_API_KEY=…`.

## Deploy — Cloudflare Workers (recommended, free)

The repo deploys as a **Cloudflare Worker with static assets** — one small
script (`worker/index.ts`) that serves `dist/` and two API routes:

- `/api/modio/*` — proxies the mod.io API with your key as a server-side
  secret → **friends never need an API key**
- `/api/proxy?url=…` — same-origin download proxy (allowlisted to
  thunderstore/mod.io CDNs) → **code mods install one-click** instead of
  falling back to manual zip downloads

- `/api/collection` — the group's **shared collection** stored in Workers KV:
  one collection everyone edits. When it has mods it becomes the homepage;
  friends add via the builder → "Publish to shared".

Files are streamed, never buffered — big avatar packs pass straight through.
Free tier covers ~100k requests/day + 1GB KV storage (a collection is ~1KB).

**Shared collection setup (one time):**

```
wrangler kv namespace create COLLECTION   # prints an id
```

Then either paste that id into `wrangler.toml` under `[[kv_namespaces]]`
(uncomment the block), or in the dashboard: **Settings → Bindings → Add →
KV namespace** → variable name `COLLECTION` → pick the namespace → redeploy.
Without it, the shared-collection buttons simply stay hidden.

**Setup (5 min):**

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** →
   **Create** → **Import a repository** → pick this repo.
2. Build command: `npm run build` · Deploy command: `npx wrangler deploy` ·
   Preview command: `npx wrangler preview` (defaults are already correct —
   `wrangler.toml` points assets at `dist/`).
3. After first deploy: **Settings → Variables and Secrets** → add secret
   `MODIO_API_KEY` = your read-only mod.io key → redeploy.

Or from the CLI:

```
npm i -g wrangler
wrangler login
npm run build
wrangler deploy
wrangler secret put MODIO_API_KEY
```

**GitHub Pages / Netlify also work** for the static `dist/` — everything
degrades gracefully (visitors paste their own API key, code mods download
zips manually instead of writing to the folder).

## Code-mod downloads caveat (self-hosting)

`ccdn.thunderstore.io` sends no CORS headers, so browsers can't fetch code
mod zips directly. On Cloudflare the built-in `/api/proxy` handles it.
Elsewhere, set a **download proxy** in the folders menu, or code mods fall
back to a normal `Downloads/` zip.

## Develop / build

```
npm install
npm run dev      # http://localhost:5173 (site only)
npm run build    # → dist/
npx wrangler dev # local Worker: site + /api routes together
```

## Limits

- Folder scanning + one-click install require **Chromium**. Everything else
  works everywhere; non-Chromium users get manual download buttons.
- Matching pre-existing installs is fuzzy; anything installed *through*
  Sigmabone is tracked exactly via the manifest, and matches can be
  confirmed/corrected per row.
