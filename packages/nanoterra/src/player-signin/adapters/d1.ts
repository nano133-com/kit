// The player sign-in's store for a game on Cloudflare D1. The tables are in ./d1.sql (the package ships it: "@nano133/nanoterra/player-signin/d1.sql");
// add it to the game's migrations. They are the game starter's own `signin_requests` and `sessions` (so a starter's data carries over: every
// player stays signed in) and one more, `signin_once`.
//
//   import { createD1PlayerSignin } from "@nano133/nanoterra/player-signin/d1";
//   const store = createD1PlayerSignin(env.DB);
//
// It reads and writes ONLY the player's rows (scope = 'play'): a game whose admin signs in through the same tables (the starter's scope 'admin')
// keeps its admin rows, and this adapter never reads, delivers, ends or deletes one. D1 has no transaction that reads and then writes, so each change
// is ONE statement that holds its own check, and a delivery and its session are one batch (the session is written only when the delivery changed a row).

import type { D1Like } from "../../admin/adapters/d1.js";
import { WAYS, type PlayerSigninStore, type RequestStoreLike, type SessionRecord, type SigninRequest, type Way } from "../types.js";

export type { D1Like, D1StatementLike } from "../../admin/adapters/d1.js";

/** The tables' names. Default: the game starter's. A game with other names changes d1.sql to match. */
export type D1PlayerSigninTables = { requests?: string; sessions?: string; once?: string };

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

export function createD1PlayerSignin(db: D1Like, tables: D1PlayerSigninTables = {}): PlayerSigninStore {
  const T = { requests: tables.requests ?? "signin_requests", sessions: tables.sessions ?? "sessions", once: tables.once ?? "signin_once" };
  for (const n of Object.values(T)) if (!NAME.test(n)) throw new Error(`not a table name: ${n}`);
  const COLS = "id, rid, starter, status, expires_at, nonce, issued_at, label, account";

  const stores = new Map<Way, RequestStoreLike>();
  for (const way of WAYS) {
    stores.set(way, {
      async create(key, r) {
        await db
          .prepare(`INSERT INTO ${T.requests} (id, rid, way, starter, status, expires_at, nonce, issued_at, label, scope) VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?, ?, 'play')`)
          .bind(key, r.id, way, r.starter, r.expiresAt, r.nonce ?? null, r.issuedAt ?? null, r.label ?? null)
          .run();
      },
      async get(key) {
        const r = await db.prepare(`SELECT ${COLS} FROM ${T.requests} WHERE id = ? AND way = ? AND scope = 'play'`).bind(key, way).first<Row>();
        return r ? toRequest(r) : null;
      },
      async find(id) {
        const r = await db.prepare(`SELECT ${COLS} FROM ${T.requests} WHERE rid = ? AND way = ? AND scope = 'play'`).bind(id, way).first<Row>();
        return r ? { key: r.id, request: toRequest(r) } : null;
      },
      async finish(key, account) {
        return changes(await db.prepare(`UPDATE ${T.requests} SET status = 'signedin', account = ? WHERE id = ? AND way = ? AND status = 'waiting' AND scope = 'play'`).bind(account, key, way).run()) === 1;
      },
    });
  }

  const insertSession = (s: SessionRecord, afterChange: boolean) => {
    const cols = `INSERT INTO ${T.sessions} (id_hash, address, created_at, expires_at, via, scope)`;
    return db.prepare(afterChange ? `${cols} SELECT ?, ?, ?, ?, ?, 'play' WHERE changes() = 1` : `${cols} VALUES (?, ?, ?, ?, ?, 'play')`).bind(s.idHash, s.address, s.createdAt, s.expiresAt, s.via);
  };

  return {
    requests: (way) => {
      const s = stores.get(way);
      if (!s) throw new Error(`no such way: ${String(way)}`);
      return s;
    },
    async deliver(way, key, session) {
      const done = await db.batch([
        db.prepare(`UPDATE ${T.requests} SET delivered = 1 WHERE id = ? AND way = ? AND delivered = 0 AND status = 'signedin' AND scope = 'play'`).bind(key, way),
        insertSession(session, true),
      ]);
      return changes(done[0]) === 1;
    },
    async createSession(session) {
      await insertSession(session, false).run();
    },
    async session(idHash, now) {
      const r = await db
        .prepare(`SELECT id_hash, address, created_at, expires_at, via FROM ${T.sessions} WHERE id_hash = ? AND expires_at > ? AND scope = 'play'`)
        .bind(idHash, now)
        .first<{ id_hash: string; address: string; created_at: number; expires_at: number; via: string }>();
      return r ? { idHash: r.id_hash, address: r.address, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), via: r.via as SessionRecord["via"] } : null;
    },
    async endSession(idHash) {
      await db.prepare(`DELETE FROM ${T.sessions} WHERE id_hash = ? AND scope = 'play'`).bind(idHash).run();
    },
    async useOnce(key, ttlMs, address) {
      const now = Date.now();
      // A row past its time may be taken again (its signature's 5 minutes are long over); a live one may not.
      const res = await db
        .prepare(`INSERT INTO ${T.once} (key, address, until) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET address = excluded.address, until = excluded.until WHERE ${T.once}.until <= ?`)
        .bind(key, address, now + ttlMs, now)
        .run();
      return changes(res) === 1;
    },
    async forget(address) {
      const done = await db.batch([
        db.prepare(`DELETE FROM ${T.sessions} WHERE address = ? AND scope = 'play'`).bind(address),
        db.prepare(`DELETE FROM ${T.requests} WHERE account = ? AND scope = 'play'`).bind(address),
        db.prepare(`DELETE FROM ${T.once} WHERE address = ?`).bind(address),
      ]);
      return done.reduce<number>((n, r) => n + changes(r), 0);
    },
    async clean(now) {
      await db.batch([
        db.prepare(`DELETE FROM ${T.requests} WHERE expires_at < ? AND scope = 'play'`).bind(now - 2 * 3_600_000),
        db.prepare(`DELETE FROM ${T.sessions} WHERE expires_at <= ? AND scope = 'play'`).bind(now),
        db.prepare(`DELETE FROM ${T.once} WHERE until <= ?`).bind(now),
      ]);
    },
  };
}
