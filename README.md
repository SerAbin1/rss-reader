# RSS Reader

A small personal RSS/Atom reader

## Goal

Import an OPML file of feed subscriptions, and on every visit to the site, pull the latest posts from those feeds and show them in one unified list, earliest unread first.

## Core Features

- A curated default feed list ships with the build and is visible to every visitor with no setup — see Architecture
- Manually add a single feed by URL, or import an OPML file to populate the subscription list (stored locally in the browser). Both are purely additive: importing the same file twice adds nothing and rewrites nothing
- On each visit, fetch the latest items from every subscribed feed
- Show a unified list of posts across all feeds, sorted earliest first — rendered incrementally as each feed's fetch resolves, not held back until every feed responds
- Read/unread tracking via a single "last read" watermark (see Architecture) rather than per-post state
- Failed feeds are marked in the feed list (reason on hover) and listed under the status line, each with a Retry — and, for your own feeds, a Remove
- Unread count in the tab title
- Unsubscribe from one of your own feeds with the × beside it in the feed list (curated feeds can't be removed). A Refresh button refetches every feed without reloading the page
- Favourites: ♡ a post to keep its title and link after it's read, in a separate Favourites view (newest first). Per device — not synced

## Goals

- Export current subscriptions back to OPML
- Group feeds into folders/categories
- Search/filter posts
- Dark mode
- Optional account + server-side storage to sync across devices

## Architecture

- **Hosting:** Cloudflare Pages
- **Framework:** Astro + TypeScript
- **CORS / feed fetching:** a Cloudflare Pages Function (`/api/feed`) fetches feed XML server-side and returns normalized JSON, avoiding the CORS restrictions that block fetching third-party feeds directly from the browser
- **Subscribing:** two front doors, one rule. A URL typed into the add-feed form, or any number of feeds out of an OPML file, both go through `planAdditions` in `src/lib/subscriptions.ts`: feeds already subscribed (personal *or* curated) are left out of what gets written, and feeds repeated within one file are collapsed. So an import is purely additive — re-importing a file the device already has saves nothing at all, which is also what keeps a feed's discovered `siteUrl` from being reset by a second import. URLs are compared in normalized form (lowercased host, no fragment; the path is left alone, since `/feed` and `/feed/` can be two different feeds), so a hand-typed URL and an OPML's `xmlUrl` naming the same feed are recognized as one subscription. An import loads only the feeds it actually added, rather than refetching the whole list
- **Adding one feed:** the URL is fetched *before* it is saved, so a link that isn't a feed is reported then instead of joining the list and failing on every load from now on — and the record is written complete, with the title and homepage the feed document declares, rather than waiting for a later load to discover them. The same response supplies the posts, so it costs one request
- **Persistence:** browser `IndexedDB` — the personal subscription list and a single `lastReadAt` watermark. No backend database or user accounts in the MVP. Used via the raw `IndexedDB` API first (educational), then wrapped in a small hand-rolled abstraction once the raw usage gets repetitive
- **Curated feed list:** `public/curated-feeds.opml`, a git-versioned file shipped as-is with every deploy — identical for every visitor, fetched fresh each load, never written to IndexedDB or synced. Adding a feed for everyone means editing this file and deploying; there's no in-app or API path that can change it, so no separate admin auth was needed
- **Read/unread:** no per-post state. One `lastReadAt` date; a post is read if `publishedAt <= lastReadAt`. Requires reading the (earliest-first) list in order — clicking a post only advances the watermark if it's the very next unread one; clicking further ahead reads just that one post without marking the skipped ones read. A post read during this load stays in place, greyed out, and is dropped on the next load (or refresh) — `isListed` in `read-state.ts` — so it doesn't vanish the moment it's opened. Styles for dynamically-created `<li>` elements live in the page's `is:global` stylesheet, since Astro's scoped `<style>` can't target them. Pure decision logic lives in `src/lib/read-state.ts`, unit-tested separately from the DOM wiring in `src/scripts/app.ts`
- **Mark read up to here:** a ✓ on each post (revealed on hover with a pointer, always shown on touch) sets `lastReadAt` to that post's date, so a backlog you don't intend to read in order can be skipped from wherever you are. Forward-only, and asks first when it marks more than the one post, since a marked post can't be brought back once the watermark syncs
- **Feed formats supported:** RSS 2.0 and Atom, normalized into one common `Post` shape
- **Not a PWA:** no manifest or service worker. The native Android app (`android/`) covers the installed-app case, so the site stays a plain online page
- **Offline:** the status line says "Offline" when the browser reports no connection, so the resulting feed failures aren't a mystery. Nothing is cached for offline reading
- **Icons:** generated, not hand-drawn. `scripts/icons/favicon.svg` is the source; `scripts/generate-icons.sh` rasterizes it into `public/` (needs `rsvg-convert` and ImageMagick locally). `src/lib/icons.test.ts` fails if a page links an icon that isn't there — which is the bug both pages shipped with for a while

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

After editing anything under `scripts/icons/`, run `bash scripts/generate-icons.sh` and commit the regenerated files in `public/`.

## Android app

`android/` is a native Kotlin app (Jetpack Compose, Material 3) modelled on [Read You](https://github.com/Ashinch/ReadYou): a feeds page and the unified unread list. Posts open in the browser (a Custom Tab; long-press → Open in browser for a full tab in the default browser), as they do on the web. It follows the web app's rules and joins the same sync group:

- **Same read model.** One `lastReadAt` watermark, earliest unread first, opening the next unread post advances it, ✓ marks read up to a post. The decisions are ported from `src/lib` into `android/app/src/main/kotlin/.../core/`, and the TS tests are ported alongside them, reading the same fixtures from `src/lib/__fixtures__`
- **Same sync.** Pairs through `/api/sync` (Settings → Set up sync / Join with a code) and shares the watermark and personal feeds with the web app and other devices. Pairing codes and QR links are interchangeable between the two
- **Same curated list.** Fetched live from the deployed `curated-feeds.opml` each refresh; the copy bundled at build time (copied from `public/`) covers the first offline launch
- **Feeds fetched directly**, not through `/api/feed` — there's no CORS in an app
- **The one difference: a list cache.** Unread posts' title, link and date are kept in a local Room database, so whatever a background refresh found is listed at launch. No post bodies — reading is online, in the browser. A read post stays listed, greyed, until the next refresh or cold launch drops it
- **Favourites**, as on the web: swipe a post right-to-left (Read You's gesture) or long-press it; a Favourites tab sits beside Unread. Kept indefinitely, per device
- **Unsubscribe** from your own feeds by long-pressing them on the feeds page
- **Open on** (Settings → General): start on Home, Unread or Favourites, like Read You's initial page
- **Configurable refreshing** (Settings → Refreshing): background refresh on/off, its interval (15 min – daily, via WorkManager), Wi-Fi only, refresh on app open, pull-to-refresh, and the refresh button

```sh
cd android
./gradlew :app:testDebugUnitTest   # JVM unit tests (no device needed)
./gradlew :app:installDebug        # build and install on a connected device/emulator
```

Needs JDK 21 and the Android SDK (`android/local.properties` → `sdk.dir`). CI runs the unit tests and builds a debug APK (`.github/workflows/android.yml`). Every such push to `main` that passes also publishes a signed release APK to GitHub Releases (`android-v0.1.<run number>`; the run number is the version code, so each installs over the last). Signing needs three repo secrets: `ANDROID_KEYSTORE_BASE64` (the keystore, base64), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`; without them the release job fails rather than ship a debug-signed APK. Keep a backup of the keystore — losing it means users must uninstall to take any later release. Local `installRelease` builds are debug-signed, so they can't install over a released APK (or vice versa) without an uninstall.

## Deployment

Cloudflare Pages, via GitHub Actions (`.github/workflows/deploy.yml`) rather than Cloudflare's native Git integration — every push to `main` runs `pnpm test` → `pnpm build` → `wrangler pages deploy`, so a failing test blocks the deploy. Requires two repo secrets set under Settings → Secrets and variables → Actions: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. One-time Cloudflare account/project setup steps are in Obsidian (`BackEnd/DevOps/Deployment.md`), not reproduced here since they involve dashboard clicks, not code.
