// The shop's money rules on a REAL Firestore (the emulator), through the Admin SDK: proof that the adapter's small interface is what the Admin SDK gives,
// and that its transactions hold under real contention. It runs only when asked, because the package has no Firebase dependency and the emulator needs Java:
//
//   FIREBASE_ADMIN=/path/to/node_modules/firebase-admin firebase emulators:exec --only firestore --project demo-kit-shop \
//     "node --import tsx --test test/shop-emulator.test.ts"
//
// Use a PRIVATE port for the emulator (firebase.json "emulators.firestore.port"), never a port another project's emulator uses.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createFirestoreShop, type FirestoreShopLike } from "../src/shop/adapters/firestore.js";
import { SHOP_CASE_TIMEOUT_MS, shopStoreConformance } from "../src/shop/conformance.js";

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
    // Each case gets its own five collections: a new, empty store.
    const k = `s${process.pid}_${n++}`;
    const names = { orders: `${k}_orders`, owned: `${k}_owned`, meta: `${k}_meta`, amounts: `${k}_amounts`, hashes: `${k}_hashes` };
    const store = createFirestoreShop(db as unknown as FirestoreShopLike, names);
    const dump = async () => {
      const parts = await Promise.all(Object.values(names).map(async (name) => (await db.collection(name).get()).docs.map((d: { id: string; data(): unknown }) => [d.id, d.data()])));
      return JSON.stringify(parts);
    };
    return { store, dump };
  })) {
    test(`shop Firestore emulator: ${c.name}`, { timeout: SHOP_CASE_TIMEOUT_MS }, c.run);
  }
}
