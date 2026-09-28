// The manifest is hand-written (public/manifest.webmanifest) so it can be read
// top-to-bottom, which also means nothing stops it from drifting away from the
// files that actually exist — both pages spent a while pointing at a
// /favicon.svg and /favicon.ico that were never generated. These tests are the
// thing that would have caught it.

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../", import.meta.url);
const publicDir = fileURLToPath(new URL("public/", repoRoot));

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose?: string;
}

interface Manifest {
	name: string;
	short_name: string;
	id: string;
	start_url: string;
	scope: string;
	display: string;
	icons: ManifestIcon[];
}

const manifest: Manifest = JSON.parse(
	readFileSync(new URL("public/manifest.webmanifest", repoRoot), "utf8"),
);

describe("manifest", () => {
	it("points only at icons that exist", () => {
		for (const icon of manifest.icons) {
			expect(
				existsSync(`${publicDir}${icon.src.replace(/^\//, "")}`),
				`${icon.src} is in the manifest but not in public/`,
			).toBe(true);
		}
	});

	it("covers the two shapes a launcher asks for", () => {
		const purposes = new Set(manifest.icons.map((icon) => icon.purpose ?? "any"));
		// A plain square for the legacy icon, and a maskable one that survives
		// being cropped into whatever shape the launcher uses.
		expect(purposes).toContain("any");
		expect(purposes).toContain("maskable");
	});

	// The parts a browser checks before it will even offer to install. Missing
	// any of these and the app works fine in a tab, which is exactly how it
	// would fail to notice.
	it("meets the installability basics", () => {
		const biggest = Math.max(
			...manifest.icons.map((icon) => Number.parseInt(icon.sizes, 10)),
		);
		expect(manifest.name).not.toBe("");
		expect(manifest.short_name).not.toBe("");
		expect(manifest.start_url).toBe("/");
		expect(manifest.scope).toBe("/");
		expect(manifest.display).toBe("standalone");
		expect(biggest).toBeGreaterThanOrEqual(192);
	});
});

describe("pages", () => {
	// /pair is a real entry point — it's what a scanned QR code points at — so
	// it needs the manifest link as much as the posts page does.
	it.each(["index", "pair"])("%s.astro carries the shared PWA head", (page) => {
		const source = readFileSync(
			new URL(`src/pages/${page}.astro`, repoRoot),
			"utf8",
		);
		expect(source).toContain("<PwaHead />");
	});

	it("the shared head is what actually links the manifest", () => {
		const source = readFileSync(
			new URL("src/components/PwaHead.astro", repoRoot),
			"utf8",
		);
		expect(source).toContain('href="/manifest.webmanifest"');
	});
});
