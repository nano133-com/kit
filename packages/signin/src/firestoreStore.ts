import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { SigninSession, SigninStore } from "./types.js";

/**
 * A store in Firestore (firebase-admin): `sessions` (one document per
 * sign-in), `amounts` (one lock per amount, `{ session, until }`) and
 * `payments` (one document per used payment hash).
 *
 * `returns` (optional): to send each sign-in amount back, the collection of
 * @nano133/late-returns' return records for the sign-in wallet. A claim then
 * records its return (pending) in the same transaction, and
 * `settleSigninRefunds` (from "@nano133/signin/refunds") sends it.
 *
 * Every document has `deleteAt` (a Timestamp): set a Firestore TTL policy on
 * it to clear old records.
 */
export function firestoreStore(db: Firestore, opts: { sessions: string; amounts: string; payments: string; returns?: string }) {
  const sessions = db.collection(opts.sessions);
  const amounts = db.collection(opts.amounts);
  const payments = db.collection(opts.payments);
  const returns = opts.returns ? db.collection(opts.returns) : null;
  const deleteAt = (ms: number) => Timestamp.fromMillis(ms + 86_400_000);
  const store: SigninStore = {
    create: (s, lockUntil) =>
      db.runTransaction(async (tx) => {
        const lock = amounts.doc(s.amount);
        const held = await tx.get(lock);
        if (held.exists && ((held.data()?.until as number | undefined) ?? 0) > s.startedAt) return false;
        tx.set(lock, { session: s.id, until: lockUntil, deleteAt: deleteAt(lockUntil) });
        tx.set(sessions.doc(s.id), { ...s, deleteAt: deleteAt(lockUntil) });
        return true;
      }),
    async get(id) {
      const d = await sessions.doc(id).get();
      if (!d.exists) return null;
      const { deleteAt: _, ...s } = d.data()!;
      return s as SigninSession;
    },
    claim: (id, hash, account, at, amount) =>
      db.runTransaction(async (tx) => {
        const H = hash.toUpperCase();
        const [p, s, r] = await Promise.all([tx.get(payments.doc(H)), tx.get(sessions.doc(id)), returns ? tx.get(returns.doc(H)) : null]);
        if (p.exists && p.data()?.session !== id) return "used";
        if (s.data()?.status !== "waiting") return "taken";
        // Payments stay recorded (no deleteAt): a payment must never sign in twice.
        tx.set(payments.doc(H), { session: id, at });
        tx.update(sessions.doc(id), { status: "signedin", hash: H, account, signedInAt: at });
        if (returns && !r?.exists) tx.set(returns.doc(H), { hash: H, amount, to: account, status: "pending", by: "signin", createdAt: at });
        return "signedin";
      }),
  };
  return store;
}

/**
 * A useOnce for signature sign-ins in Firestore: one document per key, created
 * in a transaction. Set a TTL policy on `deleteAt` to clear old keys.
 */
export function firestoreOnce(db: Firestore, collection: string) {
  const col = db.collection(collection);
  return (key: string, ttlMs: number) =>
    db.runTransaction(async (tx) => {
      const ref = col.doc(key);
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, { at: Date.now(), until: Date.now() + ttlMs, deleteAt: Timestamp.fromMillis(Date.now() + ttlMs) });
      return true;
    });
}
