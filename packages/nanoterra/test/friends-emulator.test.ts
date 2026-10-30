// The friends rules on a REAL Firestore (the emulator), through the Admin SDK: proof that the adapter's small interface is what the Admin SDK gives.
// It runs only when asked, because the package has no Firebase dependency and the emulator needs Java:
//
//   FIREBASE_ADMIN=/path/to/node_modules/firebase-admin firebase emulators:exec --only firestore --project demo-kit-friends \
//     "node --import tsx --test test/friends-emulator.test.ts"
//
// Use a PRIVATE port for the emulator (firebase.json "emulators.firestore.port"), never a port another project's emulator uses.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createFirestoreFriends, type FirestoreFriendsLike } from "../src/friends/adapters/firestore.js";
import { friendsStoreConformance } from "../src/friends/conformance.js";

const admin = process.env.FIREBASE_ADMIN;
const host = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !admin || !host ? "set FIREBASE_ADMIN and run under the Firestore emulator" : false;

if (skip) test("friends Firestore adapter on the emulator", { skip }, () => {});
else {
  const appMod = await import(pathToFileURL(join(admin!, "lib/app/index.js")).href);
  const fsMod = await import(pathToFileURL(join(admin!, "lib/firestore/index.js")).href);
  const app = appMod.initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-kit-friends" }, "friends-kit-test");
  const db = fsMod.getFirestore(app);
  let n = 0;

  for (const c of friendsStoreConformance(async () => {
    // Each case gets its own three collections: a new, empty store.
    const k = `t${process.pid}_${n++}`;
    const names = { edges: `${k}_edges`, presence: `${k}_presence`, prefs: `${k}_prefs` };
    const store = createFirestoreFriends(db as unknown as FirestoreFriendsLike, names);
    const dump = async () => {
      const parts = await Promise.all(Object.values(names).map(async (name) => (await db.collection(name).get()).docs.map((d: { id: string; data(): unknown }) => [d.id, d.data()])));
      return JSON.stringify(parts);
    };
    return { store, dump };
  })) {
    test(`friends Firestore emulator: ${c.name}`, c.run);
  }

  test("friends Firestore emulator: two requests at the same moment make one edge", async () => {
    const store = createFirestoreFriends(db as unknown as FirestoreFriendsLike, { edges: `race${process.pid}_e`, presence: `race${process.pid}_p`, prefs: `race${process.pid}_s` });
    const now = Date.now();
    await Promise.allSettled([store.request("ra", "rb", now), store.request("rb", "ra", now)]);
    const docs = (await db.collection(`race${process.pid}_e`).get()).docs;
    assert.equal(docs.length, 1);
  });
}
