#!/usr/bin/env bash
#
# Regenerates the committed favicons in public/ from scripts/icons/favicon.svg.
# Run after editing it — the outputs are committed so the build needs neither
# a dependency nor a plugin to rasterize them.
#
# Needs rsvg-convert and ImageMagick's magick (Arch: librsvg + imagemagick).
set -euo pipefail

cd "$(dirname "$0")/.."

# Scratch space for the intermediate favicon sizes the .ico is assembled from.
# Fixed path rather than mktemp so re-running leaves nothing to clean up.
build_dir=/tmp/opencode/rss-reader-icons
mkdir -p "$build_dir"

# Favicon: served as-is, plus the multi-size .ico both pages have always pointed
# at (and which 404s today — nothing in public/ generates it).
cp scripts/icons/favicon.svg public/favicon.svg
for size in 16 32 48; do
	rsvg-convert -w "$size" -h "$size" scripts/icons/favicon.svg -o "$build_dir/favicon-$size.png"
done
magick "$build_dir/favicon-16.png" "$build_dir/favicon-32.png" "$build_dir/favicon-48.png" public/favicon.ico

echo "wrote: public/favicon.svg public/favicon.ico"
