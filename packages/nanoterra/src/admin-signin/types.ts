// The ADMIN's sign-in of a game: the fixed route, the times, the limits and the store contract. (The player's sign-in is another thing:
// "@nano133/nanoterra/player-signin".) No package and no DOM: the stores, the adapters and the browser panel read this file.
//
// The admin signs in with a wallet app: Berry Wallet or Nautilus (and NanChat only when the game turns it on: its text cannot name the ADMIN). What Berry
// Wallet and Nautilus sign names the ADMIN, so a link that a stranger sends to the owner does not look like any sign-in. Only the game's own address makes a
// wallet admin login, and only from a request that was started on the admin's route; the guard (`adminAccess`) decides again on every call of /admin.
//
// Since 0.12.0, with `passkeys: true`, the owner may also LINK passkeys (at most 10): a passkey is only a key to /admin, the money stays in the owner's
// wallet. A link is written only from a live WALLET admin session of the owner and with the passkey's own signature (both sides prove their key), and a
// passkey's admin login counts only while its link to the CURRENT owner exists (read again on every request).

import type { AdminLogin } from "../admin/store.js";
import type { RequestStoreLike } from "../player-signin/types.js";

export type { RequestStoreLike, SigninRequest } from "../player-signin/types.js";

/** The admin's sign-in route, the same in every game: a page, an AI helper and the kit's panel find it here. */
export const ADMIN_SIGNIN_BASE = "/api/admin-signin";

/** The page the admin signs in to: Berry Wallet signs this page's address ("URI: https://example.com/admin", with NO query). */
export const ADMIN_PAGE = "/admin";

/**
 * The wallet apps a store keeps admin requests for, in every list's order: Berry Wallet first. NanChat is OFF unless the game turns it on
 * (`createAdminSignin({ nanchat: true })`): its text must start "Login to <host>" and cannot name the ADMIN, so the owner who is asked to sign sees a
 * text that looks like any sign-in to the game. Berry Wallet and Nautilus sign a text that says "ADMIN".
 */
export const ADMIN_WAYS = ["berry", "nautilus", "nanchat"] as const;
export type AdminWay = (typeof ADMIN_WAYS)[number];

/** What a NanChat start is told while NanChat is off (the default): the starter's words. */
export const NANCHAT_REFUSAL = "NanChat cannot open the admin yet. Use Berry Wallet or Nautilus.";

/** An admin sign-in REQUEST lives 2 minutes (a player's lives 5), and a signature is delivered for one more minute after it ends. It works once. */
export const ADMIN_REQUEST_MS = 2 * 60_000;
export const ADMIN_DELIVER_MS = 60_000;
/** How long a row of the admin's sign-in list is kept: 30 days. */
export const ADMIN_LOGIN_KEEP_MS = 30 * 24 * 60 * 60_000;
/** How long the starter cookie lives: a wallet's request must be answered within it. */
export const ADMIN_STARTER_MAX_AGE_S = 30 * 60;

/** The limits of the routes (calls per window). `signin` uses the game's `limit` hook; the rest count in this process's memory. */
export const ADMIN_SIGNIN_LIMITS = {
  /** An admin sign-in start, per visitor (hook). The key is the player's (`signin|<visitor>`): one count for both, as the starter had. */
  signin: { limit: 20, windowMs: 10 * 60_000 },
  /** The browser's checks (every 2 s), per IP address (memory). */
  poll: { limit: 90, windowMs: 60_000 },
  /** Berry Wallet's GET and POST and Nautilus's answer, per IP address (memory): the wallet's own phone sends them. */
  wallet: { limit: 30, windowMs: 60_000 },
  /** NanChat's answers (when it is on) all come from its one relay server: the whole route (memory), the answers of the right shape (hook) and each nonce (hook). */
  nanchatRoute: { limit: 120, windowMs: 60_000 },
  nanchatAll: { limit: 600, windowMs: 10 * 60_000 },
  nanchatNonce: { limit: 5, windowMs: 10 * 60_000 },
  /** The owner's passkeys: the list, a link and a removal, per IP address (memory). A passkey's sign-in counts with the starts (`signin`, hook). */
  passkeys: { limit: 30, windowMs: 60_000 },
  /** The biggest body the routes read. */
  bodyMax: 8192,
} as const;

/** The most passkeys one owner may link. */
export const ADMIN_PASSKEY_LIMIT = 10;
/** How long a passkey's signature is kept as used (its 5-minute window, both ways, and some more). */
export const ADMIN_ONCE_MS = 10 * 60_000;

/**
 * What a passkey signs to OPEN /admin: `signinMessage(adminPasskeyDomain(host), address, at)`, "ADMIN of <host>: sign in as nano_... at <ms>". Never the
 * host alone: a player's passkey signature names only the host, and it must never open /admin.
 */
export const adminPasskeyDomain = (host: string) => `ADMIN of ${host}`;
/** What a passkey signs to be LINKED to the owner: "Link this passkey to the ADMIN of <host>: sign in as nano_... at <ms>". It opens nothing. */
export const adminLinkDomain = (host: string) => `Link this passkey to the ADMIN of ${host}`;

