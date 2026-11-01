// The player sign-in's store for a game on Firestore (the Admin SDK). The package has no Firebase dependency: the adapter uses the small interface
// below, which the Admin SDK's `Firestore` fits. It reads and writes ONLY its three collections, and only the player's documents (scope "play").
//
//   import { createFirestorePlayerSignin } from "@nano133/nanoterra/player-signin/firestore";
//   const store = createFirestorePlayerSignin(getFirestore());
//
// The data model (the three collection names can be changed):
//   signin_requests/{key}   { id, way, starter, status, expiresAt, nonce?, issuedAt?, label?, account?, delivered, scope: "play", deleteAt }
//   sessions/{idHash}       { address, createdAt, expiresAt, via, scope: "play", deleteAt }
//   signin_once/{key}       { address, until, deleteAt }
// Times are ms numbers; `deleteAt` is a Date (a Timestamp in Firestore): set a TTL policy on `deleteAt` for each collection. `{key}` is the request's
// id (Berry Wallet, Nautilus) or the SHA-256 of its nonce (NanChat); `{idHash}` the SHA-256 of the session's token. Every change that reads first is a
// transaction. Indexes: Firestore's own single-field indexes are enough (`id`, `address`, `account`, `expiresAt`, `until`).

import { WAYS, type PlayerSigninStore, type RequestStoreLike, type SessionRecord, type SigninRequest, type Way } from "../types.js";

