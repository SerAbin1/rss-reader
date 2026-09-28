#!/usr/bin/env bash
#
# Regenerates the committed icons in public/ from the sources in
# scripts/icons/. Run after editing one of those SVGs — the PNGs are committed
# because the manifest, both pages and the service worker's precache list all
# reference them by path, and a build step that had to rasterize them would
# mean either a dependency or a plugin.
#
# Needs rsvg-convert and ImageMagick's magick (Arch: librsvg + imagemagick).
set -euo pipefail

cd "$(dirname "$0")/.."

# Scratch space for the intermediate favicon sizes the .ico is assembled from.
# Fixed path rather than mktemp so re-running leaves nothing to clean up.
build_dir=/tmp/opencode/rss-reader-icons
mkdir -p "$build_dir"

# Install icons: opaque, wordmark at ~45% of the canvas width.
for size in 192 512; do
	rsvg-convert -w "$size" -h "$size" scripts/icons/any.svg -o "public/icon-$size.png"
done

# Maskable icon: same wordmark, scaled into the central 80% safe zone so a
# launcher's circular/squircle crop can't clip it.
rsvg-convert -w 512 -h 512 scripts/icons/maskable.svg -o public/icon-maskable-512.png

# Favicon: served as-is, plus the multi-size .ico both pages have always pointed
# at (and which 404s today — nothing in public/ generates it).
cp scripts/icons/favicon.svg public/favicon.svg
for size in 16 32 48; do
	rsvg-convert -w "$size" -h "$size" scripts/icons/favicon.svg -o "$build_dir/favicon-$size.png"
done
magick "$build_dir/favicon-16.png" "$build_dir/favicon-32.png" "$build_dir/favicon-48.png" public/favicon.ico

echo "wrote: public/favicon.svg public/favicon.ico public/icon-192.png public/icon-512.png public/icon-maskable-512.png"
