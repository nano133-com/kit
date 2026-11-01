// The player sign-in's store in this process's memory: for tests and demos. A game uses a database (./adapters/d1.ts, ./adapters/firestore.ts, or
// its own store that passes playerSigninStoreConformance).

import { WAYS, type PlayerSigninStore, type RequestStoreLike, type SessionRecord, type SigninRequest, type Way } from "./types.js";

type RequestRow = SigninRequest & { way: Way; delivered: boolean };

export type MemoryPlayerSignin = PlayerSigninStore & {
  readonly requestRows: Map<string, RequestRow>;
  readonly sessionRows: Map<string, SessionRecord>;
  readonly onceRows: Map<string, { address: string; until: number }>;
};

const copy = <T>(v: T): T => structuredClone(v);

export function createMemoryPlayerSignin(): MemoryPlayerSignin {
  const requestRows = new Map<string, RequestRow>();
  const sessionRows = new Map<string, SessionRecord>();
  const onceRows = new Map<string, { address: string; until: number }>();
  const strip = ({ way: _way, delivered: _delivered, ...r }: RequestRow): SigninRequest => copy(r);

  const stores = new Map<Way, RequestStoreLike>();
  for (const way of WAYS) {
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
    async createSession(session) {
      if (sessionRows.has(session.idHash)) throw new Error("a session with this id exists");
      sessionRows.set(session.idHash, copy(session));
    },
    async session(idHash, now) {
      const s = sessionRows.get(idHash);
      return s && s.expiresAt > now ? copy(s) : null;
    },
    async endSession(idHash) {
      sessionRows.delete(idHash);
    },
    async useOnce(key, ttlMs, address) {
      const now = Date.now();
      const had = onceRows.get(key);
      if (had && had.until > now) return false;
      onceRows.set(key, { address, until: now + ttlMs });
      return true;
    },
    async forget(address) {
      let n = 0;
      for (const [k, s] of sessionRows) if (s.address === address && sessionRows.delete(k)) n++;
      for (const [k, r] of requestRows) if (r.account === address && requestRows.delete(k)) n++;
      for (const [k, o] of onceRows) if (o.address === address && onceRows.delete(k)) n++;
      return n;
    },
    async clean(now) {
      for (const [k, r] of requestRows) if (r.expiresAt < now - 2 * 3_600_000) requestRows.delete(k);
      for (const [k, s] of sessionRows) if (s.expiresAt <= now) sessionRows.delete(k);
      for (const [k, o] of onceRows) if (o.until <= now) onceRows.delete(k);
    },
  };
}
