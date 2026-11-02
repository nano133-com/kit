// The admin sign-in's store rules (adminSigninStoreConformance) on the memory store, the D1 adapter (on SQLite: the package's d1.sql alone, on the
// game starter's own tables, and beside the player sign-in's d1.sql) and the Firestore adapter (on an in-memory fake of the small interface it uses).
// Plus what is specific to D1: a starter's admin rows read as they were (no migration), and the player's rows are never read, delivered, ended or deleted.
import assert from "node:assert/strict";
import test from "node:test";
import { adminKey, createAdminSignin, createMemoryAdminSignin } from "../src/admin-signin/index.js";
import { createD1AdminSignin } from "../src/admin-signin/adapters/d1.js";
import { createFirestoreAdminSignin, type AdminSigninDocRef, type AdminSigninQuery, type AdminSigninQuerySnap, type AdminSigninTransaction, type FirestoreAdminSigninLike } from "../src/admin-signin/adapters/firestore.js";
import { adminSigninStoreConformance, type AdminSigninConformanceCase } from "../src/admin-signin/conformance.js";
import { createD1PlayerSignin } from "../src/player-signin/adapters/d1.js";
import { createPlayerSignin, sha256Hex } from "../src/player-signin/index.js";
import { ADMIN_SQL, OWNER, PASSKEYS_SQL, PLAYER_SQL, STARTER } from "./admin-signin-helpers.js";
import { d1Over, noSqlite, sqlite } from "./shop-helpers.js";

const run = (name: string, cases: AdminSigninConformanceCase[]) => {
  assert.ok(cases.length >= 10);
  for (const c of cases) test(`${name}: ${c.name}`, c.run);
};

// ---- memory ----

run("admin sign-in memory", adminSigninStoreConformance(async () => {
  const store = createMemoryAdminSignin();
  return { store, dump: async () => JSON.stringify([[...store.requestRows.entries()], [...store.sessionRows.entries()], store.loginRows]) };
}, { passkeys: true }));

test("conformance: a store with no passkey methods passes the passkey cases only while they are not asked for", async () => {
  const bare = async () => {
    const { createSession: _a, linkPasskey: _b, unlinkPasskey: _c, passkeys: _d, linked: _e, useOnce: _f, ...rest } = createMemoryAdminSignin();
    return { store: rest, dump: async () => "" };
  };
  const pick = (cases: AdminSigninConformanceCase[]) => cases.filter((c) => c.name.startsWith("passkeys: "));
  assert.equal(pick(adminSigninStoreConformance(bare, { passkeys: false })).length, 0);
  const auto = pick(adminSigninStoreConformance(bare));
  assert.ok(auto.length >= 4);
  for (const c of auto) await c.run();
  for (const c of pick(adminSigninStoreConformance(bare, { passkeys: true }))) await assert.rejects(c.run(), /no passkey methods/);
});

// ---- D1, on SQLite ----

const TABLES = ["signin_requests", "sessions", "admin_logins"];
const PASSKEY_TABLES = ["admin_passkeys", "admin_once"];
function d1Harness(schema: string) {
  const db = sqlite(schema);
  const store = createD1AdminSignin(d1Over(db));
  const has = (t: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) !== undefined;
  const dump = async () => [...TABLES, ...PASSKEY_TABLES.filter(has)].map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())).join("|");
  return { db, store, dump };
}

