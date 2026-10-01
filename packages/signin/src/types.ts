import type { Rpc } from "@nano133/checkout";
export type { Rpc };

/**
 * How payment sign-ins pick their amounts and how long they wait. Every
 * sign-in asks for `base + slot × step` raw, slot 1 to `slots`. The address
 * must be used for sign-ins only: every send of a slot's exact amount to it
 * counts as a sign-in payment.
 */
export type SigninConfig = {
  /** The sign-in address (a wallet used for nothing else). */
  address: string;
  /** Default 133 × 10^22 raw (0.00000133 XNO). */
  base?: bigint;
  /** Default 10^18 raw (0.000000000001 XNO). */
  step?: bigint;
  /** Default 9,999 amounts at once. */
  slots?: number;
  /** How long a sign-in waits for its payment. Default 15 minutes. */
  ttlMs?: number;
  /** A payment just after expiry still counts for this long. Default 2 minutes. */
  graceMs?: number;
  /** An amount stays reserved this long after the grace, before a new sign-in may get it. Default 3 minutes. */
  reuseMarginMs?: number;
  /**
   * How far before a sign-in began a payment may have been first seen, for the
   * difference between your clock and your node's. Default 10 seconds; at most 1 minute.
   */
  earlyMs?: number;
  /** How long after a sign-in its starter browser can still get the session. Default 10 minutes. */
  deliverMs?: number;
};

export type SigninSession = {
  id: string;
  amount: string;
  address: string;
  status: "waiting" | "signedin";
  /** A hash of the browser that started it (your own cookie): only that browser gets the sign-in. */
  starter: string;
  startedAt: number;
  expiresAt: number;
  graceMs: number;
  /** Payments of this amount that were already waiting when the sign-in began: they never count for it. */
  before: string[];
  account?: string;
  hash?: string;
  signedInAt?: number;
};

/** Where sign-ins, amount locks and used payments live. Implementations: memoryStore, firestoreStore. */
export interface SigninStore {
  /** In one atomic step: unless an unexpired lock holds the amount, lock it until `lockUntil` and save the sign-in. */
  create(session: SigninSession, lockUntil: number): Promise<boolean>;
  get(id: string): Promise<SigninSession | null>;
  /**
   * In one atomic step: unless the payment is used or the sign-in isn't
   * waiting, mark the payment used and the sign-in done. A store set up to
   * send amounts back also records the payment's return (pending) in the
   * same step, so a stop between the two can't lose it.
   */
  claim(id: string, hash: string, account: string, at: number, amount: string): Promise<"signedin" | "used" | "taken">;
}

export type CheckResult =
  /**
   * Signed in. `mine`: this is the browser that started it, and the sign-in
   * is recent (`deliverMs`). Create your session only then.
   */
  | { state: "signedin"; account: string; hash: string; again: boolean; mine: boolean }
  | { state: "waiting" }
  | { state: "pending" }
  | { state: "expired" }
  | { state: "wrong" }
  | { state: "invalid" }
  | { state: "used" }
  | { state: "unknown" };
