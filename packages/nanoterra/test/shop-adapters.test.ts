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
import { createMemoryShop, priceRaw, reserveOrder, ShopBusy, xnoText } from "../src/shop/index.js";
import { PLAYS_SQL, SHOP_SQL, d1Over, fakeFirestore, hash64, noSqlite, sqlite, testAddress } from "./shop-helpers.js";

const counts: Record<string, number> = {};
/** The runs with no plays' cases (a store that sells looks only), counted apart. */
const looksOnly: Record<string, number> = {};
const run = (name: string, cases: ShopConformanceCase[], tally = counts) => {
  tally[name] = cases.length;
  for (const c of cases) test(`${name}: ${c.name}`, { timeout: SHOP_CASE_TIMEOUT_MS }, c.run);
};

const STARTER = readFileSync(new URL("./fixtures/starter-0001_init.sql", import.meta.url), "utf8");

// ---- memory ----

run("shop memory", shopStoreConformance(async () => {
  const store = createMemoryShop();
  return { store, dump: async () => JSON.stringify([[...store.orders.values()], [...store.ownedRows.values()], [...store.creditRows.values()], [...store.adultRows]]) };
}));

// ---- D1 ----

/** A D1 shop on SQLite: `schema` (default the package's d1.sql), and with `plays` the plays' migration after it and `{ plays: true }`. */
function d1Harness(schema?: string, plays = false) {
  const db = sqlite(plays ? `${schema ?? SHOP_SQL}\n${PLAYS_SQL}` : schema);
  const log: { sql: string; args: unknown[] }[] = [];
  const store = createD1Shop(d1Over(db, log), { plays });
  const dump = async () => ["orders", "owned", "meta", ...(plays ? ["credits", "play_adults"] : [])].map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())).join("|");
  return { db, log, store, dump };
}

