// A shop store in memory, for tests (and a game's first try). Nothing is kept after the process ends, and nothing is shared between copies of a server:
// never sell with it. It keeps the same rules as the real adapters (the conformance suite runs on it), so it is the reference for what a store does.

import { paidStatus } from "./orders.js";
import { checkRef, creditEnd } from "./plays.js";
import { FORGOTTEN, kindOf, type Credit, type ForgetResult, type KeptRate, type Settled, type ShopOrder, type ShopStore } from "./store.js";

export type MemoryShop = ShopStore & {
  /** The rows as an adapter would keep them. */
  readonly orders: Map<string, ShopOrder>;
  /** "player\u0000lookId" -> the owned row. */
  readonly ownedRows: Map<string, { player: string; lookId: string; orderId: string; grantedAt: number }>;
  /** The order's id -> its credit (a paid play). */
  readonly creditRows: Map<string, Credit>;
  /** The player -> when they said "I am 18 or older". */
  readonly adultRows: Map<string, number>;
};

export function createMemoryShop(): MemoryShop {
  const orders = new Map<string, ShopOrder>();
  const ownedRows = new Map<string, { player: string; lookId: string; orderId: string; grantedAt: number }>();
  const creditRows = new Map<string, Credit>();
  const adults = new Map<string, number>();
  let rate: KeptRate | null = null;
  let scanAt: number | null = null;
  const copy = (o: ShopOrder): ShopOrder => ({ ...o });
  const holder = (amount: string) => [...orders.values()].find((o) => o.amountLock === amount);
  const ownKey = (player: string, lookId: string) => `${player}\u0000${lookId}`;
  /** A play order whose credit is unused, or was unused when its own player deleted their data (`forgotUnused`): its payment may go back. */
  const unusedPlay = (o: ShopOrder) => kindOf(o) === "play" && ((typeof o.forgotUnused === "number") || (creditRows.has(o.id) && creditRows.get(o.id)!.usedAt === null));
  const tidy = async (now: number) => {
    for (const o of orders.values()) {
      if (o.status === "open" && o.expiresAt < now) o.status = "expired";
      if (o.amountLock !== null && o.holdUntil < now) o.amountLock = null;
    }
  };

  return {
    orders,
    ownedRows,
    creditRows,
    adultRows: adults,
    tidy,
    async heldAmounts(amounts) {
      return new Set(amounts.filter((a) => holder(a)));
    },
    async insert(order) {
      if (holder(order.amount) || orders.has(order.id)) return false;
      orders.set(order.id, { ...copy(order), kind: kindOf(order), amountLock: order.amount });
      return true;
    },
    async order(id) {
      const o = orders.get(id);
      return o ? copy(o) : null;
    },
    async openOrder(player, lookId, until) {
      const list = [...orders.values()].filter((o) => o.player === player && o.lookId === lookId && o.status === "open" && o.expiresAt > until).sort((a, b) => b.createdAt - a.createdAt);
      return list[0] ? copy(list[0]) : null;
    },
    async countOpen(player, now) {
      return [...orders.values()].filter((o) => o.player === player && o.status === "open" && o.expiresAt > now).length;
    },
    async owns(player, lookId) {
      return ownedRows.has(ownKey(player, lookId));
    },
    async owned(player) {
      return [...ownedRows.values()].filter((r) => r.player === player).sort((a, b) => a.grantedAt - b.grantedAt).map((r) => r.lookId);
    },
    async held() {
      return [...orders.values()].filter((o) => o.amountLock !== null).map(copy);
    },
    async usedHashes(hashes) {
      const all = new Set([...orders.values()].map((o) => o.hash).filter((h): h is string => h !== null));
      return new Set(hashes.filter((h) => all.has(h)));
    },
    async settle(order, pay, now): Promise<Settled> {
      const o = orders.get(order.id);
      if (!o || (o.status !== "open" && o.status !== "expired") || o.amountLock === null) return "taken";
      if ([...orders.values()].some((x) => x.hash === pay.hash)) return "used";
      const status = paidStatus(o, pay.seenMs);
      Object.assign(o, { status, hash: pay.hash, payer: pay.payer, paidAt: pay.seenMs, amountLock: null });
      if (status === "paid" && kindOf(o) === "look" && !ownedRows.has(ownKey(o.player, o.lookId))) ownedRows.set(ownKey(o.player, o.lookId), { player: o.player, lookId: o.lookId, orderId: o.id, grantedAt: now });
      if (status === "paid" && kindOf(o) === "play" && !creditRows.has(o.id)) creditRows.set(o.id, { orderId: o.id, player: o.player, playId: o.lookId, grantedAt: now, expiresAt: creditEnd(o, now), usedAt: null, useRef: null });
      return status;
    },
    async credits(player, now) {
      const ready = new Map<string, number>();
      for (const c of creditRows.values()) if (c.player === player && c.usedAt === null && c.expiresAt >= now) ready.set(c.playId, (ready.get(c.playId) ?? 0) + 1);
      return [...ready].sort(([a], [b]) => (a < b ? -1 : 1)).map(([playId, n]) => ({ playId, ready: n }));
    },
    async useCredit(player, playId, ref, now) {
      checkRef(ref);
      // No await from the read to the write: one call at a time, so the check and the use are one step.
      const was = [...creditRows.values()].find((c) => c.player === player && c.useRef === ref);
      if (was) return { status: "again", credit: { ...was } };
      const next = [...creditRows.values()]
        .filter((c) => c.player === player && c.playId === playId && c.usedAt === null && c.expiresAt >= now)
        .sort((a, b) => a.grantedAt - b.grantedAt || (a.orderId < b.orderId ? -1 : 1))[0];
      if (!next) return { status: "none" };
      Object.assign(next, { usedAt: now, useRef: ref });
      return { status: "used", credit: { ...next } };
    },
    async adult(player) {
      return adults.get(player) ?? null;
    },
    async keepAdult(player, now) {
      if (!adults.has(player)) adults.set(player, now);
    },
    async claimScan(now, gapMs) {
      if (scanAt !== null && scanAt > now - gapMs) return false;
      scanAt = now;
      return true;
    },
    async readRate() {
      return rate ? { ...rate, sources: [...rate.sources] } : null;
    },
    async saveRate(r) {
      rate = { usd: r.usd, sources: [...r.sources], at: r.at };
    },
    async forget(player, now): Promise<ForgetResult> {
      await tidy(now);
      const mine = [...orders.values()].filter((o) => o.player === player);
      const waiting = mine.filter((o) => o.amountLock !== null);
      if (waiting.length) return { deleted: 0, kept: 0, waitUntil: Math.max(...waiting.map((o) => o.holdUntil)) };
      let deleted = 0;
      let kept = 0;
      // The player's own paid plays (read before their credits go): an unused credit's order keeps its payer and the mark, a used one's keeps none.
      for (const o of mine) {
        if (kindOf(o) !== "play" || o.status !== "paid") continue;
        if (unusedPlay(o)) o.forgotUnused = now;
        else if (o.payer !== null) o.payer = FORGOTTEN;
      }
      // An order the player paid keeps no payer; a paid-late one keeps it (the creator sends that payment back by hand), and so does an unused play.
      for (const o of orders.values()) if (o.payer === player && o.status === "paid" && !unusedPlay(o)) o.payer = FORGOTTEN;
      for (const [k, r] of ownedRows) if (r.player === player) (ownedRows.delete(k), deleted++);
      for (const [k, c] of creditRows) if (c.player === player) (creditRows.delete(k), deleted++);
      if (adults.delete(player)) deleted++;
      for (const o of mine) {
        if (o.hash === null) (orders.delete(o.id), deleted++);
        else (Object.assign(o, { player: FORGOTTEN, visitor: null }), kept++);
      }
      return { deleted, kept, waitUntil: null };
    },
  };
}
