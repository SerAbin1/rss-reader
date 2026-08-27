import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Default to plain Node — real `fetch`/`Request`/`Response`, no DOM polyfill quirks.
		// Files that need a DOM (e.g. `DOMParser`) opt in with a `// @vitest-environment jsdom` pragma.
		environment: "node",
	},
});
