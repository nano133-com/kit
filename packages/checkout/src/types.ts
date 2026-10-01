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
};

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
