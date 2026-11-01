// The shop store for a game on Cloudflare D1, on the game starter's own tables (migrations/0001_init.sql): `orders`, `owned` and `meta`. The package
// ships the same tables as "@nano133/nanoterra/shop/d1.sql" (CREATE ... IF NOT EXISTS) for a new game; the starter has them already, so it switches with
// no migration and keeps every order and owned look.
//
//   import { createD1Shop } from "@nano133/nanoterra/shop/d1";
//   const store = createD1Shop(env.DB);
//
// It reads and writes ONLY those three tables (in `meta`, only the keys "rate" and "scan"). The table names can be changed (`tables`), but the admin's
// D1 store ("@nano133/nanoterra/admin/d1") reads the starter's names: keep them unless the game has its own admin store.
//
// The money rules are in the statements themselves: `amount_lock` and `hash` are UNIQUE (no two held orders ask for one amount, one payment pays one
// order), the payment and the grant are ONE batch (a D1 transaction), and the scan's claim is one upsert that only one caller in a gap can win.

import type { D1Like } from "../../admin/adapters/d1.js";
import { parseRate } from "../../admin/summary.js";
import { paidStatus } from "../orders.js";
import { FORGOTTEN, type ForgetResult, type OrderStatus, type Settled, type ShopOrder, type ShopStore } from "../store.js";

export type { D1Like, D1StatementLike } from "../../admin/adapters/d1.js";

/** The table names. The defaults are the game starter's. (`hits` is for `d1Limit` only.) */
export type ShopTables = { orders?: string; owned?: string; meta?: string; hits?: string };

type Row = {
  id: string;
  player: string;
  look_id: string;
  usd: string;
  rate: number;
  amount: string;
  amount_lock: string | null;
  status: string;
  created_at: number;
  expires_at: number;
  hold_until: number;
  hash: string | null;
  payer: string | null;
  paid_at: number | null;
  visitor: string | null;
};

const STATUSES: readonly OrderStatus[] = ["open", "paid", "expired", "paid_late"];

const orderOf = (r: Row): ShopOrder => ({
  id: r.id,
  player: r.player,
  lookId: r.look_id,
  usd: r.usd,
  rate: Number(r.rate),
  amount: r.amount,
  amountLock: r.amount_lock ?? null,
  status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as OrderStatus) : "expired",
  createdAt: Number(r.created_at),
  expiresAt: Number(r.expires_at),
  holdUntil: Number(r.hold_until),
  hash: r.hash ?? null,
  payer: r.payer ?? null,
  paidAt: r.paid_at === null || r.paid_at === undefined ? null : Number(r.paid_at),
  visitor: r.visitor ?? null,
});

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const changes = (res: unknown): number => Number((res as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
const isUnique = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message ?? e));
/** D1 takes at most 100 bound values in one statement. */
const CHUNK = 90;

const tableName = (v: string | undefined, fallback: string): string => {
  const name = v ?? fallback;
  if (!NAME.test(name)) throw new Error(`the table name "${name}" must be plain (letters, digits and _)`);
  return name;
};

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * True while `key` has made at most `limit` calls in this fixed window, counted in D1 (the table `hits`: one count for the whole game, every location).
 * The game starter's `d1Limit`. Old windows stay until the game deletes them (the starter's cron deletes those older than a day).
 */
export async function d1Limit(db: D1Like, key: string, limit: number, windowMs: number, now = Date.now(), tables: Pick<ShopTables, "hits"> = {}): Promise<boolean> {
  const hits = tableName(tables.hits, "hits");
  const win = Math.floor(now / windowMs);
  const row = await db.prepare(`INSERT INTO ${hits} (key, win, count) VALUES (?, ?, 1) ON CONFLICT (key, win) DO UPDATE SET count = count + 1 RETURNING count`).bind(key, win).first<{ count: number }>();
  return Number(row?.count ?? 1) <= limit;
}

/** The visitor's IP address as Cloudflare saw it (CF-Connecting-IP); an IPv6 address by its /64 (one home network). "local" when there is none. */
export function visitorIp(req: Request): string {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}

