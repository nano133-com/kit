// The shop's money rules (shopStoreConformance) run against the memory store, the D1 adapter (on SQLite: the package's d1.sql AND the game starter's own
// 0001_init.sql) and the Firestore adapter (on a fake with real transaction conflicts), plus what is specific to each: the tables it may write, the data
// the starter already has, the admin reading the same rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createD1Store } from "../src/admin/adapters/d1.js";
import { createFirestoreStore, type FirestoreLike } from "../src/admin/adapters/firestore.js";
import { createD1Shop, d1Limit, visitorKey } from "../src/shop/adapters/d1.js";
import { createFirestoreShop } from "../src/shop/adapters/firestore.js";
import { SHOP_CASE_TIMEOUT_MS, shopStoreConformance, type ShopConformanceCase } from "../src/shop/conformance.js";
import { createMemoryShop, priceRaw, reserveOrder } from "../src/shop/index.js";
import { d1Over, fakeFirestore, hash64, noSqlite, sqlite, testAddress } from "./shop-helpers.js";

const counts: Record<string, number> = {};
const run = (name: string, cases: ShopConformanceCase[]) => {
  counts[name] = cases.length;
  for (const c of cases) test(`${name}: ${c.name}`, { timeout: SHOP_CASE_TIMEOUT_MS }, c.run);
};

const STARTER = readFileSync(new URL("./fixtures/starter-0001_init.sql", import.meta.url), "utf8");

// ---- memory ----

run("shop memory", shopStoreConformance(async () => {
  const store = createMemoryShop();
  return { store, dump: async () => JSON.stringify([[...store.orders.values()], [...store.ownedRows.values()]]) };
}));

// ---- D1 ----

function d1Harness(schema?: string) {
  const db = sqlite(schema);
  const log: { sql: string; args: unknown[] }[] = [];
  const store = createD1Shop(d1Over(db, log));
  const dump = async () => ["orders", "owned", "meta"].map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())).join("|");
  return { db, log, store, dump };
}

