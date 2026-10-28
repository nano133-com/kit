// The numbers of the summary from the rows of the orders, the same for every adapter: the counts by status, the totals and the shape of an order.
// An adapter reads its rows; this file turns them into a `StoreSummary`.

import { isRawText, xnoText } from "./amount.js";
import type { AdminOrder, Money, StoreSummary } from "./store.js";

/** An order as an adapter reads it: the amount is the raw amount (digits), the times are ms. */
export type OrderRow = {
  id: string;
  player: string;
  lookId: string;
  usd: string;
  amountRaw: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  payer: string | null;
  hash: string | null;
};

export const ORDERS_SHOWN = 500;

const toCents = (usd: string): number => {
  const n = Math.round(Number(usd) * 100);
  return Number.isFinite(n) ? n : 0;
};

/** Money from rows that are all of one status: the count, the XNO text of the raw sum and the dollars (summed in cents, so 0.1 + 0.2 is 0.30). */
export function moneyOf(rows: readonly { amountRaw: string; usd: string }[]): Money {
  let raw = 0n;
  let cents = 0;
  for (const r of rows) {
    if (isRawText(r.amountRaw)) raw += BigInt(r.amountRaw);
    cents += toCents(r.usd);
  }
  return { count: rows.length, xno: xnoText(raw.toString()), usd: (cents / 100).toFixed(2) };
}

/** Where an order counts: an open order past its expiry counts as expired. */
export const statusOf = (status: string, expiresAt: number, now: number): string => (status === "open" && expiresAt < now ? "expired" : status);

/** The orders as the page lists them: newest first, at most ORDERS_SHOWN, an open one past its expiry read as "expired". */
export function shapeOrders(rows: readonly OrderRow[], now: number): Omit<AdminOrder, "look">[] {
  return [...rows]
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .slice(0, ORDERS_SHOWN)
    .map((o) => ({
      id: o.id,
      player: o.player,
      lookId: o.lookId,
      usd: o.usd,
      xno: isRawText(o.amountRaw) ? xnoText(o.amountRaw) : "0",
      status: statusOf(o.status, o.expiresAt, now),
      createdAt: o.createdAt,
      expiresAt: o.expiresAt,
      paidAt: o.paidAt,
      payer: o.payer,
      hash: o.hash,
    }));
}

/** The looks that players own, by player (players and their looks in a steady order). */
export function shapePlayers(owned: readonly { player: string; lookId: string; at: number }[]): StoreSummary["players"] {
  const players = new Map<string, { player: string; looks: { id: string; at: number }[] }>();
  for (const o of [...owned].sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : a.at - b.at))) {
    const p = players.get(o.player) ?? { player: o.player, looks: [] };
    p.looks.push({ id: o.lookId, at: o.at });
    players.set(o.player, p);
  }
  return [...players.values()];
}

/** The whole summary from ALL the rows (for a store that reads the rows itself: Firestore, memory). */
export function summarize(rows: readonly OrderRow[], owned: readonly { player: string; lookId: string; at: number }[], rate: StoreSummary["rate"], now: number): StoreSummary {
  const counts = { open: 0, paid: 0, expired: 0, paid_late: 0 };
  for (const o of rows) {
    const key = statusOf(o.status, o.expiresAt, now);
    if (key in counts) counts[key as keyof typeof counts]++;
  }
  return {
    counts,
    totals: { paid: moneyOf(rows.filter((o) => o.status === "paid")), paidLate: moneyOf(rows.filter((o) => o.status === "paid_late")) },
    orders: shapeOrders(rows, now),
    players: shapePlayers(owned),
    rate,
  };
}

/** The `rate` row of the meta table: JSON { usd, sources } kept with the time. Anything that is not that is no rate. */
export function parseRate(value: unknown, at: unknown): StoreSummary["rate"] {
  if (typeof value !== "string" || typeof at !== "number") return null;
  try {
    const v: unknown = JSON.parse(value);
    if (!v || typeof v !== "object") return null;
    const { usd, sources } = v as { usd?: unknown; sources?: unknown };
    if (typeof usd !== "number" || !Number.isFinite(usd) || !Array.isArray(sources) || !sources.every((s) => typeof s === "string")) return null;
    return { usd, sources: sources as string[], at };
  } catch {
    return null;
  }
}
