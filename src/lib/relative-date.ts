// How a post's date reads in the list. Kept out of app.ts so it can be tested
// against a fixed "now" — same pure-lib split as read-state.ts.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Relative inside the last week ("3h ago"), where "how long ago" is the useful
// question; the full date beyond it, where "4w ago" would only make you do the
// arithmetic back. A date in the future (a scheduled post, a feed with a wrong
// clock) gets the full date too, rather than a confusing "in 3d".
export function formatPostDate(publishedAt: string, now: Date): string {
	const date = new Date(publishedAt);
	const elapsed = now.getTime() - date.getTime();

	if (elapsed >= 0 && elapsed < WEEK) {
		if (elapsed < MINUTE) return "just now";
		if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
		if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
		return `${Math.floor(elapsed / DAY)}d ago`;
	}
	return formatFullDate(date);
}

export function formatFullDate(date: Date): string {
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
