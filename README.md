# RSS Reader

A small personal RSS/Atom reader

## Goal

Import an OPML file of feed subscriptions, and on every visit to the site, pull the latest posts from those feeds and show them in one unified list, earliest unread first.

## Core Features

- A curated default feed list ships with the build and is visible to every visitor with no setup — see Architecture
- Manually add a single feed by URL or import an OPML file to populate the subscription list (stored locally in the browser)
- On each visit, fetch the latest items from every subscribed feed
- Show a unified list of posts across all feeds, sorted earliest first — rendered incrementally as each feed's fetch resolves, not held back until every feed responds
- Read/unread tracking via a single "last read" watermark (see Architecture) rather than per-post state
- Basic error handling for feeds that fail to load
- Installable as an app, and launches to a working (if feedless) shell with no network — see Architecture

## Goals

- Favorites: a separate section that fully caches favorited articles' content, independent of read/unread state or the live feed
- Export current subscriptions back to OPML
- Group feeds into folders/categories
- Search/filter posts
- Per-feed refresh/error status indicators
- Dark mode
- Optional account + server-side storage to sync across devices

## Architecture

- **Hosting:** Cloudflare Pages
- **Framework:** Astro + TypeScript
- **CORS / feed fetching:** a Cloudflare Pages Function (`/api/feed`) fetches feed XML server-side and returns normalized JSON, avoiding the CORS restrictions that block fetching third-party feeds directly from the browser
- **Persistence:** browser `IndexedDB` — the personal subscription list and a single `lastReadAt` watermark. No backend database or user accounts in the MVP. Used via the raw `IndexedDB` API first (educational), then wrapped in a small hand-rolled abstraction once the raw usage gets repetitive
- **Curated feed list:** `public/curated-feeds.opml`, a git-versioned file shipped as-is with every deploy — identical for every visitor, fetched fresh each load, never written to IndexedDB or synced. Adding a feed for everyone means editing this file and deploying; there's no in-app or API path that can change it, so no separate admin auth was needed
- **Read/unread:** no per-post state. One `lastReadAt` date; a post is read if `publishedAt <= lastReadAt`. Requires reading the (earliest-first) list in order — clicking a post only advances the watermark if it's the very next unread one; clicking further ahead reads just that one post without marking the skipped ones read. Read posts are filtered out of the rendered list entirely, not just styled differently — dynamically-created `<li>` elements can't be targeted by Astro's scoped `<style>` anyway (see Obsidian log). Pure decision logic lives in `src/lib/read-state.ts`, unit-tested separately from the DOM wiring in `src/scripts/app.ts`
- **Catch-up escape hatch:** a date picker + button lets you jump `lastReadAt` straight to a chosen date (e.g. right after importing an OPML with years of backlog), without changing the normal click-to-advance behavior at all. Excludes the chosen date itself — "everything before this day," not "up to and including it," since a plain date input can't express a time of day
- **Feed formats supported:** RSS 2.0 and Atom, normalized into one common `Post` shape
- **PWA:** a hand-written `public/manifest.webmanifest` (readable top-to-bottom, and the single place the installability contract lives) and a service worker at `src/sw.js`, emitted to `dist/sw.js` by an `astro:build:done` integration in `astro.config.mjs`. No PWA plugin: the worker can't know its own precache list at authoring time, because Astro content-hashes the app's script, and the integration that fills the list in is about twenty lines of walking `dist/`
- **What the worker caches:** the app shell only — both documents, the hashed bundles, the manifest and the icons — under a cache name derived from the *contents* of those files, so any deploy that changes one gets a new cache and the old one is deleted on activate. `index.html` is precached under both `/` and `/index.html` so a navigation is a plain cache hit
- **What it deliberately doesn't cache:** anything under `/api/`. Feed bodies are meant to be live, and every sync call carries a token — a replayed watermark push or feed change from cache would quietly rewrite the group. `curated-feeds.opml` is served network-first and cached at runtime instead, so a deploy's changes to the feed list land on the next load rather than whenever the cache version changes
- **Offline, honestly:** the shell opens offline and the status line says "Offline" so the resulting feed failures aren't a mystery. Posts are not cached. Favorites (still a goal) are what will be readable offline
- **Icons:** generated, not hand-drawn. `scripts/icons/*.svg` are the sources; `scripts/generate-icons.sh` rasterizes them into `public/` (needs `rsvg-convert` and ImageMagick locally). `src/lib/manifest.test.ts` fails if the manifest ever points at an icon that isn't there — which is the bug both pages shipped with for a while

## Local Development

```sh
pnpm install
pnpm dev        # start the Astro dev server (pages only — no /api/feed)
pnpm build      # build the static site to dist/
pnpm preview    # preview the production build locally (no /api/feed either)
pnpm pages:dev  # build first, then: serves dist/ + functions/ together, incl. /api/feed
pnpm test       # run the test suite
```

`pnpm dev`/`pnpm preview` don't run Cloudflare Pages Functions — `/api/feed` only exists under `pnpm pages:dev` (Wrangler). Run `pnpm build` again after changing anything under `functions/` or `src/`, then re-run `pnpm pages:dev` to pick it up.

The service worker is deliberately *not* registered under `pnpm dev` (Astro serves unbundled modules there, and a worker caching them would hand back stale code) — so to exercise it, `pnpm build` and then `pnpm pages:dev`, which serves the same `dist/` that gets deployed. Register the worker before checking it offline: a first visit installs it, and DevTools → Application → Service Workers shows it, along with the "Offline" checkbox that proves the shell launches with no network. Installability is visible in `chrome://web-app-internals` rather than a Lighthouse score — Lighthouse dropped its PWA category.

After editing anything under `scripts/icons/`, run `bash scripts/generate-icons.sh` and commit the regenerated files in `public/`.

## Deployment

Cloudflare Pages, via GitHub Actions (`.github/workflows/deploy.yml`) rather than Cloudflare's native Git integration — every push to `main` runs `pnpm test` → `pnpm build` → `wrangler pages deploy`, so a failing test blocks the deploy. Requires two repo secrets set under Settings → Secrets and variables → Actions: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. One-time Cloudflare account/project setup steps are in Obsidian (`BackEnd/DevOps/Deployment.md`), not reproduced here since they involve dashboard clicks, not code.
