-- The admin sign-in tables of "@nano133/nanoterra/admin-signin/d1". Add this file to the game's migrations (for example
-- migrations/0009_admin_signin.sql) and run `wrangler d1 migrations apply`. The adapter reads and writes only these five tables, and only the
-- ADMIN rows of the first two (scope = 'admin').
--
-- The game starter has the first three already (migrations 0001, 0002, 0003, 0005 and 0006), and `IF NOT EXISTS` leaves its tables and rows as they are if
-- it runs this file anyway. The last two (since 0.12.0) are the owner's passkeys: a game that turns them on (`createAdminSignin({ passkeys: true })`) and
-- has the first three adds only those two (the starter: migrations/0009_admin_passkeys.sql, the two CREATE TABLE statements at the end of this file). A
-- game that has the player sign-in's d1.sql has the first two: this file adds the other three.
-- Times are milliseconds since 1970 (Date.now()).

-- Wallet sign-in requests (the player's and the admin's: `scope` says whose). An admin request lives 2 minutes; the clean-up deletes it 2 hours after it ends.
CREATE TABLE IF NOT EXISTS signin_requests (
  id TEXT PRIMARY KEY,                 -- the store key: the request's id (Berry Wallet, Nautilus) or the SHA-256 of its nonce (NanChat, players only)
  rid TEXT,                            -- the browser's id for its checks
  way TEXT NOT NULL DEFAULT 'berry',   -- berry | nautilus | nanchat
  starter TEXT NOT NULL,               -- the SHA-256 of the starting browser's cookie ("admin:" and the cookie for an admin request)
  status TEXT NOT NULL,                -- waiting | signedin
  expires_at INTEGER NOT NULL,
  nonce TEXT,
  issued_at INTEGER,
  label TEXT,                          -- Nautilus: the label it shows and signs; Berry Wallet's admin request: "admin" or "admin:<country>"
  account TEXT,                        -- the address that signed
  delivered INTEGER NOT NULL DEFAULT 0, -- 1 once a session was made from it (or "Sign out everywhere" ended it)
  scope TEXT NOT NULL DEFAULT 'play'   -- 'play' (a player's) or 'admin' (the admin's: the only rows this adapter reads)
);
CREATE INDEX IF NOT EXISTS signin_requests_by_rid ON signin_requests (rid);

-- Sessions (the player's and the admin's). Only a hash of the cookie's token is stored: for an admin session the SHA-256 of "admin:" and the token.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'wallet',  -- wallet | passkey | nanoterra (an admin session: wallet)
  scope TEXT NOT NULL DEFAULT 'play'   -- 'play' (a player's) or 'admin' (one day)
);
CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);

-- The admin's sign-in list (the Sign-ins card of /admin): the time, the rough country and a short browser name. No address, no IP address and no browser
-- text. A row is kept 30 days.
CREATE TABLE IF NOT EXISTS admin_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,                 -- ms since 1970
  country TEXT,                        -- two capital letters from the request's country header, or NULL
  browser TEXT NOT NULL                -- a short name from fixed lists: "Chrome on macOS"
);
CREATE INDEX IF NOT EXISTS admin_logins_by_time ON admin_logins (at);

-- The owner's passkeys (since 0.12.0): each passkey linked to the game's own address, at most 10 for an owner. Only a live WALLET admin session of the owner
-- writes a link; a link opens /admin only while it is here and its owner is the game's address NOW.
CREATE TABLE IF NOT EXISTS admin_passkeys (
  owner TEXT NOT NULL,                 -- the game's own address when the link was made
  address TEXT NOT NULL,               -- the passkey purse's address
  created_at INTEGER NOT NULL,         -- ms since 1970
  PRIMARY KEY (owner, address)
);

-- The passkeys' used signatures (the admin's own, apart from the player's signin_once): the hash of each signed text, so one signature counts once.
CREATE TABLE IF NOT EXISTS admin_once (
  key TEXT PRIMARY KEY,
  until INTEGER NOT NULL               -- ms since 1970; the clean-up deletes the row after it
);
