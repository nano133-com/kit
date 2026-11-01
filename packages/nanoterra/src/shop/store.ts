// The shop's records and the store contract. The package has no database: a game gives a store (memory, D1 or Firestore here, or its own that passes
// "@nano133/nanoterra/shop/conformance"). The rules of money live in the store's few writes, so each one says exactly what it must do in ONE step.

export type OrderStatus = "open" | "paid" | "expired" | "paid_late";

/** One order: a player asked to buy a look. Amounts are raw, as text; times are ms since 1970. */
export type ShopOrder = {
  /** 24 hex characters. */
  id: string;
  /** The signed-in player who made it (the game's player id: the starter's is the Nano address). Only this player sees the order. */
  player: string;
  lookId: string;
  /** The price in US dollars when the order was made: "0.25". */
  usd: string;
  /** Dollars per XNO that turned the price into XNO. */
  rate: number;
  /** The exact amount to pay: a clean amount (at most 4 decimals of XNO). */
  amount: string;
  /**
   * The reservation: equal to `amount` while a payment of it may still be matched to this order, null after. No two orders ever hold the same amount
   * (the store's unique rule), so one payment can only match one order.
   */
  amountLock: string | null;
  status: OrderStatus;
  createdAt: number;
  /** The order takes a payment until then. */
  expiresAt: number;
  /** The amount stays reserved until then (a late payment is still seen, and never counts for a newer order). */
  holdUntil: number;
  /** The paying send block: one payment pays one order, once (the store's unique rule). */
  hash: string | null;
  /** The account that sent it. */
  payer: string | null;
  /** When the node first saw that send. */
  paidAt: number | null;
  /** A keyed hash of the buyer's IP address, for limits (never the address), or null. */
  visitor: string | null;
};

/** What `settle` did. "used": that payment already paid another order. "taken": this order was settled meanwhile (or its amount is no longer held). */
export type Settled = "paid" | "paid_late" | "used" | "taken";

/** A payment the scan found: the send's hash, its account and when the node first saw it. */
export type Payment = { hash: string; payer: string; seenMs: number };

/** The price of XNO the shop keeps (the median of the feeds) and when it read it. */
export type KeptRate = { usd: number; sources: string[]; at: number };

/**
 * What `forget` did. `waitUntil`: the player has an order whose amount is still held (a payment may still come for it), so NOTHING was deleted; try again
 * after that time. Else `deleted` rows went (owned looks, and orders that were never paid), and `kept` paid orders stay as the creator's sales record,
 * with the player (and the payer of a paid order) replaced by FORGOTTEN.
 */
export type ForgetResult = { deleted: number; kept: number; waitUntil: number | null };

/** The stand-in for a player who used "Delete my data", in the orders that stay as the creator's sales record. */
export const FORGOTTEN = "deleted";

/**
 * The shop's database. An adapter writes ONLY orders, owned looks, the kept price and the scan's claim (and their locks). Each call is ONE step: a
 * transaction, a batch, or a statement that holds its own check.
 */
export interface ShopStore {
  /** Marks the open orders past `expiresAt` "expired", and frees the amounts whose `holdUntil` is past (the amount lock goes, the order stays). */
  tidy(now: number): Promise<void>;
  /** Which of `amounts` an order holds now. */
  heldAmounts(amounts: readonly string[]): Promise<Set<string>>;
  /**
   * Writes a new order that holds its amount (`amountLock` = `amount`). False, and nothing written, when another order holds that amount now: the
   * unique rule, checked in the same step as the write. Any other failure throws.
   */
  insert(order: ShopOrder): Promise<boolean>;
  order(id: string): Promise<ShopOrder | null>;
  /** The newest open order of this player for this look that still runs at `until`, or null. */
  openOrder(player: string, lookId: string, until: number): Promise<ShopOrder | null>;
  /** How many open orders this player has that still run at `now`. */
  countOpen(player: string, now: number): Promise<number>;
  /** Whether a paid order gave this player this look. */
  owns(player: string, lookId: string): Promise<boolean>;
  /** The ids of every look that paid orders gave this player (free looks are everyone's and are not stored). */
  owned(player: string): Promise<string[]>;
  /** The orders whose amount is held: the only ones a payment can be matched to. */
  held(): Promise<ShopOrder[]>;
  /** Which of `hashes` already paid (or were recorded for) an order. */
  usedHashes(hashes: readonly string[]): Promise<Set<string>>;
  /**
   * Records a payment for a held order, exactly once, in ONE step: the order becomes "paid" (sent while it was open: `pay.seenMs` at most
   * CLOCK_SLACK_MS after `expiresAt`) and the look is given to the ORDER's player (once: one owned row per player and look), or "paid_late" (no look);
   * either way the hash is recorded and the amount freed. "taken" when the order is not open or expired with its amount held (it was settled meanwhile,
   * or its hold ended), else "used" when the hash paid another order. Either way nothing changes.
   */
  settle(order: ShopOrder, pay: Payment, now: number): Promise<Settled>;
  /** Claims the next payment scan: true for exactly one caller in each `gapMs`. */
  claimScan(now: number, gapMs: number): Promise<boolean>;
  readRate(): Promise<KeptRate | null>;
  saveRate(rate: KeptRate): Promise<void>;
  /** "Delete my data" for the shop (see ForgetResult). */
  forget(player: string, now: number): Promise<ForgetResult>;
}
