-- The friends tables of "@nano133/nanoterra/friends/d1". Add this file to the game's migrations (for example migrations/0005_friends.sql) and run
-- `wrangler d1 migrations apply`. The adapter reads and writes only these three tables.

-- One row for each pair of players (a < b): a request, a friendship or a block. `edge` is the opaque id the browser sees.
CREATE TABLE IF NOT EXISTS friend_edges (
  edge TEXT PRIMARY KEY,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  from_player TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'friend', 'blocked')),
  blocked_by TEXT NOT NULL DEFAULT '[]',
  at INTEGER NOT NULL,
  invite_from TEXT,
  invite_where TEXT,
  invite_at INTEGER,
  rev INTEGER NOT NULL DEFAULT 1,
  UNIQUE (a, b)
);
CREATE INDEX IF NOT EXISTS friend_edges_b ON friend_edges (b);

-- Where a player is now, and which tab said so. A row older than two minutes does not count.
CREATE TABLE IF NOT EXISTS friend_presence (
  player TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  lease TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- A player's "show me online" choice (1 or 0). No row: shown.
CREATE TABLE IF NOT EXISTS friend_prefs (
  player TEXT PRIMARY KEY,
  show_online INTEGER NOT NULL DEFAULT 1
);
