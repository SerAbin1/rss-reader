import { describe, expect, it } from "vitest";
import {
	findFirstUnreadIndex,
	isRead,
	watermarkAfterCatchUp,
	watermarkAfterClick,
} from "./read-state";

const posts = [
	{ publishedAt: "2026-01-01T00:00:00.000Z" },
	{ publishedAt: "2026-01-02T00:00:00.000Z" },
	{ publishedAt: "2026-01-03T00:00:00.000Z" },
];

describe("isRead", () => {
	it("is unread when lastReadAt is null", () => {
		expect(isRead(posts[0].publishedAt, null)).toBe(false);
	});

	it("is read when publishedAt is at or before lastReadAt", () => {
		expect(isRead(posts[0].publishedAt, posts[0].publishedAt)).toBe(true);
		expect(isRead(posts[0].publishedAt, posts[1].publishedAt)).toBe(true);
	});

	it("is unread when publishedAt is after lastReadAt", () => {
		expect(isRead(posts[1].publishedAt, posts[0].publishedAt)).toBe(false);
	});
});

describe("findFirstUnreadIndex", () => {
	it("returns 0 when nothing has been read", () => {
		expect(findFirstUnreadIndex(posts, null)).toBe(0);
	});

	it("returns the index right after lastReadAt", () => {
		expect(findFirstUnreadIndex(posts, posts[0].publishedAt)).toBe(1);
	});

	it("returns -1 when everything is read", () => {
		expect(findFirstUnreadIndex(posts, posts[2].publishedAt)).toBe(-1);
	});
});

describe("watermarkAfterClick", () => {
	it("advances the watermark when clicking the next unread post", () => {
		expect(watermarkAfterClick(posts, null, 0)).toBe(posts[0].publishedAt);
		expect(watermarkAfterClick(posts, posts[0].publishedAt, 1)).toBe(
			posts[1].publishedAt,
		);
	});

	it("does not advance when clicking ahead of the next unread post", () => {
		// research!rsc-style scenario: skipping straight to post 3 with 1 and 2 still unread.
		expect(watermarkAfterClick(posts, null, 2)).toBeNull();
	});

	it("does not advance when clicking something already read", () => {
		expect(watermarkAfterClick(posts, posts[1].publishedAt, 0)).toBeNull();
	});
});

describe("watermarkAfterCatchUp", () => {
	it("advances the watermark to the chosen cutoff", () => {
		expect(watermarkAfterCatchUp(null, posts[1].publishedAt)).toBe(
			posts[1].publishedAt,
		);
		expect(
			watermarkAfterCatchUp(posts[0].publishedAt, posts[2].publishedAt),
		).toBe(posts[2].publishedAt);
	});

	it("refuses to move the watermark backwards", () => {
		// Forward-only: a rewind is the one non-monotonic write this app could
		// produce, and sync's max() merge would silently discard it.
		expect(
			watermarkAfterCatchUp(posts[2].publishedAt, posts[0].publishedAt),
		).toBeNull();
	});

	it("refuses a cutoff equal to the current watermark", () => {
		expect(
			watermarkAfterCatchUp(posts[1].publishedAt, posts[1].publishedAt),
		).toBeNull();
	});
});
