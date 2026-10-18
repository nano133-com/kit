import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { UseOnce } from "./signature.js";
import type { RequestStore, WalletRequest } from "./requests.js";

// Firestore stores. Each document carries `deleteAt`: set a TTL policy on it for each collection.

const DAY = 86_400_000;

/**
 * A UseOnce in Firestore: one document per key, created in a transaction, with the account that signed (so a
 * "delete my data" can find a person's rows: `where("address", "==", address)`).
 */
export function firestoreOnce(db: Firestore, collection: string): UseOnce {
  const col = db.collection(collection);
  return (key, ttlMs, address) =>
    db.runTransaction(async (tx) => {
      const ref = col.doc(key);
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, { address, at: FieldValue.serverTimestamp(), until: Date.now() + ttlMs, deleteAt: Timestamp.fromMillis(Date.now() + ttlMs) });
      return true;
    });
}

/**
 * A RequestStore in Firestore: `collection/{key}` = { id, starter, status, label?, nonce?, issuedAt?, createdAt, expiresAt, deleteAt
 * (a day after expiresAt), and after the signature: account, signedAt }. `find` reads `where("id", "==", id)`:
 * Firestore's single-field index serves it.
 */
export function firestoreRequests(db: Firestore, collection: string): RequestStore {
  const col = db.collection(collection);
  type Doc = Omit<WalletRequest, "expiresAt"> & { expiresAt: Timestamp };
  const fromDoc = (d: Doc | undefined, key: string): WalletRequest | null => {
    // Not `instanceof Timestamp`: the site's copy of firebase-admin may not be this module's.
    if (!d || typeof d.expiresAt?.toMillis !== "function") return null;
    // A request made before ids were kept (key = id) has none on record.
    return {
      id: d.id ?? key,
      starter: d.starter,
      status: d.status,
      expiresAt: d.expiresAt.toMillis(),
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.nonce !== undefined ? { nonce: d.nonce } : {}),
      ...(d.issuedAt !== undefined ? { issuedAt: d.issuedAt } : {}),
      ...(d.account !== undefined ? { account: d.account } : {}),
    };
  };
  const get = async (key: string) => fromDoc((await col.doc(key).get()).data() as Doc | undefined, key);
  return {
    async create(key, r) {
      await col.doc(key).create({
        id: r.id,
        starter: r.starter,
        status: r.status,
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...(r.nonce !== undefined ? { nonce: r.nonce } : {}),
        ...(r.issuedAt !== undefined ? { issuedAt: r.issuedAt } : {}),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(r.expiresAt),
        deleteAt: Timestamp.fromMillis(r.expiresAt + DAY),
      });
    },
    get,
    async find(id) {
      const d = (await col.where("id", "==", id).limit(1).get()).docs[0];
      const request = d ? fromDoc(d.data() as Doc, d.id) : null;
      return request ? { key: d.id, request } : null;
    },
    async finish(key, account) {
      const ref = col.doc(key);
      return db.runTransaction(async (tx) => {
        const cur = (await tx.get(ref)).data();
        if (!cur || cur.status !== "waiting") return false;
        tx.update(ref, { status: "signedin", account, signedAt: FieldValue.serverTimestamp() });
        return true;
      });
    },
  };
}
