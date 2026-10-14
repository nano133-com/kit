import type { UseOnce } from "./signature.js";
import type { RequestStore, WalletRequest } from "./requests.js";

// Stores in this process's memory: for tests and demos only. A site uses a database (./firestore, or its own).

/** A UseOnce in memory. `rows` holds each key's account and expiry. */
export function memoryOnce(): UseOnce & { rows: Map<string, { address: string; until: number }> } {
  const rows = new Map<string, { address: string; until: number }>();
  const use = (async (key: string, ttlMs: number, address: string) => {
    const now = Date.now();
    if ((rows.get(key)?.until ?? 0) > now) return false;
    rows.set(key, { address, until: now + ttlMs });
    return true;
  }) as UseOnce & { rows: typeof rows };
  use.rows = rows;
  return use;
}

/** A RequestStore in memory. */
export function memoryRequests(): RequestStore & { rows: Map<string, WalletRequest> } {
  const rows = new Map<string, WalletRequest>();
  return {
    rows,
    async create(key, r) {
      if (rows.has(key)) throw new Error("a request with this key exists");
      rows.set(key, structuredClone(r));
    },
    async get(key) {
      const r = rows.get(key);
      return r ? structuredClone(r) : null;
    },
    async find(id) {
      for (const [key, r] of rows) if (r.id === id) return { key, request: structuredClone(r) };
      return null;
    },
    async finish(key, account) {
      const r = rows.get(key);
      if (!r || r.status !== "waiting") return false;
      Object.assign(r, { status: "signedin", account });
      return true;
    },
  };
}
