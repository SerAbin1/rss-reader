# RSS Reader

A small personal RSS/Atom reader

## Goal

Import an OPML file of feed subscriptions, and on every visit to the site, pull the latest posts from those feeds and show them in one unified list

## Core Features

- A curated default feed list ships with the build and is visible to every visitor with no setup
- Manually add a single feed by URL, or import an OPML file to populate the subscription list (stored locally in the browser).
- On each visit, fetch the latest items from every subscribed feed
- Show a unified list of posts across all feeds
- Read/unread tracking via a single "last read" watermark rather than per-post state
- Sync between **two devices** (pair with a code or QR)

## Goals

- Export current subscriptions back to OPML
- Group feeds into folders/categories
- Search/filter posts
- Dark mode
- Optional account + server-side storage to sync across devices

## Local Development

```sh
pnpm install
pnpm dev        # start the Astro dev server: pages + /api/* + local D1, in workerd
pnpm build      # build to dist/: client/ (the site) and server/ (the Worker)
pnpm preview    # preview the production build locally
pnpm d1:migrate # apply migrations/ to the local D1 that `pnpm dev` uses
pnpm test       # run the test suite
```

The site is Astro on its Cloudflare adapter: pages are prerendered, and `src/pages/api/[...path].ts` runs on demand, handing every `/api/*` request to the router in `functions/index.ts` and the handlers under `functions/api/`.

After editing anything under `scripts/icons/`, run `bash scripts/generate-icons.sh` and commit the regenerated files in `public/`.

## Android app

`android/` is a native Kotlin app (Jetpack Compose, Material 3) modelled on [Read You](https://github.com/Ashinch/ReadYou): a feeds page and the unified unread list. Posts open in the browser (a Custom Tab; long-press → Open in browser for a full tab in the default browser), as they do on the web. It follows the web app's rules and joins the same sync group:

```sh
cd android
./gradlew :app:testDebugUnitTest   # JVM unit tests (no device needed)
./gradlew :app:installDebug        # build and install on a connected device/emulator
```

Needs JDK 21 and the Android SDK (`android/local.properties` → `sdk.dir`). CI runs the unit tests and builds a debug APK (`.github/workflows/android.yml`). Every such push to `main` that passes also publishes a signed release APK to GitHub Releases (`android-v0.1.<run number>`; the run number is the version code, so each installs over the last). Signing needs three repo secrets: `ANDROID_KEYSTORE_BASE64` (the keystore, base64), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`; without them the release job fails rather than ship a debug-signed APK. Keep a backup of the keystore — losing it means users must uninstall to take any later release. Local `installRelease` builds are debug-signed, so they can't install over a released APK (or vice versa) without an uninstall.

## Deployment

Cloudflare Workers (static assets + the `/api/*` Worker), via GitHub Actions (`.github/workflows/deploy.yml`) rather than Cloudflare's native Git integration — every push to `main` runs `vp test run` → `vp run build` → D1 migrations (`cf`) → `wrangler deploy`, so a failing test blocks the deploy. Requires two repo secrets set under Settings → Secrets and variables → Actions: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. One-time Cloudflare account/project setup steps are in Obsidian (`BackEnd/DevOps/Deployment.md`), not reproduced here since they involve dashboard clicks, not code.
