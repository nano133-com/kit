// The admin sign-in's store for a game on Cloudflare D1, on the game starter's OWN tables and columns: `signin_requests` and `sessions` (their admin
// rows, scope = 'admin') and `admin_logins`. A starter moves onto it with no migration, and every creator who is signed in to /admin stays signed in.
// A new game adds ./d1.sql to its migrations ("@nano133/nanoterra/admin-signin/d1.sql": the same tables, `IF NOT EXISTS`). The owner's passkeys (since
// 0.12.0) use two more tables, `admin_passkeys` and `admin_once` (the end of d1.sql): only a game that turns the passkeys on needs them.
//
//   import { createD1AdminSignin } from "@nano133/nanoterra/admin-signin/d1";
//   const store = createD1AdminSignin(env.DB);
//
// It reads and writes ONLY the admin's rows (scope = 'admin'): a game whose players sign in through the same tables (the player sign-in's scope 'play')
// keeps its rows, and this adapter never reads, delivers, ends or deletes one. D1 has no transaction that reads and then writes, so each change is ONE
// statement that holds its own check, and a delivery and its session are one batch (the session is written only when the delivery changed a row).
// "Sign out everywhere" is the same two statements as the admin store's (`createD1Store(db, { logins: true })`): either one may run it.

import type { D1Like } from "../../admin/adapters/d1.js";
import { ADMIN_LOGIN_KEEP_MS, ADMIN_PASSKEY_LIMIT, ADMIN_WAYS, type AdminLinkResult, type AdminSessionRecord, type AdminSigninStore, type AdminWay, type RequestStoreLike, type SigninRequest } from "../types.js";

export type { D1Like, D1StatementLike } from "../../admin/adapters/d1.js";

/** The tables' names. Default: the game starter's. A game with other names changes d1.sql to match. */
export type D1AdminSigninTables = { requests?: string; sessions?: string; logins?: string; passkeys?: string; once?: string };

type Row = { id: string; rid: string | null; starter: string; status: string; expires_at: number; nonce: string | null; issued_at: number | null; label: string | null; account: string | null };

