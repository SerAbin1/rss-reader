//! JNI facade for the Android app. Mirrors the WASM bindings in `wasm.rs` —
//! same functions, same semantics, one implementation.
//!
//! Structured values cross the boundary as JSON strings (Kotlin side parses
//! with kotlinx.serialization), primitives cross as JNI scalars. Every
//! function is a thin adapter over the crate's modules; no logic lives here.

#![cfg(target_os = "android")]

use crate::models::Feed;
use crate::reconcile;
use crate::read_state;
use crate::relative_date;
use crate::subscriptions;
use crate::sync_state;
use crate::timestamps;
use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jlong, jstring};
use jni::JNIEnv;

// Everything below assumes the Kotlin facade class lives at
// io.github.serabin1.rssreader.core.RssReaderCore. JNI mangles the class path
// into the symbol name, so keeping the one class is the simplest contract.

const NO_MILLIS: i64 = -1;

fn jstr(env: &mut JNIEnv, value: String) -> jstring {
    env.new_string(value).expect("Rust string is valid UTF-8").into_raw()
}

fn optional_jstr(env: &mut JNIEnv, value: Option<String>) -> jstring {
    match value {
        Some(value) => jstr(env, value),
        None => std::ptr::null_mut(),
    }
}

fn get_str(env: &mut JNIEnv, value: &JString) -> String {
    env.get_string(value).map(|value| value.into()).unwrap_or_default()
}

fn get_opt_str(env: &mut JNIEnv, value: &JString) -> Option<String> {
    if value.as_raw().is_null() {
        None
    } else {
        Some(get_str(env, value))
    }
}

