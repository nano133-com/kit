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
// The plays (a round, a level, a life or a continue, bought and used once) need one more migration, "@nano133/nanoterra/shop/d1-plays.sql" (the orders'
// `kind`, the table `credits` and the table `play_adults`: the players' "18 or older" yes). The store reads the schema to know whether it is there (the
// orders' `kind` column, `PRAGMA table_info`): never the game's plays.json, so a game that stops selling plays still reads every play order as a play.
// Without the migration the store sells looks only, on the tables as they are: an order of a play throws before it is written.
//
// The money rules are in the statements themselves: `amount_lock` and `hash` are UNIQUE (no two held orders ask for one amount, one payment pays one
// order), the payment and the grant (a look, or a play's credit) are ONE batch (a D1 transaction), the scan's claim is one upsert that only one caller in
// a gap can win, and a use is one UPDATE that holds its own check (`used_at IS NULL`), with (player, use_ref) UNIQUE: one ref uses one credit.

import type { D1Like } from "../../admin/adapters/d1.js";
import { parseRate } from "../../admin/rate.js";
import { paidStatus } from "../orders.js";
import { PLAY_WAIT_DAYS } from "../../looks/play.js";
import { checkRef, DAY_MS, useDaysOf } from "../plays.js";
import { FORGOTTEN, kindOf, type Credit, type ForgetResult, type UseResult, type OrderStatus, type Settled, type ShopOrder, type ShopStore } from "../store.js";

export type { D1Like, D1StatementLike } from "../../admin/adapters/d1.js";

/** The table names. The defaults are the game starter's, and "credits" and "play_adults" (d1-plays.sql). (`hits` is for `d1Limit` only.) */
export type ShopTables = { orders?: string; owned?: string; meta?: string; hits?: string; credits?: string; adults?: string };

type CreditRow = { order_id: string; player: string; play_id: string; granted_at: number; expires_at: number; used_at: number | null; use_ref: string | null };

const creditOf = (r: CreditRow): Credit => ({
  orderId: r.order_id,
  player: r.player,
  playId: r.play_id,
  grantedAt: Number(r.granted_at),
  expiresAt: Number(r.expires_at),
  usedAt: r.used_at === null || r.used_at === undefined ? null : Number(r.used_at),
  useRef: r.use_ref ?? null,
});

type Row = {
  id: string;
  player: string;
  look_id: string;
  /** Only with the plays' migration (d1-plays.sql). */
  kind?: string;
  use_days?: number | null;
  forgot_unused?: number | null;
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
  kind: r.kind === "play" ? "play" : "look",
  ...(r.kind === "play" && r.use_days !== null && r.use_days !== undefined ? { useDays: Number(r.use_days) } : {}),
  ...(r.forgot_unused !== null && r.forgot_unused !== undefined ? { forgotUnused: Number(r.forgot_unused) } : {}),
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
  return (await sha256Hex(`${await saltOf(db, tables)}|${visitorIp(req)}`)).slice(0, 32);
}

/** The game's random salt (made once and kept in `meta` as "salt"). */
async function saltOf(db: D1Like, tables: Pick<ShopTables, "meta">): Promise<string> {
  const meta = tableName(tables.meta, "meta");
  let row = await db.prepare(`SELECT value FROM ${meta} WHERE key = 'salt'`).first<{ value: string }>();
  if (!row) {
    const fresh = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
    await db.prepare(`INSERT OR IGNORE INTO ${meta} (key, value, at) VALUES ('salt', ?, ?)`).bind(fresh, Date.now()).run();
    row = await db.prepare(`SELECT value FROM ${meta} WHERE key = 'salt'`).first<{ value: string }>();
  }
  return row!.value;
}

/**
 * A limit's key as `hits` keeps it: its name (before the first "|") as it is, and the rest (a player's id, a visitor's key) as a hash with the game's
 * salt, so the table never holds a player's id. "use|nano_1abc..." becomes "use|<32 hex>". createShop counts with it.
 */
export async function limitKey(db: D1Like, key: string, tables: Pick<ShopTables, "meta"> = {}): Promise<string> {
  const cut = key.indexOf("|");
  const [name, rest] = cut < 0 ? ["key", key] : [key.slice(0, cut), key.slice(cut + 1)];
  return `${name}|${(await sha256Hex(`${await saltOf(db, tables)}|limit|${rest}`)).slice(0, 32)}`;
}

