// Works out what the service worker should precache, by walking a finished
// build. Lives outside src/ because it's build-time code: src/sw.js imports
// nothing, but this is imported by astro.config.mjs, and nothing here is
// bundled into the site.
//
// The alternative was a precache manifest plugin, but this app's precache list
// is three rules of thumb (below) and a hand-written version keeps the
// exceptions — the curated feed list especially — in a file you can read
// top-to-bottom next to the worker that obeys them.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// What a browser needs to have cached before it can launch the app with no
// network: the two documents, the bundled script, the manifest and the icons.
const PRECACHEABLE_EXTENSIONS = new Set([
	".html",
	".js",
	".css",
	".svg",
	".png",
	".ico",
	".webmanifest",
]);

// Everything else in dist/ is either not a served asset or is deliberately
// handled by the worker at runtime instead of being frozen into a cache.
const EXCLUDED = new Map([
	[
		"sw.js",
		"the service worker itself, which the browser caches and versions on its own",
	],
	["_headers", "a Cloudflare Pages control file, never served to clients"],
	["_routes.json", "ditto"],
	["og-image.png", "only read by social crawlers; the app never fetches it"],
	[
		"curated-feeds.opml",
		"the curated feed list, which every load re-fetches so a deploy's changes take effect; cached network-first at runtime instead",
	],
]);

// Returns the precache list as the URL paths the worker will match requests
// against, plus a version derived from the contents of everything in it.
export async function buildPrecache(distDir) {
	const files = await listFiles(distDir);

	const assets = [];
	const hash = createHash("sha256");
	for (const file of files) {
		if (!isPrecacheable(file)) continue;

		const contents = await readFile(path.join(distDir, file));
		const url = toUrl(file);
		hash.update(url).update("\0").update(contents);

		assets.push(url);
		// index.html is precached under both its own path and the directory it
		// serves, so a navigation to "/" or "/pair/" is a plain precache hit
		// rather than a rewrite. Same bytes, so the extra entry is free.
		if (path.basename(file) === "index.html") {
			assets.push(directoryUrl(file));
		}
	}

	assets.sort();
	return { version: hash.digest("hex").slice(0, 8), assets };
}

async function listFiles(dir, prefix = "") {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(path.join(dir, entry.name), relative)));
		} else if (entry.isFile()) {
			files.push(relative);
		}
	}
	return files;
}

function isPrecacheable(file, distDir) {
	const basename = path.basename(file);
	if (EXCLUDED.has(basename)) return false;
	return PRECACHEABLE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function toUrl(file) {
	return `/${file.split(path.sep).join("/")}`;
}

function directoryUrl(file) {
	const directory = path.posix.dirname(toUrl(file));
	// posix.dirname("/index.html") is "/", which would make the alias "//".
	return directory === "/" ? "/" : `${directory}/`;
}
