// The numbers of the summary from the rows of the orders, the same for every adapter: the counts by status, the totals and the shape of an order; and
// the plays' numbers from the play orders and the credits (`playsSummary`). An adapter reads its rows; this file turns them into a `StoreSummary`.

import { PLAY_WAIT_DAYS } from "../looks/play.js";
import { FORGOTTEN } from "../shop/store.js";
import { isRawText, usdDecimals, xnoText } from "./amount.js";
import type { AdminOrder, Money, PlayStats, SendBack, StoreSummary, SummaryOptions } from "./store.js";

/** An order as an adapter reads it: the amount is the raw amount (digits), the times are ms. */
export type OrderRow = {
  id: string;
  player: string;
  lookId: string;
  /** "play" for a play's order; anything else (or none) is a look's. */
  kind?: string;
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

/** Steps of $0.0001 from a dollar text like "0.25" or "0.005". Anything that is not plain dollars (a sign, an exponent, hex) counts as 0: a bad row must not change a total. */
const toSteps = (usd: string): number => {
  if (typeof usd !== "string" || !/^\d{1,9}(\.\d{1,8})?$/.test(usd)) return 0;
  return Math.round(Number(usd) * 10_000);
};

/** Money from rows that are all of one status: the count, the XNO text of the raw sum and the dollars (summed in whole $0.0001 steps, so 0.1 + 0.2 is 0.30). */
export function moneyOf(rows: readonly { amountRaw: string; usd: string }[]): Money {
  let raw = 0n;
  let steps = 0;
  for (const r of rows) {
    if (isRawText(r.amountRaw)) raw += BigInt(r.amountRaw);
    steps += toSteps(r.usd);
  }
  return { count: rows.length, xno: xnoText(raw.toString()), usd: usdDecimals(steps / 10_000) };
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
      ...(o.kind === "play" ? { kind: "play" as const } : {}),
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

/** A credit as an adapter reads it (the shop's `credits`): one paid play order of a player, used by a round or not yet. */
export type CreditRow = { orderId: string; player: string; playId: string; grantedAt: number; usedAt: number | null };

const DAY_MS = 86_400_000;

/**
 * The plays' numbers, the paid plays to send back by hand and each player's ready credits, from the play orders that were paid (in time or late, of any
 * player, "deleted" too) and every credit. A credit is ready while it is unused and in its wait (`waitDays`, 30 days when the play does not say); an
 * unused one past its wait is not used in time: its order's payer and amount are listed to send back. A paid play of a deleted player whose credit is
 * gone and whose order kept its payer was not used either (forget keeps the payer only then): it is listed too. Pure.
 */
export function playsSummary(playOrders: readonly OrderRow[], credits: readonly CreditRow[], now: number, options: SummaryOptions = {}): { plays: PlayStats[]; sendBack: (SendBack & { amountRaw: string })[]; ready: Map<string, { id: string; ready: number }[]> } {
  const stats = new Map<string, PlayStats>();
  const of = (id: string) => stats.get(id) ?? stats.set(id, { playId: id, sold: 0, used: 0, ready: 0, late: 0, notUsedInTime: 0 }).get(id)!;
  const orders = new Map(playOrders.map((o) => [o.id, o]));
  const sendBack: (SendBack & { amountRaw: string })[] = [];
  const back = (o: OrderRow, playId: string, why: SendBack["why"]) =>
    o.payer && o.payer !== FORGOTTEN && sendBack.push({ orderId: o.id, playId, payer: o.payer, xno: isRawText(o.amountRaw) ? xnoText(o.amountRaw) : "0", usd: o.usd, paidAt: o.paidAt, why, amountRaw: o.amountRaw });
  for (const o of playOrders) {
    if (o.status === "paid") of(o.lookId).sold++;
    else if (o.status === "paid_late") of(o.lookId).late++;
  }
  const ready = new Map<string, Map<string, number>>();
  const withCredit = new Set<string>();
  for (const c of credits) {
    withCredit.add(c.orderId);
    const s = of(c.playId);
    const days = options.waitDays?.(c.playId) ?? PLAY_WAIT_DAYS;
    if (c.usedAt !== null) s.used++;
    else if (c.grantedAt >= now - days * DAY_MS) {
      s.ready++;
      const mine = ready.get(c.player) ?? ready.set(c.player, new Map()).get(c.player)!;
      mine.set(c.playId, (mine.get(c.playId) ?? 0) + 1);
    } else {
      s.notUsedInTime++;
      const o = orders.get(c.orderId);
      if (o) back(o, c.playId, "not_used_in_time");
    }
  }
  for (const o of playOrders) if (o.status === "paid" && o.player === FORGOTTEN && !withCredit.has(o.id)) back(o, o.lookId, "deleted_player");
  sendBack.sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0) || (a.orderId < b.orderId ? -1 : 1));
  const byPlayer = new Map([...ready].map(([p, m]) => [p, [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, n]) => ({ id, ready: n }))]));
  return { plays: [...stats.values()].sort((a, b) => (a.playId < b.playId ? -1 : 1)), sendBack, ready: byPlayer };
}

/** The players of the summary with their ready credits: a player with credits and no look is listed too (players in a steady order). */
export function withReady(players: StoreSummary["players"], ready: ReadonlyMap<string, { id: string; ready: number }[]>): StoreSummary["players"] {
  const out = players.map((p) => (ready.has(p.player) ? { ...p, ready: ready.get(p.player)! } : p));
  for (const [player, list] of ready) if (!players.some((p) => p.player === player)) out.push({ player, looks: [], ready: list });
  return out.sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : 0));
}

/** The plays' part of a summary: the numbers, the list to send back, the players' credits, and "To send back" (the late payments and the paid plays). */
export function addPlays(base: StoreSummary, lateRows: readonly { amountRaw: string; usd: string }[], playOrders: readonly OrderRow[], credits: readonly CreditRow[], now: number, options: SummaryOptions = {}): StoreSummary {
  const p = playsSummary(playOrders, credits, now, options);
  return {
    ...base,
    totals: { ...base.totals, sendBack: moneyOf([...lateRows, ...p.sendBack]) },
    players: withReady(base.players, p.ready),
    plays: p.plays,
    sendBack: p.sendBack.map(({ amountRaw: _, ...s }) => s),
  };
}

/** The whole summary from ALL the rows (for a store that reads the rows itself: Firestore, memory), with the credits when the game sells plays. */
export function summarize(rows: readonly OrderRow[], owned: readonly { player: string; lookId: string; at: number }[], rate: StoreSummary["rate"], now: number, credits: readonly CreditRow[] = [], options: SummaryOptions = {}): StoreSummary {
  const counts = { open: 0, paid: 0, expired: 0, paid_late: 0 };
  for (const o of rows) {
    const key = statusOf(o.status, o.expiresAt, now);
    if (Object.hasOwn(counts, key)) counts[key as keyof typeof counts]++;
  }
  const late = rows.filter((o) => o.status === "paid_late");
  const base: StoreSummary = {
    counts,
    totals: { paid: moneyOf(rows.filter((o) => o.status === "paid")), paidLate: moneyOf(late) },
    orders: shapeOrders(rows, now),
    players: shapePlayers(owned),
    rate,
  };
  return addPlays(base, late, rows.filter((o) => o.kind === "play" && (o.status === "paid" || o.status === "paid_late")), credits, now, options);
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