if (noSqlite) test("admin sign-in D1 adapter on SQLite", { skip: noSqlite }, () => {});
else {
  run("admin sign-in D1 (its d1.sql alone)", adminSigninStoreConformance(async () => d1Harness(ADMIN_SQL), { passkeys: true }));
  run("admin sign-in D1 on the starter's own tables (no migration; no passkeys)", adminSigninStoreConformance(async () => d1Harness(STARTER), { passkeys: false }));
  run("admin sign-in D1 on the starter's own tables + the passkeys' migration (0009)", adminSigninStoreConformance(async () => d1Harness(`${STARTER}\n${PASSKEYS_SQL}`), { passkeys: true }));
  run("admin sign-in D1 beside the player sign-in's d1.sql", adminSigninStoreConformance(async () => d1Harness(`${PLAYER_SQL}\n${ADMIN_SQL}`), { passkeys: true }));

  test("D1: d1.sql on the starter's tables adds only the passkeys' two tables (the rest is there: IF NOT EXISTS), the same as the 0009 migration; on the player's d1.sql it adds admin_logins and those two", () => {
    const schema = (d: ReturnType<typeof sqlite>) => JSON.stringify(d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
    const names = (d: ReturnType<typeof sqlite>) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    const db = sqlite(STARTER);
    const had = names(db);
    db.exec(ADMIN_SQL);
    assert.deepEqual(names(db).filter((n) => !had.includes(n)), ["admin_once", "admin_passkeys"]);
    const migrated = sqlite(STARTER);
    migrated.exec(PASSKEYS_SQL);
    assert.equal(schema(migrated), schema(db), "the migration makes what d1.sql makes on the starter");
    migrated.exec(PASSKEYS_SQL);
    assert.equal(schema(migrated), schema(db), "running it twice changes nothing");
    assert.doesNotMatch(PASSKEYS_SQL.replace(/--.*$/gm, ""), /\b(?:ALTER|DROP|DELETE|UPDATE|INSERT)\b/i, "the migration only adds tables");
    const p = sqlite(PLAYER_SQL);
    const before = names(p);
    p.exec(ADMIN_SQL);
    assert.deepEqual(names(p).filter((n) => !before.includes(n) && n !== "sqlite_sequence"), ["admin_logins", "admin_once", "admin_passkeys"]);
  });

  test("D1 on the starter's tables with no passkey migration: the wallet sign-in and clean() still work (clean skips the missing once-table)", async () => {
    const db = sqlite(STARTER);
    const store = createD1AdminSignin(d1Over(db));
    await store.recordLogin({ at: 1, country: null, browser: "Old" });
    await store.clean(Date.now());
    assert.equal((await store.recentLogins(5)).length, 0);
    // The passkey methods need the tables: a game turns the passkeys on only with the migration.
    await assert.rejects(store.linked(OWNER.address, OWNER.address), /no such table/);
  });

  test("D1 on the starter's tables: its admin logins and requests read as the starter wrote them, and the player's rows are never read, delivered, ended or deleted", async () => {
    const db = sqlite(`${STARTER}\n${PLAYER_SQL}`);
    const now = 1_790_000_000_000;
    const adminToken = "b".repeat(64);
    const playToken = "a".repeat(64);
    // As the starter wrote them: an admin session (the hash with "admin:"), a game session (the plain hash), an admin request signed and not delivered,
    // and a game request signed and not delivered.
    db.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, 'wallet', 'admin')").run(await adminKey(adminToken), OWNER.address, now - 1000, now + 86_400_000 - 1000);
    db.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, 'wallet', 'play')").run(await sha256Hex(playToken), OWNER.address, now - 1000, now + 30 * 86_400_000);
    db.prepare("INSERT INTO signin_requests (id, rid, way, starter, status, expires_at, nonce, issued_at, label, account, scope) VALUES (?, ?, 'berry', ?, 'signedin', ?, ?, ?, 'admin:US', ?, 'admin')").run("c".repeat(32), "c".repeat(32), "d".repeat(64), now + 60_000, "e".repeat(64), now - 60_000, OWNER.address);
    db.prepare("INSERT INTO signin_requests (id, rid, way, starter, status, expires_at, account, scope) VALUES (?, ?, 'berry', ?, 'signedin', ?, ?, 'play')").run("f".repeat(32), "f".repeat(32), "d".repeat(64), now + 60_000, OWNER.address);
    const store = createD1AdminSignin(d1Over(db));
    const admin = createAdminSignin({ store, owner: OWNER.address, now: () => now });
    const withCookie = (c: string) => new Request("http://game.test/api/admin/summary", { headers: { Cookie: c } });
    assert.deepEqual(await admin.session(withCookie(`admin=${adminToken}`)), { address: OWNER.address, createdAt: now - 1000, via: "wallet" }, "the starter's admin login stays signed in");
    assert.equal(await admin.session(withCookie(`admin=${playToken}`)), null, "a game session is never the admin's, even with its token in the admin cookie");
    const req = await store.requests("berry").get("c".repeat(32));
    assert.equal(req?.label, "admin:US");
    assert.equal(await store.requests("berry").get("f".repeat(32)), null, "a game request is not the admin store's");
    assert.equal(await store.deliver("berry", "f".repeat(32), { idHash: "1".repeat(64), address: OWNER.address, createdAt: now, expiresAt: now + 1, via: "wallet" }), false);
    await store.endSession(await sha256Hex(playToken));
    assert.equal(await store.signOutEverywhere(), 1);
    await store.clean(now + 40 * 86_400_000);
    const sessions = db.prepare("SELECT scope, COUNT(*) AS n FROM sessions GROUP BY scope").all() as { scope: string; n: number }[];
    assert.deepEqual(sessions.map((r) => [r.scope, Number(r.n)]), [["play", 1]], "only the admin's session went");
    const requests = db.prepare("SELECT scope, delivered FROM signin_requests ORDER BY scope").all() as { scope: string; delivered: number }[];
    assert.deepEqual(requests.map((r) => [r.scope, Number(r.delivered)]), [["play", 0]], "the game's request stays, not delivered; the admin's ended and went");
    // The player's adapter on the same tables still reads its own.
    const player = createPlayerSignin({ store: createD1PlayerSignin(d1Over(db)), now: () => now });
    assert.equal(await player.player(new Request("http://game.test/", { headers: { Cookie: `session=${playToken}` } })), OWNER.address);
  });

  test("D1: other table names; a name that is not one is refused", () => {
    const db = sqlite(ADMIN_SQL.replaceAll("signin_requests", "a_requests").replaceAll(" sessions", " a_sessions").replaceAll("admin_logins", "a_logins"));
    assert.doesNotThrow(() => createD1AdminSignin(d1Over(db), { requests: "a_requests", sessions: "a_sessions", logins: "a_logins" }));
    assert.throws(() => createD1AdminSignin(d1Over(db), { sessions: "sessions; DROP TABLE x" }));
  });
}

