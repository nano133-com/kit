// A store in memory, for tests (and for a game's first try). Nothing is kept after the process ends.

import type { AdminOrder, AdminStore, StoreSummary } from "./store.js";
import type { GamePatch } from "./switches.js";

export type MemoryStore = AdminStore & {
  /** The rows as an adapter would keep them. */
  readonly rows: Map<string, string>;
  /** How many writes were made. */
  writes: number;
  orders: Omit<AdminOrder, "look">[];
  owned: { player: string; lookId: string; at: number }[];
};

export function createMemoryStore(seed: { orders?: Omit<AdminOrder, "look">[]; owned?: { player: string; lookId: string; at: number }[] } = {}): MemoryStore {
  const store: MemoryStore = {
    rows: new Map(),
    writes: 0,
    orders: seed.orders ?? [],
    owned: seed.owned ?? [],
    async readSettings() {
      return { character: store.rows.get("setting:character"), signin: store.rows.get("setting:signin") };
    },
    async saveSettings(patch: GamePatch) {
      if (patch.character) store.rows.set("setting:character", patch.character);
      if (patch.signin) store.rows.set("setting:signin", patch.signin);
      store.writes++;
    },
    async summary(now: number): Promise<StoreSummary> {
      const counts = { open: 0, paid: 0, expired: 0, paid_late: 0 };
      const total = (status: string) => {
        let cents = 0;
        let xno = 0;
        let count = 0;
        for (const o of store.orders) {
          if (o.status !== status) continue;
          cents += Math.round(Number(o.usd) * 100);
          xno += Number(o.xno);
          count++;
        }
        return { count, xno: String(xno), usd: (cents / 100).toFixed(2) };
      };
      for (const o of store.orders) {
        const key = o.status === "open" && o.expiresAt < now ? "expired" : o.status;
        if (key in counts) counts[key as keyof typeof counts]++;
      }
      const players = new Map<string, { player: string; looks: { id: string; at: number }[] }>();
      for (const o of store.owned) {
        const p = players.get(o.player) ?? { player: o.player, looks: [] };
        p.looks.push({ id: o.lookId, at: o.at });
        players.set(o.player, p);
      }
      return { counts, totals: { paid: total("paid"), paidLate: total("paid_late") }, orders: store.orders.slice(0, 500), players: [...players.values()], rate: null };
    },
  };
  return store;
}
