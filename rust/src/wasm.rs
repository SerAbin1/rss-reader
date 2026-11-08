//! WASM bindings for the browser (Astro/web app). Mirrors the native crate's
//! API exactly, so the web app and the Android app call the same semantics.
//!
//! Complex values cross the boundary as JS objects via `serde_wasm_bindgen`:
//! the TS side passes/receives plain objects with the same camelCase field
//! names the native structures use, plus the same null-ness for Option<T>.

use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    to_value(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn parse_js<T: serde::de::DeserializeOwned>(value: &JsValue, what: &str) -> Result<T, JsValue> {
    from_value(value.clone()).map_err(|error| JsValue::from_str(&format!("invalid {what}: {error}")))
}

#[wasm_bindgen]
pub fn parse_feed(xml_text: &str, feed_url: &str) -> Result<JsValue, JsValue> {
    let parsed = crate::feed_parser::parse_feed(xml_text, feed_url)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js(&parsed)
}

#[wasm_bindgen]
pub fn parse_opml(xml_text: &str) -> Result<JsValue, JsValue> {
    let feeds = crate::opml::parse_opml(xml_text).map_err(|error| JsValue::from_str(&error.to_string()))?;
    to_js(&feeds)
}

#[wasm_bindgen]
pub fn write_opml(feeds: JsValue, title: &str) -> Result<String, JsValue> {
    let feeds: Vec<crate::models::Feed> = parse_js(&feeds, "feeds")?;
    Ok(crate::opml::write_opml(&feeds, title))
}

#[wasm_bindgen]
pub fn normalize_feed_url(raw: &str) -> Option<String> {
    crate::subscriptions::normalize_feed_url(raw)
}

#[wasm_bindgen]
pub fn plan_additions(candidates: JsValue, existing: JsValue) -> Result<JsValue, JsValue> {
    let candidates: Vec<crate::models::Feed> = parse_js(&candidates, "candidates")?;
    let existing: Vec<crate::models::Feed> = parse_js(&existing, "existing")?;
    to_js(&crate::subscriptions::plan_additions(&candidates, &existing))
}

#[wasm_bindgen]
pub fn describe_import(additions: JsValue) -> Result<String, JsValue> {
    let additions: crate::subscriptions::FeedAdditions = parse_js(&additions, "additions")?;
    Ok(crate::subscriptions::describe_import(&additions))
}

#[wasm_bindgen]
pub fn is_read(published_at: &str, last_read_at: Option<String>) -> bool {
    crate::read_state::is_read(published_at, last_read_at.as_deref())
}

#[wasm_bindgen]
pub fn find_first_unread_index(published_at: Vec<String>, last_read_at: Option<String>) -> Option<usize> {
    let refs: Vec<&str> = published_at.iter().map(String::as_str).collect();
    crate::read_state::find_first_unread_index(&refs, last_read_at.as_deref())
}

#[wasm_bindgen]
pub fn watermark_after_click(
    published_at: Vec<String>,
    last_read_at: Option<String>,
    clicked_index: usize,
) -> Option<String> {
    let refs: Vec<&str> = published_at.iter().map(String::as_str).collect();
    crate::read_state::watermark_after_click(&refs, last_read_at.as_deref(), clicked_index)
}

#[wasm_bindgen]
pub fn watermark_after_mark_up_to(last_read_at: Option<String>, published_at: &str) -> Option<String> {
    crate::read_state::watermark_after_mark_up_to(last_read_at.as_deref(), published_at)
}

#[wasm_bindgen]
pub fn is_listed(published_at: &str, listed_after: Option<String>) -> bool {
    crate::read_state::is_listed(published_at, listed_after.as_deref())
}

#[wasm_bindgen]
pub fn favourite_key(feed_url: &str, guid: &str) -> String {
    crate::read_state::favourite_key(feed_url, guid)
}

#[wasm_bindgen]
pub fn merge_watermark(a: Option<String>, b: Option<String>) -> Option<String> {
    crate::sync_state::merge_watermark(a.as_deref(), b.as_deref())
}

#[wasm_bindgen]
pub fn is_pair_code_usable(code: JsValue, now: u64) -> Result<bool, JsValue> {
    let code: crate::sync_state::PairCode = parse_js(&code, "pair code")?;
    Ok(crate::sync_state::is_pair_code_usable(&code, now))
}

#[wasm_bindgen]
pub fn format_pair_code(code: &str) -> String {
    crate::sync_state::format_pair_code(code)
}

#[wasm_bindgen]
pub fn merge_feeds(a: JsValue, b: JsValue) -> Result<JsValue, JsValue> {
    let a: Vec<crate::sync_state::SyncedFeed> = parse_js(&a, "SyncedFeed[]")?;
    let b: Vec<crate::sync_state::SyncedFeed> = parse_js(&b, "SyncedFeed[]")?;
    to_js(&crate::sync_state::merge_feeds(&a, &b))
}

#[wasm_bindgen]
pub fn live_feeds(feeds: JsValue) -> Result<JsValue, JsValue> {
    let feeds: Vec<crate::sync_state::SyncedFeed> = parse_js(&feeds, "SyncedFeed[]")?;
    to_js(&crate::sync_state::live_feeds(&feeds))
}

#[wasm_bindgen]
pub fn plan_push(personal: JsValue, curated_urls: Vec<String>, remote: JsValue) -> Result<JsValue, JsValue> {
    let personal: Vec<crate::models::Feed> = parse_js(&personal, "personal feeds")?;
    let remote: Vec<crate::reconcile::RemoteFeed> = parse_js(&remote, "remote feeds")?;
    to_js(&crate::reconcile::plan_push(&personal, &curated_urls, &remote))
}

#[wasm_bindgen]
pub fn apply_group(group: JsValue, curated_urls: Vec<String>) -> Result<JsValue, JsValue> {
    let group: Vec<crate::reconcile::RemoteFeed> = parse_js(&group, "group feeds")?;
    to_js(&crate::reconcile::apply_group(&group, &curated_urls))
}

#[wasm_bindgen]
pub fn format_post_date(published_at: &str, now_millis: i64) -> String {
    let now = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_millis)
        .unwrap_or_else(|| chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).unwrap());
    crate::relative_date::format_post_date(published_at, now)
}

#[wasm_bindgen]
pub fn format_full_date(published_at: &str) -> String {
    let millis = crate::timestamps::parse_iso_millis(published_at).unwrap_or(0);
    let date = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis).unwrap();
    crate::relative_date::format_full_date(date)
}
