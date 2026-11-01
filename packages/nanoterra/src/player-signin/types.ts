// The PLAYER sign-in of a game: the types, the limits and the store contract. (The admin's sign-in is another thing: "@nano133/nanoterra/admin".)
//
// A player is a Nano address. Every way to sign in is a signature from a key the player holds, and the server holds no key:
//   - a passkey purse: a Nano account made in the browser from the player's passkey (its PRF output), by the game's FROZEN scheme;
//     the browser signs a short text that names the game, and the server checks the signature (no WebAuthn on the server);
//   - Berry Wallet (nano-signin-v1), NanChat (nanauth) and Nautilus (nanoauth): the wallet app signs a request that the browser started.
// The checks are @nano133/signin's. This file names no package: the stores and their adapters work without it.

/** The wallet apps a player can sign in with, in the order the sheet shows them. */
export const WAYS = ["berry", "nanchat", "nautilus"] as const;
export type Way = (typeof WAYS)[number];

/** How a session was made. "wallet": a wallet app's signature. "passkey": a signature by a key in the page (the passkey purse). "nanoterra": the game's own code exchange. */
export type Via = "wallet" | "passkey" | "nanoterra";
export const VIAS: readonly Via[] = ["wallet", "passkey", "nanoterra"];

/** A wallet app's sign-in request, as a store keeps it. The same shape as @nano133/signin's `WalletRequest`. */
export type SigninRequest = {
  /** The browser's id for its checks. */
  id: string;
  /** The SHA-256 (hex) of the starter cookie of the browser that asked. */
  starter: string;
  status: "waiting" | "signedin";
  /** When it stops taking a signature (ms). */
  expiresAt: number;
  /** Nautilus: the label the app shows and signs. */
  label?: string;
  /** Berry Wallet: the nonce and when it was issued (ms). */
  nonce?: string;
  issuedAt?: number;
  /** The account that signed, once it is signed. */
  account?: string;
};

/**
 * The requests of ONE wallet app. The same methods as @nano133/signin's `RequestStore`, so the package's functions take it as it is. `key` is the
 * request's id for Berry Wallet and Nautilus, and the SHA-256 of the nonce for NanChat (whose answer names only the nonce). `finish` is atomic:
 * waiting → signed, once; false otherwise.
 */
export interface RequestStoreLike {
  create(key: string, r: SigninRequest): Promise<void>;
  get(key: string): Promise<SigninRequest | null>;
  find(id: string): Promise<{ key: string; request: SigninRequest } | null>;
  finish(key: string, account: string): Promise<boolean>;
}

/** A session as a store keeps it. `idHash` is the SHA-256 (hex) of the cookie's token: the token itself is never stored. */
export type SessionRecord = { idHash: string; address: string; createdAt: number; expiresAt: number; via: Via };

/** A session as the game reads it. `via` is "unknown" for a word the store holds that is none of VIAS (never read as a wallet). */
export type PlayerSession = { address: string; createdAt: number; via: Via | "unknown" };

/**
 * The game's database for the player sign-in. An adapter reads and writes ONLY its three tables or collections (requests, sessions, once-only
 * keys), and only the PLAYER's rows of them (a game whose admin shares the tables keeps its rows apart: the D1 adapter's `scope` column).
 * Run `playerSigninStoreConformance` on a store you write yourself.
 */
export interface PlayerSigninStore {
  /** The requests of one wallet app. */
  requests(way: Way): RequestStoreLike;
  /**
   * Delivers a signed request to the browser that started it, ONCE, and writes its session in the same step: true when this call delivered it,
   * false (and no session written) when it was delivered before, is not signed, or is not known.
   */
  deliver(way: Way, key: string, session: SessionRecord): Promise<boolean>;
  createSession(session: SessionRecord): Promise<void>;
  /** The session of a token's hash while it lasts (`expiresAt` > now), else null. */
  session(idHash: string, now: number): Promise<SessionRecord | null>;
  endSession(idHash: string): Promise<void>;
  /** Records `key` and answers true; answers false when it is there already. `address` is kept on the row (for `forget`). The passkey route's replay guard. */
  useOnce(key: string, ttlMs: number, address: string): Promise<boolean>;
  /** A player's "Delete my data": every session, every signed request and every once-only row of `address`. Returns how many rows went. */
  forget(address: string): Promise<number>;
  /** Deletes what nobody needs any more: requests 2 hours after they ended, sessions that ended, once-only rows past their time. */
  clean(now: number): Promise<void>;
}

/** The limits of the routes (calls per window). The two marked "hook" use the game's `limit`; the rest count in this copy's memory. */
export const PLAYER_SIGNIN_LIMITS = {
  /** A wallet sign-in start or a passkey sign-in, per visitor (hook). */
  signin: { limit: 20, windowMs: 10 * 60_000 },
  /** The browser's checks (every 2 s), per visitor (memory). */
  poll: { limit: 90, windowMs: 60_000 },
  /** Berry Wallet's GET and POST and Nautilus's answer, per IP address (memory): the wallet's own phone sends them. */
  wallet: { limit: 30, windowMs: 60_000 },
  /** NanChat's answers all come from its one relay server: the whole route (memory), the answers of the right shape (hook) and each nonce (hook). */
  nanchatRoute: { limit: 120, windowMs: 60_000 },
  nanchatAll: { limit: 600, windowMs: 10 * 60_000 },
  nanchatNonce: { limit: 5, windowMs: 10 * 60_000 },
  /** The biggest body the routes read. */
  bodyMax: 8192,
} as const;

/** How long a player's session lasts (the game starter's 30 days). */
export const SESSION_DAYS = 30;
/** How long the starter cookie lives: a wallet's request must be answered within it. */
export const STARTER_MAX_AGE_S = 30 * 60;

/** A token, a starter value: 32 random bytes as 64 hex characters. */
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** A store's word for `via`, as the game reads it. */
export const viaOf = (v: unknown): Via | "unknown" => (VIAS.includes(v as Via) ? (v as Via) : "unknown");