export type PlayerSigninDocSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
export interface PlayerSigninDocRef {
  get(): Promise<PlayerSigninDocSnap>;
}
export type PlayerSigninQuerySnap = { docs: { id: string; ref: PlayerSigninDocRef; data(): Record<string, unknown> }[] };
export interface PlayerSigninQuery {
  where(field: string, op: "==" | "<" | "<=", value: unknown): PlayerSigninQuery;
  limit(n: number): PlayerSigninQuery;
  get(): Promise<PlayerSigninQuerySnap>;
}
export interface PlayerSigninCollection extends PlayerSigninQuery {
  doc(id: string): PlayerSigninDocRef;
}
/** A transaction: every read before the first write, as Firestore asks. */
export interface PlayerSigninTransaction {
  get(ref: PlayerSigninDocRef): Promise<PlayerSigninDocSnap>;
  set(ref: PlayerSigninDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  delete(ref: PlayerSigninDocRef): unknown;
}
export interface PlayerSigninBatch {
  delete(ref: PlayerSigninDocRef): unknown;
  commit(): Promise<unknown>;
}
export interface FirestorePlayerSigninLike {
  collection(name: string): PlayerSigninCollection;
  runTransaction<T>(fn: (tx: PlayerSigninTransaction) => Promise<T>): Promise<T>;
  batch(): PlayerSigninBatch;
}

const DAY = 86_400_000;
/** At most this many documents go in one batch (Firestore's limit is 500). */
const BATCH = 400;

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function requestOf(d: Record<string, unknown> | undefined, key: string, way: Way): SigninRequest | null {
  if (!d || d.scope !== "play" || d.way !== way || typeof d.starter !== "string" || num(d.expiresAt) === undefined) return null;
  const nonce = text(d.nonce);
  const issuedAt = num(d.issuedAt);
  const label = text(d.label);
  const account = text(d.account);
  return {
    id: text(d.id) ?? key,
    starter: d.starter,
    status: d.status === "signedin" ? "signedin" : "waiting",
    expiresAt: num(d.expiresAt)!,
    ...(label !== undefined ? { label } : {}),
    ...(nonce !== undefined ? { nonce } : {}),
    ...(issuedAt !== undefined ? { issuedAt } : {}),
    ...(account !== undefined ? { account } : {}),
  };
}

export function createFirestorePlayerSignin(db: FirestorePlayerSigninLike, collections: { requests?: string; sessions?: string; once?: string } = {}): PlayerSigninStore {
  const requestsCol = () => db.collection(collections.requests ?? "signin_requests");
  const sessionsCol = () => db.collection(collections.sessions ?? "sessions");
  const onceCol = () => db.collection(collections.once ?? "signin_once");

  const sessionData = (s: SessionRecord) => ({ address: s.address, createdAt: s.createdAt, expiresAt: s.expiresAt, via: s.via, scope: "play", deleteAt: new Date(s.expiresAt) });

  const stores = new Map<Way, RequestStoreLike>();
  for (const way of WAYS) {
    stores.set(way, {
      async create(key, r) {
        const ref = requestsCol().doc(key);
        await db.runTransaction(async (tx) => {
          if ((await tx.get(ref)).exists) throw new Error("a request with this key exists");
          tx.set(ref, {
            id: r.id,
            way,
            starter: r.starter,
            status: "waiting",
            expiresAt: r.expiresAt,
            ...(r.nonce !== undefined ? { nonce: r.nonce } : {}),
            ...(r.issuedAt !== undefined ? { issuedAt: r.issuedAt } : {}),
            ...(r.label !== undefined ? { label: r.label } : {}),
            delivered: false,
            scope: "play",
            deleteAt: new Date(r.expiresAt + DAY),
          });
        });
      },
      async get(key) {
        return requestOf((await requestsCol().doc(key).get()).data(), key, way);
      },
      async find(id) {
        for (const d of (await requestsCol().where("id", "==", id).limit(10).get()).docs) {
          const request = requestOf(d.data(), d.id, way);
          if (request) return { key: d.id, request };
        }
        return null;
      },
      async finish(key, account) {
        const ref = requestsCol().doc(key);
        return db.runTransaction(async (tx) => {
          const cur = requestOf((await tx.get(ref)).data(), key, way);
          if (!cur || cur.status !== "waiting") return false;
          tx.set(ref, { status: "signedin", account }, { merge: true });
          return true;
        });
      },
    });
  }

  async function deleteAll(docs: { ref: PlayerSigninDocRef }[]): Promise<number> {
    for (let i = 0; i < docs.length; i += BATCH) {
      const b = db.batch();
      for (const d of docs.slice(i, i + BATCH)) b.delete(d.ref);
      await b.commit();
    }
    return docs.length;
  }

  return {
    requests: (way) => {
      const s = stores.get(way);
      if (!s) throw new Error(`no such way: ${String(way)}`);
      return s;
    },
    async deliver(way, key, session) {
      const ref = requestsCol().doc(key);
      const sref = sessionsCol().doc(session.idHash);
      return db.runTransaction(async (tx) => {
        const raw = (await tx.get(ref)).data();
        const cur = requestOf(raw, key, way);
        await tx.get(sref);
        if (!cur || cur.status !== "signedin" || raw?.delivered === true) return false;
        tx.set(ref, { delivered: true }, { merge: true });
        tx.set(sref, sessionData(session));
        return true;
      });
    },
    async createSession(session) {
      const ref = sessionsCol().doc(session.idHash);
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) throw new Error("a session with this id exists");
        tx.set(ref, sessionData(session));
      });
    },
    async session(idHash, now) {
      const d = (await sessionsCol().doc(idHash).get()).data();
      if (!d || d.scope !== "play" || typeof d.address !== "string") return null;
      const expiresAt = num(d.expiresAt);
      if (expiresAt === undefined || expiresAt <= now) return null;
      return { idHash, address: d.address, createdAt: num(d.createdAt) ?? 0, expiresAt, via: d.via as SessionRecord["via"] };
    },
    async endSession(idHash) {
      const ref = sessionsCol().doc(idHash);
      await db.runTransaction(async (tx) => {
        const d = (await tx.get(ref)).data();
        if (d && d.scope === "play") tx.delete(ref);
      });
    },
    async useOnce(key, ttlMs, address) {
      const ref = onceCol().doc(key);
      return db.runTransaction(async (tx) => {
        const now = Date.now();
        const d = (await tx.get(ref)).data();
        if (d && (num(d.until) ?? Infinity) > now) return false;
        tx.set(ref, { address, until: now + ttlMs, deleteAt: new Date(now + ttlMs) });
        return true;
      });
    },
    async forget(address) {
      const sessions = (await sessionsCol().where("address", "==", address).get()).docs.filter((d) => d.data().scope === "play");
      const requests = (await requestsCol().where("account", "==", address).get()).docs.filter((d) => d.data().scope === "play");
      const once = (await onceCol().where("address", "==", address).get()).docs;
      return deleteAll([...sessions, ...requests, ...once]);
    },
    async clean(now) {
      const old = (await requestsCol().where("expiresAt", "<", now - 2 * 3_600_000).limit(BATCH).get()).docs.filter((d) => d.data().scope === "play");
      const ended = (await sessionsCol().where("expiresAt", "<=", now).limit(BATCH).get()).docs.filter((d) => d.data().scope === "play");
      const used = (await onceCol().where("until", "<=", now).limit(BATCH).get()).docs;
      await deleteAll([...old, ...ended, ...used]);
    },
  };
}
