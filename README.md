# RSS Reader

A small RSS/Atom reader for personal use.

## Goal

Import an OPML file with your feed subscriptions. Each time you open RSS Reader, it fetches the newest posts from those feeds and shows them in one list.

## Core Features

- RSS Reader comes with a default list of feeds. You can use it without any setup.
- You can add one feed by its URL or import an OPML file. Your subscription list is stored in your browser.
- RSS Reader fetches the newest posts from all your feeds each time you open the app.
- All posts from your feeds appear in one list.
- RSS Reader tracks which posts you have read.
- RSS Reader syncs between **two devices**. Pair the devices with a code or a QR code.

## Installation

### Android

The Android app is written in Kotlin. It uses Jetpack Compose and Material 3, and it follows the design of [Read You](https://github.com/Ashinch/ReadYou). It has a feeds page and a list of unread posts.

When you tap a post, it opens in the browser as a Custom Tab. To open the post in a full browser tab, press and hold it, then select **Open in browser**.

The app behaves like the web app. It joins the same sync group, so both apps stay in sync.

#### F-Droid (Recommended)

1. Install [F-Droid](https://f-droid.org/), if you do not have it already.
2. Open F-Droid. Go to **Settings → Repositories** and add this repository URL:

   ```
   https://serabin1.github.io/rss-reader/repo?fingerprint=3A5894B43A279EFF91B872CAE14C769154B17BAD1A7AB7E876E72DD2AD4ECD1D
   ```

   The `fingerprint` value is the SHA-256 hash of the repository signing key. You can check it on [the repository page](https://serabin1.github.io/rss-reader/repo). That page also shows a QR code. You can scan the code instead of typing the URL.

3. Search for **RSS Reader** and install it. F-Droid delivers all later updates.

#### GitHub releases

1. Download the newest `rss-reader-*.apk` file from [GitHub Releases](https://github.com/SerAbin1/rss-reader/releases).
2. Open the file to install it. If your device asks for it, allow installation from unknown sources.

The F-Droid repository and the GitHub releases use the same signing key. You can switch between them without uninstalling the app.
