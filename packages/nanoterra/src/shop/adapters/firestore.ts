// The shop store for a game on Firestore (the Admin SDK). The package has no Firebase dependency: the adapter uses the small interface below, which the
// Admin SDK's `Firestore` fits. It reads and writes ONLY its five collections.
//
//   import { createFirestoreShop } from "@nano133/nanoterra/shop/firestore";
//   const store = createFirestoreShop(getFirestore());
//
// The data model (the five collection names can be changed; the first three are the ones the admin's Firestore store reads):
//   orders/{id}               { player, lookId, usd, rate, amount, amountLock, status, createdAt, expiresAt, holdUntil, hash, payer, paidAt, visitor }
//   owned/{player__lookId}    { player, lookId, orderId, grantedAt }       (the player's id with encodeURIComponent: a Nano address stays as it is)
//   meta/rate                 { value: JSON { usd, sources }, at }          meta/scan { value: "", at }
//   shop_amounts/{amount}     { orderId, holdUntil }   the reservation: a document for each held amount, so two orders cannot hold one (a transaction makes it)
//   shop_hashes/{hash}        { orderId }              one payment pays one order: a document for each recorded payment
// Every write that a rule depends on is a transaction that reads what it checks. Indexes: the single-field indexes Firestore makes by itself are enough
// (the queries are equalities, and one `<` on shop_amounts.holdUntil).

import { paidStatus } from "../orders.js";
import { FORGOTTEN, type ForgetResult, type OrderStatus, type Settled, type ShopOrder, type ShopStore } from "../store.js";

