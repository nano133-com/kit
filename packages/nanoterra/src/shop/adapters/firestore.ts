// The shop store for a game on Firestore (the Admin SDK). The package has no Firebase dependency: the adapter uses the small interface below, which the
// Admin SDK's `Firestore` fits. It reads and writes ONLY its eight collections.
//
//   import { createFirestoreShop } from "@nano133/nanoterra/shop/firestore";
//   const store = createFirestoreShop(getFirestore());
//
// The data model (the eight collection names can be changed; the first three are the ones the admin's Firestore store reads):
//   orders/{id}               { player, lookId, kind, useDays, usd, rate, amount, amountLock, status, createdAt, expiresAt, holdUntil, hash, payer, paidAt, visitor }
//                             (kind "look" or "play": a missing kind reads as "look"; a play order's lookId is the play's id, and useDays its credit's wait)
//   owned/{player__lookId}    { player, lookId, orderId, grantedAt }       (the player's id with encodeURIComponent: a Nano address stays as it is)
//   meta/rate                 { value: JSON { usd, sources }, at }          meta/scan { value: "", at }
//   shop_amounts/{amount}     { orderId, holdUntil }   the reservation: a document for each held amount, so two orders cannot hold one (a transaction makes it)
//   shop_hashes/{hash}        { orderId }              one payment pays one order: a document for each recorded payment
//   credits/{orderId}         { player, playId, orderId, grantedAt, expiresAt, usedAt, useRef }   one credit per paid play order (usedAt null until a round
//                             uses it; expiresAt, its last time of use, is fixed at the grant)
//   shop_uses/{player|ref}    { player, orderId, at }  one ref of a player uses one credit: a document for each use, made in the use's transaction (the
//                             player's id with encodeURIComponent, which writes "|" as %7C, and a ref never holds "|": two players' ids never meet)
//   play_adults/{player}      { player, at }           the player said "I am 18 or older" (the admin's Legal card), once: "Delete my data" deletes it
// Every write that a rule depends on is a transaction that reads what it checks. Indexes: the single-field indexes Firestore makes by itself are enough
// (the queries are equalities, and one `<` on shop_amounts.holdUntil).
//
// A use: a query outside a transaction lists the player's unused credits of the play, oldest first; then one transaction for each candidate reads the
// ref's document and the credit, and takes the credit only while it is unused (and the ref is new). A transaction that loses on every attempt (ABORTED)
// goes on to the next candidate; after the last, the candidates are read again (at most three times), then "none".

import { paidStatus } from "../orders.js";
import { checkRef, creditEnd } from "../plays.js";
import { FORGOTTEN, kindOf, type Credit, type ForgetResult, type UseResult, type OrderStatus, type Settled, type ShopOrder, type ShopStore } from "../store.js";

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

export type ShopCollections = { orders?: string; owned?: string; meta?: string; amounts?: string; hashes?: string; credits?: string; uses?: string; adults?: string };

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
    kind: d.kind === "play" ? "play" : "look",
    ...(typeof d.useDays === "number" ? { useDays: d.useDays } : {}),
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

const creditOf = (orderId: string, d: Record<string, unknown>): Credit => ({
  orderId,
  player: text(d.player),
  playId: text(d.playId),
  grantedAt: num(d.grantedAt),
  // A credit with no end is never usable (every grant writes one).
  expiresAt: num(d.expiresAt, -Infinity),
  usedAt: typeof d.usedAt === "number" ? d.usedAt : null,
  useRef: orNull(d.useRef),
});

