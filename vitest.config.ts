import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    // Default to plain Node — real `fetch`/`Request`/`Response`, no DOM polyfill quirks.
    // Files that need a DOM (e.g. `DOMParser`) opt in with a `// @vitest-environment jsdom` pragma.
    environment: "node",
  },
});
