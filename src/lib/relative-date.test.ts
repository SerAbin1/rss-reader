import { describe, expect, it } from "vitest";
import { formatFullDate, formatPostDate } from "./relative-date";

const now = new Date("2026-10-03T12:00:00.000Z");

function ago(ms: number): string {
	return new Date(now.getTime() - ms).toISOString();
}

describe("formatPostDate", () => {
	it("says just now under a minute", () => {
		expect(formatPostDate(ago(30_000), now)).toBe("just now");
	});

	it("counts minutes, hours and days within a week", () => {
		expect(formatPostDate(ago(5 * 60_000), now)).toBe("5m ago");
		expect(formatPostDate(ago(3 * 3_600_000), now)).toBe("3h ago");
		expect(formatPostDate(ago(6 * 86_400_000), now)).toBe("6d ago");
	});

	it("rounds down, so 59 minutes is not yet an hour", () => {
		expect(formatPostDate(ago(59 * 60_000 + 59_000), now)).toBe("59m ago");
	});

	it("falls back to the full date from a week on", () => {
		const weekAgo = ago(7 * 86_400_000);
		expect(formatPostDate(weekAgo, now)).toBe(formatFullDate(new Date(weekAgo)));
	});

	it("shows the full date for a post dated in the future", () => {
		const future = "2026-10-05T00:00:00.000Z";
		expect(formatPostDate(future, now)).toBe(formatFullDate(new Date(future)));
	});
});
