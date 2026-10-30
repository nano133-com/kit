// The friends rules (friendsStoreConformance) run against the memory store, the D1 adapter (on SQLite, with the package's own d1.sql) and the
// Firestore adapter (on an in-memory fake of the small interface it uses), plus what is specific to each: the tables or collections it may write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryFriends } from "../src/friends/index.js";
import { createD1Friends } from "../src/friends/adapters/d1.js";
import { createFirestoreFriends, type FirestoreFriendsLike, type FriendsDocRef, type FriendsQuery, type FriendsQuerySnap, type FriendsTransaction } from "../src/friends/adapters/firestore.js";
import { friendsStoreConformance, type FriendsConformanceCase } from "../src/friends/conformance.js";
import type { D1Like, D1StatementLike } from "../src/admin/adapters/d1.js";
import { FRIEND_LIMIT } from "../src/friends/types.js";

const run = (name: string, cases: FriendsConformanceCase[]) => {
  for (const c of cases) test(`${name}: ${c.name}`, c.run);
};
const counts: Record<string, number> = {};
const runCounted = (name: string, cases: FriendsConformanceCase[]) => {
  counts[name] = cases.length;
  run(name, cases);
};

// ---- the memory store ----

runCounted("friends memory", friendsStoreConformance(async () => {
  const store = createMemoryFriends();
  return { store, dump: async () => JSON.stringify([[...store.edges.values()], [...store.presence.values()], [...store.prefs.entries()]]) };
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
const SCHEMA = readFileSync(new URL("../src/friends/adapters/d1.sql", import.meta.url), "utf8");

function d1Over(db: Sqlite, log: { sql: string; args: unknown[] }[] = []): D1Like {
  const stmt = (sql: string, args: unknown[] = []): D1StatementLike & { exec(): unknown } => ({
    bind: (...v) => stmt(sql, v),
    all: async <T>() => (log.push({ sql, args }), { results: db.prepare(sql).all(...(args as never[])) as T[] }),
    first: async <T>() => (log.push({ sql, args }), ((db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null)),
    run: async () => (log.push({ sql, args }), { meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    exec: () => (log.push({ sql, args }), db.prepare(sql).run(...(args as never[]))),
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

function d1Harness() {
  const db = new DatabaseSync!(":memory:");
  db.exec(SCHEMA);
  // A table of the game that the adapter must never touch.
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL); INSERT INTO meta VALUES ('setting:friends', 'own', 1);");
  const log: { sql: string; args: unknown[] }[] = [];
  const store = createD1Friends(d1Over(db, log));
  const dump = async () => ["friend_edges", "friend_presence", "friend_prefs"].map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())).join("|");
  return { db, log, store, dump };
}

if (skip) test("friends D1 adapter on SQLite", { skip }, () => {});
else {
  runCounted("friends D1", friendsStoreConformance(async () => d1Harness()));

  test("friends D1: every statement reads or writes only the three friends tables, and binds its values", async () => {
    const h = d1Harness();
    const now = Date.now();
    await h.store.request("p1", "p2", now);
    const edge = (await h.store.view("p1", { byName: async () => null, names: async () => new Map() }, now)).people[0].edge;
    await h.store.accept("p2", edge, now + 1);
    await h.store.invite("p1", edge, "Room", now + 2);
    await h.store.pulse("p1", "Room", "lease-0001", now + 3);
    await h.store.setShowOnline("p1", false);
    await h.store.block("p2", edge, now + 4);
    await h.store.unblock("p2", edge, now + 5);
    await h.store.forget("p1");
    assert.ok(h.log.length > 10);
    for (const { sql } of h.log) {
      const tables = [...sql.matchAll(/\b(?:FROM|INTO|(?<!DO )UPDATE|JOIN)\s+(\w+)/gi)].map((m) => m[1]);
      for (const t of tables) assert.ok(["friend_edges", "friend_presence", "friend_prefs"].includes(t), `${t} in: ${sql}`);
      assert.doesNotMatch(sql, /'p[12]'|'Room'|lease-0001/, "values are bound, not written into the SQL");
    }
    assert.equal((h.db.prepare("SELECT value FROM meta WHERE key = 'setting:friends'").get() as { value: string }).value, "own", "the game's own table is untouched");
  });

  test("friends D1: a write on a row that changed after it was read is refused (409), not lost", async () => {
    const h = d1Harness();
    const now = Date.now();
    await h.store.request("p1", "p2", now);
    const edge = (await h.store.view("p2", { byName: async () => null, names: async () => new Map() }, now)).people[0].edge;
    // Another request changes the row between this accept's read and its write: the rev moves on under it.
    h.db.prepare("UPDATE friend_edges SET rev = rev + 5 WHERE edge = ?").run(edge);
    const stale = createD1Friends({
      ...d1Over(h.db),
      prepare(sql: string) {
        const s = d1Over(h.db).prepare(sql);
        if (/^SELECT .* FROM friend_edges WHERE edge = \?$/.test(sql)) {
          return { ...s, bind: (...v: unknown[]) => ({ ...s.bind(...v), first: async <T>() => ({ ...(h.db.prepare(sql).get(...(v as never[])) as object), rev: 1 }) as T }) } as D1StatementLike;
        }
        return s;
      },
    });
    await assert.rejects(stale.accept("p2", edge, now + 1), (e: Error & { status?: number }) => e.status === 409);
  });

  test("friends D1: the full-list rule holds in the INSERT itself (a row added between the count and the write is counted)", async () => {
    const h = d1Harness();
    const now = Date.now();
    for (let i = 0; i < FRIEND_LIMIT - 1; i++) h.db.prepare("INSERT INTO friend_edges (edge, a, b, from_player, state, at) VALUES (?, ?, ?, ?, 'friend', ?)").run(`e${String(i).padStart(8, "0")}`, "a-full", `z${i}`, "a-full", now);
    // A store whose count read is stale (it says 0) still cannot pass the limit: the INSERT counts again.
    const stale = createD1Friends({
      ...d1Over(h.db),
      prepare(sql: string) {
        const s = d1Over(h.db).prepare(sql);
        if (/^SELECT \(SELECT COUNT/.test(sql)) return { ...s, bind: (...v: unknown[]) => ({ ...s.bind(...v), first: async <T>() => ({ n: 0 }) as T }) } as D1StatementLike;
        return s;
      },
    });
    h.db.prepare("INSERT INTO friend_edges (edge, a, b, from_player, state, at) VALUES ('e-last-one', 'a-full', 'zz', 'a-full', 'friend', ?)").run(now);
    await assert.rejects(stale.request("a-full", "b-new", now + 1), (e: Error & { status?: number }) => e.status === 409);
    assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM friend_edges WHERE a = 'a-full' OR b = 'a-full'").get() as { n: number }).n, FRIEND_LIMIT);
  });
}

// ---- Firestore, on a fake ----

type Data = Record<string, unknown>;
function fakeFirestore() {
  const cols = new Map<string, Map<string, Data>>();
  const writes: string[] = [];
  const col = (name: string) => cols.get(name) ?? cols.set(name, new Map()).get(name)!;
  type Ref = FriendsDocRef & { __col: string; __id: string };
  const ref = (name: string, id: string): Ref => ({
    __col: name,
    __id: id,
    async get() {
      const d = col(name).get(id);
      return { exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
    },
  });
  const query = (name: string, filters: [string, string, unknown][] = [], max?: number): FriendsQuery & { doc(id: string): Ref } => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]], max),
    limit: (n) => query(name, filters, n),
    async get(): Promise<FriendsQuerySnap> {
      let docs = [...col(name)].filter(([, d]) => filters.every(([f, op, v]) => (op === "==" ? d[f] === v : Array.isArray(d[f]) && (d[f] as unknown[]).includes(v))));
      if (max) docs = docs.slice(0, max);
      return { docs: docs.map(([id, d]) => ({ id, ref: ref(name, id), data: () => structuredClone(d) })) };
    },
    doc: (id) => ref(name, id),
  });
  const setDoc = (r: FriendsDocRef, data: Data, merge = false) => {
    const { __col, __id } = r as Ref;
    col(__col).set(__id, merge ? { ...(col(__col).get(__id) ?? {}), ...data } : structuredClone(data));
    writes.push(__col);
  };
  const delDoc = (r: FriendsDocRef) => {
    const { __col, __id } = r as Ref;
    col(__col).delete(__id);
    writes.push(__col);
  };
  const db: FirestoreFriendsLike = {
    collection: (name) => query(name),
    async runTransaction(fn) {
      // Reads see the store as it is; the writes apply at the end, all together (as Firestore does).
      const pending: (() => void)[] = [];
      const tx = {
        get: (target: FriendsDocRef | FriendsQuery) => (target as FriendsDocRef & FriendsQuery).get(),
        set: (r: FriendsDocRef, data: Data) => pending.push(() => setDoc(r, data)),
        delete: (r: FriendsDocRef) => pending.push(() => delDoc(r)),
      } as unknown as FriendsTransaction;
      const out = await fn(tx);
      for (const p of pending) p();
      return out;
    },
    batch() {
      const pending: (() => void)[] = [];
      return {
        set: (r, data, o) => pending.push(() => setDoc(r, data, Boolean(o?.merge))),
        delete: (r) => pending.push(() => delDoc(r)),
        async commit() {
          assert.ok(pending.length <= 500, "a batch holds at most 500 writes");
          for (const p of pending) p();
        },
      };
    },
  };
  return { db, cols, col, writes };
}

function firestoreHarness(names?: { edges?: string; presence?: string; prefs?: string }) {
  const f = fakeFirestore();
  const store = createFirestoreFriends(f.db, names);
  const dump = async () => JSON.stringify([...f.cols].map(([name, docs]) => [name, [...docs]]));
  return { ...f, store, dump };
}

runCounted("friends Firestore", friendsStoreConformance(async () => firestoreHarness()));

test("friends Firestore: the only collections written are the three, and they can be renamed", async () => {
  const h = firestoreHarness({ edges: "fe", presence: "fp", prefs: "fs" });
  const now = Date.now();
  await h.store.request("p1", "p2", now);
  const edge = (await h.store.view("p2", { byName: async () => null, names: async () => new Map() }, now)).people[0].edge;
  await h.store.accept("p2", edge, now + 1);
  await h.store.pulse("p1", "Room", "lease-0001", now + 2);
  await h.store.setShowOnline("p2", false);
  await h.store.forget("p1");
  assert.deepEqual([...new Set(h.writes)].sort(), ["fe", "fp", "fs"]);
  assert.equal(h.cols.has("friend_edges"), false);
});

test("friends Firestore: a pair has one document, named by a digest (any id makes a valid document id)", async () => {
  const h = firestoreHarness();
  const now = Date.now();
  await h.store.request("a/b..", "__x__", now);
  await h.store.request("__x__", "a/b..", now + 1);
  const ids = [...h.col("friend_edges").keys()];
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^[0-9a-f]{64}$/);
  const doc = h.col("friend_edges").get(ids[0])!;
  assert.equal(doc.state, "friend");
  assert.ok(typeof doc.edge === "string" && doc.edge !== ids[0], "the browser's edge is not the document id");
});

test("friends Firestore: forget deletes in batches of at most 400", async () => {
  const h = firestoreHarness();
  const now = Date.now();
  for (let i = 0; i < 90; i++) await h.store.request(`fan${i}`, "star", now + i);
  assert.equal(await h.store.forget("star"), 90);
  assert.equal(h.col("friend_edges").size, 0);
});

test("the conformance suite is the same on every store", () => {
  const values = Object.values(counts);
  assert.ok(values.length >= 2 && values.every((v) => v === values[0] && v >= 18), JSON.stringify(counts));
});
