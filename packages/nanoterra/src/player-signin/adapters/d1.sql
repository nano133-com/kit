-- The player sign-in tables of "@nano133/nanoterra/player-signin/d1". Add this file to the game's migrations (for example
-- migrations/0008_player_signin.sql) and run `wrangler d1 migrations apply`. The adapter reads and writes only these three tables, and only their
-- PLAYER rows (scope = 'play').
--
-- The game starter has the first two tables already (migrations 0001, 0002, 0003 and 0006): `IF NOT EXISTS` leaves them and their rows as they are,
-- so every player who is signed in stays signed in. For the starter this file adds `signin_once` and three indexes, nothing else.
-- Times are milliseconds since 1970 (Date.now()).

-- Wallet sign-in requests (Berry Wallet, Nautilus, NanChat). They live 5 minutes; the clean-up deletes them 2 hours after they end.
CREATE TABLE IF NOT EXISTS signin_requests (
  id TEXT PRIMARY KEY,                 -- the store key: the request's id (Berry Wallet, Nautilus) or the SHA-256 of its nonce (NanChat)
  rid TEXT,                            -- the browser's id for its checks
  way TEXT NOT NULL DEFAULT 'berry',   -- berry | nautilus | nanchat
  starter TEXT NOT NULL,               -- the SHA-256 of the starting browser's cookie
  status TEXT NOT NULL,                -- waiting | signedin
  expires_at INTEGER NOT NULL,
  nonce TEXT,
  issued_at INTEGER,
  label TEXT,                          -- Nautilus: the label it shows and signs
  account TEXT,                        -- the address that signed
  delivered INTEGER NOT NULL DEFAULT 0, -- 1 once a session was made from it
  scope TEXT NOT NULL DEFAULT 'play'   -- 'play' (a player's) or 'admin' (the game's own admin sign-in, which this adapter never reads)
);
CREATE INDEX IF NOT EXISTS signin_requests_by_rid ON signin_requests (rid);
CREATE INDEX IF NOT EXISTS signin_requests_by_account ON signin_requests (account);

-- Sessions. Only the SHA-256 of the cookie's token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'wallet',  -- wallet | passkey | nanoterra
  scope TEXT NOT NULL DEFAULT 'play'   -- 'play' (a player's) or 'admin' (never read by this adapter)
);
CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_by_address ON sessions (address);

-- The passkey sign-in's once-only keys: the hash of each signed message, so one signature signs in once.
CREATE TABLE IF NOT EXISTS signin_once (
  key TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_once_by_address ON signin_once (address);