if (noSqlite) test("shop D1 adapter on SQLite", { skip: noSqlite }, () => {});
else {
  run("shop D1", shopStoreConformance(async () => d1Harness(undefined, true)));
  run("shop D1 on the starter's own tables and the plays' migration", shopStoreConformance(async () => d1Harness(STARTER, true)));
  // A game that sells looks only switches with no migration: the money rules of the looks hold on the starter's tables as they are.
  run("shop D1 on the starter's own tables, looks only", shopStoreConformance(async () => d1Harness(STARTER), { plays: false }), looksOnly);

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
    // Rows exactly as the starter's orders.ts writes them (reserve, then settle). They have no kind: each reads as a look.
    h.db.prepare("INSERT INTO orders (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)")
      .run("a".repeat(24), player, "red-coat", "0.25", 1.02, "2500000000000000000000000000000", "2500000000000000000000000000000", T, T + 900_000, T + 4_500_000, "vk");
    h.db.prepare("INSERT INTO orders (id, player, look_id, usd, rate, amount, amount_lock, status, created_at, expires_at, hold_until, hash, payer, paid_at, visitor) VALUES (?, ?, ?, ?, ?, ?, NULL, 'paid', ?, ?, ?, ?, ?, ?, ?)")
      .run("b".repeat(24), player, "blue-cap", "0.25", 1, "2501000000000000000000000000000", T - 9_000_000, T - 8_100_000, T - 4_500_000, "C".repeat(64), player, T - 8_500_000, "vk");
    h.db.prepare("INSERT INTO owned (player, look_id, order_id, granted_at) VALUES (?, ?, ?, ?)").run(player, "blue-cap", "b".repeat(24), T - 8_400_000);
    const open = await h.store.order("a".repeat(24));
    assert.deepEqual(open, { id: "a".repeat(24), player, lookId: "red-coat", kind: "look", usd: "0.25", rate: 1.02, amount: "2500000000000000000000000000000", amountLock: "2500000000000000000000000000000", status: "open", createdAt: T, expiresAt: T + 900_000, holdUntil: T + 4_500_000, hash: null, payer: null, paidAt: null, visitor: "vk" });
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

  test("shop D1 with plays: every statement reads or writes only orders, owned, meta and credits, and binds its values", async () => {
    const h = d1Harness(STARTER, true);
    const T = 1_800_000_000_000;
    const player = testAddress();
    const o = await reserveOrder(h.store, { player, lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: "v-hash", now: T });
    assert.equal(o.kind, "play");
    assert.equal(await h.store.settle(o, { hash: hash64(), payer: player, seenMs: T + 1000 }, T + 1000), "paid");
    assert.deepEqual(await h.store.credits(player, 0), [{ playId: "extra-round", ready: 1 }]);
    assert.deepEqual(await h.store.owned(player), [], "a play is never owned");
    assert.equal((await h.store.useCredit(player, "extra-round", "round:1", T + 2000, 0)).status, "used");
    assert.equal((await h.store.useCredit(player, "extra-round", "round:1", T + 3000, 0)).status, "again");
    assert.equal((await h.store.useCredit(player, "extra-round", "round:2", T + 3000, 0)).status, "none");
    await h.store.keepAdult(player, T + 4000);
    assert.equal(await h.store.adult(player), T + 4000);
    await h.store.forget(player, T + 10_000_000);
    for (const { sql, args } of h.log) {
      const tables = [...sql.matchAll(/\b(?:FROM|INTO|(?<!DO )UPDATE|JOIN)\s+(\w+)/gi)].map((m) => m[1]);
      for (const t of tables) assert.ok(["orders", "owned", "meta", "credits", "play_adults"].includes(t), `${t} in: ${sql}`);
      assert.ok(!sql.includes(player) && !sql.includes("v-hash") && !sql.includes("round:1"), "values are bound, not written into the SQL");
      assert.ok(args.every((a) => typeof a !== "object" || a === null), "every value is plain");
    }
    assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM credits").get() as { n: number }).n, 0, "forget deleted the credit");
    assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM play_adults").get() as { n: number }).n, 0, "forget deleted the yes");
  });

  test("shop D1 with plays: the admin's D1 store with { plays: true } reads the shop's play orders and credits: sold, ready, used, and a deleted player's unused credit to send back", async () => {
    const h = d1Harness(STARTER, true);
    const admin = createD1Store(d1Over(h.db), { plays: true });
    const T = 1_800_000_000_000;
    const ann = testAddress();
    const bob = testAddress();
    const paid = async (player: string, at: number) => {
      const o = await reserveOrder(h.store, { player, lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: at });
      assert.equal(await h.store.settle(o, { hash: hash64(), payer: player, seenMs: at + 1 }, at + 2), "paid");
      return o;
    };
    await paid(ann, T);
    const unused = await paid(bob, T + 100);
    assert.equal((await h.store.useCredit(ann, "extra-round", "round-1", T + 200, 0)).status, "used");
    let s = await admin.summary(T + 300);
    assert.deepEqual(s.plays, [{ playId: "extra-round", sold: 2, used: 1, ready: 1, late: 0, notUsedInTime: 0 }]);
    assert.deepEqual(s.players, [{ player: bob, looks: [], ready: [{ id: "extra-round", ready: 1 }] }]);
    assert.ok(s.orders.every((o) => o.kind === "play"));
    await h.store.forget(bob, unused.holdUntil + 1);
    s = await admin.summary(unused.holdUntil + 2);
    assert.deepEqual(s.sendBack?.map((x) => [x.orderId, x.why, x.payer, x.xno, x.usd]), [[unused.id, "deleted_player", bob, "0.05", "0.05"]]);
    assert.deepEqual(s.totals.sendBack, { count: 1, xno: "0.05", usd: "0.05" });
    // Past its wait (30 days) a credit is listed to send back too.
    await paid(ann, T + 400);
    s = await admin.summary(T + 400 + 31 * 86_400_000);
    assert.deepEqual(s.sendBack?.map((x) => [x.why, x.payer]), [["deleted_player", bob], ["not_used_in_time", ann]]);
    // Without { plays: true } the admin reads the tables as before and lists no play.
    assert.deepEqual((await createD1Store(d1Over(h.db)).summary(T)).plays, []);
  });

  test("shop D1: a store with no plays refuses a play order before it writes it; the starter's rows read as looks after the plays' migration", async () => {
    const T = 1_800_000_000_000;
    const play = { player: "p1", lookId: "extra-round", kind: "play" as const, usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: T };
    // The tables with no migration: looks work, a play order throws and nothing is written.
    const plain = d1Harness(STARTER);
    await assert.rejects(reserveOrder(plain.store, play), /d1-plays\.sql/);
    assert.equal((plain.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n, 0);
    assert.deepEqual(await plain.store.credits("p1", 0), []);
    assert.deepEqual(await plain.store.useCredit("p1", "extra-round", "r1", T, 0), { status: "none" });
    await assert.rejects(plain.store.useCredit("p1", "extra-round", "bad ref", T, 0), /ref/);
    // The starter's database with an order made before the migration: it reads as a look, and a paid look order still gives the look.
    const db = sqlite(STARTER);
    const before = await reserveOrder(createD1Shop(d1Over(db)), { ...play, lookId: "red-coat", kind: undefined });
    db.exec(PLAYS_SQL);
    const store = createD1Shop(d1Over(db), { plays: true });
    assert.equal((await store.order(before.id))?.kind, "look");
    assert.equal(await store.settle(before, { hash: hash64(), payer: "p1", seenMs: T + 1 }, T + 1), "paid");
    assert.deepEqual([await store.owned("p1"), await store.credits("p1", 0)], [["red-coat"], []]);
  });

  test("shop D1 with plays: the credits table can be renamed too", async () => {
    const db = sqlite(`${SHOP_SQL_RENAMED}\n${PLAYS_SQL.replace(/\borders\b/g, "shop_orders").replace(/\bcredits\b/g, "shop_credits")}`);
    const store = createD1Shop(d1Over(db), { plays: true, tables: { orders: "shop_orders", owned: "shop_owned", meta: "shop_meta", credits: "shop_credits" } });
    const o = await reserveOrder(store, { player: "p1", lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: 1 });
    await store.settle(o, { hash: hash64(), payer: "p1", seenMs: 2 }, 2);
    assert.deepEqual(await store.credits("p1", 0), [{ playId: "extra-round", ready: 1 }]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM shop_credits").get() as { n: number }).n, 1);
    assert.throws(() => createD1Shop(d1Over(db), { tables: { credits: "credits--" } }), /plain/);
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

test("shop Firestore: a transaction that loses every attempt (ABORTED) is a taken amount, and any other error still throws", async () => {
  const T = 1_800_000_000_000;
  const at = (fail: (call: number) => unknown) => {
    const f = fakeFirestore();
    let calls = 0;
    const db: typeof f.db = {
      ...f.db,
      runTransaction: (fn) => {
        const e = fail(calls++);
        return e ? Promise.reject(e) : f.db.runTransaction(fn);
      },
    };
    return { ...f, store: createFirestoreShop(db) };
  };
  const buy = (store: ReturnType<typeof createFirestoreShop>) => reserveOrder(store, { player: "p1", lookId: "red-coat", usd: "0.25", rate: 1, price: priceRaw(0.25, 1)!, visitor: null, now: T });
  const abortedError = (code: unknown) => Object.assign(new Error("10 ABORTED: Transaction lock timeout."), { code });

  // The Admin SDK's code 10 and the web SDK's "aborted": the first amount is lost, the order takes the next one and writes nothing for the first.
  for (const code of [10, "aborted"]) {
    const h = at((call) => (call === 0 ? abortedError(code) : null));
    const o = await buy(h.store);
    assert.equal(xnoText(o.amount), "0.2501", String(code));
    assert.deepEqual((await h.store.held()).map((x) => x.id), [o.id]);
  }
  // Lost on every amount: ShopBusy, as when every amount is held.
  await assert.rejects(buy(at(() => abortedError(10)).store), ShopBusy);
  // Any other error is not a lost race: it goes to the caller.
  for (const e of [abortedError(4), abortedError("deadline-exceeded"), new Error("network down")]) {
    await assert.rejects(buy(at((call) => (call === 0 ? e : null)).store), (x) => x === e);
  }
});

test("shop Firestore: plays write the credits, shop_uses and play_adults collections too, and those can be renamed", async () => {
  const h = firestoreHarness({ orders: "o", owned: "w", meta: "m", amounts: "a", hashes: "x", credits: "c", uses: "u", adults: "y" });
  const T = 1_800_000_000_000;
  const o = await reserveOrder(h.store, { player: "p1", lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: T });
  assert.equal(await h.store.settle(o, { hash: hash64(), payer: "p1", seenMs: T + 1 }, T + 1), "paid");
  assert.deepEqual(await h.store.credits("p1", 0), [{ playId: "extra-round", ready: 1 }]);
  assert.equal((await h.store.useCredit("p1", "extra-round", "r:1", T + 2, 0)).status, "used");
  assert.deepEqual([...h.col("u").keys()], ["p1__r:1"]);
  await h.store.keepAdult("p1", T + 3);
  assert.deepEqual([...h.col("y").keys()], ["p1"]);
  await h.store.forget("p1", T + 10_000_000);
  assert.deepEqual([...new Set(h.writes)].sort(), ["a", "c", "o", "u", "x", "y"]);
  assert.equal(h.col("c").size + h.col("u").size + h.col("y").size, 0, "the credit, the use and the yes went");
  assert.equal(h.cols.has("credits") || h.cols.has("shop_uses") || h.cols.has("play_adults"), false);
});

test("shop Firestore: a use whose transaction loses every attempt (ABORTED) goes on to the next credit, and any other error throws", async () => {
  const T = 1_800_000_000_000;
  const f = fakeFirestore();
  let failNext: unknown = null;
  const db: typeof f.db = {
    ...f.db,
    runTransaction: (fn) => {
      const e = failNext;
      failNext = null;
      return e ? Promise.reject(e) : f.db.runTransaction(fn);
    },
  };
  const store = createFirestoreShop(db);
  const credit = async (at: number) => {
    const o = await reserveOrder(store, { player: "p1", lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: at });
    await store.settle(o, { hash: hash64(), payer: "p1", seenMs: at + 1 }, at + 1);
    return o.id;
  };
  const older = await credit(T);
  const newer = await credit(T + 10);
  failNext = Object.assign(new Error("10 ABORTED"), { code: 10 });
  const r = await store.useCredit("p1", "extra-round", "r1", T + 20, 0);
  assert.equal(r.status, "used");
  assert.equal(r.status === "used" && r.credit.orderId, newer, "the oldest was lost to a race: the next one is used");
  assert.deepEqual(await store.credits("p1", 0), [{ playId: "extra-round", ready: 1 }]);
  assert.equal((await store.useCredit("p1", "extra-round", "r2", T + 30, 0)).status === "used", true);
  assert.equal((await store.credits("p1", 0)).length, 0, `the older one (${older}) is used too`);
  const boom = new Error("network down");
  await credit(T + 40);
  failNext = boom;
  await assert.rejects(store.useCredit("p1", "extra-round", "r3", T + 50, 0), (x) => x === boom);
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
  // A paid play: the admin counts its credit, and after "Delete my data" lists it to send back with its payer.
  const p = await reserveOrder(h.store, { player: "nano_round", lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: T + 10 });
  await h.store.settle(p, { hash: hash64(), payer: "nano_round", seenMs: T + 11 }, T + 12);
  const admin = createFirestoreStore(adminView);
  let a = await admin.summary(T + 13);
  assert.deepEqual(a.plays, [{ playId: "extra-round", sold: 1, used: 0, ready: 1, late: 0, notUsedInTime: 0 }]);
  assert.equal(a.orders.find((o) => o.id === p.id)?.kind, "play");
  assert.deepEqual(a.players.find((x) => x.player === "nano_round")?.ready, [{ id: "extra-round", ready: 1 }]);
  await h.store.forget("nano_round", p.holdUntil + 1);
  a = await admin.summary(p.holdUntil + 2);
  assert.deepEqual(a.sendBack?.map((x) => [x.orderId, x.why, x.payer, x.xno]), [[p.id, "deleted_player", "nano_round", "0.05"]]);
});

test("the conformance suite is the same on every store", () => {
  const values = Object.values(counts);
  assert.ok(values.length >= 2 && values.every((v) => v === values[0] && v >= 26), JSON.stringify(counts));
  // The plays add ten cases (nine, and the "18 or older" yes); a looks-only store runs the rest.
  for (const v of Object.values(looksOnly)) assert.equal(v, values[0] - 10, JSON.stringify(looksOnly));
});
