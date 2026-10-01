import type { SigninSession, SigninStore } from "./types.js";

/** A store in this process's memory: for tests and demos only. */
export function memoryStore() {
  const sessions = new Map<string, SigninSession>();
  const locks = new Map<string, number>();
  const used = new Map<string, string>();
  const store: SigninStore & { sessions: typeof sessions; locks: typeof locks; used: typeof used } = {
    sessions,
    locks,
    used,
    async create(s, lockUntil) {
      if ((locks.get(s.amount) ?? 0) > s.startedAt) return false;
      locks.set(s.amount, lockUntil);
      sessions.set(s.id, structuredClone(s));
      return true;
    },
    async get(id) {
      const s = sessions.get(id);
      return s ? structuredClone(s) : null;
    },
    async claim(id, hash, account, at) {
      const H = hash.toUpperCase();
      const s = sessions.get(id);
      if (used.has(H) && used.get(H) !== id) return "used";
      if (!s || s.status !== "waiting") return "taken";
      used.set(H, id);
      Object.assign(s, { status: "signedin", hash: H, account, signedInAt: at });
      return "signedin";
    },
  };
  return store;
}

/** A useOnce for signature sign-ins, in memory (tests only; use a database row with a unique key in production). */
export function memoryOnce() {
  const seen = new Map<string, number>();
  return async (key: string, ttlMs: number) => {
    const now = Date.now();
    if ((seen.get(key) ?? 0) > now) return false;
    seen.set(key, now + ttlMs);
    return true;
  };
}
