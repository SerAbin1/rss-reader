# RSS Reader

A small personal RSS/Atom reader

## Goal

Import an OPML file of feed subscriptions, and on every visit to the site, pull the latest posts from those feeds and show them in one unified, chronological list.

## Core Features

- Manually add a single feed by URL or import an OPML file to populate the subscription list (stored locally in the browser)
- On each visit, fetch the latest items from every subscribed feed
- Show a unified, chronologically sorted list of posts across all feeds
- Mark posts as read/unread (persisted locally)
- Basic error handling for feeds that fail to load

## Goals

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
- **Persistence:** browser `IndexedDB` — subscription list, read/unread state, and cached posts. No backend database or user accounts in the MVP. Used via the raw `IndexedDB` API first (educational), then wrapped in a small hand-rolled abstraction once the raw usage gets repetitive
- **Feed formats supported:** RSS 2.0 and Atom, normalized into one common `Post` shape

## Local Development

```sh
pnpm install
pnpm dev      # start the dev server
pnpm build    # build the static site to dist/
pnpm preview  # preview the production build locally
```

## Deployment

Cloudflare Pages, auto-deploying from `main`.
