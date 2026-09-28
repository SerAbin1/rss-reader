// The precache list is what the service worker installs, so getting it wrong
// shows up as an installed app that launches to a blank page or a 404 for its
// own script — and only on a real device, after a deploy. These run the same
// walk over a throwaway directory that the build runs over dist/.

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrecache } from "./precache.mjs";

const swSource = fileURLToPath(new URL("../src/sw.js", import.meta.url));

let distDir: string;

beforeEach(async () => {
	distDir = await mkdtemp(path.join(tmpdir(), "precache-test-"));
});

afterEach(async () => {
	await rm(distDir, { recursive: true, force: true });
});

async function write(relativePath: string, contents: string): Promise<void> {
	const file = path.join(distDir, relativePath);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, contents);
}

// A cut-down stand-in for a real build output.
async function writeBuild(): Promise<void> {
	await write("index.html", "<html>posts</html>");
	await write("pair/index.html", "<html>pair</html>");
	await write("_astro/app.abc123.js", "console.log('app')");
	await write("favicon.svg", "<svg />");
	await write("icon-512.png", "png");
	await write("manifest.webmanifest", "{}");
	await write("og-image.png", "png");
	await write("curated-feeds.opml", "<opml />");
	await write("_headers", "/sw.js\n  Cache-Control: no-cache");
	await write("sw.js", "generated later");
}

describe("buildPrecache", () => {
	it("caches the documents under both the directory and the file", async () => {
		await writeBuild();
		const { assets } = await buildPrecache(distDir);

		// A navigation to "/" has to be a plain precache hit, not a rewrite:
		// the worker looks up url.pathname verbatim.
		expect(assets).toContain("/");
		expect(assets).toContain("/index.html");
		expect(assets).toContain("/pair/");
		expect(assets).toContain("/pair/index.html");
		expect(assets).not.toContain("//");
	});

	it("caches the hashed bundle and the icons", async () => {
		await writeBuild();
		const { assets } = await buildPrecache(distDir);

		expect(assets).toContain("/_astro/app.abc123.js");
		expect(assets).toContain("/favicon.svg");
		expect(assets).toContain("/icon-512.png");
		expect(assets).toContain("/manifest.webmanifest");
	});

	it("leaves out what must stay live", async () => {
		await writeBuild();
		const { assets } = await buildPrecache(distDir);

		// The curated list is served network-first and cached at runtime, so
		// precaching it would freeze the feed list at this deploy's version.
		// og-image.png is only read by social crawlers. _headers isn't served.
		// sw.js is the worker itself.
		expect(assets).not.toContain("/curated-feeds.opml");
		expect(assets).not.toContain("/og-image.png");
		expect(assets).not.toContain("/_headers");
		expect(assets).not.toContain("/sw.js");
	});

	it("gives identical builds identical versions", async () => {
		await writeBuild();
		const first = await buildPrecache(distDir);
		const second = await buildPrecache(distDir);
		expect(second.version).toBe(first.version);
	});

	// index.html is the one precached file whose name doesn't change when its
	// contents do, so a version derived from names alone would serve a stale
	// document forever.
	it("changes the version when a file's contents change", async () => {
		await writeBuild();
		const before = await buildPrecache(distDir);
		await write("index.html", "<html>posts, edited</html>");
		const after = await buildPrecache(distDir);
		expect(after.version).not.toBe(before.version);
	});
});

describe("the worker source", () => {
	// astro.config.mjs substitutes this placeholder with the built list, and
	// fails the build if it isn't there exactly once.
	it("has exactly one precache placeholder", async () => {
		const source = await readFile(swSource, "utf8");
		expect(source.split("__PRECACHE__").length - 1).toBe(1);
	});

	// Whatever the build emits has to be a worker, not a template that would
	// throw on the first line the browser evaluates.
	it("has no other unsubstituted placeholders", async () => {
		const source = await readFile(swSource, "utf8");
		const placeholders = (source.match(/__[A-Z_]+__/g) ?? []).filter(
			(placeholder) => placeholder !== "__PRECACHE__",
		);
		expect(placeholders).toEqual([]);
	});
});
