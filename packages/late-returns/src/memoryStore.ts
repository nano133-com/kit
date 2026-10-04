import { randomUUID } from "node:crypto";
import { LockLost, type Lock, type RecordResult, type ReturnRecord, type ReturnStore, type StoreWriter } from "./types.js";

/**
 * A store in this process's memory: for tests, and for a single-process site
 * that can afford to lose its records on restart (it can't: use a database in
 * production). `used` is the set of payment hashes your checkouts claimed.
 */
export function memoryStore(used: Set<string> = new Set()) {
  const returns = new Map<string, ReturnRecord>();
  const days = new Map<string, number>();
  /** Returns per sender per day (key: senderKey()). */
  const senders = new Map<string, number>();
  let held: { owner: string; until: number } | null = null;

  const store: ReturnStore & { returns: Map<string, ReturnRecord>; used: Set<string>; days: Map<string, number>; senders: Map<string, number>; expireLock: () => void } = {
    returns,
    used,
    days,
    senders,
    senderLimit: true,
    /** Tests only: makes the current lock expire now. */
    expireLock: () => {
      if (held) held.until = 0;
    },
    async isUsed(hash) {
      return used.has(hash.toUpperCase());
    },
    async record(r, day, sender): Promise<RecordResult> {
      const hash = r.hash.toUpperCase();
      if (returns.has(hash)) return "exists";
      if (used.has(hash)) return "used";
      const s = sender ? (senders.get(sender.key) ?? 0) : 0;
      if (sender && s >= sender.max) {
        used.add(hash);
        returns.set(hash, { ...r, hash, status: "kept", reason: "limit", day: day.key, createdAt: Date.now() });
        return "kept";
      }
      const n = days.get(day.key) ?? 0;
      if (n >= day.max) return "limit";
      used.add(hash);
      returns.set(hash, { ...r, hash, status: "pending", createdAt: Date.now() });
      days.set(day.key, n + 1);
      if (sender) senders.set(sender.key, s + 1);
      return "created";
    },
    async release(hash, to, by) {
      const r = returns.get(hash.toUpperCase());
      if (!r) return "missing";
      if (r.status !== "kept") return "not-kept";
      Object.assign(r, { status: "pending", to, releasedBy: by, releasedAt: Date.now() });
      return "released";
    },
    async get(hash) {
      const r = returns.get(hash.toUpperCase());
      return r ? structuredClone(r) : null;
    },
    async pending(limit) {
      return [...returns.values()].filter((r) => r.status === "pending").slice(0, limit).map((r) => structuredClone(r));
    },
    lock(ttlMs): Lock & StoreWriter {
      const owner = randomUUID();
      const fence = () => {
        if (held?.owner !== owner || held.until <= Date.now()) throw new LockLost();
      };
      return {
        async take() {
          if (held && held.until > Date.now()) return false;
          held = { owner, until: Date.now() + ttlMs };
          return true;
        },
        async renew() {
          fence();
          held!.until = Date.now() + ttlMs;
        },
        async release() {
          if (held?.owner === owner) held = null;
        },
        async update(hash, patch) {
          fence();
          const r = returns.get(hash.toUpperCase());
          if (r) Object.assign(r, structuredClone(patch));
          held!.until = Date.now() + ttlMs;
        },
      };
    },
  };
  return store;
}
