// The shop's records and the store contract. The package has no database: a game gives a store (memory, D1 or Firestore here, or its own that passes
// "@nano133/nanoterra/shop/conformance"). The rules of money live in the store's few writes, so each one says exactly what it must do in ONE step.

export type OrderStatus = "open" | "paid" | "expired" | "paid_late";

/** What an order sells: a look (the player owns it for good) or a play (one credit, used once: a round or a level). */
export type OrderKind = "look" | "play";

/** One order: a player asked to buy a look or a play. Amounts are raw, as text; times are ms since 1970. */
export type ShopOrder = {
  /** 24 hex characters. */
  id: string;
  /** The signed-in player who made it (the game's player id: the starter's is the Nano address). Only this player sees the order. */
  player: string;
  /** The id of what the order sells: a look's id, or a play's id for a play (looks and plays share one id space). */
  lookId: string;
  /** What the order sells. Missing reads as "look" (an order of a store or a version that knows no plays); a store always gives it back. */
  kind?: OrderKind;
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

/** The kind of an order: "look" unless it says "play". */
export const kindOf = (o: Pick<ShopOrder, "kind">): OrderKind => (o.kind === "play" ? "play" : "look");

/**
 * One paid play of one player: a paid order of kind "play" gives exactly one credit (keyed by the order's id), and a round start uses it once. A credit
 * belongs to the ORDER's player (as a look does), and never turns into anything else.
 */
export type Credit = {
  orderId: string;
  player: string;
  playId: string;
  /** When the payment was recorded (the credit's wait counts from here). */
  grantedAt: number;
  /** When a round used it, or null while it waits. */
  usedAt: number | null;
  /** The round's own id (its `ref`) that used it, or null. One ref of a player uses one credit, ever. */
  useRef: string | null;
};

/** What `useCredit` did. "used": this call used the credit. "again": this ref used it before (the same answer again). "none": no credit is ready. */
export type UseResult = { status: "used"; credit: Credit } | { status: "again"; credit: Credit } | { status: "none" };

/** How many credits of one play wait for their use. */
export type ReadyCredits = { playId: string; ready: number };

/** What `settle` did. "used": that payment already paid another order. "taken": this order was settled meanwhile (or its amount is no longer held). */
export type Settled = "paid" | "paid_late" | "used" | "taken";

/** A payment the scan found: the send's hash, its account and when the node first saw it. */
export type Payment = { hash: string; payer: string; seenMs: number };

/** The price of XNO the shop keeps (the median of the feeds) and when it read it. */
export type KeptRate = { usd: number; sources: string[]; at: number };

/**
 * What `forget` did. `waitUntil`: the player has an order whose amount is still held (a payment may still come for it), so NOTHING was deleted; try again
 * after that time. Else `deleted` rows went (owned looks, credits, and orders that were never paid), and `kept` paid orders stay as the creator's sales
 * record, with the player (and the payer of a paid order) replaced by FORGOTTEN. A paid play order whose credit was not used keeps its payer, as a late
 * payment does: its credit went, so the creator sends that payment back by hand.
 */
export type ForgetResult = { deleted: number; kept: number; waitUntil: number | null };

/** The stand-in for a player who used "Delete my data", in the orders that stay as the creator's sales record. */
export const FORGOTTEN = "deleted";

/**
 * The shop's database. An adapter writes ONLY orders, owned looks, credits, the kept price and the scan's claim (and their locks). Each call is ONE step: a
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
  /** The newest open order of this player for this look (or play) that still runs at `until`, or null. */
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
   * CLOCK_SLACK_MS after `expiresAt`) and the look is given to the ORDER's player (once: one owned row per player and look), or for a play ONE credit
   * (once: one credit per order), or "paid_late" (no look, no credit); either way the hash is recorded and the amount freed. "taken" when the order is not open or expired with its amount held (it was settled meanwhile,
   * or its hold ended), else "used" when the hash paid another order. Either way nothing changes.
   */
  settle(order: ShopOrder, pay: Payment, now: number): Promise<Settled>;
  /** Claims the next payment scan: true for exactly one caller in each `gapMs`. */
  claimScan(now: number, gapMs: number): Promise<boolean>;
  readRate(): Promise<KeptRate | null>;
  saveRate(rate: KeptRate): Promise<void>;
  /** The player's unused credits of each play granted at or after `notBefore` (the wait), by play id. A play with none is not listed. */
  credits(player: string, notBefore: number): Promise<ReadyCredits[]>;
  /**
   * Uses the oldest unused credit of this player and play granted at or after `notBefore`, exactly once, in ONE step that holds its own check: two calls
   * can never use one credit. `ref` is the round's own id (USE_REF_PATTERN; any other throws): a ref this player used before answers "again" with that
   * credit (whatever play it was), and never uses a second one, also when many calls with one ref come at once.
   */
  useCredit(player: string, playId: string, ref: string, now: number, notBefore: number): Promise<UseResult>;
  /** "Delete my data" for the shop (see ForgetResult). */
  forget(player: string, now: number): Promise<ForgetResult>;
}
