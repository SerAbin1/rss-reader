/// <reference types="astro/client" />

// The Worker's bindings, as src/pages/api/[...path].ts reads them. A local
// stand-in for @cloudflare/workers-types, like the D1 types in
// functions/api/sync/_shared.ts: just the one export it uses.
declare module "cloudflare:workers" {
  export const env: import("../functions/api/sync/_shared").SyncContext["env"];
}
