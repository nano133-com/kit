// The shop's money rules on a REAL Firestore (the emulator), through the Admin SDK: proof that the adapter's small interface is what the Admin SDK gives,
// and that its transactions hold under real contention. It runs only when asked, because the package has no Firebase dependency and the emulator needs Java:
//
//   FIREBASE_ADMIN=/path/to/node_modules/firebase-admin firebase emulators:exec --only firestore --project demo-kit-shop \
//     "node --import tsx --test test/shop-emulator.test.ts"
//
// Use a PRIVATE port for the emulator (firebase.json "emulators.firestore.port"), never a port another project's emulator uses.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreShop, type FirestoreShopLike } from "../src/shop/adapters/firestore.js";
import { SHOP_CASE_TIMEOUT_MS, shopStoreConformance } from "../src/shop/conformance.js";
import { priceRaw, reserveOrder } from "../src/shop/index.js";

const admin = process.env.FIREBASE_ADMIN;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !admin || !host ? "set FIREBASE_ADMIN and run under the Firestore emulator" : false;

if (skip) test("shop Firestore adapter on the emulator", { skip }, () => {});
else {
  const appMod = await import(pathToFileURL(join(admin!, "lib/app/index.js")).href);
  const fsMod = await import(pathToFileURL(join(admin!, "lib/firestore/index.js")).href);
  const app = appMod.initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-kit-shop" }, "shop-kit-test");
  const db = fsMod.getFirestore(app);
  let n = 0;

  for (const c of shopStoreConformance(async () => {
    // Each case gets its own eight collections: a new, empty store.
    const k = `s${process.pid}_${n++}`;
    const names = { orders: `${k}_orders`, owned: `${k}_owned`, meta: `${k}_meta`, amounts: `${k}_amounts`, hashes: `${k}_hashes`, credits: `${k}_credits`, uses: `${k}_uses`, adults: `${k}_adults` };
    const store = createFirestoreShop(db as unknown as FirestoreShopLike, names);
    const dump = async () => {
      const parts = await Promise.all(Object.values(names).map(async (name) => (await db.collection(name).get()).docs.map((d: { id: string; data(): unknown }) => [d.id, d.data()])));
      return JSON.stringify(parts);
    };
    return { store, dump };
  })) {
    test(`shop Firestore emulator: ${c.name}`, { timeout: SHOP_CASE_TIMEOUT_MS }, c.run);
  }

  // A burst of 25 at once, with Firestore's own retries: now and then a transaction loses on every attempt and gets ABORTED (on the emulator, about 1 run
  // in 6 before 0.14.1 threw it at the buyer). Every ABORTED must be "taken", never a thrown error, and the 25 orders still hold 25 different amounts. The
  // line it prints counts the ABORTED answers, so a run of this test many times shows that the path ran.
  test("shop Firestore emulator: a burst of 25 at once: a lost race is the next amount, never an error", { timeout: SHOP_CASE_TIMEOUT_MS }, async () => {
    const k = `b${process.pid}_${n++}`;
    let lost = 0;
    const counted: FirestoreShopLike = {
      collection: (name) => db.collection(name),
      batch: () => db.batch(),
      runTransaction: (fn) =>
        db.runTransaction(fn).catch((e: { code?: unknown }) => {
          if (e?.code === 10) lost++;
          throw e;
        }),
    };
    const store = createFirestoreShop(counted, { orders: `${k}_orders`, owned: `${k}_owned`, meta: `${k}_meta`, amounts: `${k}_amounts`, hashes: `${k}_hashes` });
    const T = Date.now();
    const made = await Promise.all(
      Array.from({ length: 25 }, (_, i) => reserveOrder(store, { player: `p${i}`, lookId: "look-a", usd: "0.25", rate: 1, price: priceRaw(0.25, 1)!, visitor: null, now: T })),
    );
    assert.equal(new Set(made.map((o) => o.amount)).size, 25);
    const held = await store.held();
    assert.equal(held.length, 25);
    assert.deepEqual(new Set(held.map((o) => o.id)), new Set(made.map((o) => o.id)));
    console.log(`# burst of 25: ${lost} transaction(s) lost every attempt (ABORTED) and went on to the next amount`);
  });

  // The uses under real contention: 20 at once for 3 credits (20 refs), then 20 at once with one ref. A use whose transaction is ABORTED goes on to the
  // next credit; the line counts those, so many runs of this test show that the path ran. Exactly 3 used, then exactly 1.
  test("shop Firestore emulator: 20 uses at once: 3 credits are used once each, and one ref uses one credit", { timeout: SHOP_CASE_TIMEOUT_MS }, async () => {
    const k = `u${process.pid}_${n++}`;
    let lost = 0;
    const counted: FirestoreShopLike = {
      collection: (name) => db.collection(name),
      batch: () => db.batch(),
      runTransaction: (fn) =>
        db.runTransaction(fn).catch((e: { code?: unknown }) => {
          if (e?.code === 10) lost++;
          throw e;
        }),
    };
    const store = createFirestoreShop(counted, { orders: `${k}_orders`, owned: `${k}_owned`, meta: `${k}_meta`, amounts: `${k}_amounts`, hashes: `${k}_hashes`, credits: `${k}_credits`, uses: `${k}_uses` });
    const T = Date.now();
    const credit = async (i: number) => {
      const o = await reserveOrder(store, { player: "p1", lookId: "extra-round", kind: "play", usd: "0.05", rate: 1, price: priceRaw(0.05, 1)!, visitor: null, now: T + i });
      assert.equal(await store.settle(o, { hash: `${"A".repeat(60)}${String(i).padStart(4, "0")}`, payer: "p1", seenMs: T + i }, T + i), "paid");
    };
    for (let i = 0; i < 3; i++) await credit(i);
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => store.useCredit("p1", "extra-round", `r-${i}`, T + 100)));
    const used = many.flatMap((r) => (r.status === "used" ? [r.credit.orderId] : []));
    assert.deepEqual([used.length, new Set(used).size, many.filter((r) => r.status === "none").length], [3, 3, 17]);
    for (let i = 3; i < 5; i++) await credit(i);
    const one = await Promise.all(Array.from({ length: 20 }, () => store.useCredit("p1", "extra-round", "r-one", T + 200)));
    assert.equal(one.filter((r) => r.status === "used").length, 1, one.map((r) => r.status).join(","));
    assert.ok(one.every((r) => r.status !== "none"));
    assert.deepEqual(await store.credits("p1", 0), [{ playId: "extra-round", ready: 1 }]);
    console.log(`# uses at once: ${lost} transaction(s) lost every attempt (ABORTED) and went on to the next credit`);
  });
}
