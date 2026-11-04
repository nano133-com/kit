-- The plays of "@nano133/nanoterra/shop/d1" (plays.json: a round, a level, a life or a continue that a player buys and uses once). A game that sells plays adds this file as
-- its next migration (for example migrations/0012_plays.sql), AFTER the shop's tables (d1.sql, or the starter's own 0001_init.sql), applies it BEFORE it
-- deploys the Worker that sells plays (createD1Shop reads the schema to know it is there; `{ plays: true }` skips that read). A game that sells only
-- looks needs none of it. Run it once (ALTER TABLE has no IF NOT EXISTS; `wrangler d1 migrations apply` runs each file once). Times are ms since 1970.

-- What an order sells: 'look' or 'play' (look_id then holds the play's id). Every order made before reads as a look.
ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'look';
-- A play's order: the days its credit may wait for a use (the play's useWithinDays when the order was made). NULL for a look.
ALTER TABLE orders ADD COLUMN use_days INTEGER;
-- A paid play's order: when its player's "Delete my data" deleted its credit UNUSED (the order keeps its payer: the payment goes back by hand). NULL else.
ALTER TABLE orders ADD COLUMN forgot_unused INTEGER;

-- One credit per paid play order: the order's id is the key, so a second settle of one order writes nothing.
CREATE TABLE IF NOT EXISTS credits (
  order_id TEXT PRIMARY KEY,         -- the paid order
  player TEXT NOT NULL,              -- the ORDER's player (as settle gives a look)
  play_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,       -- when the payment was recorded: the wait counts from here
  expires_at INTEGER NOT NULL,       -- the last time it can be used: granted_at + the order's use_days, fixed at the grant
  used_at INTEGER,                   -- NULL until a round uses it
  use_ref TEXT                       -- the round's own id that used it
);
CREATE INDEX IF NOT EXISTS credits_ready ON credits (player, play_id, used_at, expires_at);
-- One ref of a player uses one credit, ever (NULLs never collide).
CREATE UNIQUE INDEX IF NOT EXISTS credits_use ON credits (player, use_ref);

-- The players who said "I am 18 or older" (the admin's Legal card: "Paid rounds for 18 and up only"), once each. "Delete my data" deletes the row.
CREATE TABLE IF NOT EXISTS play_adults (
  player TEXT PRIMARY KEY,
  at INTEGER NOT NULL                -- when the player said yes
);
