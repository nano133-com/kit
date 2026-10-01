import type { Checkout, CheckoutStore } from "./types.js";

/** A store in this process's memory: for tests and demos only (it forgets everything on restart). */
export function memoryStore() {
  const checkouts = new Map<string, Checkout>();
  const locks = new Map<string, number>();
  const used = new Map<string, string>();
  const store: CheckoutStore & { checkouts: typeof checkouts; locks: typeof locks; used: typeof used } = {
    checkouts,
    locks,
    used,
    async create(c, lockUntil) {
      if ((locks.get(c.amount) ?? 0) > c.createdAt) return false;
      locks.set(c.amount, lockUntil);
      checkouts.set(c.id, structuredClone(c));
      return true;
    },
    async get(id) {
      const c = checkouts.get(id);
      return c ? structuredClone(c) : null;
    },
    async markPaid(id, hash, payer, at) {
      const H = hash.toUpperCase();
      const c = checkouts.get(id);
      if (used.has(H) && used.get(H) !== id) return "used";
      if (!c || c.status !== "waiting") return "taken";
      used.set(H, id);
      Object.assign(c, { status: "paid", hash: H, payer, paidAt: at });
      return "paid";
    },
    async isUsed(hash) {
      return used.has(hash.toUpperCase());
    },
    async claimable(amount, now) {
      return [...checkouts.values()].some((c) => c.status === "waiting" && c.amount === amount && c.expiresAt + c.graceMs > now);
    },
  };
  return store;
}
