import { describe, expect, it } from "vite-plus/test";
import worker from "./index";
import { fakeDb } from "./api/sync/_fake-db";

const env = { DB: fakeDb(() => ({})).db };

describe("worker routing", () => {
  it("404s on an unknown /api path", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/nope"), env);
    expect(res.status).toBe(404);
  });

  it("405s on a known path with a method it has no handler for", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/sync/claim"), env);
    expect(res.status).toBe(405);
  });

  it("dispatches to the path's handler for the method", async () => {
    // /api/feed's own validation answers, so the request reached it.
    const res = await worker.fetch(new Request("http://localhost/api/feed"), env);
    expect(res.status).toBe(400);
  });
});
