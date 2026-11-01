// The player sign-in's store rules (playerSigninStoreConformance) on the memory store, the D1 adapter (on SQLite: the package's d1.sql alone, and
// d1.sql on top of the game starter's own tables) and the Firestore adapter (on an in-memory fake of the small interface it uses). Plus what is
// specific to D1: a starter's players stay signed in after the switch, and the admin's rows are never read, delivered, ended or deleted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryPlayerSignin, createPlayerSignin, sha256Hex } from "../src/player-signin/index.js";
import { createD1PlayerSignin } from "../src/player-signin/adapters/d1.js";
import { createFirestorePlayerSignin, type FirestorePlayerSigninLike, type PlayerSigninDocRef, type PlayerSigninQuery, type PlayerSigninQuerySnap, type PlayerSigninTransaction } from "../src/player-signin/adapters/firestore.js";
import { playerSigninStoreConformance, type PlayerSigninConformanceCase } from "../src/player-signin/conformance.js";
import type { D1Like, D1StatementLike } from "../src/admin/adapters/d1.js";

const run = (name: string, cases: PlayerSigninConformanceCase[]) => {
  assert.ok(cases.length >= 10);
  for (const c of cases) test(`${name}: ${c.name}`, c.run);
};

// ---- memory ----

run("player sign-in memory", playerSigninStoreConformance(async () => {
  const store = createMemoryPlayerSignin();
  return { store, dump: async () => JSON.stringify([[...store.requestRows.entries()], [...store.sessionRows.entries()], [...store.onceRows.entries()]]) };
}));

// ---- D1, on SQLite ----

type Sqlite = import("node:sqlite").DatabaseSync;
let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite is not in this Node";
const SCHEMA = readFileSync(new URL("../src/player-signin/adapters/d1.sql", import.meta.url), "utf8");

// The game starter's sign-in tables as its migrations 0001, 0002, 0003, 0005 and 0006 make them (nano-game-starter main c668201), with a few of its
// other tables. d1.sql runs on top of them unchanged.
const STARTER = `
CREATE TABLE signin_requests (id TEXT PRIMARY KEY, starter TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, nonce TEXT, issued_at INTEGER, account TEXT, delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, address TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
CREATE TABLE hits (key TEXT NOT NULL, win INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, win));
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE owned (player TEXT NOT NULL, look_id TEXT NOT NULL, order_id TEXT NOT NULL, granted_at INTEGER NOT NULL, PRIMARY KEY (player, look_id));
ALTER TABLE signin_requests ADD COLUMN way TEXT NOT NULL DEFAULT 'berry';
ALTER TABLE signin_requests ADD COLUMN rid TEXT;
ALTER TABLE signin_requests ADD COLUMN label TEXT;
UPDATE signin_requests SET rid = id WHERE rid IS NULL;
CREATE INDEX signin_requests_by_rid ON signin_requests (rid);
ALTER TABLE sessions ADD COLUMN via TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'play';
CREATE TABLE admin_logins (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, country TEXT, browser TEXT NOT NULL);
ALTER TABLE signin_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'play';
`;

function d1Over(db: Sqlite): D1Like {
  const stmt = (sql: string, args: unknown[] = []): D1StatementLike & { exec(): unknown } => ({
    bind: (...v) => stmt(sql, v),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    exec: () => db.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of list as ReturnType<typeof stmt>[]) results.push({ meta: { changes: Number((s.exec() as { changes?: number | bigint }).changes ?? 0) } });
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return results;
    },
  };
}

const TABLES = ["signin_requests", "sessions", "signin_once"];
function d1Harness(starter: boolean) {
  const db = new DatabaseSync!(":memory:");
  if (starter) db.exec(STARTER);
  db.exec(SCHEMA);
  const store = createD1PlayerSignin(d1Over(db));
  const dump = async () => TABLES.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())).join("|");
  return { db, store, dump };
}

