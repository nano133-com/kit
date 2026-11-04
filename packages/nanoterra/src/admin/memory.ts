// A store in memory, for tests (and for a game's first try). Nothing is kept after the process ends. It builds its summary with the same code as the
// real adapters (./summary.ts), so it is the reference for what a summary says.

import { summarize, type OrderRow } from "./summary.js";
import { SETTING_KEYS, settingRows, type AdminLogin, type AdminStore, type SettingName, type StoredSettings, type StoreSummary } from "./store.js";
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
  /** Admin sign-in requests started and not delivered, and the game's own: "sign out everywhere" ends the first and leaves the second. */
  pendingAdminRequests: number;
  pendingGameRequests: number;
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
    pendingAdminRequests: 0,
    pendingGameRequests: 0,
    async readSettings() {
      const out: StoredSettings = {};
      for (const [name, key] of Object.entries(SETTING_KEYS) as [SettingName, string][]) if (store.rows.has(key)) out[name] = store.rows.get(key);
      return out;
    },
    async saveSettings(patch: GamePatch, now: number) {
      for (const [name, value] of settingRows(patch, now)) store.rows.set(SETTING_KEYS[name], value);
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
      store.pendingAdminRequests = 0;
      return n;
    };
  }
  return store;
}
