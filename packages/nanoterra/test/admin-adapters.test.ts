// The store contract (adapterConformance) run against the memory store, the D1 adapter (on SQLite, with the game starter's tables) and the Firestore adapter
// (on an in-memory fake of the small interface it uses), plus what is specific to each: the ONLY writes are the two settings.
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStore, xnoText, RAW_PER_XNO, type OrderRow } from "../src/admin/index.js";
import { createD1Store, type D1Like, type D1StatementLike } from "../src/admin/adapters/d1.js";
import { createFirestoreStore, type FirestoreLike } from "../src/admin/adapters/firestore.js";
import { adminStoreConformance, type ConformanceCase, type StoreHarness } from "../src/admin/conformance.js";

const run = (name: string, cases: ConformanceCase[]) => {
  for (const c of cases) test(`${name}: ${c.name}`, c.run);
};

// ---- the memory store ----

run("memory store", adminStoreConformance(async () => {
  const store = createMemoryStore();
  const h: StoreHarness = {
    store,
    async seed(d) {
      if (d.orders) store.orders = d.orders;
      if (d.owned) store.owned = d.owned;
      if (d.rate) store.rate = (await import("../src/admin/index.js")).parseRate(d.rate.value, d.rate.at);
    },
    async snapshot() {
      return JSON.stringify([store.orders, store.owned, store.rate]);
    },
  };
  return h;
}));

// ---- D1, on SQLite ----

const SCHEMA = `
CREATE TABLE orders (id TEXT PRIMARY KEY, player TEXT NOT NULL, look_id TEXT NOT NULL, usd TEXT NOT NULL, rate REAL NOT NULL DEFAULT 1, amount TEXT NOT NULL, amount_lock TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, hold_until INTEGER NOT NULL DEFAULT 0, hash TEXT UNIQUE, payer TEXT, paid_at INTEGER, visitor TEXT);
CREATE TABLE owned (player TEXT NOT NULL, look_id TEXT NOT NULL, order_id TEXT NOT NULL DEFAULT '', granted_at INTEGER NOT NULL, PRIMARY KEY (player, look_id));
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);`;

type Sqlite = import("node:sqlite").DatabaseSync;
let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : "node:sqlite is not in this Node";

