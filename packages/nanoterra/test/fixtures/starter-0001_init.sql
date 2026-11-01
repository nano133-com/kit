-- A copy of the game starter's migrations/0001_init.sql (nano-game-starter main c668201), for the test that the shop's D1 store works on the starter's own
-- tables with no migration. Do not change it: it stands for databases that exist.

-- The game's own records. They stay in YOUR database: Nano Island never sees them.
-- Times are milliseconds since 1970 (Date.now()). Amounts are raw, as text (1 XNO = 10^30 raw).

-- One row per order (a player asked to buy a look).
CREATE TABLE orders (
  id TEXT PRIMARY KEY,               -- 24 hex characters
  player TEXT NOT NULL,              -- the signed-in player's nano_ address
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
CREATE INDEX orders_by_status ON orders (status, expires_at);
CREATE INDEX orders_by_player ON orders (player, look_id, status);

-- The looks each player owns. One row per player and look: a second grant changes nothing.
CREATE TABLE owned (
  player TEXT NOT NULL,
  look_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (player, look_id)
);

-- Sign-in requests (Berry Wallet's nano-signin-v1). They live 5 minutes; the clean-up deletes old ones.
CREATE TABLE signin_requests (
  id TEXT PRIMARY KEY,
  starter TEXT NOT NULL,             -- the SHA-256 of the starting browser's cookie
  status TEXT NOT NULL,              -- waiting | signedin
  expires_at INTEGER NOT NULL,
  nonce TEXT,
  issued_at INTEGER,
  account TEXT,
  delivered INTEGER NOT NULL DEFAULT 0 -- 1 once a session was made from it
);

-- Sessions. Only the SHA-256 of the cookie is stored.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

-- Rate-limit counters: one row per key and time window. The clean-up deletes old windows.
CREATE TABLE hits (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);

-- Small shared values: the last good XNO price, the time of the last payment scan, the hashing salt.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);
