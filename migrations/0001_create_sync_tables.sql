-- Cross-device reading-state sync.
-- See Obsidian → Software_Development/Projects/rss-reader.md,
-- "feat: cross-device sync — opaque device tokens, not a shared group ID".
--
-- Three identifiers, kept deliberately separate: the group id is an internal
-- identifier and is never accepted as authentication; the device token is the
-- only credential and is stored hashed, never in plaintext; a pair code is
-- single-use and short-lived, exchangeable for a device token but never usable
-- as one.

CREATE TABLE sync_group (
  id           TEXT PRIMARY KEY,
  last_read_at TEXT,                    -- ISO 8601; NULL = nothing read yet
  updated_at   INTEGER NOT NULL,        -- epoch ms, server-stamped
  created_at   INTEGER NOT NULL
);

-- token_hash is SHA-256 of the bearer token. Hashed for the same reason
-- passwords are: a leaked dump or an over-broad query must not yield working
-- credentials for every paired device.
CREATE TABLE device (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES sync_group(id),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX device_group_idx ON device (group_id);

-- claimed_at non-null means redeemed; single-use is enforced on it rather than
-- by deleting the row, so a replayed code is distinguishable from an unknown one.
CREATE TABLE pair_code (
  code_hash  TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES sync_group(id),
  expires_at INTEGER NOT NULL,          -- epoch ms
  claimed_at INTEGER
);

CREATE INDEX pair_code_expires_idx ON pair_code (expires_at);

-- User-added feeds only. The curated list ships with the build as a
-- git-versioned file, identical for every visitor, so it needs no rows here;
-- this table is the per-group delta on top of it.
--
-- updated_at/deleted_at are stamped by the endpoint, never by the device.
-- Feed membership is resolved by comparing these timestamps (last-write-wins
-- per feed), so a device with a skewed clock would otherwise win arguments it
-- should lose. deleted_at is a tombstone rather than a row deletion: a purely
-- additive set can never forget, so a feed removed on one device would be
-- resurrected by the other on the next merge.
CREATE TABLE feed (
  group_id   TEXT NOT NULL REFERENCES sync_group(id),
  feed_url   TEXT NOT NULL,
  title      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,                   -- NULL = live
  PRIMARY KEY (group_id, feed_url)
);