/** A D1-shaped wrapper over SQLite. `log` keeps every statement and what it was bound to. */
function d1Over(db: Sqlite, log: { sql: string; args: unknown[] }[] = []): D1Like {
  const stmt = (sql: string, args: unknown[] = []): D1StatementLike & { exec(): unknown } => ({
    bind: (...v) => stmt(sql, v),
    all: async <T>() => (log.push({ sql, args }), { results: db.prepare(sql).all(...(args as never[])) as T[] }),
    first: async <T>() => (log.push({ sql, args }), ((db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null)),
    run: async () => (log.push({ sql, args }), db.prepare(sql).run(...(args as never[]))),
    exec: () => (log.push({ sql, args }), db.prepare(sql).run(...(args as never[]))),
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      try {
        for (const s of list as ReturnType<typeof stmt>[]) s.exec();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  };
}

function d1Harness(): StoreHarness & { log: { sql: string; args: unknown[] }[]; db: Sqlite } {
  const db = new DatabaseSync!(":memory:");
  db.exec(SCHEMA);
  const log: { sql: string; args: unknown[] }[] = [];
  return {
    db,
    log,
    store: createD1Store(d1Over(db, log)),
    async seed(d) {
      for (const o of d.orders ?? []) {
        db.prepare("INSERT INTO orders (id, player, look_id, usd, amount, status, created_at, expires_at, paid_at, payer, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(o.id, o.player, o.lookId, o.usd, o.amountRaw, o.status, o.createdAt, o.expiresAt, o.paidAt, o.payer, o.hash);
      }
      for (const o of d.owned ?? []) db.prepare("INSERT OR REPLACE INTO owned (player, look_id, granted_at) VALUES (?, ?, ?)").run(o.player, o.lookId, o.at);
      if (d.rate) db.prepare("INSERT OR REPLACE INTO meta (key, value, at) VALUES ('rate', ?, ?)").run(d.rate.value, d.rate.at);
    },
    async snapshot() {
      const q = (sql: string) => JSON.stringify(db.prepare(sql).all());
      return [q("SELECT * FROM orders ORDER BY id"), q("SELECT * FROM owned ORDER BY player, look_id"), q("SELECT * FROM meta WHERE key NOT IN ('setting:character', 'setting:signin') ORDER BY key")].join("|");
    },
  };
}

if (skip) test("D1 adapter on SQLite", { skip }, () => {});
else {
  run("D1 adapter", adminStoreConformance(async () => d1Harness()));

  test("D1 adapter: the only statements that write are the two setting rows of meta, and every other statement is a SELECT", async () => {
    const h = d1Harness();
    await h.seed({ orders: [{ id: "1", player: "p", lookId: "l", usd: "0.25", amountRaw: "1", status: "paid", createdAt: 1, expiresAt: 2, paidAt: 1, payer: "p", hash: "h" }] });
    h.log.length = 0;
    await h.store.readSettings();
    await h.store.saveSettings({ character: "own", signin: "none" }, 5);
    await h.store.summary(10);
    assert.ok(h.log.length >= 6);
    for (const { sql, args } of h.log) {
      if (/^\s*SELECT/i.test(sql)) continue;
      assert.match(sql, /^INSERT INTO meta \(key, value, at\) VALUES \(\?, \?, \?\) ON CONFLICT \(key\) DO UPDATE/, sql);
      assert.ok(["setting:character", "setting:signin"].includes(String(args[0])), `a write to the meta row ${String(args[0])}`);
    }
  });

  test("D1 adapter: a patch for both switches is one batch, all or none", async () => {
    const h = d1Harness();
    // Make the second write fail: a row with the key of the first is fine, but a trigger that rejects the second key makes the batch fail.
    h.db.exec("CREATE TRIGGER no_signin BEFORE INSERT ON meta WHEN NEW.key = 'setting:signin' BEGIN SELECT RAISE(ABORT, 'no'); END;");
    await assert.rejects(h.store.saveSettings({ character: "own", signin: "none" }, 5));
    const s = await h.store.readSettings();
    assert.equal(s.character, undefined, "the first write was undone");
  });

  test("D1 adapter: the same SQL as the game starter's own summary (counts over all orders, the list of the newest 500)", async () => {
    const h = d1Harness();
    h.log.length = 0;
    await h.store.summary(10);
    const sqls = h.log.map((l) => l.sql.replace(/\s+/g, " "));
    assert.ok(sqls.some((q) => q.includes("FROM orders ORDER BY created_at DESC LIMIT ?")));
    assert.ok(sqls.some((q) => q.includes("SELECT status, expires_at < ? AS past, COUNT(*) AS n FROM orders GROUP BY status, past")));
    assert.ok(sqls.some((q) => q.includes("SELECT status, amount, usd FROM orders WHERE status IN ('paid', 'paid_late')")));
  });
}

// ---- Firestore, on a fake ----

type Data = Record<string, unknown>;
function fakeFirestore() {
  const cols = new Map<string, Map<string, Data>>();
  const writes: { path: string; data: Data }[] = [];
  const col = (name: string) => cols.get(name) ?? cols.set(name, new Map()).get(name)!;
  const query = (name: string, order?: [string, "asc" | "desc"], max?: number) => {
    const q = {
      orderBy: (f: string, d: "asc" | "desc" = "asc") => query(name, [f, d], max),
      limit: (n: number) => query(name, order, n),
      async get() {
        let docs = [...col(name)].map(([id, data]) => ({ id, data: () => data }));
        if (order) docs = docs.sort((a, b) => (Number(a.data()[order[0]]) - Number(b.data()[order[0]])) * (order[1] === "desc" ? -1 : 1));
        return { docs: max ? docs.slice(0, max) : docs };
      },
      doc: (id: string) => ({ __path: `${name}/${id}`, async get() { const d = col(name).get(id); return { exists: d !== undefined, data: () => d }; } }),
    };
    return q;
  };
  const db: FirestoreLike = {
    collection: (name) => query(name),
    batch() {
      const pending: { path: string; data: Data; merge: boolean }[] = [];
      return {
        set(doc, data, options) { pending.push({ path: (doc as unknown as { __path: string }).__path, data, merge: Boolean(options?.merge) }); },
        async commit() {
          for (const p of pending) {
            const [c, id] = [p.path.slice(0, p.path.indexOf("/")), p.path.slice(p.path.indexOf("/") + 1)];
            col(c).set(id, p.merge ? { ...(col(c).get(id) ?? {}), ...p.data } : p.data);
            writes.push({ path: p.path, data: p.data });
          }
        },
      };
    },
  };
  return { db, cols, writes, col };
}

function firestoreHarness() {
  const f = fakeFirestore();
  const h: StoreHarness & { writes: typeof f.writes } = {
    writes: f.writes,
    store: createFirestoreStore(f.db),
    async seed(d) {
      for (const o of d.orders ?? []) f.col("orders").set(o.id, { player: o.player, lookId: o.lookId, usd: o.usd, amount: o.amountRaw, status: o.status, createdAt: o.createdAt, expiresAt: o.expiresAt, paidAt: o.paidAt, payer: o.payer, hash: o.hash });
      for (const o of d.owned ?? []) f.col("owned").set(`${o.player}__${o.lookId}`, { player: o.player, lookId: o.lookId, orderId: "", grantedAt: o.at });
      if (d.rate) f.col("meta").set("rate", { value: d.rate.value, at: d.rate.at });
    },
    async snapshot() {
      const dump = (name: string, skipKeys: string[] = []) => JSON.stringify([...f.col(name)].filter(([id]) => !skipKeys.includes(id)).sort(([a], [b]) => (a < b ? -1 : 1)));
      return [dump("orders"), dump("owned"), dump("meta", ["setting:character", "setting:signin"])].join("|");
    },
  };
  return h;
}

run("Firestore adapter", adminStoreConformance(async () => firestoreHarness()));

test("Firestore adapter: the only writes are the two setting documents of meta", async () => {
  const h = firestoreHarness();
  await h.store.saveSettings({ character: "own" }, 7);
  await h.store.saveSettings({ signin: "none", character: "nanoterra" }, 8);
  await h.store.summary(10);
  await h.store.readSettings();
  assert.ok(h.writes.length === 3);
  for (const w of h.writes) assert.match(w.path, /^meta\/setting:(character|signin)$/);
});

test("Firestore adapter: the three collections can be renamed, and nothing else", async () => {
  const f = fakeFirestore();
  const store = createFirestoreStore(f.db, { meta: "m", orders: "o", owned: "w" });
  await store.saveSettings({ signin: "none" }, 1);
  assert.equal(f.col("m").get("setting:signin")?.value, "none");
  assert.equal(f.cols.has("meta"), false);
  f.col("o").set("x", { player: "p", lookId: "l", usd: "1", amount: "10", status: "paid", createdAt: 1, expiresAt: 2 });
  assert.equal((await store.summary(5)).counts.paid, 1);
});

test("a row with bad data (a raw amount that is not digits, a time that is not a number) does not break the summary", async () => {
  const f = fakeFirestore();
  f.col("orders").set("bad", { player: 5, lookId: null, usd: "x", amount: "12.5e3", status: "paid", createdAt: "yesterday", expiresAt: undefined });
  const s = await createFirestoreStore(f.db).summary(5);
  assert.equal(s.counts.paid, 1);
  assert.equal(s.totals.paid.xno, "0");
  assert.equal(s.orders[0].xno, "0");
});

// ---- amounts ----

test("xnoText writes a raw amount as XNO with every significant digit", () => {
  assert.equal(xnoText((2512n * 10n ** 26n).toString()), "0.2512");
  assert.equal(xnoText(RAW_PER_XNO.toString()), "1");
  assert.equal(xnoText("0"), "0");
  assert.equal(xnoText((RAW_PER_XNO * 123n + 5n * 10n ** 28n).toString()), "123.05");
  assert.equal(xnoText("1"), "0.000000000000000000000000000001");
});

// ---- what the security read found ----

test("a row with an odd status or an odd dollar text does not change the counts or the totals", async () => {
  const store = createMemoryStore({
    orders: [
      { id: "1", player: "p", lookId: "l", usd: "0.25", amountRaw: "1", status: "paid", createdAt: 1, expiresAt: 2, paidAt: 1, payer: "p", hash: "a" },
      { id: "2", player: "p", lookId: "l", usd: "-5", amountRaw: "1", status: "paid", createdAt: 2, expiresAt: 3, paidAt: 1, payer: "p", hash: "b" },
      { id: "3", player: "p", lookId: "l", usd: "0x10", amountRaw: "1", status: "paid", createdAt: 3, expiresAt: 4, paidAt: 1, payer: "p", hash: "c" },
      { id: "4", player: "p", lookId: "l", usd: "1e3", amountRaw: "1", status: "constructor", createdAt: 4, expiresAt: 5, paidAt: 1, payer: "p", hash: "d" },
      { id: "5", player: "p", lookId: "l", usd: "0.75", amountRaw: "1", status: "toString", createdAt: 5, expiresAt: 6, paidAt: 1, payer: "p", hash: "e" },
    ],
  });
  const s = await store.summary(0);
  assert.deepEqual(Object.keys(s.counts), ["open", "paid", "expired", "paid_late"]);
  assert.deepEqual(s.counts, { open: 0, paid: 3, expired: 0, paid_late: 0 });
  assert.equal(s.totals.paid.usd, "0.25", "a negative, a hex and an exponent text count as 0");
});