if (noSqlite) test("shop D1 adapter on SQLite", { skip: noSqlite }, () => {});
else {
  run("shop D1", shopStoreConformance(async () => d1Harness()));
  run("shop D1 on the starter's own tables", shopStoreConformance(async () => d1Harness(STARTER)));

  test("shop D1: every statement reads or writes only orders, owned and meta (the keys rate and scan), and binds its values", async () => {
    const h = d1Harness(STARTER);
    h.db.exec("INSERT INTO meta VALUES ('setting:friends', 'own', 1)");
    const T = 1_800_000_000_000;
    const player = testAddress();
    const o = await reserveOrder(h.store, { player, lookId: "red-coat", usd: "0.25", rate: 1, price: priceRaw(0.25, 1)!, visitor: "v-hash", now: T });
    await h.store.settle(o, { hash: hash64(), payer: player, seenMs: T + 1000 }, T + 1000);
    await h.store.claimScan(T, 4000);
    await h.store.saveRate({ usd: 1, sources: ["A"], at: T });
    await h.store.readRate();
    await h.store.owned(player);
    await h.store.forget(player, T + 10_000_000);
    for (const { sql, args } of h.log) {
      const tables = [...sql.matchAll(/\b(?:FROM|INTO|(?<!DO )UPDATE|JOIN)\s+(\w+)/gi)].map((m) => m[1]);
      for (const t of tables) assert.ok(["orders", "owned", "meta"].includes(t), `${t} in: ${sql}`);
      assert.ok(!sql.includes(player) && !sql.includes("v-hash"), "values are bound, not written into the SQL");
      if (/\bmeta\b/.test(sql)) assert.match(sql, /'rate'|'scan'/, sql);
      assert.ok(args.every((a) => typeof a !== "object" || a === null), "every value is plain");
    }
    for (const t of ["sessions", "signin_requests", "hits"]) assert.equal((h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0, `${t} untouched`);
    assert.equal((h.db.prepare("SELECT value FROM meta WHERE key = 'setting:friends'").get() as { value: string }).value, "own", "the admin's setting is untouched");
  });

  test("shop D1: the starter's existing rows are read as they are (an order, a paid order and an owned look made by the starter's own code)", async () => {
    const h = d1Harness(STARTER);
    const player = testAddress();
    const T = 1_800_000_000_000;
    // Rows exactly as the starter's orders.ts writes them (reserve, then settle).
    h.db.prepare("INSERT INTO orders (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)")
      .run("a".repeat(24), player, "red-coat", "0.25", 1.02, "2500000000000000000000000000000", "2500000000000000000000000000000", T, T + 900_000, T + 4_500_000, "vk");
    h.db.prepare("INSERT INTO orders (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, hash, payer, paid_at, visitor) VALUES (?, ?, ?, ?, ?, ?, NULL, 'paid', ?, ?, ?, ?, ?, ?, ?)")
      .run("b".repeat(24), player, "blue-cap", "0.25", 1, "2501000000000000000000000000000", T - 9_000_000, T - 8_100_000, T - 4_500_000, "C".repeat(64), player, T - 8_500_000, "vk");
    h.db.prepare("INSERT INTO owned (player, look_id, order_id, granted_at) VALUES (?, ?, ?, ?)").run(player, "blue-cap", "b".repeat(24), T - 8_400_000);
    const open = await h.store.order("a".repeat(24));
    assert.deepEqual(open, { id: "a".repeat(24), player, lookId: "red-coat", usd: "0.25", rate: 1.02, amount: "2500000000000000000000000000000", amountLock: "2500000000000000000000000000000", status: "open", createdAt: T, expiresAt: T + 900_000, holdUntil: T + 4_500_000, hash: null, payer: null, paidAt: null, visitor: "vk" });
    assert.deepEqual(await h.store.owned(player), ["blue-cap"]);
    assert.equal(await h.store.owns(player, "blue-cap"), true);
    assert.deepEqual((await h.store.usedHashes(["C".repeat(64)])).size, 1);
    // A new order of the same price steps over the starter's held amount.
    const next = await reserveOrder(h.store, { player: testAddress(), lookId: "red-coat", usd: "0.25", rate: 1, price: "2500000000000000000000000000000", visitor: null, now: T + 1000 });
    assert.equal(next.amount, "2500100000000000000000000000000"); // 2.5 XNO + one step (0.0001 XNO)
    // The admin's own D1 store reads the shop's rows (one database, one truth).
    const summary = await createD1Store(d1Over(h.db)).summary(T + 2000);
    assert.equal(summary.counts.open, 2);
    assert.equal(summary.counts.paid, 1);
    assert.deepEqual(summary.players, [{ player, looks: [{ id: "blue-cap", at: T - 8_400_000 }] }]);
  });

  test("shop D1: table names can be changed, and a name that is not plain is refused", async () => {
    const db = sqlite(SHOP_SQL_RENAMED);
    const store = createD1Shop(d1Over(db), { tables: { orders: "shop_orders", owned: "shop_owned", meta: "shop_meta" } });
    const o = await reserveOrder(store, { player: "p1", lookId: "red-coat", usd: "0.25", rate: 1, price: priceRaw(0.25, 1)!, visitor: null, now: 1 });
    assert.equal((await store.order(o.id))?.player, "p1");
    assert.throws(() => createD1Shop(d1Over(db), { tables: { orders: "orders; DROP TABLE x" } }), /plain/);
  });

  test("shop D1: d1Limit counts for the whole game in `hits`, and visitorKey hashes the IP with the game's salt (never the IP)", async () => {
    const db = sqlite(STARTER);
    const d1 = d1Over(db);
    const T = 1_800_000_000_000;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await d1Limit(d1, "order|x", 3, 60_000, T));
    assert.deepEqual(results, [true, true, true, false]);
    assert.equal(await d1Limit(d1, "order|x", 3, 60_000, T + 60_000), true, "a new window");
    const req = (ip: string) => new Request("https://game.example/api/orders", { headers: { "CF-Connecting-IP": ip } });
    const a = await visitorKey(d1, req("203.0.113.7"));
    assert.match(a, /^[0-9a-f]{32}$/);
    assert.equal(await visitorKey(d1, req("203.0.113.7")), a, "the same salt every time");
    assert.notEqual(await visitorKey(d1, req("203.0.113.8")), a);
    assert.equal(await visitorKey(d1, req("2001:db8:1:2:3:4:5:6")), await visitorKey(d1, req("2001:db8:1:2:aaaa::1")), "an IPv6 address by its /64");
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM meta").all()).includes("203.0.113"), "no IP is kept");
  });
}

