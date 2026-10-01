import type { Firestore } from "firebase-admin/firestore";
import type { SigninSession, SigninStore } from "./types.js";

/**
 * A store in Firestore (firebase-admin): `sessions` (one document per
 * sign-in), `amounts` (one lock per amount, `{ session, until }`) and
 * `payments` (one document per used payment hash).
 */
export function firestoreStore(db: Firestore, opts: { sessions: string; amounts: string; payments: string }) {
  const sessions = db.collection(opts.sessions);
  const amounts = db.collection(opts.amounts);
  const payments = db.collection(opts.payments);
  const store: SigninStore = {
    create: (s, lockUntil) =>
      db.runTransaction(async (tx) => {
        const lock = amounts.doc(s.amount);
        const held = await tx.get(lock);
        if (held.exists && ((held.data()?.until as number | undefined) ?? 0) > s.startedAt) return false;
        tx.set(lock, { session: s.id, until: lockUntil });
        tx.set(sessions.doc(s.id), s);
        return true;
      }),
    async get(id) {
      const d = await sessions.doc(id).get();
      return d.exists ? (d.data() as SigninSession) : null;
    },
    claim: (id, hash, account, at) =>
      db.runTransaction(async (tx) => {
        const H = hash.toUpperCase();
        const [p, s] = await Promise.all([tx.get(payments.doc(H)), tx.get(sessions.doc(id))]);
        if (p.exists && p.data()?.session !== id) return "used";
        if (s.data()?.status !== "waiting") return "taken";
        tx.set(payments.doc(H), { session: id, at });
        tx.update(sessions.doc(id), { status: "signedin", hash: H, account, signedInAt: at });
        return "signedin";
      }),
  };
  return store;
}

/** A useOnce for signature sign-ins in Firestore: one document per key, created in a transaction. */
export function firestoreOnce(db: Firestore, collection: string) {
  const col = db.collection(collection);
  return (key: string, ttlMs: number) =>
    db.runTransaction(async (tx) => {
      const ref = col.doc(key);
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, { at: Date.now(), until: Date.now() + ttlMs });
      return true;
    });
}
