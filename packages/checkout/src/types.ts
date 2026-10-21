/** A Nano node RPC call. It must reject when the answer has an `error` field (for example "Block not found"). */
export type Rpc = <T>(body: Record<string, unknown>, timeoutMs?: number) => Promise<T>;

/** What the node's block_info answer carries (json_block). */
export type BlockInfo = {
  block_account: string;
  amount: string;
  confirmed: string;
  subtype?: string;
  /** When the node first saw the block (seconds). */
  local_timestamp?: string;
  contents: { link_as_account?: string; subtype?: string };
};

export type Checkout = {
  id: string;
  /** What is sold: your own id for it ("article:12", "pass:30d"). */
  item: string;
  /** The exact amount to pay, in raw (the price plus a unique tail). */
  amount: string;
  /** The address to pay. */
  to: string;
  status: "waiting" | "paid";
  createdAt: number;
  expiresAt: number;
  /** How long after expiresAt a payment still counts. */
  graceMs: number;
  meta?: Record<string, unknown>;
  hash?: string;
  payer?: string;
  paidAt?: number;
  /**
   * Derived-address mode only (createDerivedCheckout, "@nano133/checkout/derived"): the index that gives `to`.
   * A checkout with an index has its own address and a clean amount, and no amount lock.
   */
  index?: number;
  /** Derived-address mode only: Late Payment Return watches the address until this time (ms). */
  scanUntil?: number;
  /** Derived-address mode only: where the sweep of the paid address stands. Set when the checkout is paid. */
  sweep?: SweepState;
};

/** A block that is recorded before it is published, so a later run can find it instead of sending again. */
export type SweepIntent = { hash: string; root: string; block: StateBlock };

/** A state block as the node's `process` action takes it (json_block). */
export type StateBlock = {
  type?: string;
  account: string;
  previous: string;
  representative: string;
  balance: string;
  link: string;
  signature?: string;
  work?: string;
};

/** Where the sweep of a derived address stands (no key, no seed: only public facts about the blocks). */
export type SweepState = {
  /** "due": paid, not swept yet. "done": the quote was sent on. */
  status: "due" | "done";
  /** The receive of the paid block ("earlier" when an earlier run received it). */
  recv?: string | null;
  /** The send of the quote, recorded before it is published. */
  send?: SweepIntent | null;
  /** The send that moved the quote on (once done). */
  hash?: string;
  /** The run that works on it now. A run that dies leaves it; it ends at `until`. */
  lease?: { owner: string; until: number } | null;
  error?: string | null;
  tries?: number;
};

/** What a sweep may write on a checkout while it holds the lease. */
export type SweepPatch = Partial<Pick<SweepState, "recv" | "send" | "error" | "tries">>;

/** The run no longer holds the checkout's sweep lease: it must stop before it writes or sends anything else. */
export class SweepLeaseLost extends Error {
  constructor() {
    super("the sweep lease was lost");
  }
}

/** Where checkouts, amount locks and used payments live. Implementations: memoryStore, firestoreStore. */
export interface CheckoutStore {
  /** In one atomic step: unless an unexpired lock holds `checkout.amount`, lock it until `lockUntil` and save the checkout. */
  create(checkout: Checkout, lockUntil: number): Promise<boolean>;
  get(id: string): Promise<Checkout | null>;
  /**
   * In one atomic step: unless the payment hash is already used or the
   * checkout isn't waiting, mark the hash used (by this checkout) and the
   * checkout paid. "used": another checkout or a return used that payment.
   */
  markPaid(id: string, hash: string, payer: string, at: number): Promise<"paid" | "used" | "taken">;
  /** Whether a payment hash is used: it paid a checkout, or a return took it. */
  isUsed(hash: string): Promise<boolean>;
  /** Whether a waiting checkout asks for exactly `amount` and can still claim it at `now` (for Late Payment Return). */
  claimable(amount: string, now: number): Promise<boolean>;
}

/**
 * What derived-address mode needs from a store, beyond CheckoutStore. memoryStore and firestoreStore have all of it.
 * Every method that says "atomic" must be one step in your database: two callers at once never both win.
 */
export interface DerivedStore extends CheckoutStore {
  /**
   * Atomic counter: gives 0, then 1, then 2, one number to one caller, ever. Throws once the next number would be
   * `cap` or more, and when the counter holds anything but a whole number from 0.
   */
  takeIndex(cap: number): Promise<number>;
  /**
   * Saves a derived checkout (it has an `index`), with no amount lock. Answers false, and saves nothing, when a
   * checkout with that id or that address `to` exists (a reset counter must never give an address twice).
   */
  createDerived(checkout: Checkout): Promise<boolean>;
  /** The derived checkout whose address is `address`, or null. */
  byAddress(address: string): Promise<Checkout | null>;
  /** Addresses of derived checkouts with `scanUntil > now`, newest first (for Late Payment Return's `addresses`). */
  derivedAddresses(now: number, limit: number): Promise<string[]>;
  /** Paid derived checkouts whose sweep is due (`sweep.status` "due"), at most `limit`. */
  unswept(limit: number): Promise<Checkout[]>;
  /**
   * Atomic: takes the checkout's sweep lease for `owner` until `now + leaseMs`. False when the sweep is not due, or
   * another owner holds an unexpired lease.
   */
  claimSweep(id: string, owner: string, now: number, leaseMs: number): Promise<boolean>;
  /** Writes sweep progress and renews the lease, in one atomic step that first proves `owner` holds it (else throws SweepLeaseLost). */
  patchSweep(id: string, owner: string, patch: SweepPatch, now: number, leaseMs: number): Promise<void>;
  /**
   * The same fence, and in the same atomic step: the sweep is "done" with its send `hash`, the lease ends, and `hash`
   * is marked used (so Late Payment Return never sends the sweep's own money back).
   */
  finishSweep(id: string, owner: string, hash: string, now: number): Promise<void>;
  /** Ends `owner`'s lease. Another owner's lease stays. */
  releaseSweep(id: string, owner: string): Promise<void>;
}

export type ClaimResult =
  /** Paid now, or earlier (`again`). The receipt is set when receipts are on. */
  | { state: "paid"; checkout: Checkout; again: boolean; receipt?: string }
  /** Nothing yet. */
  | { state: "waiting" }
  /** The payment is on its way: seen, not confirmed yet. */
  | { state: "pending" }
  /** Past its expiry and grace: a new checkout is needed. */
  | { state: "expired" }
  /** The named block isn't a send of this amount to this address. */
  | { state: "wrong" }
  /** The named hash isn't a block hash. */
  | { state: "invalid" }
  /** That payment already paid another checkout (or went back). */
  | { state: "used" }
  /** No such checkout. */
  | { state: "unknown" };
