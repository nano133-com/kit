import type { Firestore } from "firebase-admin/firestore";
import { SweepLeaseLost, type Checkout, type DerivedStore, type SweepPatch } from "./types.js";

/**
 * A store in Firestore (firebase-admin).
 *
 * - `checkouts`: one document per checkout.
 * - `amounts`: one lock document per amount, `{ checkout, until }`. Use one
 *   collection for everything paid to the same address.
 * - `payments`: one document per used payment hash, `{ checkout }`. Late
 *   Payment Return reads and writes the same collection.
 * - `counter` (derived-address mode only): the path of one document, `{ next }`,
 *   the index counter. Default `checkout_index/counter`. Never delete it or
 *   change it by hand: an index that is given twice is one address for two
 *   checkouts (createDerived refuses it, but the counter must still only grow).
 *
 * Queries for `claimable()` need checkouts indexed on `amount` and `status`
 * (Firestore's single-field indexes cover two equality filters). Derived-address
 * mode queries `to`, `scanUntil` and `sweep.status` (single-field indexes too).
 */
export function firestoreStore(db: Firestore, opts: { checkouts: string; amounts: string; payments: string; counter?: string }) {
  const checkouts = db.collection(opts.checkouts);
  const amounts = db.collection(opts.amounts);
  const payments = db.collection(opts.payments);
  const counter = () => db.doc(opts.counter ?? "checkout_index/counter");
  const nano = (a: string) => a.replace(/^xrb_/, "nano_");
  /** Throws SweepLeaseLost unless `owner` holds the checkout's unexpired sweep lease (read inside the transaction). */
  const fence = (c: Checkout | undefined, owner: string, now: number) => {
    const lease = c?.sweep?.lease;
    if (!c || !lease || lease.owner !== owner || lease.until <= now) throw new SweepLeaseLost();
  };
  const dotted = (patch: SweepPatch) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [`sweep.${k}`, v ?? null]));
  const store: DerivedStore = {
    create: (c, lockUntil) =>
      db.runTransaction(async (tx) => {
        const lock = amounts.doc(c.amount);
        const held = await tx.get(lock);
        if (held.exists && ((held.data()?.until as number | undefined) ?? 0) > c.createdAt) return false;
        tx.set(lock, { checkout: c.id, until: lockUntil });
        tx.set(checkouts.doc(c.id), c);
        return true;
      }),
    async get(id) {
      const d = await checkouts.doc(id).get();
      return d.exists ? (d.data() as Checkout) : null;
    },
    markPaid: (id, hash, payer, at) =>
      db.runTransaction(async (tx) => {
        const H = hash.toUpperCase();
        const [p, c] = await Promise.all([tx.get(payments.doc(H)), tx.get(checkouts.doc(id))]);
        if (p.exists && p.data()?.checkout !== id) return "used";
        if (c.data()?.status !== "waiting") return "taken";
        tx.set(payments.doc(H), { checkout: id, at });
        // A derived checkout is also due for its sweep from now on.
        tx.update(checkouts.doc(id), { status: "paid", hash: H, payer, paidAt: at, ...(c.data()?.index !== undefined ? { "sweep.status": "due" } : {}) });
        return "paid";
      }),
    async isUsed(hash) {
      return (await payments.doc(hash.toUpperCase()).get()).exists;
    },
    async claimable(amount, now) {
      const q = await checkouts.where("amount", "==", amount).where("status", "==", "waiting").get();
      // A derived checkout is claimed by its own address, never by its amount alone (derivedReturns().isClaimable).
      return q.docs.some((d) => {
        const c = d.data() as Checkout;
        return c.index === undefined && c.expiresAt + c.graceMs > now;
      });
    },
    takeIndex: (cap) =>
      db.runTransaction(async (tx) => {
        const d = await tx.get(counter());
        const next = d.exists ? d.data()?.next : 0;
        if (typeof next !== "number" || !Number.isInteger(next) || next < 0) throw new Error("the index counter is not a whole number");
        if (next >= cap) throw new Error(`the index counter reached the cap of ${cap}`);
        tx.set(counter(), { next: next + 1 });
        return next;
      }),
    createDerived: (c) =>
      db.runTransaction(async (tx) => {
        if (c.index === undefined) throw new Error("a derived checkout needs an index");
        const [same, onAddress] = await Promise.all([tx.get(checkouts.doc(c.id)), tx.get(checkouts.where("to", "==", c.to).limit(1))]);
        if (same.exists || !onAddress.empty) return false;
        tx.set(checkouts.doc(c.id), c);
        return true;
      }),
    async byAddress(address) {
      const q = await checkouts.where("to", "==", nano(address)).limit(1).get();
      const c = q.docs[0]?.data() as Checkout | undefined;
      return c && c.index !== undefined ? c : null;
    },
    async derivedAddresses(now, limit) {
      const q = await checkouts.where("scanUntil", ">", now).orderBy("scanUntil", "desc").limit(limit).get();
      return q.docs.map((d) => (d.data() as Checkout).to);
    },
    async unswept(limit) {
      const q = await checkouts.where("sweep.status", "==", "due").limit(limit).get();
      return q.docs.map((d) => d.data() as Checkout);
    },
    claimSweep: (id, owner, now, leaseMs) =>
      db.runTransaction(async (tx) => {
        const c = (await tx.get(checkouts.doc(id))).data() as Checkout | undefined;
        if (!c || c.index === undefined || c.status !== "paid" || c.sweep?.status !== "due") return false;
        const lease = c.sweep.lease;
        if (lease && lease.until > now && lease.owner !== owner) return false;
        tx.update(checkouts.doc(id), { "sweep.lease": { owner, until: now + leaseMs } });
        return true;
      }),
    patchSweep: (id, owner, patch, now, leaseMs) =>
      db.runTransaction(async (tx) => {
        fence((await tx.get(checkouts.doc(id))).data() as Checkout | undefined, owner, now);
        tx.update(checkouts.doc(id), { ...dotted(patch), "sweep.lease": { owner, until: now + leaseMs } });
      }),
    finishSweep: (id, owner, hash, now) =>
      db.runTransaction(async (tx) => {
        fence((await tx.get(checkouts.doc(id))).data() as Checkout | undefined, owner, now);
        const H = hash.toUpperCase();
        tx.update(checkouts.doc(id), { "sweep.status": "done", "sweep.hash": H, "sweep.error": null, "sweep.lease": null });
        // The sweep's own send is a used payment: Late Payment Return never sends it back to the address it came from.
        tx.set(payments.doc(H), { sweep: id, at: now });
      }),
    releaseSweep: (id, owner) =>
      db.runTransaction(async (tx) => {
        const c = (await tx.get(checkouts.doc(id))).data() as Checkout | undefined;
        if (c?.sweep?.lease?.owner === owner) tx.update(checkouts.doc(id), { "sweep.lease": null });
      }),
  };
  return store;
}
