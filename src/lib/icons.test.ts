// Both pages spent a while pointing at a /favicon.svg and /favicon.ico that
// were never generated. This is the check that would have caught it.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = new URL("../../", import.meta.url);
const publicDir = fileURLToPath(new URL("public/", repoRoot));

describe("pages", () => {
  it.each(["index", "pair"])("%s.astro links only to icons that exist", (page) => {
    const source = readFileSync(new URL(`src/pages/${page}.astro`, repoRoot), "utf8");
    const hrefs = [...source.matchAll(/<link rel="icon"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(existsSync(`${publicDir}${href}`), `${href} is linked but not in public/`).toBe(true);
    }
  });
});
