// Orders: the clean amount and its reservation (the game starter's src/worker/orders.ts; the writes are the store's, ./store.ts).
// DO NOT CHANGE THE MONEY RULES HERE without the tests that pin them (the conformance suite, test/shop-*.test.ts).
//
// The reservation (the same rule as the Nano Unlock WordPress plugin):
// - An order asks for its price, rounded up to 0.0001 XNO. While another held order has that exact amount, it asks for one step (0.0001 XNO) more, and so
//   on: at most a tenth of the price more, and at most 99 steps. When every step is held, the player is asked to try again in a moment.
// - No two held orders can ever ask for the same amount (the store's unique rule), so one payment can only match one order. Two orders made at the same
//   instant cannot both take an amount: the store refuses the second, and it moves on to the next step.
// - The amount stays held from the order's start to LATE_HOLD_MS after it expires (a play's order too: PLAY_LATE_HOLD_MS), so a late payment is still
//   recognised (as "paid late") and never counts for a newer order. A paid order frees its amount at once (its payment's hash is recorded, so that payment never counts again).

import { compareRaw, isClean, plusSteps, STEP_RAW } from "./amount.js";
import { CLOCK_SLACK_MS } from "./match.js";
import { useDaysOf } from "./plays.js";
import type { OrderKind, OrderStatus, ShopOrder, ShopStore } from "./store.js";

export const ORDER_TTL_MS = 15 * 60_000;
export const LATE_HOLD_MS = 60 * 60_000;
/**
 * A play's order holds its amount this long after it expires: the hour a look's order holds (Wes, 2026-11-04: "15+60 for plays too"), so a payment up
 * to an hour late is still seen as this order's ("paid late"), never as a newer order's of the same amount.
 */
export const PLAY_LATE_HOLD_MS = LATE_HOLD_MS;
export const MAX_STEPS = 100;
export const MAX_EXTRA_PERCENT = 10;
/** One player can wait on this many orders at once. */
export const MAX_OPEN_PER_PLAYER = 3;
/** An order's id: 24 hex characters. */
export const ORDER_ID_PATTERN = /^[0-9a-f]{24}$/;

/** Every amount for this price is held by another order: ask the player to try again in a minute. */
export class ShopBusy extends Error {
  constructor(message = "every amount for this price is held") {
    super(message);
    this.name = "ShopBusy";
  }
}

/** How many amounts a price may use: the price and the steps above it. At least 1. */
export function stepsFor(price: string): number {
  const base = BigInt(price) / STEP_RAW;
  return Math.max(1, Math.min(MAX_STEPS, Number((base * BigInt(MAX_EXTRA_PERCENT)) / 100n) + 1));
}

/** The amounts an order of this price may ask for, smallest first. */
export function amountsFor(price: string): string[] {
  if (!isClean(price)) throw new Error("the price must be a clean amount");
  return Array.from({ length: stepsFor(price) }, (_, k) => plusSteps(price, k));
}

/** A new order id: 12 random bytes as hex. */
export const newOrderId = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, "0")).join("");

/** `lookId` is the id of what is sold: a look's, or a play's with `kind: "play"` (default "look"); a play's `useDays` is its useWithinDays (default 30). */
export type ReserveInput = { player: string; lookId: string; kind?: OrderKind; useDays?: number; usd: string; rate: number; price: string; visitor: string | null; now: number; ttlMs?: number };

/** Makes an order with the smallest free amount at or above `p.price` (a clean amount in raw). Throws ShopBusy when every allowed amount is held. */
export async function reserveOrder(store: ShopStore, p: ReserveInput): Promise<ShopOrder> {
  const amounts = amountsFor(p.price);
  await store.tidy(p.now);
  const held = await store.heldAmounts(amounts);
  const expiresAt = p.now + (p.ttlMs ?? ORDER_TTL_MS);
  for (const amount of amounts) {
    if (held.has(amount)) continue;
    const order: ShopOrder = {
      id: newOrderId(),
      player: p.player,
      lookId: p.lookId,
      kind: p.kind === "play" ? "play" : "look",
      ...(p.kind === "play" ? { useDays: useDaysOf(p) } : {}),
      usd: p.usd,
      rate: p.rate,
      amount,
      amountLock: amount,
      status: "open",
      createdAt: p.now,
      expiresAt,
      holdUntil: expiresAt + (p.kind === "play" ? PLAY_LATE_HOLD_MS : LATE_HOLD_MS),
      hash: null,
      payer: null,
      paidAt: null,
      visitor: p.visitor,
    };
    // False: another order took this amount since the read. Go on to the next step.
    if (await store.insert(order)) return order;
  }
  throw new ShopBusy();
}

/** "paid" when the send was first seen while the order was open (with the clock allowance), else "paid_late". Every store uses this one rule. */
export const paidStatus = (order: Pick<ShopOrder, "expiresAt">, seenMs: number): "paid" | "paid_late" => (seenMs > order.expiresAt + CLOCK_SLACK_MS ? "paid_late" : "paid");

/** The status as the player reads it now: an open order past its time is "expired". */
export const statusAt = (o: Pick<ShopOrder, "status" | "expiresAt">, now: number): OrderStatus => (o.status === "open" && o.expiresAt < now ? "expired" : o.status);

/** The orders' smallest amount, or null (the scan's threshold). */
export const smallestAmount = (orders: readonly Pick<ShopOrder, "amount">[]): string | null => orders.map((o) => o.amount).sort(compareRaw)[0] ?? null;

/** The order as its player sees it (the starter's `orderView`). The pay screen adds the XNO text, the test mode, the address and the link. */
export function orderView(o: ShopOrder, now: number): { id: string; lookId: string; usd: string; amount: string; status: OrderStatus; createdAt: number; expiresAt: number } {
  return { id: o.id, lookId: o.lookId, usd: o.usd, amount: o.amount, status: statusAt(o, now), createdAt: o.createdAt, expiresAt: o.expiresAt };
}