fn to_json_str<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn from_json_str<T: serde::de::DeserializeOwned>(text: &str) -> Option<T> {
    serde_json::from_str(text).ok()
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_parseFeedJson(
    mut env: JNIEnv,
    _class: JClass,
    xml_text: JString,
    feed_url: JString,
) -> jstring {
    let xml_text = get_str(&mut env, &xml_text);
    let feed_url = get_str(&mut env, &feed_url);
    match crate::feed_parser::parse_feed(&xml_text, &feed_url) {
        Ok(parsed) => jstr(&mut env, to_json_str(&parsed)),
        Err(error) => jstr(&mut env, serde_json::json!({"error": error.to_string()}).to_string()),
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_parseOpmlJson(
    mut env: JNIEnv,
    _class: JClass,
    xml_text: JString,
) -> jstring {
    let xml_text = get_str(&mut env, &xml_text);
    match crate::opml::parse_opml(&xml_text) {
        Ok(feeds) => jstr(&mut env, to_json_str(&feeds)),
        Err(error) => jstr(&mut env, serde_json::json!({"error": error.to_string()}).to_string()),
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_writeOpml(
    mut env: JNIEnv,
    _class: JClass,
    feeds_json: JString,
    title: JString,
) -> jstring {
    let feeds_json = get_str(&mut env, &feeds_json);
    let title = get_str(&mut env, &title);
    match from_json_str::<Vec<Feed>>(&feeds_json) {
        Some(feeds) => jstr(&mut env, crate::opml::write_opml(&feeds, &title)),
        None => jstr(&mut env, String::new()),
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_normalizeFeedUrl(
    mut env: JNIEnv,
    _class: JClass,
    raw: JString,
) -> jstring {
    let raw = get_str(&mut env, &raw);
    optional_jstr(&mut env, subscriptions::normalize_feed_url(&raw))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_planAdditionsJson(
    mut env: JNIEnv,
    _class: JClass,
    candidates_json: JString,
    existing_json: JString,
) -> jstring {
    let candidates: Vec<Feed> = match from_json_str(&get_str(&mut env, &candidates_json)) {
        Some(value) => value,
        None => return jstr(&mut env, "{\"added\":[],\"alreadySubscribed\":0,\"invalid\":0}".to_string()),
    };
    let existing: Vec<Feed> = match from_json_str(&get_str(&mut env, &existing_json)) {
        Some(value) => value,
        None => return jstr(&mut env, "{\"added\":[],\"alreadySubscribed\":0,\"invalid\":0}".to_string()),
    };
    jstr(&mut env, to_json_str(&subscriptions::plan_additions(&candidates, &existing)))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_describeImport(
    mut env: JNIEnv,
    _class: JClass,
    additions_json: JString,
) -> jstring {
    let additions_json = get_str(&mut env, &additions_json);
    match from_json_str::<subscriptions::FeedAdditions>(&additions_json) {
        Some(additions) => jstr(&mut env, subscriptions::describe_import(&additions)),
        None => jstr(&mut env, String::new()),
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_isRead(
    mut env: JNIEnv,
    _class: JClass,
    published_at: JString,
    last_read_at: JString,
) -> jboolean {
    let published_at = get_str(&mut env, &published_at);
    let last_read_at = get_opt_str(&mut env, &last_read_at);
    (read_state::is_read(&published_at, last_read_at.as_deref()) as jboolean) as u8
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_findFirstUnreadIndexJson(
    mut env: JNIEnv,
    _class: JClass,
    dates_json: JString,
    last_read_at: JString,
) -> jlong {
    let dates: Vec<String> = match from_json_str(&get_str(&mut env, &dates_json)) {
        Some(value) => value,
        None => return NO_MILLIS,
    };
    let last_read_at = get_opt_str(&mut env, &last_read_at);
    let refs: Vec<&str> = dates.iter().map(String::as_str).collect();
    read_state::find_first_unread_index(&refs, last_read_at.as_deref()).map(|i| i as jlong).unwrap_or(NO_MILLIS)
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_watermarkAfterClickJson(
    mut env: JNIEnv,
    _class: JClass,
    dates_json: JString,
    last_read_at: JString,
    clicked_index: jlong,
) -> jstring {
    let dates: Vec<String> = match from_json_str(&get_str(&mut env, &dates_json)) {
        Some(value) => value,
        None => return std::ptr::null_mut(),
    };
    let last_read_at = get_opt_str(&mut env, &last_read_at);
    let refs: Vec<&str> = dates.iter().map(String::as_str).collect();
    optional_jstr(&mut env, read_state::watermark_after_click(&refs, last_read_at.as_deref(), clicked_index as usize))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_watermarkAfterMarkUpTo(
    mut env: JNIEnv,
    _class: JClass,
    last_read_at: JString,
    published_at: JString,
) -> jstring {
    let last_read_at = get_opt_str(&mut env, &last_read_at);
    let published_at = get_str(&mut env, &published_at);
    optional_jstr(&mut env, read_state::watermark_after_mark_up_to(last_read_at.as_deref(), &published_at))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_isListed(
    mut env: JNIEnv,
    _class: JClass,
    published_at: JString,
    listed_after: JString,
) -> jboolean {
    let published_at = get_str(&mut env, &published_at);
    let listed_after = get_opt_str(&mut env, &listed_after);
    (read_state::is_listed(&published_at, listed_after.as_deref()) as jboolean) as u8
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_favouriteKey(
    mut env: JNIEnv,
    _class: JClass,
    feed_url: JString,
    guid: JString,
) -> jstring {
    let feed_url = get_str(&mut env, &feed_url);
    let guid = get_str(&mut env, &guid);
    jstr(&mut env, read_state::favourite_key(&feed_url, &guid))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_mergeWatermark(
    mut env: JNIEnv,
    _class: JClass,
    a: JString,
    b: JString,
) -> jstring {
    let a = get_opt_str(&mut env, &a);
    let b = get_opt_str(&mut env, &b);
    optional_jstr(&mut env, sync_state::merge_watermark(a.as_deref(), b.as_deref()))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_isPairCodeUsableJson(
    mut env: JNIEnv,
    _class: JClass,
    code_json: JString,
    now: jlong,
) -> jboolean {
    let code_json = get_str(&mut env, &code_json);
    match from_json_str::<sync_state::PairCode>(&code_json) {
        Some(code) => (sync_state::is_pair_code_usable(&code, now as u64) as jboolean) as u8,
        None => 0,
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_formatPairCode(
    mut env: JNIEnv,
    _class: JClass,
    code: JString,
) -> jstring {
    let code = get_str(&mut env, &code);
    jstr(&mut env, sync_state::format_pair_code(&code))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_mergeFeedsJson(
    mut env: JNIEnv,
    _class: JClass,
    a_json: JString,
    b_json: JString,
) -> jstring {
    let a: Vec<sync_state::SyncedFeed> = from_json_str(&get_str(&mut env, &a_json)).unwrap_or_default();
    let b: Vec<sync_state::SyncedFeed> = from_json_str(&get_str(&mut env, &b_json)).unwrap_or_default();
    jstr(&mut env, to_json_str(&sync_state::merge_feeds(&a, &b)))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_liveFeedsJson(
    mut env: JNIEnv,
    _class: JClass,
    feeds_json: JString,
) -> jstring {
    let feeds: Vec<sync_state::SyncedFeed> = from_json_str(&get_str(&mut env, &feeds_json)).unwrap_or_default();
    jstr(&mut env, to_json_str(&sync_state::live_feeds(&feeds)))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_planPushJson(
    mut env: JNIEnv,
    _class: JClass,
    personal_json: JString,
    curated_urls_json: JString,
    remote_json: JString,
) -> jstring {
    let personal: Vec<Feed> = from_json_str(&get_str(&mut env, &personal_json)).unwrap_or_default();
    let curated_urls: Vec<String> = from_json_str(&get_str(&mut env, &curated_urls_json)).unwrap_or_default();
    let remote: Vec<reconcile::RemoteFeed> = from_json_str(&get_str(&mut env, &remote_json)).unwrap_or_default();
    jstr(&mut env, to_json_str(&reconcile::plan_push(&personal, &curated_urls, &remote)))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_applyGroupJson(
    mut env: JNIEnv,
    _class: JClass,
    group_json: JString,
    curated_urls_json: JString,
) -> jstring {
    let group: Vec<reconcile::RemoteFeed> = from_json_str(&get_str(&mut env, &group_json)).unwrap_or_default();
    let curated_urls: Vec<String> = from_json_str(&get_str(&mut env, &curated_urls_json)).unwrap_or_default();
    jstr(&mut env, to_json_str(&reconcile::apply_group(&group, &curated_urls)))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_formatPostDate(
    mut env: JNIEnv,
    _class: JClass,
    published_at: JString,
    now_millis: jlong,
) -> jstring {
    let published_at = get_str(&mut env, &published_at);
    let now = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_millis)
        .unwrap_or_else(|| chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).unwrap());
    jstr(&mut env, relative_date::format_post_date(&published_at, now))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_formatFullDate(
    mut env: JNIEnv,
    _class: JClass,
    published_at: JString,
) -> jstring {
    let published_at = get_str(&mut env, &published_at);
    match timestamps::parse_iso_millis(&published_at) {
        Some(millis) => {
            let date = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis).unwrap();
            jstr(&mut env, relative_date::format_full_date(date))
        }
        None => jstr(&mut env, published_at),
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_isoFromMillis(
    mut env: JNIEnv,
    _class: JClass,
    millis: jlong,
) -> jstring {
    jstr(&mut env, timestamps::format_iso_millis(millis))
}

#[no_mangle]
pub extern "system" fn Java_io_github_serabin1_rssreader_core_RssReaderCore_millisFromIso(
    mut env: JNIEnv,
    _class: JClass,
    iso: JString,
) -> jlong {
    let iso = get_str(&mut env, &iso);
    timestamps::parse_iso_millis(&iso).unwrap_or(NO_MILLIS)
}
