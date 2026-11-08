// Thin typed layer over the WASM build of the shared Rust crate (rust/).
// Every function and data shape mirrors the Rust API one-to-one, so web and
// Android call into the same implementation — the same semantics, the same
// tests. The old TypeScript ports this layer replaced lived in sibling
// modules (feed-parser.ts, subscriptions.ts, read-state.ts, sync-state.ts,
// opml.ts, relative-date.ts) and were removed when this landed.

// The wasm-bindgen `bundler` target imports the .wasm file in a way Vite
// understands, so the instance is ready the moment this module is imported —
// there is no init step to await.
import * as wasm from "./pkg/rss_reader_core.js";

// --- Data shapes --------------------------------------------------------------

// Feeds carry the row-level fields the app needs, exactly what the Rust Feed
// struct serialises (skip_serializing_if omits absent siteUrl).
export interface Feed {
  feedUrl: string;
  title: string;
  siteUrl?: string;
}

export interface Post {
  feedUrl: string;
  guid: string;
  title: string;
  link: string;
  publishedAt: string;
}

// What parseFeed returns: channel metadata plus the posts. The TS fields are
// null (rather than undefined) when the document doesn't declare them, the
// same spelling the old code used.
export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  posts: Post[];
}

// The sync bookkeeping on a feed the group knows about — same shape the D1
// endpoints send, since that's what the old sync-client and sync-state types
// were built around.
export interface SyncedFeed extends Feed {
  updatedAt: number;
  deletedAt: number | null;
}

export interface PairCode {
  expiresAt: number;
  claimedAt: number | null;
}

export interface FeedAdditions {
  added: Feed[];
  alreadySubscribed: number;
  invalid: number;
}

export interface RemoteFeed {
  feedUrl: string;
  title: string;
  deleted: boolean;
}

export interface ReconcilePush {
  additions: Feed[];
  retractions: string[];
}

export interface ReconcileResult {
  live: Feed[];
  removed: string[];
}

// --- Helpers -----------------------------------------------------------------

// wasm-bindgen represents Option<T> as `T | undefined`; the web code uses
// null to mean "not set", so normalise at the boundary.
const orNull = <T>(value: T | undefined): T | null => value ?? null;

// --- Feed parsing -------------------------------------------------------------

// Throws with the Rust error message when the XML is malformed or the root is
// not RSS or Atom — the caller's catch lands in the same message the app
// already showed.
export function parseFeed(xmlText: string, feedUrl: string): ParsedFeed {
  return wasm.parse_feed(xmlText, feedUrl) as ParsedFeed;
}

// --- OPML ---------------------------------------------------------------------

export function parseOpml(xmlText: string): Feed[] {
  return wasm.parse_opml(xmlText) as Feed[];
}

export function writeOpml(feeds: Feed[], title: string): string {
  return wasm.write_opml(feeds, title);
}

// --- Subscriptions ------------------------------------------------------------

// The canonical form a feed URL is stored and compared under — same string
// the server sees and the sync key compares. Exactly the same semantics as
// the old normalizeFeedUrl (trim, lowercase host, drop fragment, drop
// default ports, http/https only), enforced by the same unit-test cases.
export function normalizeFeedUrl(raw: string): string | null {
  return orNull(wasm.normalize_feed_url(raw));
}

export function planAdditions(candidates: Feed[], existing: Feed[]): FeedAdditions {
  return wasm.plan_additions(candidates, existing) as FeedAdditions;
}

export function describeImport(additions: FeedAdditions): string {
  return wasm.describe_import(additions);
}

// --- Read state -----------------------------------------------------------------
// The watermark: a post is read when it was published at or before lastReadAt.
// lastReadAt participates in sync as a monotonic ISO string.

export const isRead = (publishedAt: string, lastReadAt: string | null): boolean =>
  wasm.is_read(publishedAt, lastReadAt);

export interface Dated {
  publishedAt: string;
}

// posts must be sorted ascending by publishedAt. -1 when everything is read.
// The callers hand over arrays of posts; the boundary receives their ISO dates.
export const findFirstUnreadIndex = (posts: Dated[], lastReadAt: string | null): number =>
  wasm.find_first_unread_index(
    posts.map((post) => post.publishedAt),
    lastReadAt,
  ) ?? -1;

// Only advances the watermark when the clicked post is exactly the next
// unread one; clicking ahead reads just that one post.
export const watermarkAfterClick = (
  posts: Dated[],
  lastReadAt: string | null,
  clickedIndex: number,
): string | null =>
  orNull(
    wasm.watermark_after_click(
      posts.map((post) => post.publishedAt),
      lastReadAt,
      clickedIndex,
    ),
  );

// Forward-only: a rewind would be discarded by sync's max() merge.
export const watermarkAfterMarkUpTo = (
  lastReadAt: string | null,
  publishedAt: string,
): string | null => orNull(wasm.watermark_after_mark_up_to(lastReadAt, publishedAt));

export const isListed = (publishedAt: string, listedAfter: string | null): boolean =>
  wasm.is_listed(publishedAt, listedAfter);

// A guid is only unique within its own feed, so the key for favourites
// couples the feed URL with the guid.
export const favouriteKey = (post: { feedUrl: string; guid: string }): string =>
  wasm.favourite_key(post.feedUrl, post.guid);

// --- Sync merge -----------------------------------------------------------------

export const mergeWatermark = (a: string | null, b: string | null): string | null =>
  orNull(wasm.merge_watermark(a, b));

export const isPairCodeUsable = (code: PairCode, now: number): boolean =>
  wasm.is_pair_code_usable(code, BigInt(now));

export const formatPairCode = (code: string): string => wasm.format_pair_code(code);

// Feeds merge per-feed last-write-wins over the union of both sides. Ties
// break in favour of the tombstone — and equal timestamps are possible (same
// millisecond, one server clock).
export const mergeFeeds = (a: SyncedFeed[], b: SyncedFeed[]): SyncedFeed[] =>
  wasm.merge_feeds(a, b) as SyncedFeed[];

// The live feeds, bookkeeping stripped — what the app renders and fetches.
export const liveFeeds = (feeds: SyncedFeed[]): Feed[] => wasm.live_feeds(feeds) as Feed[];

// --- Reconcile ------------------------------------------------------------------

// What to tell the group before consuming its answer; what to keep afterwards.
export function planPush(
  personal: Feed[],
  curatedUrls: string[],
  remote: RemoteFeed[],
): ReconcilePush {
  return wasm.plan_push(personal, curatedUrls, remote) as ReconcilePush;
}

export function applyGroup(group: RemoteFeed[], curatedUrls: string[]): ReconcileResult {
  return wasm.apply_group(group, curatedUrls) as ReconcileResult;
}

// --- Dates -----------------------------------------------------------------------
// Relative for the week, otherwise the full date; future dates get the full
// date too, rather than "in 3d" for a scheduled post.

export const formatPostDate = (publishedAt: string, now: Date): string =>
  wasm.format_post_date(publishedAt, BigInt(now.getTime()));

export const formatFullDate = (date: Date): string => wasm.format_full_date(date.toISOString());
