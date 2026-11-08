# RSS Reader

A small personal RSS/Atom reader

## Goal

Import an OPML file of feed subscriptions, and on every visit to the site, pull the latest posts from those feeds and show them in one unified list

## Core Features

- A curated default feed list is available with no setup
- Manually add a single feed by URL, or import an OPML file to populate the subscription list (stored locally in the browser).
- On each visit, fetch the latest items from every subscribed feed
- Show a unified list of posts across all feeds
- Read/unread tracking
- Sync between **two devices** (pair with a code or QR)

## Installation

### Android

The Android app is a native Kotlin app (Jetpack Compose, Material 3) modelled on [Read You](https://github.com/Ashinch/ReadYou): a feeds page and the unified unread list. Posts open in the browser (a Custom Tab; long-press → Open in browser for a full tab in the default browser), as they do on the web. It follows the web app's rules and joins the same sync group.

#### F-Droid (Recommended)

1. Install [F-Droid](https://f-droid.org/) if you don't have it already.
2. In F-Droid, go to **Settings → Repositories** and add this repository:

   ```
   https://serabin1.github.io/rss-reader/repo?fingerprint=3A5894B43A279EFF91B872CAE14C769154B17BAD1A7AB7E876E72DD2AD4ECD1D
   ```

   The `fingerprint` is the SHA-256 of the repo's signing key; you can verify it against [the repo page](https://serabin1.github.io/rss-reader/repo), which also has a QR code you can scan instead of typing the URL.

3. Search for **RSS Reader** and install it. Further updates arrive through F-Droid automatically.

#### GitHub releases

1. Download the latest `rss-reader-*.apk` from [GitHub Releases](https://github.com/SerAbin1/rss-reader/releases).
2. Open the downloaded file and allow installation from unknown sources if prompted.

The F-Droid repo and the GitHub release APKs are signed with the same key, so you can switch between the two without uninstalling.
