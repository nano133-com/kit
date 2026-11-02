// The admin sign-in's store for a game on Firestore (the Admin SDK). The package has no Firebase dependency: the adapter uses the small interface
// below, which the Admin SDK's `Firestore` fits. It reads and writes ONLY its three collections, and only the admin's documents (scope "admin") of the
// first two: the player sign-in's Firestore adapter keeps its own (scope "play") in the same collections.
//
//   import { createFirestoreAdminSignin } from "@nano133/nanoterra/admin-signin/firestore";
//   const store = createFirestoreAdminSignin(getFirestore());
//
// The data model (the three collection names can be changed):
//   signin_requests/{key}   { id, way, starter, status, expiresAt, nonce?, issuedAt?, label?, account?, delivered, scope: "admin", deleteAt }
//   sessions/{idHash}       { address, createdAt, expiresAt, via, scope: "admin", deleteAt }
//   admin_logins/{id}       { at, country, browser, deleteAt }
//   admin_passkeys/{owner}  { owner, passkeys: [{ address, createdAt }] }      (since 0.12.0: the owner's linked passkeys, at most 10; no deleteAt)
//   admin_once/{key}        { until, deleteAt }                                (since 0.12.0: the passkeys' used signatures)
// Times are ms numbers; `deleteAt` is a Date (a Timestamp in Firestore): set a TTL policy on `deleteAt` for each collection that has it. `{key}` is the
// request's id; `{idHash}` the SHA-256 of "admin:" and the session's token. Every change that reads first is a transaction (the owner's passkeys are ONE
// document, so a link holds the limit in its transaction). Indexes: Firestore's own single-field indexes are enough (`id`, `scope`, `expiresAt`, `at`,
// `address`, `until`).
//
// The admin store for Firestore (`createFirestoreStore`) has no sign-in list and no "Sign out everywhere": give it this sign-in's,
// `store.recentLogins = signin.recentLogins` and `store.signOutEverywhere = signin.signOutEverywhere`.

import type { AdminLogin } from "../../admin/store.js";
import { ADMIN_LOGIN_KEEP_MS, ADMIN_PASSKEY_LIMIT, ADMIN_WAYS, type AdminPasskey, type AdminSessionRecord, type AdminSigninStore, type AdminWay, type RequestStoreLike, type SigninRequest } from "../types.js";