// ---- Firestore, on a fake of the small interface (one transaction at a time, as Firestore's serialisable transactions behave for one document) ----

function fakeFirestore() {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  const col = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };
  type Ref = AdminSigninDocRef & { col: string; id: string };
  const ref = (c: string, id: string): Ref => ({ col: c, id, get: async () => snap(c, id) });
  const snap = (c: string, id: string) => {
    const d = col(c).get(id);
    return { exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
  };
  type Q = { filters: [string, string, unknown][]; order?: [string, "asc" | "desc"]; max: number };
  const query = (c: string, q: Q): AdminSigninQuery => ({
    where: (f, op, v) => query(c, { ...q, filters: [...q.filters, [f, op, v]] }),
    orderBy: (f, dir = "asc") => query(c, { ...q, order: [f, dir] }),
    limit: (n) => query(c, { ...q, max: n }),
    async get(): Promise<AdminSigninQuerySnap> {
      let rows = [...col(c).entries()].filter(([, d]) => q.filters.every(([f, op, v]) => (op === "==" ? d[f] === v : (d[f] as number) < (v as number))));
      if (q.order) {
        const [f, dir] = q.order;
        // Firestore orders ties by the document's id.
        rows = rows.sort(([ia, a], [ib, b]) => ((a[f] as number) - (b[f] as number) || (ia < ib ? -1 : 1)) * (dir === "desc" ? -1 : 1));
      }
      return { docs: rows.slice(0, q.max).map(([id, d]) => ({ id, ref: ref(c, id), data: () => structuredClone(d) })) };
    },
  });
  let chain = Promise.resolve();
  const write = (r: Ref, d: Record<string, unknown> | null, merge = false) => (d === null ? col(r.col).delete(r.id) : col(r.col).set(r.id, merge ? { ...(col(r.col).get(r.id) ?? {}), ...structuredClone(d) } : structuredClone(d)));
  const db: FirestoreAdminSigninLike = {
    collection: (name) => Object.assign(query(name, { filters: [], max: Infinity }), { doc: (id: string) => ref(name, id) }),
    runTransaction<T>(fn: (tx: AdminSigninTransaction) => Promise<T>): Promise<T> {
      const next = chain.then(async () => {
        const writes: (() => void)[] = [];
        const tx: AdminSigninTransaction = {
          get: async (r) => {
            if (writes.length) throw new Error("a read after a write");
            return snap((r as Ref).col, (r as Ref).id);
          },
          set: (r, d, o) => writes.push(() => write(r as Ref, d, o?.merge)),
          delete: (r) => writes.push(() => write(r as Ref, null)),
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
      return {
        set: (r, d, o) => writes.push(() => write(r as Ref, d, o?.merge)),
        delete: (r) => writes.push(() => write(r as Ref, null)),
        commit: async () => {
          if (writes.length > 500) throw new Error("a batch holds at most 500 writes");
          writes.forEach((w) => w());
        },
      };
    },
  };
  return { db, data };
}

run("admin sign-in Firestore (fake)", adminSigninStoreConformance(async () => {
  const { db, data } = fakeFirestore();
  return { store: createFirestoreAdminSignin(db), dump: async () => JSON.stringify([...data.entries()].map(([k, m]) => [k, [...m.entries()]])) };
}, { passkeys: true }));

test("Firestore: every document carries deleteAt (a TTL policy deletes it), only the three collections are written, and a player's documents are never read or deleted", async () => {
  const { db, data } = fakeFirestore();
  const store = createFirestoreAdminSignin(db, { requests: "r", sessions: "s", logins: "l" });
  const now = Date.now();
  await store.requests("berry").create("k".repeat(32), { id: "k".repeat(32), starter: "0".repeat(64), status: "waiting", expiresAt: now + 1000 });
  await store.requests("berry").finish("k".repeat(32), OWNER.address);
  await store.deliver("berry", "k".repeat(32), { idHash: "1".repeat(64), address: OWNER.address, createdAt: now, expiresAt: now + 2000, via: "wallet" });
  await store.recordLogin({ at: now, country: "US", browser: "Chrome on macOS" });
  assert.deepEqual([...data.keys()].sort(), ["l", "r", "s"]);
  for (const m of data.values()) for (const d of m.values()) assert.ok(d.deleteAt instanceof Date, JSON.stringify(d));
  // A player's documents in the same collections (the player sign-in's adapter writes scope "play").
  data.get("s")!.set("2".repeat(64), { address: OWNER.address, createdAt: now, expiresAt: now - 1, via: "wallet", scope: "play" });
  data.get("r")!.set("p".repeat(32), { id: "p".repeat(32), way: "berry", starter: "0".repeat(64), status: "signedin", expiresAt: 0, delivered: false, scope: "play" });
  assert.equal(await store.requests("berry").get("p".repeat(32)), null);
  assert.equal(await store.session("2".repeat(64), now - 10), null);
  assert.equal(await store.signOutEverywhere(), 1);
  await store.clean(now + 3 * 3_600_000);
  assert.ok(data.get("s")!.has("2".repeat(64)) && data.get("r")!.has("p".repeat(32)), "the player's documents stay");
  assert.equal(data.get("r")!.get("p".repeat(32))!.delivered, false);
});