const toRequest = (r: Row): SigninRequest => ({
  id: r.rid ?? r.id,
  starter: r.starter,
  status: r.status === "signedin" ? "signedin" : "waiting",
  expiresAt: Number(r.expires_at),
  ...(r.label ? { label: r.label } : {}),
  ...(r.nonce ? { nonce: r.nonce } : {}),
  ...(r.issued_at ? { issuedAt: Number(r.issued_at) } : {}),
  ...(r.account ? { account: r.account } : {}),
});

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const changes = (res: unknown): number => Number((res as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);

/** True for D1's (and SQLite's) "no such table": a game that has not added the passkeys' tables. */
const noTable = (e: unknown) => /no such table/i.test(String((e as { message?: unknown } | null)?.message ?? e));

export function createD1AdminSignin(db: D1Like, tables: D1AdminSigninTables = {}): Required<AdminSigninStore> {
  const T = {
    requests: tables.requests ?? "signin_requests",
    sessions: tables.sessions ?? "sessions",
    logins: tables.logins ?? "admin_logins",
    passkeys: tables.passkeys ?? "admin_passkeys",
    once: tables.once ?? "admin_once",
  };
  for (const n of Object.values(T)) if (!NAME.test(n)) throw new Error(`not a table name: ${n}`);
  const COLS = "id, rid, starter, status, expires_at, nonce, issued_at, label, account";

  const stores = new Map<AdminWay, RequestStoreLike>();
  for (const way of ADMIN_WAYS) {
    stores.set(way, {
      async create(key, r) {
        // The starter's own insert: `scope` is written when the request is created, so a request started for the admin is the admin's for good.
        await db
          .prepare(`INSERT INTO ${T.requests} (id, rid, way, starter, status, expires_at, nonce, issued_at, label, scope) VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?, ?, 'admin')`)
          .bind(key, r.id, way, r.starter, r.expiresAt, r.nonce ?? null, r.issuedAt ?? null, r.label ?? null)
          .run();
      },
      async get(key) {
        const r = await db.prepare(`SELECT ${COLS} FROM ${T.requests} WHERE id = ? AND way = ? AND scope = 'admin'`).bind(key, way).first<Row>();
        return r ? toRequest(r) : null;
      },
      async find(id) {
        const r = await db.prepare(`SELECT ${COLS} FROM ${T.requests} WHERE rid = ? AND way = ? AND scope = 'admin'`).bind(id, way).first<Row>();
        return r ? { key: r.id, request: toRequest(r) } : null;
      },
      async finish(key, account) {
        return changes(await db.prepare(`UPDATE ${T.requests} SET status = 'signedin', account = ? WHERE id = ? AND way = ? AND status = 'waiting' AND scope = 'admin'`).bind(account, key, way).run()) === 1;
      },
    });
  }

  return {
    requests: (way) => {
      const s = stores.get(way);
      if (!s) throw new Error(`no such way: ${String(way)}`);
      return s;
    },
    async deliver(way, key, s) {
      // The starter's batch: the delivery, and the session only when the delivery changed a row.
      const done = await db.batch([
        db.prepare(`UPDATE ${T.requests} SET delivered = 1 WHERE id = ? AND way = ? AND delivered = 0 AND status = 'signedin' AND scope = 'admin'`).bind(key, way),
        db.prepare(`INSERT INTO ${T.sessions} (id_hash, address, created_at, expires_at, via, scope) SELECT ?, ?, ?, ?, ?, 'admin' WHERE changes() = 1`).bind(s.idHash, s.address, s.createdAt, s.expiresAt, s.via),
      ]);
      return changes(done[0]) === 1;
    },
    async session(idHash, now) {
      const r = await db
        .prepare(`SELECT id_hash, address, created_at, expires_at, via FROM ${T.sessions} WHERE id_hash = ? AND expires_at > ? AND scope = 'admin'`)
        .bind(idHash, now)
        .first<{ id_hash: string; address: string; created_at: number; expires_at: number; via: string }>();
      return r ? ({ idHash: r.id_hash, address: r.address, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), via: String(r.via) } satisfies AdminSessionRecord) : null;
    },
    async endSession(idHash) {
      await db.prepare(`DELETE FROM ${T.sessions} WHERE id_hash = ? AND scope = 'admin'`).bind(idHash).run();
    },
    async signOutEverywhere() {
      const done = await db.batch([
        db.prepare(`DELETE FROM ${T.sessions} WHERE scope = 'admin'`),
        db.prepare(`UPDATE ${T.requests} SET delivered = 1, expires_at = 0 WHERE scope = 'admin' AND delivered = 0`),
      ]);
      return changes(done[0]);
    },
    async recordLogin(login) {
      await db.batch([
        db.prepare(`INSERT INTO ${T.logins} (at, country, browser) VALUES (?, ?, ?)`).bind(login.at, login.country, login.browser),
        db.prepare(`DELETE FROM ${T.logins} WHERE at < ?`).bind(login.at - ADMIN_LOGIN_KEEP_MS),
      ]);
    },
    async recentLogins(limit) {
      const n = Math.min(Math.max(Math.floor(Number(limit)) || 0, 0), 50);
      const rows = (await db.prepare(`SELECT at, country, browser FROM ${T.logins} ORDER BY at DESC, id DESC LIMIT ?`).bind(n).all<{ at: number; country: string | null; browser: string }>()).results;
      return rows.map((r) => ({ at: Number(r.at), country: r.country, browser: r.browser }));
    },
    async clean(now) {
      // The starter's clean-up of its admin rows (its `cleanUp`, without the game's own `hits`).
      await db.batch([
        db.prepare(`DELETE FROM ${T.requests} WHERE expires_at < ? AND scope = 'admin'`).bind(now - 2 * 3_600_000),
        db.prepare(`DELETE FROM ${T.sessions} WHERE expires_at < ? AND scope = 'admin'`).bind(now),
        db.prepare(`DELETE FROM ${T.logins} WHERE at < ?`).bind(now - ADMIN_LOGIN_KEEP_MS),
      ]);
      // The used passkey signatures, on their own: a game without the passkeys' tables (they came in 0.12.0) still cleans the rest.
      try {
        await db.prepare(`DELETE FROM ${T.once} WHERE until <= ?`).bind(now).run();
      } catch (e) {
        if (!noTable(e)) throw e;
      }
    },
    async createSession(s) {
      await db.prepare(`INSERT INTO ${T.sessions} (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, ?, 'admin')`).bind(s.idHash, s.address, s.createdAt, s.expiresAt, s.via).run();
    },
    async linkPasskey(owner, address, at): Promise<AdminLinkResult> {
      // ONE statement holds the limit: the row is written only while the owner has fewer than the limit, and never twice.
      const res = await db
        .prepare(`INSERT INTO ${T.passkeys} (owner, address, created_at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM ${T.passkeys} WHERE owner = ?) < ? ON CONFLICT (owner, address) DO NOTHING`)
        .bind(owner, address, at, owner, ADMIN_PASSKEY_LIMIT)
        .run();
      if (changes(res) === 1) return "linked";
      const had = await db.prepare(`SELECT 1 AS one FROM ${T.passkeys} WHERE owner = ? AND address = ?`).bind(owner, address).first<{ one: number }>();
      return had ? "exists" : "full";
    },
    async unlinkPasskey(owner, address) {
      // The link, and the passkey's admin sessions with it.
      const done = await db.batch([
        db.prepare(`DELETE FROM ${T.passkeys} WHERE owner = ? AND address = ?`).bind(owner, address),
        db.prepare(`DELETE FROM ${T.sessions} WHERE scope = 'admin' AND via = 'passkey' AND address = ?`).bind(address),
      ]);
      return changes(done[0]) > 0;
    },
    async passkeys(owner) {
      const rows = (await db.prepare(`SELECT address, created_at FROM ${T.passkeys} WHERE owner = ? ORDER BY created_at, address`).bind(owner).all<{ address: string; created_at: number }>()).results;
      return rows.map((r) => ({ address: String(r.address), createdAt: Number(r.created_at) }));
    },
    async linked(owner, address) {
      return (await db.prepare(`SELECT 1 AS one FROM ${T.passkeys} WHERE owner = ? AND address = ?`).bind(owner, address).first<{ one: number }>()) !== null;
    },
    async useOnce(key, ttlMs) {
      const now = Date.now();
      // A row past its time may be taken again (its signature's window is long over); a live one may not.
      const res = await db
        .prepare(`INSERT INTO ${T.once} (key, until) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET until = excluded.until WHERE ${T.once}.until <= ?`)
        .bind(key, now + ttlMs, now)
        .run();
      return changes(res) === 1;
    },
  };
}