const dataOf = (o: ShopOrder): Record<string, unknown> => ({
  player: o.player,
  lookId: o.lookId,
  kind: kindOf(o),
  ...(kindOf(o) === "play" ? { useDays: o.useDays ?? null } : {}),
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
    credits: collections.credits ?? "credits",
    uses: collections.uses ?? "shop_uses",
    adults: collections.adults ?? "play_adults",
  };
  const col = (name: keyof typeof C) => db.collection(C[name]);
  const ownedId = (player: string, lookId: string) => `${encodeURIComponent(player)}__${lookId}`;
  // "|" is in neither part (encodeURIComponent writes it as %7C; USE_REF_PATTERN has no "|"), so ("user_", "1x") and ("user", "_1x") are two documents.
  // The use's reads still check the document's player: one that is not this player's is no use of theirs.
  const useId = (player: string, ref: string) => `${encodeURIComponent(player)}|${ref}`;
  const creditsOf = (player: string) => col("credits").where("player", "==", player).where("usedAt", "==", null).limit(FIRESTORE_SHOP_SCAN);
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
        const creditRef = col("credits").doc(order.id);
        const credit = await tx.get(creditRef);
        if (!o || (o.status !== "open" && o.status !== "expired") || o.amountLock === null) return "taken";
        if (hash.exists) return "used";
        const status = paidStatus(o, pay.seenMs);
        tx.set(orderRef, dataOf({ ...o, status, hash: pay.hash, payer: pay.payer, paidAt: pay.seenMs, amountLock: null }));
        if (lock.exists && lock.data()?.orderId === order.id) tx.delete(lockRef);
        tx.set(hashRef, { orderId: order.id });
        if (status === "paid" && kindOf(o) === "look" && !owned.exists) tx.set(ownedRef, { player: o.player, lookId: o.lookId, orderId: o.id, grantedAt: now });
        if (status === "paid" && kindOf(o) === "play" && !credit.exists) tx.set(creditRef, { player: o.player, playId: o.lookId, orderId: o.id, grantedAt: now, expiresAt: creditEnd(o, now), usedAt: null, useRef: null });
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

    async credits(player, now) {
      const ready = new Map<string, number>();
      for (const d of (await creditsOf(player).get()).docs) {
        const c = creditOf(d.id, d.data());
        if (c.player === player && c.usedAt === null && c.expiresAt >= now) ready.set(c.playId, (ready.get(c.playId) ?? 0) + 1);
      }
      return [...ready].sort(([a], [b]) => (a < b ? -1 : 1)).map(([playId, n]) => ({ playId, ready: n }));
    },

    async useCredit(player, playId, ref, now): Promise<UseResult> {
      checkRef(ref);
      const useRef = col("uses").doc(useId(player, ref));
      /** The credit this ref used, or null. */
      const usedBefore = async (): Promise<UseResult | null> => {
        const use = await useRef.get();
        const orderId = use.exists && use.data()?.player === player ? text(use.data()?.orderId) : "";
        if (!orderId) return null;
        const snap = await col("credits").doc(orderId).get();
        const d = snap.exists ? snap.data() : undefined;
        return d && d.player === player ? { status: "again", credit: creditOf(orderId, d) } : null;
      };
      for (let round = 0; round < 3; round++) {
        const was = await usedBefore();
        if (was) return was;
        const list = (await creditsOf(player).where("playId", "==", playId).get()).docs
          .map((d) => ({ ref: d.ref, c: creditOf(d.id, d.data()) }))
          .filter(({ c }) => c.player === player && c.playId === playId && c.usedAt === null && c.expiresAt >= now)
          .sort((a, b) => a.c.grantedAt - b.c.grantedAt || (a.c.orderId < b.c.orderId ? -1 : 1));
        let lost = false;
        for (const { ref: creditRef, c } of list) {
          let out: UseResult | null;
          try {
            out = await db.runTransaction(async (tx): Promise<UseResult | null> => {
              const use = await tx.get(useRef);
              const snap = await tx.get(creditRef);
              if (use.exists) {
                // Another player's use document never answers for this player (and is never written over): no credit is used.
                if (use.data()?.player !== player) return { status: "none" };
                const orderId = text(use.data()?.orderId);
                const was = orderId ? await tx.get(col("credits").doc(orderId)) : null;
                const d = was?.exists ? was.data() : undefined;
                return d && d.player === player ? { status: "again", credit: creditOf(orderId, d) } : { status: "none" };
              }
              const d = snap.exists ? snap.data() : undefined;
              const fresh = d ? creditOf(c.orderId, d) : null;
              // Used meanwhile, or no longer this player's: the next candidate.
              if (!fresh || fresh.player !== player || fresh.playId !== playId || fresh.usedAt !== null || fresh.expiresAt < now) return null;
              tx.set(creditRef, { usedAt: now, useRef: ref }, { merge: true });
              tx.set(useRef, { player, orderId: c.orderId, at: now });
              return { status: "used", credit: { ...fresh, usedAt: now, useRef: ref } };
            });
          } catch (e) {
            // Lost to other uses on every attempt: it wrote nothing. Try the next candidate.
            if (aborted(e)) {
              lost = true;
              continue;
            }
            throw e;
          }
          if (out) return out;
        }
        // Every candidate was taken by others, and no transaction was cut short: none is left.
        if (!lost) break;
      }
      return (await usedBefore()) ?? { status: "none" };
    },

    async adult(player) {
      const snap = await col("adults").doc(encodeURIComponent(player)).get();
      const d = snap.exists ? snap.data() : undefined;
      return d && d.player === player && typeof d.at === "number" ? d.at : null;
    },

    async keepAdult(player, now) {
      const ref = col("adults").doc(encodeURIComponent(player));
      // Read, then write only when absent, in one transaction: the first yes keeps its time.
      await db.runTransaction(async (tx) => {
        if (!(await tx.get(ref)).exists) tx.set(ref, { player, at: now });
      });
    },

    async forget(player, now): Promise<ForgetResult> {
      await tidy(now);
      const mine = (await ordersOf(player).get()).docs.map((d) => ({ ref: d.ref, o: orderOf(d.id, d.data()) })).filter((x) => x.o.player === player);
      const waiting = mine.filter((x) => x.o.amountLock !== null);
      if (waiting.length) return { deleted: 0, kept: 0, waitUntil: Math.max(...waiting.map((x) => x.o.holdUntil)) };
      const owned = (await col("owned").where("player", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => d.data().player === player);
      const credits = (await col("credits").where("player", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => d.data().player === player);
      const uses = (await col("uses").where("player", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => d.data().player === player);
      const paid = (await col("orders").where("payer", "==", player).limit(FIRESTORE_SHOP_SCAN).get()).docs.filter((d) => d.data().status === "paid");
      // A paid play whose credit is not known to be used (unused, or gone with an earlier "Delete my data") keeps its payer: its payment may go back.
      const usedPlay = async (d: (typeof paid)[number]) => {
        if (kindOf(orderOf(d.id, d.data())) !== "play") return true;
        const c = await col("credits").doc(d.id).get();
        return c.exists && typeof c.data()?.usedAt === "number";
      };
      const paidBy = (await Promise.all(paid.map(async (d) => ((await usedPlay(d)) ? [d] : [])))).flat();
      const writes: ((b: ShopBatch) => void)[] = [];
      let deleted = 0;
      let kept = 0;
      for (const d of [...owned, ...credits]) (writes.push((b) => b.delete(d.ref)), deleted++);
      for (const d of uses) writes.push((b) => b.delete(d.ref));
      const adult = col("adults").doc(encodeURIComponent(player));
      if ((await adult.get()).exists) (writes.push((b) => b.delete(adult)), deleted++);
      for (const { ref, o } of mine) {
        if (o.hash === null) (writes.push((b) => b.delete(ref)), deleted++);
        else (writes.push((b) => b.set(ref, { player: FORGOTTEN, visitor: null }, { merge: true })), kept++);
      }
      // A paid order keeps no payer; a paid-late one keeps it: the creator sends that payment back by hand (and so does an unused play, above).
      for (const d of paidBy) writes.push((b) => b.set(d.ref, { payer: FORGOTTEN }, { merge: true }));
      await commitAll(writes);
      return { deleted, kept, waitUntil: null };
    },
  };
}
