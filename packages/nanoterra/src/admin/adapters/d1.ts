// The admin store for a game on Cloudflare D1, with the tables of the game starter (migrations/0001_init.sql): `meta`, `orders` and `owned`.
// It writes ONLY the two settings (`setting:character`, `setting:signin` in `meta`); everything else it does is a read.
//
//   import { createD1Store } from "@nano133/nanoterra/admin/d1";
//   const store = createD1Store(env.DB);

import { ORDERS_SHOWN, moneyOf, parseRate, shapeOrders, shapePlayers, type OrderRow } from "../summary.js";
import type { AdminStore, StoreSummary } from "../store.js";
import type { GamePatch } from "../switches.js";

/** The part of D1 that the adapter uses. Cloudflare's `D1Database` fits it. */
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}

export const D1_KEYS = { character: "setting:character", signin: "setting:signin" } as const;

type Row = { id: string; player: string; look_id: string; usd: string; amount: string; status: string; created_at: number; expires_at: number; paid_at: number | null; payer: string | null; hash: string | null };

export function createD1Store(db: D1Like): AdminStore {
  return {
    async readSettings() {
      const rows = (await db.prepare("SELECT key, value FROM meta WHERE key IN (?, ?)").bind(D1_KEYS.character, D1_KEYS.signin).all<{ key: string; value: string }>()).results;
      const row = (key: string) => rows.find((r) => r.key === key)?.value;
      return { character: row(D1_KEYS.character), signin: row(D1_KEYS.signin) };
    },

    async saveSettings(patch: GamePatch, now: number) {
      const write = (key: string, value: string) =>
        db.prepare("INSERT INTO meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = excluded.at").bind(key, value, now);
      const batch = [];
      if (patch.character) batch.push(write(D1_KEYS.character, patch.character));
      if (patch.signin) batch.push(write(D1_KEYS.signin, patch.signin));
      if (batch.length) await db.batch(batch);
    },

    async summary(now: number): Promise<StoreSummary> {
      // The game starter's own queries: the counts and the totals are over ALL orders, the list is the newest ORDERS_SHOWN.
      const orders = (
        await db
          .prepare("SELECT id, player, look_id, usd, amount, status, created_at, expires_at, paid_at, payer, hash FROM orders ORDER BY created_at DESC LIMIT ?")
          .bind(ORDERS_SHOWN)
          .all<Row>()
      ).results;
      const owned = (await db.prepare("SELECT player, look_id, granted_at FROM owned ORDER BY player, granted_at").all<{ player: string; look_id: string; granted_at: number }>()).results;
      const sums = (await db.prepare("SELECT status, amount, usd FROM orders WHERE status IN ('paid', 'paid_late')").all<{ status: string; amount: string; usd: string }>()).results;
      const grouped = (await db.prepare("SELECT status, expires_at < ? AS past, COUNT(*) AS n FROM orders GROUP BY status, past").bind(now).all<{ status: string; past: number; n: number }>()).results;
      const rate = await db.prepare("SELECT value, at FROM meta WHERE key = 'rate'").first<{ value: string; at: number }>();

      const counts = { open: 0, paid: 0, expired: 0, paid_late: 0 };
      for (const c of grouped) {
        const key = c.status === "open" && c.past ? "expired" : c.status;
        if (Object.hasOwn(counts, key)) counts[key as keyof typeof counts] += c.n;
      }
      const money = (status: string) => moneyOf(sums.filter((s) => s.status === status).map((s) => ({ amountRaw: s.amount, usd: s.usd })));
      const rows: OrderRow[] = orders.map((o) => ({ id: o.id, player: o.player, lookId: o.look_id, usd: o.usd, amountRaw: o.amount, status: o.status, createdAt: o.created_at, expiresAt: o.expires_at, paidAt: o.paid_at, payer: o.payer, hash: o.hash }));
      return {
        counts,
        totals: { paid: money("paid"), paidLate: money("paid_late") },
        orders: shapeOrders(rows, now),
        players: shapePlayers(owned.map((o) => ({ player: o.player, lookId: o.look_id, at: o.granted_at }))),
        rate: parseRate(rate?.value, rate?.at),
      };
    },
  };
}
