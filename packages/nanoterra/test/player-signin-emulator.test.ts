// The player sign-in's store rules on a REAL Firestore (the emulator), through the Admin SDK: proof that the adapter's small interface is what the
// Admin SDK gives. It runs only when asked, because the package has no Firebase dependency and the emulator needs Java:
//
//   FIREBASE_ADMIN=/path/to/node_modules/firebase-admin firebase emulators:exec --only firestore --project demo-kit-signin \
//     "node --import tsx --test test/player-signin-emulator.test.ts"
//
// Use a PRIVATE port for the emulator (firebase.json "emulators.firestore.port"), never a port another project's emulator uses.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createFirestorePlayerSignin, type FirestorePlayerSigninLike } from "../src/player-signin/adapters/firestore.js";
import { playerSigninStoreConformance } from "../src/player-signin/conformance.js";

const admin = process.env.FIREBASE_ADMIN;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !admin || !host ? "set FIREBASE_ADMIN and run under the Firestore emulator" : false;

if (skip) test("player sign-in Firestore adapter on the emulator", { skip }, () => {});
else {
  const appMod = await import(pathToFileURL(join(admin!, "lib/app/index.js")).href);
  const fsMod = await import(pathToFileURL(join(admin!, "lib/firestore/index.js")).href);
  const app = appMod.initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-kit-signin" }, "player-signin-kit-test");
  const db = fsMod.getFirestore(app);
  let n = 0;

  for (const c of playerSigninStoreConformance(async () => {
    // Each case gets its own three collections: a new, empty store.
    const k = `ps${process.pid}_${n++}`;
    const names = { requests: `${k}_requests`, sessions: `${k}_sessions`, once: `${k}_once` };
    const store = createFirestorePlayerSignin(db as unknown as FirestorePlayerSigninLike, names);
    const dump = async () => {
      const parts = await Promise.all(Object.values(names).map(async (name) => (await db.collection(name).get()).docs.map((d: { id: string; data(): unknown }) => [d.id, d.data()])));
      return JSON.stringify(parts);
    };
    return { store, dump };
  })) {
    test(`player sign-in Firestore emulator: ${c.name}`, c.run);
  }

  test("player sign-in Firestore emulator: deleteAt is a Timestamp", async () => {
    const name = `ps${process.pid}_ttl`;
    const store = createFirestorePlayerSignin(db as unknown as FirestorePlayerSigninLike, { sessions: name });
    await store.createSession({ idHash: "f".repeat(64), address: "nano_x", createdAt: 1, expiresAt: Date.now() + 1000, via: "passkey" });
    const d = (await db.collection(name).doc("f".repeat(64)).get()).data();
    assert.equal(typeof d.deleteAt.toMillis, "function");
  });
}