export type D1ShopOptions = {
  tables?: ShopTables;
  /**
   * True: the database has the plays' migration (d1-plays.sql), and the store does not read the schema to know it (a database without it then fails every
   * call, which is safe). Left out (or false): the store reads the schema (the orders' `kind` column), once; a "no" is read again before each payment
   * and each "Delete my data", so a migration applied while the store runs is never missed where it matters. Whenever the column is there, a play's
   * order is a play: it never grants a look, and "Delete my data" deletes its credits.
   */
  plays?: boolean;
};

export function createD1Shop(db: D1Like, options: D1ShopOptions = {}): ShopStore {
  const T = {
    orders: tableName(options.tables?.orders, "orders"),
    owned: tableName(options.tables?.owned, "owned"),
    meta: tableName(options.tables?.meta, "meta"),
    credits: tableName(options.tables?.credits, "credits"),
    adults: tableName(options.tables?.adults, "play_adults"),
  };
  // Whether the schema has the plays' migration: true is kept for good; false is kept for reads, and read again (`fresh`) before a write of money.
  let known: boolean | null = options.plays === true ? true : null;
  async function hasPlays(fresh = false): Promise<boolean> {
    if (known === true || (known === false && !fresh)) return known;
    const cols = (await db.prepare(`PRAGMA table_info(${T.orders})`).all<{ name: string }>()).results;
    known = cols.some((c) => c.name === "kind");
    return known;
  }
  const BASE_COLS = "id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, hash, payer, paid_at, visitor";
  const cols = async () => `${BASE_COLS}${(await hasPlays()) ? ", kind, use_days, forgot_unused" : ""}`;
  const CREDIT_COLS = "order_id, player, play_id, granted_at, expires_at, used_at, use_ref";
  const NO_PLAYS = "this D1 shop store sells no plays: apply @nano133/nanoterra/shop/d1-plays.sql";

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
      // A play order on tables with no credits would take a payment and give nothing: it is refused before anything is written.
      const plays = await hasPlays(kindOf(o) === "play");
      if (!plays && kindOf(o) === "play") throw new Error(NO_PLAYS);
      try {
        const values = [o.id, o.player, o.lookId, o.usd, o.rate, o.amount, o.amount, o.createdAt, o.expiresAt, o.holdUntil, o.visitor];
        await (plays
          ? db
              .prepare(`INSERT INTO ${T.orders} (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, visitor, kind, use_days) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`)
              .bind(...values, kindOf(o), kindOf(o) === "play" ? useDaysOf(o) : null)
          : db.prepare(`INSERT INTO ${T.orders} (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`).bind(...values)
        ).run();
        return true;
      } catch (e) {
        // Another order took this amount since the read. Any other failure stops.
        if (isUnique(e)) return false;
        throw e;
      }
    },

    async order(id) {
      const r = await db.prepare(`SELECT ${await cols()} FROM ${T.orders} WHERE id = ?`).bind(id).first<Row>();
      return r ? orderOf(r) : null;
    },

    async openOrder(player, lookId, until) {
      const r = await db
        .prepare(`SELECT ${await cols()} FROM ${T.orders} WHERE player = ? AND look_id = ? AND status = 'open' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`)
        .bind(player, lookId, until)
        .first<Row>();
      return r ? orderOf(r) : null;
    },

    async countOpen(player, now, lookId) {
      const one = lookId === undefined ? "" : " AND look_id = ?";
      const r = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${T.orders} WHERE player = ? AND status = 'open' AND expires_at > ?${one}`)
        .bind(...(lookId === undefined ? [player, now] : [player, now, lookId]))
        .first<{ n: number }>();
      return Number(r?.n ?? 0);
    },

    async owns(player, lookId) {
      return Boolean(await db.prepare(`SELECT 1 AS one FROM ${T.owned} WHERE player = ? AND look_id = ?`).bind(player, lookId).first());
    },

    async owned(player) {
      return (await db.prepare(`SELECT look_id FROM ${T.owned} WHERE player = ? ORDER BY granted_at, look_id`).bind(player).all<{ look_id: string }>()).results.map((r) => r.look_id);
    },

    async held() {
      return (await db.prepare(`SELECT ${await cols()} FROM ${T.orders} WHERE amount_lock IS NOT NULL`).all<Row>()).results.map(orderOf);
    },

    usedHashes: (hashes) => inChunks((m) => `SELECT hash FROM ${T.orders} WHERE hash IN (${m})`, hashes, "hash"),

    async settle(order, pay, now): Promise<Settled> {
      const status = paidStatus(order, pay.seenMs);
      // Read the schema afresh unless it is known to have the plays: with the column, only an order of kind 'look' grants a look, whatever the game sells now.
      const plays = await hasPlays(true);
      try {
        // The payment, and in the same batch the grant: a look (one owned row per player and look) or a play's credit (one per order). Each grant reads
        // the order's row as the batch's first statement left it, so a payment that changed nothing grants nothing.
        const [update] = await db.batch([
          db
            .prepare(`UPDATE ${T.orders} SET status = ?, hash = ?, payer = ?, paid_at = ?, amount_lock = NULL WHERE id = ? AND status IN ('open', 'expired') AND amount_lock IS NOT NULL`)
            .bind(status, pay.hash, pay.payer, pay.seenMs, order.id),
          db
            .prepare(`INSERT OR IGNORE INTO ${T.owned} (player, look_id, order_id, granted_at) SELECT player, look_id, id, ? FROM ${T.orders} WHERE id = ? AND status = 'paid' AND hash = ?${plays ? " AND kind = 'look'" : ""}`)
            .bind(now, order.id, pay.hash),
          ...(plays
            ? [
                db
                  // The credit's own end, fixed now: the order's use_days (PLAY_WAIT_DAYS when it has none) from this grant.
                  .prepare(
                    `INSERT OR IGNORE INTO ${T.credits} (order_id, player, play_id, granted_at, expires_at) SELECT id, player, look_id, ?1, ?1 + COALESCE(use_days, ${PLAY_WAIT_DAYS}) * ${DAY_MS} FROM ${T.orders} WHERE id = ?2 AND status = 'paid' AND hash = ?3 AND kind = 'play'`,
                  )
                  .bind(now, order.id, pay.hash),
              ]
            : []),
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

    async credits(player, now) {
      if (!(await hasPlays())) return [];
      const rows = await db
        .prepare(`SELECT play_id, COUNT(*) AS n FROM ${T.credits} WHERE player = ? AND used_at IS NULL AND expires_at >= ? GROUP BY play_id ORDER BY play_id`)
        .bind(player, now)
        .all<{ play_id: string; n: number }>();
      return rows.results.map((r) => ({ playId: r.play_id, ready: Number(r.n) }));
    },

    async useCredit(player, playId, ref, now): Promise<UseResult> {
      checkRef(ref);
      // Looks only: no play order was ever written, so no credit exists.
      if (!(await hasPlays(true))) return { status: "none" };
      const byRef = () => db.prepare(`SELECT ${CREDIT_COLS} FROM ${T.credits} WHERE player = ? AND use_ref = ?`).bind(player, ref).first<CreditRow>();
      for (let attempt = 0; attempt < 3; attempt++) {
        const was = await byRef();
        if (was) return { status: "again", credit: creditOf(was) };
        try {
          // ONE statement: it picks the oldest unused credit and takes it only while it is still unused, so two calls never take one credit.
          const row = await db
            .prepare(
              `UPDATE ${T.credits} SET used_at = ?, use_ref = ? WHERE order_id = (SELECT order_id FROM ${T.credits} WHERE player = ? AND play_id = ? AND used_at IS NULL AND expires_at >= ? ORDER BY granted_at, order_id LIMIT 1) AND used_at IS NULL RETURNING ${CREDIT_COLS}`,
            )
            .bind(now, ref, player, playId, now)
            .first<CreditRow>();
          if (row) return { status: "used", credit: creditOf(row) };
        } catch (e) {
          // The same ref used a credit meanwhile (UNIQUE (player, use_ref)): read it back as "again".
          if (isUnique(e)) continue;
          throw e;
        }
        // Nothing changed: no credit is ready, unless the same ref won meanwhile.
        const again = await byRef();
        return again ? { status: "again", credit: creditOf(again) } : { status: "none" };
      }
      const last = await byRef();
      return last ? { status: "again", credit: creditOf(last) } : { status: "none" };
    },

    async adult(player) {
      if (!(await hasPlays())) return null;
      const r = await db.prepare(`SELECT at FROM ${T.adults} WHERE player = ?`).bind(player).first<{ at: number }>();
      return r ? Number(r.at) : null;
    },

    async keepAdult(player, now) {
      if (!(await hasPlays(true))) throw new Error(NO_PLAYS);
      await db.prepare(`INSERT OR IGNORE INTO ${T.adults} (player, at) VALUES (?, ?)`).bind(player, now).run();
    },

    async forget(player, now): Promise<ForgetResult> {
      await tidy(now);
      const w = await waiting(player);
      if (Number(w?.n ?? 0) > 0) return { deleted: 0, kept: 0, waitUntil: Number(w!.until) };
      // With the plays' migration (read afresh): the player's credits and yes go too, and the payer rule reads the credits.
      const plays = await hasPlays(true);
      // One batch, and each statement holds the money gate again: an order made meanwhile stops every one of them.
      const gate = `NOT EXISTS (SELECT 1 FROM ${T.orders} WHERE player = ?1 AND amount_lock IS NOT NULL)`;
      // An order's credit is unused (read before the credits go).
      const unusedCredit = `EXISTS (SELECT 1 FROM ${T.credits} c WHERE c.order_id = ${T.orders}.id AND c.used_at IS NULL)`;
      // A play whose payment may go back: its credit is unused, or was unused when its own player deleted their data (forgot_unused).
      const unusedPlay = plays ? ` AND NOT (kind = 'play' AND (forgot_unused IS NOT NULL OR ${unusedCredit}))` : "";
      const done = await db.batch([
        db.prepare(`DELETE FROM ${T.owned} WHERE player = ?1 AND ${gate}`).bind(player),
        db.prepare(`DELETE FROM ${T.orders} WHERE player = ?1 AND hash IS NULL AND amount_lock IS NULL AND ${gate}`).bind(player),
        ...(plays
          ? [
              // The player's own paid plays: an unused credit's order keeps its payer and gets the mark; a used one's keeps no payer, whoever paid.
              db.prepare(`UPDATE ${T.orders} SET forgot_unused = ?2 WHERE player = ?1 AND kind = 'play' AND status = 'paid' AND ${unusedCredit} AND ${gate}`).bind(player, now),
              db.prepare(`UPDATE ${T.orders} SET payer = ?2 WHERE player = ?1 AND kind = 'play' AND status = 'paid' AND forgot_unused IS NULL AND payer IS NOT NULL AND ${gate}`).bind(player, FORGOTTEN),
            ]
          : []),
        // An order the player paid keeps no payer; a paid-late one keeps it (the creator sends that payment back by hand), and so does an unused play.
        db.prepare(`UPDATE ${T.orders} SET payer = ?2 WHERE payer = ?1 AND status = 'paid'${unusedPlay} AND ${gate}`).bind(player, FORGOTTEN),
        db.prepare(`UPDATE ${T.orders} SET player = ?2, visitor = NULL WHERE player = ?1 AND hash IS NOT NULL AND ${gate}`).bind(player, FORGOTTEN),
        ...(plays ? [db.prepare(`DELETE FROM ${T.credits} WHERE player = ?1 AND ${gate}`).bind(player), db.prepare(`DELETE FROM ${T.adults} WHERE player = ?1 AND ${gate}`).bind(player)] : []),
      ]);
      const counts = done.map(changes);
      // The marks and the payer changes are not counted (the kept orders are).
      const [owned, orders] = counts;
      const [kept, credits = 0, adults = 0] = counts.slice(plays ? 5 : 3);
      if (owned + orders + kept + credits + adults === 0) {
        const again = await waiting(player);
        if (Number(again?.n ?? 0) > 0) return { deleted: 0, kept: 0, waitUntil: Number(again!.until) };
      }
      return { deleted: owned + orders + credits + adults, kept, waitUntil: null };
    },
  };
}
