// The admin sign-in's store in this process's memory: for tests and demos. A game uses a database (./adapters/d1.ts, ./adapters/firestore.ts, or its
// own store that passes adminSigninStoreConformance).

import type { AdminLogin } from "../admin/store.js";
import { ADMIN_LOGIN_KEEP_MS, ADMIN_PASSKEY_LIMIT, ADMIN_WAYS, type AdminPasskey, type AdminSessionRecord, type AdminSigninStore, type AdminWay, type RequestStoreLike, type SigninRequest } from "./types.js";

type RequestRow = SigninRequest & { way: AdminWay; delivered: boolean };

export type MemoryAdminSignin = Required<AdminSigninStore> & {
  readonly requestRows: Map<string, RequestRow>;
  readonly sessionRows: Map<string, AdminSessionRecord>;
  readonly loginRows: AdminLogin[];
  /** The owner's passkeys: owner → the links, oldest first. */
  readonly passkeyRows: Map<string, AdminPasskey[]>;
  /** The used passkey signatures: key → until (ms). */
  readonly onceRows: Map<string, number>;
};

const copy = <T>(v: T): T => structuredClone(v);

export function createMemoryAdminSignin(): MemoryAdminSignin {
  const requestRows = new Map<string, RequestRow>();
  const sessionRows = new Map<string, AdminSessionRecord>();
  const loginRows: AdminLogin[] = [];
  const passkeyRows = new Map<string, AdminPasskey[]>();
  const onceRows = new Map<string, number>();
  const strip = ({ way: _way, delivered: _delivered, ...r }: RequestRow): SigninRequest => copy(r);

  const stores = new Map<AdminWay, RequestStoreLike>();
  for (const way of ADMIN_WAYS) {
    stores.set(way, {
      async create(key, r) {
        if (requestRows.has(key)) throw new Error("a request with this key exists");
        requestRows.set(key, { ...copy(r), way, delivered: false });
      },
      async get(key) {
        const r = requestRows.get(key);
        return r && r.way === way ? strip(r) : null;
      },
      async find(id) {
        for (const [key, r] of requestRows) if (r.way === way && r.id === id) return { key, request: strip(r) };
        return null;
      },
      async finish(key, account) {
        const r = requestRows.get(key);
        if (!r || r.way !== way || r.status !== "waiting") return false;
        r.status = "signedin";
        r.account = account;
        return true;
      },
    });
  }

  return {
    requestRows,
    sessionRows,
    loginRows,
    passkeyRows,
    onceRows,
    requests: (way) => {
      const s = stores.get(way);
      if (!s) throw new Error(`no such way: ${String(way)}`);
      return s;
    },
    async deliver(way, key, session) {
      const r = requestRows.get(key);
      if (!r || r.way !== way || r.status !== "signedin" || r.delivered) return false;
      r.delivered = true;
      sessionRows.set(session.idHash, copy(session));
      return true;
    },
    async session(idHash, now) {
      const s = sessionRows.get(idHash);
      return s && s.expiresAt > now ? copy(s) : null;
    },
    async endSession(idHash) {
      sessionRows.delete(idHash);
    },
    async signOutEverywhere() {
      const n = sessionRows.size;
      sessionRows.clear();
      for (const r of requestRows.values()) {
        if (r.delivered) continue;
        r.delivered = true;
        r.expiresAt = 0;
      }
      return n;
    },
    async recordLogin(login) {
      for (let i = loginRows.length - 1; i >= 0; i--) if (loginRows[i].at < login.at - ADMIN_LOGIN_KEEP_MS) loginRows.splice(i, 1);
      loginRows.push({ at: login.at, country: login.country, browser: login.browser });
    },
    async recentLogins(limit) {
      const n = Math.min(Math.max(Math.floor(Number(limit)) || 0, 0), 50);
      // Newest first; of two at the same time, the one written last.
      return loginRows
        .map((l, i) => ({ l, i }))
        .sort((a, b) => b.l.at - a.l.at || b.i - a.i)
        .slice(0, n)
        .map(({ l }) => ({ at: l.at, country: l.country, browser: l.browser }));
    },
    async clean(now) {
      for (const [k, r] of requestRows) if (r.expiresAt < now - 2 * 3_600_000) requestRows.delete(k);
      for (const [k, s] of sessionRows) if (s.expiresAt < now) sessionRows.delete(k);
      for (let i = loginRows.length - 1; i >= 0; i--) if (loginRows[i].at < now - ADMIN_LOGIN_KEEP_MS) loginRows.splice(i, 1);
      for (const [k, until] of onceRows) if (until <= now) onceRows.delete(k);
    },
    async createSession(session) {
      if (sessionRows.has(session.idHash)) throw new Error("a session with this id exists");
      sessionRows.set(session.idHash, copy(session));
    },
    async linkPasskey(owner, address, at) {
      const list = passkeyRows.get(owner) ?? [];
      if (list.some((p) => p.address === address)) return "exists";
      if (list.length >= ADMIN_PASSKEY_LIMIT) return "full";
      passkeyRows.set(owner, [...list, { address, createdAt: at }]);
      return "linked";
    },
    async unlinkPasskey(owner, address) {
      const list = passkeyRows.get(owner) ?? [];
      const had = list.some((p) => p.address === address);
      if (had) passkeyRows.set(owner, list.filter((p) => p.address !== address));
      // The passkey's admin sessions end with its link.
      for (const [k, s] of sessionRows) if (s.via === "passkey" && s.address === address) sessionRows.delete(k);
      return had;
    },
    async passkeys(owner) {
      return copy(passkeyRows.get(owner) ?? []);
    },
    async linked(owner, address) {
      return (passkeyRows.get(owner) ?? []).some((p) => p.address === address);
    },
    async useOnce(key, ttlMs) {
      const now = Date.now();
      const until = onceRows.get(key);
      if (until !== undefined && until > now) return false;
      onceRows.set(key, now + ttlMs);
      return true;
    },
  };
}
