// Test-only D1 stand-in. Same spirit as feed.test.ts stubbing global fetch:
// it replaces the one external dependency so the handler's own decisions —
// status codes, auth gating, what it writes — can be asserted without a
// database.
//
// It does NOT execute SQL, so it cannot tell you the queries are correct. That
// is what `pnpm pages:dev` against local D1 is for.

import type { D1Database, D1RunResult } from "./_shared";

export interface Reply {
	first?: unknown;
	run?: D1RunResult;
	all?: { results: unknown[] };
}

export interface Call {
	sql: string;
	values: unknown[];
}

export function fakeDb(
	handler: (sql: string, values: unknown[]) => Reply,
): { db: D1Database; calls: Call[] } {
	const calls: Call[] = [];

	const db: D1Database = {
		prepare(sql: string) {
			let values: unknown[] = [];
			const statement = {
				bind(...bound: unknown[]) {
					values = bound;
					return statement;
				},
				async first<T>(): Promise<T | null> {
					calls.push({ sql, values });
					return (handler(sql, values).first ?? null) as T | null;
				},
				async run(): Promise<D1RunResult> {
					calls.push({ sql, values });
					return handler(sql, values).run ?? { meta: { changes: 1 } };
				},
				async all<T>(): Promise<{ results: T[] }> {
					calls.push({ sql, values });
					return (handler(sql, values).all ?? { results: [] }) as {
						results: T[];
					};
				},
			};
			return statement;
		},
	};

	return { db, calls };
}

export function sqlFor(calls: Call[], fragment: string): Call | undefined {
	return calls.find((call) => call.sql.includes(fragment));
}