if (skip) test("player sign-in D1 adapter on SQLite", { skip }, () => {});
else {
  run("player sign-in D1", playerSigninStoreConformance(async () => d1Harness(false)));
  run("player sign-in D1 on the starter's tables", playerSigninStoreConformance(async () => d1Harness(true)));

  test("D1 on the starter's tables: its players stay signed in, and its admin rows are never read, delivered, ended or deleted", async () => {
    const { db } = d1Harness(true);
    const now = 1_790_000_000_000;
    const player = "nano_1fjhmh9d93qoktzxk14sn8ohf8pzeiijesnp1u5wfejwxamkpcxoup1etgmp";
    const playToken = "a".repeat(64);
    const adminToken = "b".repeat(64);
    // As the starter wrote them: a game session (the plain hash), an admin session (the hash with "admin:"), an admin request that was signed.
    db.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, 'wallet', 'play')").run(await sha256Hex(playToken), player, now - 1000, now + 86_400_000);
    db.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, 'wallet', 'admin')").run(await sha256Hex(`admin:${adminToken}`), player, now - 1000, now + 86_400_000);
    db.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, 'wallet', 'admin')").run(await sha256Hex(adminToken), player, now - 1000, now + 86_400_000);
    db.prepare("INSERT INTO signin_requests (id, rid, way, starter, status, expires_at, account, scope) VALUES (?, ?, 'berry', ?, 'signedin', ?, ?, 'admin')").run("c".repeat(32), "c".repeat(32), "d".repeat(64), now - 3 * 3_600_000, player);
    const store = createD1PlayerSignin(d1Over(db));
    const signin = createPlayerSignin({ store, now: () => now });
    const with_ = (token: string) => new Request("http://game.test/api/me", { headers: { Cookie: `session=${token}` } });
    assert.deepEqual(await signin.session(with_(playToken)), { address: player, createdAt: now - 1000, via: "wallet" }, "a starter session reads as it was");
    assert.equal(await signin.player(with_(adminToken)), null, "an admin session is never a player's, even with its token in the game's cookie");
    assert.equal(await store.requests("berry").get("c".repeat(32)), null, "an admin request is not the player store's");
    assert.equal(await store.deliver("berry", "c".repeat(32), { idHash: "e".repeat(64), address: player, createdAt: now, expiresAt: now + 1, via: "wallet" }), false);
    await store.endSession(await sha256Hex(adminToken));
    await signin.forget(player);
    await signin.clean(now + 2 * 86_400_000);
    const left = db.prepare("SELECT scope, COUNT(*) AS n FROM sessions GROUP BY scope").all() as { scope: string; n: number }[];
    assert.deepEqual(left.map((r) => [r.scope, Number(r.n)]), [["admin", 2]], "only the player's session went");
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM signin_requests WHERE scope = 'admin'").get() as { n: number }).n), 1, "the admin request stays");
  });

  test("D1: other table names; a name that is not one is refused", () => {
    const db = new DatabaseSync!(":memory:");
    db.exec(SCHEMA.replaceAll("signin_requests", "p_requests").replaceAll(" sessions", " p_sessions").replaceAll("signin_once", "p_once"));
    assert.doesNotThrow(() => createD1PlayerSignin(d1Over(db), { requests: "p_requests", sessions: "p_sessions", once: "p_once" }));
    assert.throws(() => createD1PlayerSignin(d1Over(db), { sessions: "sessions; DROP TABLE x" }));
  });
}

// ---- Firestore, on a fake of the small interface (one transaction at a time, as Firestore's serialisable transactions behave for one document) ----

function fakeFirestore() {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  const col = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };
  type Ref = PlayerSigninDocRef & { col: string; id: string };
  const ref = (c: string, id: string): Ref => ({ col: c, id, get: async () => snap(c, id) });
  const snap = (c: string, id: string) => {
    const d = col(c).get(id);
    return { exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
  };
  const query = (c: string, filters: [string, string, unknown][], max = Infinity): PlayerSigninQuery => ({
    where: (f, op, v) => query(c, [...filters, [f, op, v]], max),
    limit: (n) => query(c, filters, n),
    async get(): Promise<PlayerSigninQuerySnap> {
      const docs = [...col(c).entries()]
        .filter(([, d]) => filters.every(([f, op, v]) => (op === "==" ? d[f] === v : op === "<" ? (d[f] as number) < (v as number) : (d[f] as number) <= (v as number))))
        .slice(0, max)
        .map(([id, d]) => ({ id, ref: ref(c, id), data: () => structuredClone(d) }));
      return { docs };
    },
  });
  let chain = Promise.resolve();
  const db: FirestorePlayerSigninLike = {
    collection: (name) => Object.assign(query(name, []), { doc: (id: string) => ref(name, id) }),
    runTransaction<T>(fn: (tx: PlayerSigninTransaction) => Promise<T>): Promise<T> {
      const next = chain.then(async () => {
        const writes: (() => void)[] = [];
        const tx: PlayerSigninTransaction = {
          get: async (r) => {
            if (writes.length) throw new Error("a read after a write");
            return snap((r as Ref).col, (r as Ref).id);
          },
          set: (r, d, o) => writes.push(() => col((r as Ref).col).set((r as Ref).id, o?.merge ? { ...(col((r as Ref).col).get((r as Ref).id) ?? {}), ...structuredClone(d) } : structuredClone(d))),
          delete: (r) => writes.push(() => col((r as Ref).col).delete((r as Ref).id)),
        };
        const out = await fn(tx);
        for (const w of writes) w();
        return out;
      });
      chain = next.then(() => undefined, () => undefined);
      return next;
    },
    batch() {
      const writes: (() => void)[] = [];
      return { delete: (r) => writes.push(() => col((r as Ref).col).delete((r as Ref).id)), commit: async () => writes.forEach((w) => w()) };
    },
  };
  return { db, data };
}

run("player sign-in Firestore (fake)", playerSigninStoreConformance(async () => {
  const { db, data } = fakeFirestore();
  return { store: createFirestorePlayerSignin(db), dump: async () => JSON.stringify([...data.entries()].map(([k, m]) => [k, [...m.entries()]])) };
}));

test("Firestore: every document carries deleteAt (a TTL policy deletes it), and only the three collections are written", async () => {
  const { db, data } = fakeFirestore();
  const store = createFirestorePlayerSignin(db, { requests: "r", sessions: "s", once: "o" });
  await store.requests("berry").create("k".repeat(32), { id: "k".repeat(32), starter: "0".repeat(64), status: "waiting", expiresAt: 1000 });
  await store.createSession({ idHash: "1".repeat(64), address: "nano_x", createdAt: 1, expiresAt: 2000, via: "passkey" });
  await store.useOnce("2".repeat(64), 1000, "nano_x");
  assert.deepEqual([...data.keys()].sort(), ["o", "r", "s"]);
  for (const m of data.values()) for (const d of m.values()) assert.ok(d.deleteAt instanceof Date, JSON.stringify(d));
});
