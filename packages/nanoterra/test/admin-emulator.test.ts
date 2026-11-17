// The admin store's contract (adminStoreConformance, the maintenance case included) on a REAL Firestore (the emulator), through the Admin SDK: proof that
// the Firestore adapter's small interface is what the Admin SDK gives, not only what the in-memory fake of test/admin-adapters.test.ts gives. It runs only
// when asked, because the package has no Firebase dependency and the emulator needs Java:
//
//   FIREBASE_ADMIN=/path/to/node_modules/firebase-admin firebase emulators:exec --only firestore --project demo-kit-admin \
//     "node --import tsx --test test/admin-emulator.test.ts"
//
// Use a PRIVATE port for the emulator (firebase.json "emulators.firestore.port"), never a port another project's emulator uses.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { SETTING_KEYS } from "../src/admin/index.js";
import { createFirestoreStore, type FirestoreLike } from "../src/admin/adapters/firestore.js";
import { adminStoreConformance, type StoreHarness } from "../src/admin/conformance.js";
import { loadMaintenance } from "../src/admin/handler.js";

const admin = process.env.FIREBASE_ADMIN;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !admin || !host ? "set FIREBASE_ADMIN and run under the Firestore emulator" : false;

if (skip) test("admin Firestore adapter on the emulator", { skip }, () => {});
else {
  const appMod = await import(pathToFileURL(join(admin!, "lib/app/index.js")).href);
  const fsMod = await import(pathToFileURL(join(admin!, "lib/firestore/index.js")).href);
  const app = appMod.initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-kit-admin" }, "admin-kit-test");
  const db = fsMod.getFirestore(app);
  let n = 0;
  type Doc = { id: string; data(): Record<string, unknown> };

  const harness = (): StoreHarness => {
    // Each case gets its own four collections: a new, empty store.
    const k = `a${process.pid}_${n++}`;
    const names = { meta: `${k}_meta`, orders: `${k}_orders`, owned: `${k}_owned`, credits: `${k}_credits` };
    const store = createFirestoreStore(db as unknown as FirestoreLike, names);
    return {
      store,
      plays: true,
      async seed(d) {
        const b = db.batch();
        for (const o of d.orders ?? []) b.set(db.collection(names.orders).doc(o.id), { player: o.player, lookId: o.lookId, ...(o.kind ? { kind: o.kind } : {}), ...(typeof o.forgotUnused === "number" ? { forgotUnused: o.forgotUnused } : {}), usd: o.usd, amount: o.amountRaw, status: o.status, createdAt: o.createdAt, expiresAt: o.expiresAt, paidAt: o.paidAt, payer: o.payer, hash: o.hash });
        for (const c of d.credits ?? []) b.set(db.collection(names.credits).doc(c.orderId), { player: c.player, playId: c.playId, orderId: c.orderId, grantedAt: c.grantedAt, expiresAt: c.expiresAt, usedAt: c.usedAt, useRef: null });
        for (const o of d.owned ?? []) b.set(db.collection(names.owned).doc(`${o.player}__${o.lookId}`), { player: o.player, lookId: o.lookId, orderId: "", grantedAt: o.at });
        if (d.rate) b.set(db.collection(names.meta).doc("rate"), { value: d.rate.value, at: d.rate.at });
        await b.commit();
      },
      async snapshot() {
        const skipKeys: string[] = Object.values(SETTING_KEYS);
        const dump = async (name: string, skip: string[] = []) =>
          JSON.stringify(((await db.collection(name).get()).docs as Doc[]).filter((d) => !skip.includes(d.id)).map((d) => [d.id, d.data()]).sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)));
        return [await dump(names.orders), await dump(names.owned), await dump(names.credits), await dump(names.meta, skipKeys)].join("|");
      },
    };
  };

  for (const c of adminStoreConformance(async () => harness())) test(`admin Firestore emulator: ${c.name}`, c.run);

  test("admin Firestore emulator: loadMaintenance reads the switch the store keeps, and a value that is not on or off reads as off", async () => {
    const h = harness();
    assert.equal(await loadMaintenance(h.store), false);
    await h.store.saveSettings({ maintenance: "on", maintenanceAt: 10 }, 10);
    assert.equal(await loadMaintenance(h.store), true);
    await h.store.saveSettings({ maintenance: "off", maintenanceAt: 11 }, 11);
    assert.equal(await loadMaintenance(h.store), false);
  });
}
