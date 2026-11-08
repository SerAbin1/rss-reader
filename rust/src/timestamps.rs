//! Lenient feed date parsing and ISO 8601 formatting.
//!
//! Mirrors the browser's `Date` parser only as far as real feeds need: the
//! shapes RSS and Atom declare are RFC 822 / RFC 1123 / RFC 3339, plus the
//! frequent mistakes. Same approach as the web app and the Kotlin port — try
//! the most common shapes first.

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};

/// JS `Date.prototype.toISOString()` shape: always three fractional digits,
/// always `Z`. The watermark crosses the wire as a string and the server
/// orders watermarks by comparing those strings as text, so every device has
/// to write the exact same shape.
pub fn format_iso_millis(millis: i64) -> String {
    let secs = millis / 1000;
    let millis_remainder = millis % 1000;
    // chrono's %.3f does fractional; format manually to keep exactly 3 digits.
    let date_time = Utc.timestamp_opt(secs, (millis_remainder * 1_000_000) as u32).unwrap();
    date_time.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Parse an ISO 8601-ish date into epoch milliseconds, truncated the same way
/// a JS Date is (millisecond precision). Tries the standard shapes in the
/// order the Kotlin port does, then the no-offset ISO shapes (taken as UTC,
/// so the same post sorts the same on two devices).
pub fn parse_iso_millis(raw: &str) -> Option<i64> {
    let mut text = raw.trim().split_ascii_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }

    // RFC 3339 (Atom), with any offset.
    if let Ok(ts) = DateTime::parse_from_rfc3339(&text) {
        return Some(ts.timestamp_millis());
    }

    // RSS leans on "GMT"/"UTC" as the offset. Map a trailing token to
    // +0000 before trying numeric-offset patterns — chrono's %z does not
    // accept named zones.
    let upper = text.to_ascii_uppercase();
    if upper.ends_with(" GMT") {
        text = format!("{} +0000", &text[..text.len() - 4]);
    } else if upper.ends_with(" UTC") {
        text = format!("{} +0000", &text[..text.len() - 4]);
    } else if upper.ends_with("Z") && !upper.contains("+") {
        // Uncommon in RSS but symmetric with RFC 3339 output.
        text = format!("{} +0000", &text[..text.len() - 1]);
    }

    const ZONED: &[&str] = &[
        // RFC 1123 / RFC 822 (RSS): "Mon, 24 Aug 2026 09:00:00 +0000"
        "%a, %d %b %Y %H:%M:%S %z",
        // No weekday.
        "%d %b %Y %H:%M:%S %z",
        // 2-digit years.
        "%a, %d %b %y %H:%M:%S %z",
        "%d %b %y %H:%M:%S %z",
    ];

    for pattern in ZONED {
        if let Ok(ts) = DateTime::parse_from_str(&text, pattern) {
            return Some(ts.timestamp_millis());
        }
    }

    if let Ok(naive) = NaiveDateTime::parse_from_str(&text, "%Y-%m-%dT%H:%M:%S") {
        return Some(naive.and_utc().timestamp_millis());
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(&text, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(naive.and_utc().timestamp_millis());
    }
    if let Ok(date) = NaiveDate::parse_from_str(&text, "%Y-%m-%d") {
        let naive: DateTime<Utc> = DateTime::from_naive_utc_and_offset(
            date.and_hms_opt(0, 0, 0).expect("midnight always valid"),
            Utc,
        );
        return Some(naive.timestamp_millis());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rfc1123_gmt() {
        assert_eq!(
            parse_iso_millis("Mon, 24 Aug 2026 09:00:00 GMT").and_then(|m| Some(format_iso_millis(m))),
            Some("2026-08-24T09:00:00.000Z".to_string())
        );
    }

    #[test]
    fn parses_rfc3339_z() {
        assert_eq!(
            parse_iso_millis("2026-08-24T09:00:00Z").and_then(|m| Some(format_iso_millis(m))),
            Some("2026-08-24T09:00:00.000Z".to_string())
        );
    }

    #[test]
    fn parses_rfc3339_with_offset() {
        let expected = parse_iso_millis("2026-08-24T11:00:00+02:00").map(format_iso_millis);
        assert_eq!(expected.unwrap(), "2026-08-24T09:00:00.000Z");
    }

    #[test]
    fn parses_rfc1123_without_weekday() {
        assert_eq!(
            parse_iso_millis("24 Aug 2026 09:00:00 GMT").map(format_iso_millis).unwrap(),
            "2026-08-24T09:00:00.000Z".to_string()
        );
    }

    #[test]
    fn date_only_is_midnight_utc() {
        assert_eq!(
            parse_iso_millis("2026-08-24").map(format_iso_millis).unwrap(),
            "2026-08-24T00:00:00.000Z".to_string()
        );
    }

    #[test]
    fn bare_datetime_is_utc_not_local() {
        assert_eq!(
            parse_iso_millis("2026-08-24T09:00:00").map(format_iso_millis).unwrap(),
            "2026-08-24T09:00:00.000Z".to_string()
        );
    }

    #[test]
    fn garbage_is_none() {
        assert_eq!(parse_iso_millis("not a date"), None);
        assert_eq!(parse_iso_millis(""), None);
        assert_eq!(parse_iso_millis("   "), None);
    }
}
