import type { Firestore } from "firebase-admin/firestore";
import type { Checkout, CheckoutStore } from "./types.js";

/**
 * A store in Firestore (firebase-admin).
 *
 * - `checkouts`: one document per checkout.
 * - `amounts`: one lock document per amount, `{ checkout, until }`. Use one
 *   collection for everything paid to the same address.
 * - `payments`: one document per used payment hash, `{ checkout }`. Late
 *   Payment Return reads and writes the same collection.
 *
 * Queries for `claimable()` need checkouts indexed on `amount` and `status`
 * (Firestore's single-field indexes cover two equality filters).
 */
export function firestoreStore(db: Firestore, opts: { checkouts: string; amounts: string; payments: string }) {
  const checkouts = db.collection(opts.checkouts);
  const amounts = db.collection(opts.amounts);
  const payments = db.collection(opts.payments);
  const store: CheckoutStore = {
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
        tx.update(checkouts.doc(id), { status: "paid", hash: H, payer, paidAt: at });
        return "paid";
      }),
    async isUsed(hash) {
      return (await payments.doc(hash.toUpperCase()).get()).exists;
    },
    async claimable(amount, now) {
      const q = await checkouts.where("amount", "==", amount).where("status", "==", "waiting").get();
      return q.docs.some((d) => {
        const c = d.data() as Checkout;
        return c.expiresAt + c.graceMs > now;
      });
    },
  };
  return store;
}
