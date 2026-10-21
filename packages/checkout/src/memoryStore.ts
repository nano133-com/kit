import { SweepLeaseLost, type Checkout, type DerivedStore } from "./types.js";

const nano = (a: string) => a.replace(/^xrb_/, "nano_");

/** A store in this process's memory: for tests and demos only (it forgets everything on restart). */
export function memoryStore() {
  const checkouts = new Map<string, Checkout>();
  const locks = new Map<string, number>();
  const used = new Map<string, string>();
  /** Derived-address mode's counter: the next index to give. */
  const index = { next: 0 };
  /** The checkout, when its sweep lease is held by `owner` right now; else throws. */
  const held = (id: string, owner: string, now: number) => {
    const c = checkouts.get(id);
    const lease = c?.sweep?.lease;
    if (!c || !c.sweep || !lease || lease.owner !== owner || lease.until <= now) throw new SweepLeaseLost();
    return c as Checkout & { sweep: NonNullable<Checkout["sweep"]> };
  };
  const store: DerivedStore & { checkouts: typeof checkouts; locks: typeof locks; used: typeof used; index: typeof index } = {
    checkouts,
    locks,
    used,
    index,
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
      Object.assign(c, { status: "paid", hash: H, payer, paidAt: at, ...(c.index !== undefined ? { sweep: { status: "due" as const } } : {}) });
      return "paid";
    },
    async isUsed(hash) {
      return used.has(hash.toUpperCase());
    },
    async claimable(amount, now) {
      // A derived checkout is claimed by its own address, never by its amount alone (derivedReturns().isClaimable).
      return [...checkouts.values()].some((c) => c.index === undefined && c.status === "waiting" && c.amount === amount && c.expiresAt + c.graceMs > now);
    },
    async takeIndex(cap) {
      const n = index.next;
      if (!Number.isInteger(n) || n < 0) throw new Error("the index counter is not a whole number");
      if (n >= cap) throw new Error(`the index counter reached the cap of ${cap}`);
      index.next = n + 1;
      return n;
    },
    async createDerived(c) {
      if (c.index === undefined) throw new Error("a derived checkout needs an index");
      if (checkouts.has(c.id) || [...checkouts.values()].some((x) => nano(x.to) === nano(c.to))) return false;
      checkouts.set(c.id, structuredClone(c));
      return true;
    },
    async byAddress(address) {
      const c = [...checkouts.values()].find((x) => x.index !== undefined && nano(x.to) === nano(address));
      return c ? structuredClone(c) : null;
    },
    async derivedAddresses(now, limit) {
      return [...checkouts.values()]
        .filter((c) => c.index !== undefined && (c.scanUntil ?? 0) > now)
        .sort((a, b) => (b.scanUntil ?? 0) - (a.scanUntil ?? 0))
        .slice(0, limit)
        .map((c) => c.to);
    },
    async unswept(limit) {
      return [...checkouts.values()]
        .filter((c) => c.index !== undefined && c.sweep?.status === "due")
        .slice(0, limit)
        .map((c) => structuredClone(c));
    },
    async claimSweep(id, owner, now, leaseMs) {
      const c = checkouts.get(id);
      if (!c || c.index === undefined || c.status !== "paid" || c.sweep?.status !== "due") return false;
      const lease = c.sweep.lease;
      if (lease && lease.until > now && lease.owner !== owner) return false;
      c.sweep.lease = { owner, until: now + leaseMs };
      return true;
    },
    async patchSweep(id, owner, patch, now, leaseMs) {
      const c = held(id, owner, now);
      Object.assign(c.sweep, structuredClone(patch));
      c.sweep.lease = { owner, until: now + leaseMs };
    },
    async finishSweep(id, owner, hash, now) {
      const c = held(id, owner, now);
      Object.assign(c.sweep, { status: "done", hash: hash.toUpperCase(), error: null, lease: null });
      used.set(hash.toUpperCase(), `sweep:${id}`);
    },
    async releaseSweep(id, owner) {
      const c = checkouts.get(id);
      if (c?.sweep?.lease?.owner === owner) c.sweep.lease = null;
    },
  };
  return store;
}
