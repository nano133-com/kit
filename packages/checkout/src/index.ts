import { randomBytes, randomInt } from "node:crypto";
import { withTail } from "./amount.js";
import { checkPayment } from "./payment.js";
import { signReceipt } from "./receipt.js";
import type { Checkout, CheckoutStore, ClaimResult, Rpc } from "./types.js";

export * from "./types.js";
export * from "./amount.js";
export { xnoUsdRate } from "./rate.js";
export { checkPayment, findInWindow, inWindow, type PaymentWindow, type PaymentCheck } from "./payment.js";
export { signReceipt, verifyReceipt, type ReceiptClaims } from "./receipt.js";

// Nano Checkout.
//
// 1. createCheckout() asks for the price plus a random tail of 1 to 999999
//    raw, and locks that exact amount until the checkout's expiry plus its
//    grace: no other checkout gets it while a payment of it can still count.
// 2. The buyer pays that exact amount to your address (a QR code or a nano:
//    link with the amount filled in).
// 3. claimCheckout() asks your node: a confirmed send of exactly that amount
//    to your address, first seen inside the checkout's window. One payment
//    pays one checkout, once. When the node doesn't answer, it throws: nothing
//    is credited.
// 4. On success you get a signed receipt for a cookie or a restore link.

export type CheckoutOptions = {
  /** Calls your Nano node. Use your own node: its answers decide what you credit. */
  rpc: Rpc;
  store: CheckoutStore;
  /** The address buyers pay. */
  to: string;
  /** Signs receipts (HMAC-SHA256). Leave it out to skip receipts. Keep it secret. */
  receiptSecret?: string;
  /** How long a receipt is valid, in seconds. Default 30 days. */
  receiptTtlSec?: number;
  /** The current time, ms (tests). */
  now?: () => number;
  /** The tail for an amount, 1 to 999999 (tests). Default: random. */
  tail?: () => number;
};

/**
 * Creates a checkout for `price` (raw) with a unique amount. `ttlMs` (default
 * 15 minutes) is how long it is open; `graceMs` (default 1 hour) is how long
 * after that a late payment still counts. Throws when no free amount was found
 * in 5 tries.
 */
export async function createCheckout(o: CheckoutOptions, p: { item: string; price: bigint; ttlMs?: number; graceMs?: number; meta?: Record<string, unknown> }): Promise<Checkout> {
  const now = o.now?.() ?? Date.now();
  const ttl = p.ttlMs ?? 15 * 60_000;
  const graceMs = p.graceMs ?? 60 * 60_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const amount = withTail(p.price, o.tail?.() ?? randomInt(1, 1_000_000)).toString();
    const checkout: Checkout = { id: randomBytes(12).toString("hex"), item: p.item, amount, to: o.to, status: "waiting", createdAt: now, expiresAt: now + ttl, graceMs, ...(p.meta ? { meta: p.meta } : {}) };
    if (await o.store.create(checkout, checkout.expiresAt + graceMs)) return checkout;
  }
  throw Object.assign(new Error("no free amount right now; try again"), { status: 503 });
}

/**
 * Checks a checkout's payment. `hash`: the block the browser saw (a stream or
 * the purse), or null to search. Throws when the node doesn't answer.
 */
export async function claimCheckout(o: CheckoutOptions, id: string, hash: string | null): Promise<ClaimResult> {
  const now = o.now?.() ?? Date.now();
  const c = await o.store.get(id);
  if (!c) return { state: "unknown" };
  const receipt = (x: Checkout) =>
    o.receiptSecret ? signReceipt(o.receiptSecret, { item: x.item, checkout: x.id, payer: x.payer!, hash: x.hash!, exp: Math.floor(now / 1000) + (o.receiptTtlSec ?? 30 * 86_400) }) : undefined;
  if (c.status === "paid") return { state: "paid", checkout: c, again: true, receipt: receipt(c) };
  // Too late: the amount is free again, so a payment of it may be someone else's.
  if (now > c.expiresAt + c.graceMs) return { state: "expired" };
  const check = await checkPayment(o.rpc, { hash, to: c.to, amount: c.amount, window: { from: c.createdAt, until: c.expiresAt + c.graceMs } });
  if (check.state === "invalid" || check.state === "wrong") return { state: check.state };
  if (check.state === "unconfirmed") return { state: "pending" };
  if (check.state !== "paid") return { state: "waiting" };
  const marked = await o.store.markPaid(c.id, check.hash, check.info.block_account, now);
  if (marked === "used") return { state: "used" };
  const done = (await o.store.get(c.id))!;
  if (done.status !== "paid") return { state: "waiting" };
  return { state: "paid", checkout: done, again: marked === "taken", receipt: receipt(done) };
}
