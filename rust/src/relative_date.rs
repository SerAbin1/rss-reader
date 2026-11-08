//! How a post's date reads in the list. Kept out of the app so it can be
//! tested against a fixed "now" — same pure-lib split as read_state.rs.
//!
//! Relative inside the last week ("3h ago"), where "how long ago" is the useful
//! question; the full date beyond it, where "4w ago" would only make you do
//! the arithmetic back. A date in the future (a scheduled post, a feed with a
//! wrong clock) gets the full date too, rather than a confusing "in 3d".

use crate::timestamps::parse_iso_millis;
use chrono::{DateTime, Utc};

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
const WEEK: i64 = 7 * DAY;

/// Format the date for display relative to `now`.
///
/// Falls back to the full date for unparseable dates rather than panicking —
/// the feed parser only lets through posts whose pubDate it could parse, but
/// the string formate still has to be total.
pub fn format_post_date(published_at: &str, now: DateTime<Utc>) -> String {
    let millis = match parse_iso_millis(published_at) {
        Some(millis) => millis,
        None => return format_full_date_from_text(published_at),
    };
    let post = DateTime::<Utc>::from_timestamp_millis(millis).expect("millis within range");
    let elapsed = now.signed_duration_since(post).num_milliseconds();

    if (0..WEEK).contains(&elapsed) {
        if elapsed < MINUTE {
            return "just now".to_string();
        }
        if elapsed < HOUR {
            return format!("{}m ago", elapsed / MINUTE);
        }
        if elapsed < DAY {
            return format!("{}h ago", elapsed / HOUR);
        }
        return format!("{}d ago", elapsed / DAY);
    }
    format_full_date(post)
}

/// The full date for display — e.g. "Aug 24, 2026".
pub fn format_full_date(date: DateTime<Utc>) -> String {
    date.format("%b %-d, %Y").to_string()
}

/// The full date when only the original (possibly odd) text is available.
pub fn format_full_date_from_text(raw: &str) -> String {
    match parse_iso_millis(raw).and_then(DateTime::<Utc>::from_timestamp_millis) {
        Some(date) => format_full_date(date),
        None => raw.trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timestamps::format_iso_millis;

    fn millis_of(iso: &str) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp_millis(parse_iso_millis(iso).unwrap()).unwrap()
    }

    // 2026-10-03T12:00:00.000Z
    const NOW_ISO: &str = "2026-10-03T12:00:00.000Z";

    fn ago(offset_millis: i64) -> String {
        let now = parse_iso_millis(NOW_ISO).unwrap();
        format_iso_millis(now - offset_millis)
    }

    #[test]
    fn just_now_under_a_minute() {
        let now = millis_of(NOW_ISO);
        assert_eq!(format_post_date(&ago(30_000), now), "just now");
    }

    #[test]
    fn counts_minutes_hours_days_within_a_week() {
        let now = millis_of(NOW_ISO);
        assert_eq!(format_post_date(&ago(5 * MINUTE), now), "5m ago");
        assert_eq!(format_post_date(&ago(3 * HOUR), now), "3h ago");
        assert_eq!(format_post_date(&ago(6 * DAY), now), "6d ago");
    }

    #[test]
    fn rounds_down_59_minutes() {
        let now = millis_of(NOW_ISO);
        assert_eq!(format_post_date(&ago(59 * MINUTE + 59_000), now), "59m ago");
    }

    #[test]
    fn a_week_falls_back_to_full_date() {
        let now = millis_of(NOW_ISO);
        let week_ago = ago(7 * DAY);
        let expected = format_full_date(millis_of(&week_ago));
        assert_eq!(format_post_date(&week_ago, now), expected);
    }

    #[test]
    fn future_date_shows_full_date_not_in_n_days() {
        let now = millis_of(NOW_ISO);
        let future = "2026-10-05T00:00:00.000Z";
        let expected = format_full_date(millis_of(future));
        assert_eq!(format_post_date(future, now), expected);
    }
}
