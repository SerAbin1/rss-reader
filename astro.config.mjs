// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { buildPrecache } from "./scripts/precache.mjs";

const swSource = new URL("./src/sw.js", import.meta.url);
const precachePlaceholder = "__PRECACHE__";

// Emits dist/sw.js from src/sw.js, filling in the precache list.
//
// Astro has no build hook that knows a service worker exists, and the worker
// can't know its own precache list at authoring time: the app's script is
// content-hashed by Astro, so the filename the worker has to cache is only
// known once the build has run. Generating the worker here keeps src/sw.js
// readable and the list exact, without a plugin.
//
// Typed as an AstroIntegration (rather than as a bare function) so the hook's
// arguments are inferred instead of implicitly any, which is what this file's
// @ts-check is here to catch.
/** @type {import("astro").AstroIntegration} */
const serviceWorker = {
	name: "service-worker",
	hooks: {
		"astro:build:done": async ({ dir, logger }) => {
			const outDir = fileURLToPath(dir);
			const { version, assets } = await buildPrecache(outDir);
			const source = await readFile(swSource, "utf8");

			const occurrences = source.split(precachePlaceholder).length - 1;
			if (occurrences !== 1) {
				throw new Error(
					`Expected exactly one ${precachePlaceholder} placeholder in src/sw.js, found ${occurrences}.`,
				);
			}

			await writeFile(
				path.join(outDir, "sw.js"),
				source.replace(
					precachePlaceholder,
					`${JSON.stringify({ version, assets }, null, "\t")}`,
				),
			);
			logger.info(`sw.js: precaching ${assets.length} entries (v${version})`);
		},
	},
};

// https://astro.build/config
export default defineConfig({
	site: "https://my-rss-reader.pages.dev",
	integrations: [serviceWorker],
});
