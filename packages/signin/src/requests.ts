import { timingSafeEqual } from "node:crypto";

// A sign-in request that a wallet app answers (./nautilus, ./nanchat, ./nanosignin). The browser starts it, the app signs it and
// posts the signature to the site's server, and the browser that started it asks until it is signed. Each request
// takes one signature, for a few minutes, and only the browser that started it may be signed in by it.

/** One request, as a store keeps it. */
export type WalletRequest = {
  /** The browser's id for its checks. */
  id: string;
  /** A hash of the starter cookie of the browser that asked (the site keeps the cookie; see `mine`). */
  starter: string;
  status: "waiting" | "signedin";
  /** When it stops taking a signature (ms). */
  expiresAt: number;
  /** Nautilus: the label the app shows and signs. */
  label?: string;
  /** nano-signin-v1 (./nanosignin): the request's nonce, and when it was issued (ms). Both are in the signed text. */
  nonce?: string;
  issuedAt?: number;
  /** The account that signed, once it is signed. */
  account?: string;
};

/**
 * Where the requests live. `key` is the id for Nautilus and a hash of the nonce for NanChat (whose answer names
 * only the nonce). Every write that changes a request must be atomic: `finish` sets "signedin" only on a request
 * that is still "waiting", and answers false otherwise. memoryRequests and firestoreRequests implement it.
 */
export interface RequestStore {
  create(key: string, r: WalletRequest): Promise<void>;
  get(key: string): Promise<WalletRequest | null>;
  /** The request whose `id` is `id`, with its key, or null. */
  find(id: string): Promise<{ key: string; request: WalletRequest } | null>;
  finish(key: string, account: string): Promise<boolean>;
}

/** A refusal, with words for the person: the wallet app shows them. */
export class WalletRefused extends Error {}

/** Where a request stands, for the browser that asks. */
export type RequestCheck = {
  status: "waiting" | "signedin" | "expired";
  account?: string;
  /** True when `starter` (the asking browser's hash) is the one that started it. Only then sign that browser in. */
  mine?: boolean;
  /** The stored starter hash, for a site that compares it with its own cookie code. */
  starter?: string;
  /** False an hour after the request expired: a late check then signs nobody in. */
  fresh?: boolean;
  /** The request's store key. */
  key?: string;
};

/** How long after a request expires its answer can still sign in the browser that started it. */
export const DELIVER_MS = 60 * 60_000;

/** Timing-safe: is `starter` (hex) the stored starter hash? */
export function sameStarter(stored: unknown, starter: string | undefined): boolean {
  if (typeof stored !== "string" || typeof starter !== "string" || !/^[0-9a-f]+$/i.test(stored) || stored.length !== starter.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(starter, "hex"));
  } catch {
    return false;
  }
}

/**
 * A request's state for the browser that asks. `deliverMs`: how long after the request expires a signature can still sign in the browser that started it
 * (default DELIVER_MS, an hour, when it is not given). A site that wants a shorter life for a request (an admin sign-in) passes a shorter one; a value above DELIVER_MS is held to
 * DELIVER_MS. A value that is not a number of milliseconds from 0 up (a negative one, NaN, Infinity) is a mistake of the site and is read as 0: no delivery after the request ends.
 */
export function checkOf(found: { key: string; request: WalletRequest } | null, now: number, starter?: string, deliverMs: number = DELIVER_MS): RequestCheck {
  if (!found) return { status: "expired" };
  const r = found.request;
  // From 0 up to DELIVER_MS: a site can only SHORTEN the delivery window (an admin sign-in), never make it longer than the default hour.
  const late = typeof deliverMs === "number" && Number.isFinite(deliverMs) && deliverMs >= 0 ? Math.min(deliverMs, DELIVER_MS) : 0;
  if (r.status === "signedin")
    return { status: "signedin", account: r.account, starter: r.starter, fresh: now < r.expiresAt + late, key: found.key, ...(starter !== undefined ? { mine: sameStarter(r.starter, starter) && now < r.expiresAt + late } : {}) };
  return now > r.expiresAt ? { status: "expired" } : { status: "waiting" };
}

/** A browser id: 18 random bytes as base64url (24 characters). */
export const REQUEST_ID = /^[A-Za-z0-9_-]{24}$/;
