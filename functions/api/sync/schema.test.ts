// The one place the sync SQL actually runs: Node's built-in SQLite (what D1
// is), with the real migrations applied and foreign keys on, as D1 has them.
// The fake DB in sync.test.ts checks each endpoint's decisions; this checks
// that the database holds the device limit on its own, and that the queries
// behind it are valid SQL.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { onRequestPost as claim } from "./claim";
import { onRequestDelete as leave } from "./device";
import { onRequestPost as pair } from "./pair";
import type { D1Database } from "./_shared";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

let sqlite: DatabaseSync;
let env: { DB: D1Database };

// Just enough of D1 over node:sqlite for the endpoints.
function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first<T>() {
          return (db.prepare(sql).get(...(values as never[])) ?? null) as T | null;
        },
        async run() {
          const { changes } = db.prepare(sql).run(...(values as never[]));
          return { meta: { changes: Number(changes) } };
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...(values as never[])) as T[] };
        },
      };
      return statement;
    },
  };
}

function request(path: string, body?: unknown, token?: string, method = "POST"): Request {
  return new Request(`http://localhost/api/sync/${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function count(table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

async function startGroup(): Promise<{ token: string; code: string }> {
  const body = await (await pair({ request: request("pair", {}), env })).json();
  return { token: body.deviceToken, code: body.pairCode };
}

async function join(code: string): Promise<Response> {
  return claim({ request: request("claim", { code }), env });
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  env = { DB: d1(sqlite) };
});

describe("device_group_limit trigger", () => {
  function insertDevice(id: string, group: string): void {
    sqlite
      .prepare("INSERT INTO device (id, group_id, token_hash, created_at) VALUES (?, ?, ?, 0)")
      .run(id, group, `hash-${id}`);
  }

  beforeEach(() => {
    for (const group of ["g1", "g2"]) {
      sqlite
        .prepare("INSERT INTO sync_group (id, updated_at, created_at) VALUES (?, 0, 0)")
        .run(group);
    }
  });

  it("refuses a third device in a group, whoever does the inserting", () => {
    insertDevice("a", "g1");
    insertDevice("b", "g1");
    expect(() => insertDevice("c", "g1")).toThrow(/sync group full/);
    expect(count("device")).toBe(2);
  });

  it("counts per group", () => {
    insertDevice("a", "g1");
    insertDevice("b", "g1");
    insertDevice("c", "g2");
    expect(count("device")).toBe(3);
  });
});

describe("pairing against the real schema", () => {
  it("lets a second device join, and refuses a third with a 409", async () => {
    const first = await startGroup();
    expect((await join(first.code)).status).toBe(200);

    const res = await pair({ request: request("pair", {}, first.token), env });
    expect(res.status).toBe(409);
    expect(count("device")).toBe(2);
  });

  it("refuses a code issued while the group had room, once it's full", async () => {
    // Two codes from a one-device group: both pass /pair's check, and only
    // the first to be claimed may join.
    const first = await startGroup();
    const second = await (await pair({ request: request("pair", {}, first.token), env })).json();

    expect((await join(first.code)).status).toBe(200);
    expect((await join(second.pairCode)).status).toBe(409);
    expect(count("device")).toBe(2);
  });

  it("replace removes the other device and lets the new one in", async () => {
    const first = await startGroup();
    const old = await (await join(first.code)).json();

    const fresh = await (
      await pair({ request: request("pair", { replace: true }, first.token), env })
    ).json();
    expect((await join(fresh.pairCode)).status).toBe(200);

    expect(count("device")).toBe(2);
    // The replaced device's token is dead.
    const res = await leave({
      request: request("device", undefined, old.deviceToken, "DELETE"),
      env,
    });
    expect(res.status).toBe(401);
  });

  it("unpairing frees the place, and the last device out removes the group", async () => {
    const first = await startGroup();
    const second = await (await join(first.code)).json();
    sqlite
      .prepare("INSERT INTO feed (group_id, feed_url, title, updated_at) VALUES (?, 'u', 't', 0)")
      .run(second.groupId);

    await leave({ request: request("device", undefined, second.deviceToken, "DELETE"), env });
    expect(count("device")).toBe(1);
    expect(count("sync_group")).toBe(1);

    await leave({ request: request("device", undefined, first.token, "DELETE"), env });
    expect(count("device")).toBe(0);
    expect(count("feed")).toBe(0);
    expect(count("pair_code")).toBe(0);
    expect(count("sync_group")).toBe(0);
  });
});
