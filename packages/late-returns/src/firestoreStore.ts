import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { LockLost, type Lock, type RecordResult, type ReturnRecord, type ReturnStore, type StoreWriter } from "./types.js";

/**
 * A store in Firestore (firebase-admin).
 *
 * - `returns`: the collection for return records, one document per payment hash.
 * - `used`: the collections where your checkouts record a claimed payment
 *   (one document per payment hash). A payment with a document in any of them
 *   is never returned. The first one also gets the "used" mark of a return,
 *   so a late claim that checks it refuses the payment.
 * - `meta`: a collection for the lock and the daily counters.
 */
export function firestoreStore(db: Firestore, opts: { returns: string; used: string[]; meta: string }) {
  if (!opts.used.length) throw new Error("name at least one collection of used payments");
  const returns = db.collection(opts.returns);
  const used = opts.used.map((c) => db.collection(c));
  const meta = db.collection(opts.meta);
  const lockRef = meta.doc("lock");

  const store: ReturnStore = {
    async isUsed(hash) {
      const H = hash.toUpperCase();
      const snaps = await Promise.all(used.map((c) => c.doc(H).get()));
      return snaps.some((s) => s.exists);
    },
    async record(r, day): Promise<RecordResult> {
      const H = r.hash.toUpperCase();
      const ref = returns.doc(H);
      const dayRef = meta.doc(`returns-${day.key}`);
      return db.runTransaction(async (tx) => {
        const [ret, d, ...marks] = await Promise.all([tx.get(ref), tx.get(dayRef), ...used.map((c) => tx.get(c.doc(H)))]);
        if (ret.exists) return "exists";
        if (marks.some((m) => m.exists)) return "used";
        const n = (d.data()?.n as number | undefined) ?? 0;
        if (n >= day.max) return "limit";
        tx.set(used[0].doc(H), { return: H, at: Date.now() });
        tx.set(ref, { ...r, hash: H, status: "pending", createdAt: Date.now() } satisfies ReturnRecord);
        tx.set(dayRef, { n: n + 1 });
        return "created";
      });
    },
    async get(hash) {
      const d = await returns.doc(hash.toUpperCase()).get();
      return d.exists ? (d.data() as ReturnRecord) : null;
    },
    async pending(limit) {
      const q = await returns.where("status", "==", "pending").limit(limit).get();
      return q.docs.map((d) => d.data() as ReturnRecord);
    },
    lock(ttlMs): Lock & StoreWriter {
      const owner = randomUUID();
      const fence = async (tx: FirebaseFirestore.Transaction) => {
        const d = (await tx.get(lockRef)).data();
        if (d?.owner !== owner || (d.until as number) <= Date.now()) throw new LockLost();
      };
      return {
        take: () =>
          db.runTransaction(async (tx) => {
            const d = (await tx.get(lockRef)).data();
            if (d && (d.until as number) > Date.now()) return false;
            tx.set(lockRef, { owner, until: Date.now() + ttlMs });
            return true;
          }),
        renew: () =>
          db.runTransaction(async (tx) => {
            await fence(tx);
            tx.update(lockRef, { until: Date.now() + ttlMs });
          }),
        release: () =>
          db.runTransaction(async (tx) => {
            if ((await tx.get(lockRef)).data()?.owner === owner) tx.delete(lockRef);
          }),
        // Every write proves, in its own transaction, that this run still holds the lock.
        update: (hash, patch) =>
          db.runTransaction(async (tx) => {
            await fence(tx);
            tx.update(returns.doc(hash.toUpperCase()), patch as Record<string, unknown>);
            tx.update(lockRef, { until: Date.now() + ttlMs });
          }),
      };
    },
  };
  return store;
}