const SHOP_SQL_RENAMED = readFileSync(new URL("../src/shop/adapters/d1.sql", import.meta.url), "utf8")
  .replace(/\borders\b/g, "shop_orders")
  .replace(/\bowned\b/g, "shop_owned")
  .replace(/\bmeta\b/g, "shop_meta");

// ---- Firestore ----

function firestoreHarness(names?: Parameters<typeof createFirestoreShop>[1]) {
  const f = fakeFirestore();
  return { ...f, store: createFirestoreShop(f.db, names) };
}

run("shop Firestore", shopStoreConformance(async () => {
  const h = firestoreHarness();
  return { store: h.store, dump: h.dump };
}));

test("shop Firestore: it writes only its five collections, and they can be renamed", async () => {
  const h = firestoreHarness({ orders: "o", owned: "w", meta: "m", amounts: "a", hashes: "x" });
  const T = 1_800_000_000_000;
  const o = await reserveOrder(h.store, { player: "p1", lookId: "red-coat", usd: "0.25", rate: 1, price: priceRaw(0.25, 1)!, visitor: null, now: T });
  await h.store.settle(o, { hash: hash64(), payer: "p1", seenMs: T + 1 }, T + 1);
  await h.store.claimScan(T, 4000);
  await h.store.saveRate({ usd: 1, sources: ["A"], at: T });
  await h.store.forget("p1", T + 10_000_000);
  assert.deepEqual([...new Set(h.writes)].sort(), ["a", "m", "o", "w", "x"]);
  assert.equal(h.cols.has("orders"), false);
});

test("shop Firestore: the admin's Firestore store reads the shop's orders, owned looks and price", async () => {
  const h = firestoreHarness();
  const T = 1_800_000_000_000;
  const o = await reserveOrder(h.store, { player: "nano_buyer", lookId: "red-coat", usd: "0.25", rate: 1, price: priceRaw(0.25, 1)!, visitor: null, now: T });
  await h.store.settle(o, { hash: hash64(), payer: "nano_buyer", seenMs: T + 1 }, T + 2);
  await h.store.saveRate({ usd: 0.9, sources: ["A", "B"], at: T });
  // The admin's interface has orderBy; the fake's query has none: sort in the wrapper, as Firestore would.
  const adminView: FirestoreLike = {
    collection: (name) => {
      const c = h.db.collection(name);
      const q = (dir?: "asc" | "desc", n?: number): ReturnType<FirestoreLike["collection"]> => ({
        orderBy: (_f, d) => q(d, n),
        limit: (m) => q(dir, m),
        get: async () => {
          const docs = (await c.get()).docs.sort((a, b) => ((a.data().createdAt as number) - (b.data().createdAt as number)) * (dir === "desc" ? -1 : 1));
          return { docs: n ? docs.slice(0, n) : docs };
        },
        doc: (id) => c.doc(id),
      });
      return q();
    },
    batch: () => h.db.batch() as unknown as ReturnType<FirestoreLike["batch"]>,
  };
  const s = await createFirestoreStore(adminView).summary(T + 3);
  assert.equal(s.counts.paid, 1);
  assert.equal(s.orders[0].lookId, "red-coat");
  assert.equal(s.orders[0].xno, "0.25");
  assert.deepEqual(s.players, [{ player: "nano_buyer", looks: [{ id: "red-coat", at: T + 2 }] }]);
  assert.deepEqual(s.rate, { usd: 0.9, sources: ["A", "B"], at: T });
});

test("the conformance suite is the same on every store", () => {
  const values = Object.values(counts);
  assert.ok(values.length >= 2 && values.every((v) => v === values[0] && v >= 17), JSON.stringify(counts));
});