export type ShopDocSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
export interface ShopDocRef {
  get(): Promise<ShopDocSnap>;
}
export type ShopQuerySnap = { docs: { id: string; ref: ShopDocRef; data(): Record<string, unknown> }[] };
export interface ShopQuery {
  where(field: string, op: "==" | "<", value: unknown): ShopQuery;
  limit(n: number): ShopQuery;
  get(): Promise<ShopQuerySnap>;
}
export interface ShopCollection extends ShopQuery {
  doc(id: string): ShopDocRef;
}
/** A transaction: every read before the first write, as Firestore asks. */
export interface ShopTransaction {
  get(ref: ShopDocRef): Promise<ShopDocSnap>;
  set(ref: ShopDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  delete(ref: ShopDocRef): unknown;
}
export interface ShopBatch {
  set(ref: ShopDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  delete(ref: ShopDocRef): unknown;
  commit(): Promise<unknown>;
}
export interface FirestoreShopLike {
  collection(name: string): ShopCollection;
  runTransaction<T>(fn: (tx: ShopTransaction) => Promise<T>): Promise<T>;
  batch(): ShopBatch;
}

export type ShopCollections = { orders?: string; owned?: string; meta?: string; amounts?: string; hashes?: string };

/** The most documents one query reads: a small game's orders of one player, or its held amounts. */
export const FIRESTORE_SHOP_SCAN = 2000;

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const orNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const STATUSES: readonly OrderStatus[] = ["open", "paid", "expired", "paid_late"];
/** A transaction that lost to other ones on every attempt: the Admin SDK's gRPC code 10, or the web SDK's "aborted". */
const aborted = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 10 || code === "aborted";
};

function orderOf(id: string, d: Record<string, unknown>): ShopOrder {
  return {
    id,
    player: text(d.player),
    lookId: text(d.lookId),
    usd: text(d.usd, "0"),
    rate: num(d.rate),
    amount: text(d.amount, "0"),
    amountLock: orNull(d.amountLock),
    status: (STATUSES as readonly unknown[]).includes(d.status) ? (d.status as OrderStatus) : "expired",
    createdAt: num(d.createdAt),
    expiresAt: num(d.expiresAt),
    holdUntil: num(d.holdUntil),
    hash: orNull(d.hash),
    payer: orNull(d.payer),
    paidAt: typeof d.paidAt === "number" ? d.paidAt : null,
    visitor: orNull(d.visitor),
  };
}

const dataOf = (o: ShopOrder): Record<string, unknown> => ({
  player: o.player,
  lookId: o.lookId,
  usd: o.usd,
  rate: o.rate,
  amount: o.amount,
  amountLock: o.amountLock,
  status: o.status,
  createdAt: o.createdAt,
  expiresAt: o.expiresAt,
  holdUntil: o.holdUntil,
  hash: o.hash,
  payer: o.payer,
  paidAt: o.paidAt,
  visitor: o.visitor,
});

export function createFirestoreShop(db: FirestoreShopLike, collections: ShopCollections = {}): ShopStore {
  const C = {
    orders: collections.orders ?? "orders",
    owned: collections.owned ?? "owned",
    meta: collections.meta ?? "meta",
    amounts: collections.amounts ?? "shop_amounts",
    hashes: collections.hashes ?? "shop_hashes",
  };
  const col = (name: keyof typeof C) => db.collection(C[name]);
  const ownedId = (player: string, lookId: string) => `${encodeURIComponent(player)}__${lookId}`;
  const ordersOf = (player: string) => col("orders").where("player", "==", player).limit(FIRESTORE_SHOP_SCAN);

  async function commitAll(writes: ((b: ShopBatch) => void)[]) {
    // A batch holds at most 500 writes.
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + 400)) w(batch);
      await batch.commit();
    }
  }

  const tidy = async (now: number) => {
    // Each change reads the document again in a transaction: a blind write could undo a payment that was recorded meanwhile.
    const open = (await col("orders").where("status", "==", "open").limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => num(d.data().expiresAt) < now);
    for (const d of open) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(d.ref);
        const o = snap.exists ? snap.data() : undefined;
        if (o && o.status === "open" && num(o.expiresAt) < now) tx.set(d.ref, { status: "expired" }, { merge: true });
      });
    }
    const stale = (await col("amounts").where("holdUntil", "<", now).limit(FIRESTORE_SHOP_SCAN).get()).docs;
    for (const d of stale) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(d.ref);
        const lock = snap.exists ? snap.data() : undefined;
        if (!lock || num(lock.holdUntil) >= now) return;
        const orderRef = col("orders").doc(text(lock.orderId));
        const order = await tx.get(orderRef);
        tx.delete(d.ref);
        if (order.exists && order.data()?.amountLock === d.id) tx.set(orderRef, { amountLock: null }, { merge: true });
      });
    }
  };

  return {
    tidy,

    async heldAmounts(amounts) {
      const want = new Set(amounts);
      return new Set((await col("amounts").limit(FIRESTORE_SHOP_SCAN).get()).docs.map((d) => d.id).filter((id) => want.has(id)));
    },

    async insert(o) {
      const lockRef = col("amounts").doc(o.amount);
      const orderRef = col("orders").doc(o.id);
      try {
        return await db.runTransaction(async (tx) => {
          const [lock, order] = [await tx.get(lockRef), await tx.get(orderRef)];
          if (lock.exists || order.exists) return false;
          tx.set(lockRef, { orderId: o.id, holdUntil: o.holdUntil });
          tx.set(orderRef, dataOf({ ...o, amountLock: o.amount, status: "open", hash: null, payer: null, paidAt: null }));
          return true;
        });
      } catch (e) {
        // Many buyers of one price at the same instant all race for one amount's document. Firestore retries the losers, and one that loses on every
        // attempt gets ABORTED. An aborted transaction wrote nothing, so it is "taken": reserveOrder goes on to the next amount (ShopBusy after the last).
        if (aborted(e)) return false;
        throw e;
      }
    },

    async order(id) {
      const snap = await col("orders").doc(id).get();
      const d = snap.exists ? snap.data() : undefined;
      return d ? orderOf(id, d) : null;
    },

    async openOrder(player, lookId, until) {
      const docs = (await ordersOf(player).where("lookId", "==", lookId).where("status", "==", "open").get()).docs;
      const list = docs.map((d) => orderOf(d.id, d.data())).filter((o) => o.player === player && o.expiresAt > until).sort((a, b) => b.createdAt - a.createdAt);
      return list[0] ?? null;
    },

    async countOpen(player, now) {
      return (await ordersOf(player).where("status", "==", "open").get()).docs.map((d) => orderOf(d.id, d.data())).filter((o) => o.player === player && o.expiresAt > now).length;
    },

    async owns(player, lookId) {
      const snap = await col("owned").doc(ownedId(player, lookId)).get();
      return snap.exists && snap.data()?.player === player;
    },

    async owned(player) {
      const rows = (await col("owned").where("player", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.map((d) => d.data());
      return rows
        .filter((r) => r.player === player)
        .sort((a, b) => num(a.grantedAt) - num(b.grantedAt) || (text(a.lookId) < text(b.lookId) ? -1 : 1))
        .map((r) => text(r.lookId));
    },

    async held() {
      const locks = (await col("amounts").limit(FIRESTORE_SHOP_SCAN).get()).docs;
      const out: ShopOrder[] = [];
      for (const l of locks) {
        const id = text(l.data().orderId);
        const snap = await col("orders").doc(id).get();
        const d = snap.exists ? snap.data() : undefined;
        if (d && d.amountLock === l.id) out.push(orderOf(id, d));
      }
      return out;
    },

    async usedHashes(hashes) {
      const snaps = await Promise.all(hashes.map(async (h) => [h, await col("hashes").doc(h).get()] as const));
      return new Set(snaps.filter(([, s]) => s.exists).map(([h]) => h));
    },

    async settle(order, pay, now): Promise<Settled> {
      const orderRef = col("orders").doc(order.id);
      const hashRef = col("hashes").doc(pay.hash);
      return db.runTransaction(async (tx) => {
        const hash = await tx.get(hashRef);
        const snap = await tx.get(orderRef);
        const d = snap.exists ? snap.data() : undefined;
        const lockRef = col("amounts").doc(text(d?.amountLock, order.amount));
        const lock = await tx.get(lockRef);
        const o = d ? orderOf(order.id, d) : null;
        const ownedRef = col("owned").doc(ownedId(o?.player ?? order.player, o?.lookId ?? order.lookId));
        const owned = await tx.get(ownedRef);
        if (!o || (o.status !== "open" && o.status !== "expired") || o.amountLock === null) return "taken";
        if (hash.exists) return "used";
        const status = paidStatus(o, pay.seenMs);
        tx.set(orderRef, dataOf({ ...o, status, hash: pay.hash, payer: pay.payer, paidAt: pay.seenMs, amountLock: null }));
        if (lock.exists && lock.data()?.orderId === order.id) tx.delete(lockRef);
        tx.set(hashRef, { orderId: order.id });
        if (status === "paid" && !owned.exists) tx.set(ownedRef, { player: o.player, lookId: o.lookId, orderId: o.id, grantedAt: now });
        return status;
      });
    },

    async claimScan(now, gapMs) {
      const ref = col("meta").doc("scan");
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const at = snap.exists ? num(snap.data()?.at, -Infinity) : -Infinity;
        if (at > now - gapMs) return false;
        tx.set(ref, { value: "", at: now });
        return true;
      });
    },

    async readRate() {
      const snap = await col("meta").doc("rate").get();
      const d = snap.exists ? snap.data() : undefined;
      if (!d || typeof d.value !== "string" || typeof d.at !== "number") return null;
      try {
        const v = JSON.parse(d.value) as { usd?: unknown; sources?: unknown };
        if (typeof v.usd !== "number" || !Number.isFinite(v.usd) || !Array.isArray(v.sources) || !v.sources.every((s) => typeof s === "string")) return null;
        return { usd: v.usd, sources: v.sources as string[], at: d.at };
      } catch {
        return null;
      }
    },

    async saveRate(rate) {
      const batch = db.batch();
      batch.set(col("meta").doc("rate"), { value: JSON.stringify({ usd: rate.usd, sources: rate.sources }), at: rate.at });
      await batch.commit();
    },

    async forget(player, now): Promise<ForgetResult> {
      await tidy(now);
      const mine = (await ordersOf(player).get()).docs.map((d) => ({ ref: d.ref, o: orderOf(d.id, d.data()) })).filter((x) => x.o.player === player);
      const waiting = mine.filter((x) => x.o.amountLock !== null);
      if (waiting.length) return { deleted: 0, kept: 0, waitUntil: Math.max(...waiting.map((x) => x.o.holdUntil)) };
      const owned = (await col("owned").where("player", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => d.data().player === player);
      const paidBy = (await col("orders").where("payer", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => d.data().status === "paid");
      const writes: ((b: ShopBatch) => void)[] = [];
      let deleted = 0;
      let kept = 0;
      for (const d of owned) (writes.push((b) => b.delete(d.ref)), deleted++);
      for (const { ref, o } of mine) {
        if (o.hash === null) (writes.push((b) => b.delete(ref)), deleted++);
        else (writes.push((b) => b.set(ref, { player: FORGOTTEN, visitor: null }, { merge: true })), kept++);
      }
      // A paid order keeps no payer; a paid-late one keeps it: the creator sends that payment back by hand.
      for (const d of paidBy) writes.push((b) => b.set(d.ref, { payer: FORGOTTEN }, { merge: true }));
      await commitAll(writes);
      return { deleted, kept, waitUntil: null };
    },
  };
}
