// A store in memory, for tests (and for a game's first try). Nothing is kept after the process ends. It builds its summary with the same code as the
// real adapters (./summary.ts), so it is the reference for what a summary says.

import { summarize, type OrderRow } from "./summary.js";
import type { AdminLogin, AdminStore, StoreSummary } from "./store.js";
import type { GamePatch } from "./switches.js";

export type MemoryStore = AdminStore & {
  /** The rows as an adapter would keep them in its meta table. */
  readonly rows: Map<string, string>;
  /** How many writes were made. */
  writes: number;
  orders: OrderRow[];
  owned: { player: string; lookId: string; at: number }[];
  rate: StoreSummary["rate"];
  /** The admin sign-ins and the count of admin sessions, when the store was made with `logins: true`. */
  logins: (AdminLogin & Record<string, unknown>)[];
  adminSessions: number;
  playSessions: number;
};

export function createMemoryStore(seed: { orders?: OrderRow[]; owned?: { player: string; lookId: string; at: number }[]; rate?: StoreSummary["rate"]; logins?: boolean } = {}): MemoryStore {
  const store: MemoryStore = {
    rows: new Map(),
    writes: 0,
    orders: seed.orders ?? [],
    owned: seed.owned ?? [],
    rate: seed.rate ?? null,
    logins: [],
    adminSessions: 0,
    playSessions: 0,
    async readSettings() {
      return { character: store.rows.get("setting:character"), signin: store.rows.get("setting:signin") };
    },
    async saveSettings(patch: GamePatch) {
      if (patch.character) store.rows.set("setting:character", patch.character);
      if (patch.signin) store.rows.set("setting:signin", patch.signin);
      store.writes++;
    },
    async summary(now: number): Promise<StoreSummary> {
      return summarize(store.orders, store.owned, store.rate, now);
    },
  };
  if (seed.logins) {
    store.recentLogins = async (limit: number) => [...store.logins].sort((a, b) => b.at - a.at).slice(0, limit);
    store.signOutEverywhere = async () => {
      const n = store.adminSessions;
      store.adminSessions = 0;
      return n;
    };
  }
  return store;
}