/**
 * The visitor's key: a hash of a random salt (made once per game and kept in `meta` as "salt") and the IP address, never the address itself. The game
 * starter's `visitorKey`: the same salt row, so the keys stay the same after a switch.
 */
export async function visitorKey(db: D1Like, req: Request, tables: Pick<ShopTables, "meta"> = {}): Promise<string> {
  const meta = tableName(tables.meta, "meta");
  let row = await db.prepare(`SELECT value FROM ${meta} WHERE key = 'salt'`).first<{ value: string }>();
  if (!row) {
    const fresh = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
    await db.prepare(`INSERT OR IGNORE INTO ${meta} (key, value, at) VALUES ('salt', ?, ?)`).bind(fresh, Date.now()).run();
    row = await db.prepare(`SELECT value FROM ${meta} WHERE key = 'salt'`).first<{ value: string }>();
  }
  return (await sha256Hex(`${row!.value}|${visitorIp(req)}`)).slice(0, 32);
}

export function createD1Shop(db: D1Like, options: { tables?: ShopTables } = {}): ShopStore {
  const T = { orders: tableName(options.tables?.orders, "orders"), owned: tableName(options.tables?.owned, "owned"), meta: tableName(options.tables?.meta, "meta") };
  const COLS = "id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, hash, payer, paid_at, visitor";

  async function inChunks(sql: (marks: string) => string, values: readonly string[], col: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < values.length; i += CHUNK) {
      const part = values.slice(i, i + CHUNK);
      const rows = (await db.prepare(sql(part.map(() => "?").join(", "))).bind(...part).all<Record<string, string>>()).results;
      for (const r of rows) out.add(r[col]);
    }
    return out;
  }

  const tidy = async (now: number) => {
    await db.batch([
      db.prepare(`UPDATE ${T.orders} SET status = 'expired' WHERE status = 'open' AND expires_at < ?`).bind(now),
      db.prepare(`UPDATE ${T.orders} SET amount_lock = NULL WHERE amount_lock IS NOT NULL AND hold_until < ?`).bind(now),
    ]);
  };

  const waiting = async (player: string) =>
    db.prepare(`SELECT COUNT(*) AS n, MAX(hold_until) AS until FROM ${T.orders} WHERE player = ? AND amount_lock IS NOT NULL`).bind(player).first<{ n: number; until: number | null }>();

  return {
    tidy,

    heldAmounts: (amounts) => inChunks((m) => `SELECT amount_lock FROM ${T.orders} WHERE amount_lock IN (${m})`, amounts, "amount_lock"),

    async insert(o) {
      try {
        await db
          .prepare(`INSERT INTO ${T.orders} (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`)
          .bind(o.id, o.player, o.lookId, o.usd, o.rate, o.amount, o.amount, o.createdAt, o.expiresAt, o.holdUntil, o.visitor)
          .run();
        return true;
      } catch (e) {
        // Another order took this amount since the read. Any other failure stops.
        if (isUnique(e)) return false;
        throw e;
      }
    },

    async order(id) {
      const r = await db.prepare(`SELECT ${COLS} FROM ${T.orders} WHERE id = ?`).bind(id).first<Row>();
      return r ? orderOf(r) : null;
    },

    async openOrder(player, lookId, until) {
      const r = await db
        .prepare(`SELECT ${COLS} FROM ${T.orders} WHERE player = ? AND look_id = ? AND status = 'open' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`)
        .bind(player, lookId, until)
        .first<Row>();
      return r ? orderOf(r) : null;
    },

    async countOpen(player, now) {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${T.orders} WHERE player = ? AND status = 'open' AND expires_at > ?`).bind(player, now).first<{ n: number }>();
      return Number(r?.n ?? 0);
    },

    async owns(player, lookId) {
      return Boolean(await db.prepare(`SELECT 1 AS one FROM ${T.owned} WHERE player = ? AND look_id = ?`).bind(player, lookId).first());
    },

    async owned(player) {
      return (await db.prepare(`SELECT look_id FROM ${T.owned} WHERE player = ? ORDER BY granted_at, look_id`).bind(player).all<{ look_id: string }>()).results.map((r) => r.look_id);
    },

    async held() {
      return (await db.prepare(`SELECT ${COLS} FROM ${T.orders} WHERE amount_lock IS NOT NULL`).all<Row>()).results.map(orderOf);
    },

    usedHashes: (hashes) => inChunks((m) => `SELECT hash FROM ${T.orders} WHERE hash IN (${m})`, hashes, "hash"),

    async settle(order, pay, now): Promise<Settled> {
      const status = paidStatus(order, pay.seenMs);
      try {
        const [update] = await db.batch([
          db
            .prepare(`UPDATE ${T.orders} SET status = ?, hash = ?, payer = ?, paid_at = ?, amount_lock = NULL WHERE id = ? AND status IN ('open', 'expired') AND amount_lock IS NOT NULL`)
            .bind(status, pay.hash, pay.payer, pay.seenMs, order.id),
          db
            .prepare(`INSERT OR IGNORE INTO ${T.owned} (player, look_id, order_id, granted_at) SELECT player, look_id, id, ? FROM ${T.orders} WHERE id = ? AND status = 'paid' AND hash = ?`)
            .bind(now, order.id, pay.hash),
        ]);
        return changes(update) === 1 ? status : "taken";
      } catch (e) {
        if (isUnique(e)) return "used";
        throw e;
      }
    },

    async claimScan(now, gapMs) {
      const r = await db
        .prepare(`INSERT INTO ${T.meta} (key, value, at) VALUES ('scan', '', ?) ON CONFLICT (key) DO UPDATE SET at = excluded.at WHERE ${T.meta}.at <= ?`)
        .bind(now, now - gapMs)
        .run();
      return changes(r) === 1;
    },

    async readRate() {
      const r = await db.prepare(`SELECT value, at FROM ${T.meta} WHERE key = 'rate'`).first<{ value: string; at: number }>();
      return r ? parseRate(r.value, Number(r.at)) : null;
    },

    async saveRate(rate) {
      await db
        .prepare(`INSERT INTO ${T.meta} (key, value, at) VALUES ('rate', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = excluded.at`)
        .bind(JSON.stringify({ usd: rate.usd, sources: rate.sources }), rate.at)
        .run();
    },

    async forget(player, now): Promise<ForgetResult> {
      await tidy(now);
      const w = await waiting(player);
      if (Number(w?.n ?? 0) > 0) return { deleted: 0, kept: 0, waitUntil: Number(w!.until) };
      // One batch, and each statement holds the money gate again: an order made meanwhile stops every one of them.
      const gate = `NOT EXISTS (SELECT 1 FROM ${T.orders} WHERE player = ?1 AND amount_lock IS NOT NULL)`;
      const done = await db.batch([
        db.prepare(`DELETE FROM ${T.owned} WHERE player = ?1 AND ${gate}`).bind(player),
        db.prepare(`DELETE FROM ${T.orders} WHERE player = ?1 AND hash IS NULL AND amount_lock IS NULL AND ${gate}`).bind(player),
        // A paid order keeps no payer; a paid-late one keeps it: the creator sends that payment back by hand.
        db.prepare(`UPDATE ${T.orders} SET payer = ?2 WHERE payer = ?1 AND status = 'paid' AND ${gate}`).bind(player, FORGOTTEN),
        db.prepare(`UPDATE ${T.orders} SET player = ?2, visitor = NULL WHERE player = ?1 AND hash IS NOT NULL AND ${gate}`).bind(player, FORGOTTEN),
      ]);
      const [owned, orders, , kept] = done.map(changes);
      if (owned + orders + kept === 0) {
        const again = await waiting(player);
        if (Number(again?.n ?? 0) > 0) return { deleted: 0, kept: 0, waitUntil: Number(again!.until) };
      }
      return { deleted: owned + orders, kept, waitUntil: null };
    },
  };
}
