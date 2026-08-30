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

## Deployment

Cloudflare Pages, via GitHub Actions (`.github/workflows/deploy.yml`) rather than Cloudflare's native Git integration — every push to `main` runs `pnpm test` → `pnpm build` → `wrangler pages deploy`, so a failing test blocks the deploy. Requires two repo secrets set under Settings → Secrets and variables → Actions: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. One-time Cloudflare account/project setup steps are in Obsidian (`BackEnd/DevOps/Deployment.md`), not reproduced here since they involve dashboard clicks, not code.