/** One passkey linked to the owner: the passkey purse's address and when it was linked (ms). */
export type AdminPasskey = { address: string; createdAt: number };
/** What a link gives: "linked", "exists" (it was linked already: nothing changed) or "full" (the owner has ADMIN_PASSKEY_LIMIT already). */
export type AdminLinkResult = "linked" | "exists" | "full";

/** A token, a starter value: 32 random bytes as 64 hex characters. */
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * An admin session as a store keeps it. `idHash` is the SHA-256 (hex) of "admin:" and the cookie's token (`adminKey`): never the token, and never the
 * plain hash a player's session has, so the SERVER keeps the two scopes apart and not only the cookies' names. `via` is "wallet" for a wallet's session
 * and "passkey" for a linked passkey's (its `address` is the PASSKEY's, never the owner's); a store returns the word it holds.
 */
export type AdminSessionRecord = { idHash: string; address: string; createdAt: number; expiresAt: number; via: string };

/**
 * The admin session as the game reads it (`createAdminHandler`'s `session` hook). `via` is "unknown" for a stored word other than "wallet", "nanoterra" and
 * "passkey": the guard refuses it. A "passkey" session carries `linkedTo`, the owner's address, only while its link to the CURRENT owner exists (read on this
 * request); without the link the sign-in gives no session at all.
 */
export type AdminSigninSession =
  | { address: string; createdAt: number; via: "wallet" | "nanoterra" | "unknown" }
  | { address: string; createdAt: number; via: "passkey"; linkedTo: string };

/**
 * The game's database for the admin's sign-in. An adapter reads and writes ONLY its tables or collections (requests, sessions, the sign-in list, and for
 * the owner's passkeys the links and the used signatures), and only the ADMIN's rows of the first two (a game whose players sign in through the same tables
 * keeps its rows apart: the `scope` column). Run `adminSigninStoreConformance` on a store you write yourself.
 *
 * The passkey methods (`createSession` to `useOnce`) are optional: a store without them works for wallets, and `createAdminSignin({ passkeys: true })`
 * refuses it.
 */
export interface AdminSigninStore {
  /** The admin requests of one wallet app. */
  requests(way: AdminWay): RequestStoreLike;
  /**
   * Delivers a signed admin request to the browser that started it, ONCE, and writes its session in the same step: true when this call delivered it,
   * false (and no session written) when it was delivered before, is not signed, is not known or is not the admin's.
   */
  deliver(way: AdminWay, key: string, session: AdminSessionRecord): Promise<boolean>;
  /** The admin session of a hash while it lasts (`expiresAt` > now), else null. */
  session(idHash: string, now: number): Promise<AdminSessionRecord | null>;
  /** Ends one admin session (this browser's sign-out). */
  endSession(idHash: string): Promise<void>;
  /**
   * "Sign out everywhere": deletes EVERY admin session and no player's, and ends every admin request that was not delivered (it is marked delivered and
   * its time is over, so a request signed a moment ago, or signed later, makes no login). Returns how many sessions went.
   */
  signOutEverywhere(): Promise<number>;
  /** Writes one row of the sign-in list (the time, the country, a short browser name: nothing else) and deletes the rows older than ADMIN_LOGIN_KEEP_MS before it. */
  recordLogin(login: AdminLogin): Promise<void>;
  /** The last sign-ins, newest first, at most `limit`, with only `at`, `country` and `browser`. */
  recentLogins(limit: number): Promise<AdminLogin[]>;
  /** Deletes what nobody needs any more: admin requests 2 hours after they ended, admin sessions that ended, sign-in rows older than 30 days, used passkey signatures past their time. */
  clean(now: number): Promise<void>;

  // ---- the owner's passkeys (since 0.12.0) ----

  /** Writes an admin session (a linked passkey's sign-in). Throws when a session with this hash exists. */
  createSession?(session: AdminSessionRecord): Promise<void>;
  /**
   * Links the passkey `address` to `owner`, in ONE step that holds the limit: "linked"; "exists" when it is linked already (nothing changes); "full" when
   * `owner` has ADMIN_PASSKEY_LIMIT links (nothing is written). Two calls at once never make more than the limit.
   */
  linkPasskey?(owner: string, address: string, at: number): Promise<AdminLinkResult>;
  /** Removes the link and ends every admin session of that passkey ("passkey" sessions of `address`). True when a link was there. */
  unlinkPasskey?(owner: string, address: string): Promise<boolean>;
  /** The passkeys linked to `owner`, oldest first. */
  passkeys?(owner: string): Promise<AdminPasskey[]>;
  /** True only when `address` is linked to `owner` NOW (the exact texts). */
  linked?(owner: string, address: string): Promise<boolean>;
  /** Records `key` (a used passkey signature) and answers true; false when it is there and its time is not over. The admin's own table, not the player's. */
  useOnce?(key: string, ttlMs: number): Promise<boolean>;
}
