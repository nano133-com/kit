-- The shop tables of "@nano133/nanoterra/shop/d1": the game starter's own (migrations/0001_init.sql), column for column. A new game adds this file to its
-- migrations (for example migrations/0002_shop.sql) and runs `wrangler d1 migrations apply`. A game made from the starter has these tables already:
-- it needs no migration (and IF NOT EXISTS makes this file a no-op there). The store reads and writes only the first three tables; `d1Limit` the fourth.
-- Times are milliseconds since 1970 (Date.now()). Amounts are raw, as text (1 XNO = 10^30 raw).

-- One row per order (a player asked to buy a look).
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,               -- 24 hex characters
  player TEXT NOT NULL,              -- the signed-in player's id (the starter's: the nano_ address)
  look_id TEXT NOT NULL,
  usd TEXT NOT NULL,                 -- the price in US dollars when the order was made: "0.25"
  rate REAL NOT NULL,                -- dollars per XNO that turned the price into XNO
  amount TEXT NOT NULL,              -- the exact amount to pay, a clean amount (at most 4 decimals of XNO)
  -- The reservation: equal to `amount` while a payment of it may still be matched to this order, NULL
  -- after. UNIQUE, so no two held orders ever ask for the same amount (NULLs never collide).
  amount_lock TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'open', -- open | paid | expired | paid_late
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,       -- the order takes a payment until then
  hold_until INTEGER NOT NULL,       -- the amount stays reserved until then (late payments are still seen)
  hash TEXT UNIQUE,                  -- the paying send block: one payment pays one order, once
  payer TEXT,                        -- the account that sent it
  paid_at INTEGER,                   -- when the node first saw that send
  visitor TEXT                       -- a keyed hash of the buyer's IP address (limits, never the address)
);
CREATE INDEX IF NOT EXISTS orders_by_status ON orders (status, expires_at);
CREATE INDEX IF NOT EXISTS orders_by_player ON orders (player, look_id, status);

-- The looks each player owns. One row per player and look: a second grant changes nothing.
CREATE TABLE IF NOT EXISTS owned (
  player TEXT NOT NULL,
  look_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (player, look_id)
);

-- Small shared values. The shop keeps "rate" (the last good XNO price, JSON { usd, sources }), "scan" (the time of the last payment scan) and "salt" (`visitorKey`).
-- The admin keeps its settings here too ("setting:character" and the rest).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Rate-limit counters (`d1Limit`): one row per key and time window. The game deletes old windows (the starter's cron: those older than a day).
CREATE TABLE IF NOT EXISTS hits (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