export type AdminSigninDocSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
export interface AdminSigninDocRef {
  get(): Promise<AdminSigninDocSnap>;
}
export type AdminSigninQuerySnap = { docs: { id: string; ref: AdminSigninDocRef; data(): Record<string, unknown> }[] };
export interface AdminSigninQuery {
  where(field: string, op: "==" | "<", value: unknown): AdminSigninQuery;
  orderBy(field: string, direction?: "asc" | "desc"): AdminSigninQuery;
  limit(n: number): AdminSigninQuery;
  get(): Promise<AdminSigninQuerySnap>;
}
export interface AdminSigninCollection extends AdminSigninQuery {
  doc(id: string): AdminSigninDocRef;
}
/** A transaction: every read before the first write, as Firestore asks. */
export interface AdminSigninTransaction {
  get(ref: AdminSigninDocRef): Promise<AdminSigninDocSnap>;
  set(ref: AdminSigninDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  delete(ref: AdminSigninDocRef): unknown;
}
export interface AdminSigninBatch {
  set(ref: AdminSigninDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  delete(ref: AdminSigninDocRef): unknown;
  commit(): Promise<unknown>;
}
export interface FirestoreAdminSigninLike {
  collection(name: string): AdminSigninCollection;
  runTransaction<T>(fn: (tx: AdminSigninTransaction) => Promise<T>): Promise<T>;
  batch(): AdminSigninBatch;
}

const DAY = 86_400_000;
/** At most this many documents go in one batch (Firestore's limit is 500). */
const BATCH = 400;

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (x) => x.toString(16).padStart(2, "0")).join("");

function requestOf(d: Record<string, unknown> | undefined, key: string, way: AdminWay): SigninRequest | null {
  if (!d || d.scope !== "admin" || d.way !== way || typeof d.starter !== "string" || num(d.expiresAt) === undefined) return null;
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

/** The links a passkeys document holds: only well-formed ones. */
function linksOf(d: Record<string, unknown> | undefined): AdminPasskey[] {
  const list = Array.isArray(d?.passkeys) ? (d.passkeys as unknown[]) : [];
  return list.flatMap((p) => {
    const v = p as Record<string, unknown> | null;
    const address = text(v?.address);
    return address !== undefined ? [{ address, createdAt: num(v?.createdAt) ?? 0 }] : [];
  });
}

export type FirestoreAdminSigninCollections = { requests?: string; sessions?: string; logins?: string; passkeys?: string; once?: string };

export function createFirestoreAdminSignin(db: FirestoreAdminSigninLike, collections: FirestoreAdminSigninCollections = {}): Required<AdminSigninStore> {
  const requestsCol = () => db.collection(collections.requests ?? "signin_requests");
  const sessionsCol = () => db.collection(collections.sessions ?? "sessions");
  const loginsCol = () => db.collection(collections.logins ?? "admin_logins");
  const passkeysCol = () => db.collection(collections.passkeys ?? "admin_passkeys");
  const onceCol = () => db.collection(collections.once ?? "admin_once");

  const sessionData = (s: AdminSessionRecord) => ({ address: s.address, createdAt: s.createdAt, expiresAt: s.expiresAt, via: s.via, scope: "admin", deleteAt: new Date(s.expiresAt) });

  const stores = new Map<AdminWay, RequestStoreLike>();
  for (const way of ADMIN_WAYS) {
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
            scope: "admin",
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

  async function deleteAll(docs: { ref: AdminSigninDocRef }[]): Promise<number> {
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
    async session(idHash, now) {
      const d = (await sessionsCol().doc(idHash).get()).data();
      if (!d || d.scope !== "admin" || typeof d.address !== "string") return null;
      const expiresAt = num(d.expiresAt);
      if (expiresAt === undefined || expiresAt <= now) return null;
      return { idHash, address: d.address, createdAt: num(d.createdAt) ?? 0, expiresAt, via: String(d.via ?? "") };
    },
    async endSession(idHash) {
      const ref = sessionsCol().doc(idHash);
      await db.runTransaction(async (tx) => {
        const d = (await tx.get(ref)).data();
        if (d && d.scope === "admin") tx.delete(ref);
      });
    },
    async signOutEverywhere() {
      // The requests first, then the sessions are read: a delivery that ran before the requests were ended wrote its session already, and it goes too; a
      // delivery after it finds its request delivered (its transaction runs again on the changed document) and writes none.
      const pending = (await requestsCol().where("scope", "==", "admin").get()).docs.filter((d) => d.data().delivered !== true);
      for (let i = 0; i < pending.length; i += BATCH) {
        const b = db.batch();
        for (const d of pending.slice(i, i + BATCH)) b.set(d.ref, { delivered: true, expiresAt: 0 }, { merge: true });
        await b.commit();
      }
      return deleteAll((await sessionsCol().where("scope", "==", "admin").get()).docs);
    },
    async recordLogin(login: AdminLogin) {
      const old = (await loginsCol().where("at", "<", login.at - ADMIN_LOGIN_KEEP_MS).limit(BATCH).get()).docs;
      const b = db.batch();
      b.set(loginsCol().doc(`${String(login.at).padStart(15, "0")}-${hex(8)}`), { at: login.at, country: login.country, browser: login.browser, deleteAt: new Date(login.at + ADMIN_LOGIN_KEEP_MS) });
      for (const d of old) b.delete(d.ref);
      await b.commit();
    },
    async recentLogins(limit) {
      const n = Math.min(Math.max(Math.floor(Number(limit)) || 0, 0), 50);
      if (!n) return [];
      // Newest first; two at the same time come in the order of their ids (the time, then random letters).
      const docs = (await loginsCol().orderBy("at", "desc").limit(n).get()).docs;
      return docs.map((d) => {
        const v = d.data();
        return { at: num(v.at) ?? 0, country: text(v.country) ?? null, browser: text(v.browser) ?? "Unknown browser" };
      });
    },
    async clean(now) {
      const old = (await requestsCol().where("expiresAt", "<", now - 2 * 3_600_000).limit(BATCH).get()).docs.filter((d) => d.data().scope === "admin");
      const ended = (await sessionsCol().where("expiresAt", "<", now).limit(BATCH).get()).docs.filter((d) => d.data().scope === "admin");
      const logins = (await loginsCol().where("at", "<", now - ADMIN_LOGIN_KEEP_MS).limit(BATCH).get()).docs;
      const used = (await onceCol().where("until", "<", now + 1).limit(BATCH).get()).docs;
      await deleteAll([...old, ...ended, ...logins, ...used]);
    },
    async createSession(session) {
      const ref = sessionsCol().doc(session.idHash);
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) throw new Error("a session with this id exists");
        tx.set(ref, sessionData(session));
      });
    },
    async linkPasskey(owner, address, at) {
      const ref = passkeysCol().doc(owner);
      return db.runTransaction(async (tx) => {
        const d = (await tx.get(ref)).data();
        const list = d && d.owner === owner ? linksOf(d) : [];
        if (list.some((p) => p.address === address)) return "exists" as const;
        if (list.length >= ADMIN_PASSKEY_LIMIT) return "full" as const;
        tx.set(ref, { owner, passkeys: [...list, { address, createdAt: at }] });
        return "linked" as const;
      });
    },
    async unlinkPasskey(owner, address) {
      const ref = passkeysCol().doc(owner);
      const had = await db.runTransaction(async (tx) => {
        const d = (await tx.get(ref)).data();
        const list = d && d.owner === owner ? linksOf(d) : [];
        if (!list.some((p) => p.address === address)) return false;
        tx.set(ref, { owner, passkeys: list.filter((p) => p.address !== address) });
        return true;
      });
      // The passkey's admin sessions end with its link (after it: a session read in between finds no link and is refused anyway).
      await deleteAll((await sessionsCol().where("address", "==", address).get()).docs.filter((x) => x.data().scope === "admin" && x.data().via === "passkey"));
      return had;
    },
    async passkeys(owner) {
      const d = (await passkeysCol().doc(owner).get()).data();
      return d && d.owner === owner ? linksOf(d) : [];
    },
    async linked(owner, address) {
      const d = (await passkeysCol().doc(owner).get()).data();
      return Boolean(d && d.owner === owner && linksOf(d).some((p) => p.address === address));
    },
    async useOnce(key, ttlMs) {
      const ref = onceCol().doc(key);
      return db.runTransaction(async (tx) => {
        const now = Date.now();
        const d = (await tx.get(ref)).data();
        if (d && (num(d.until) ?? Infinity) > now) return false;
        tx.set(ref, { until: now + ttlMs, deleteAt: new Date(now + ttlMs) });
        return true;
      });
    },
  };
}
