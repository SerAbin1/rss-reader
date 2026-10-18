// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://my-rss-reader.serabin1.workers.dev",
  // Pages stay prerendered; the adapter is what makes this a Worker, so
  // src/pages/api/[...path].ts can run on demand. It sets the Worker's entry
  // and assets itself, which is why wrangler.toml has neither.
  adapter: cloudflare({
    // No astro:assets images, so no Cloudflare Images binding.
    imageService: "passthrough",
  }),
  // Unused, and left on the adapter would add a KV namespace for it.
  session: false,
});
