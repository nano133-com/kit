// The Firestore stores, on an emulator only: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> npm test. Skipped without it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";

const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !EMU && "set FIRESTORE_EMULATOR_HOST to run the Firestore tests";

test("firestoreOnce and firestoreRequests", { skip }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps()[0] ?? initializeApp({ projectId: "nano133-kit-test" });
  const db = getFirestore(app);
  const { firestoreOnce, firestoreRequests } = await import("../src/firestore.js");
  const run = randomBytes(4).toString("hex");

  const once = firestoreOnce(db, `once-${run}`);
  assert.equal(await once("k", 60_000, "nano_a"), true);
  assert.equal(await once("k", 60_000, "nano_a"), false);
  assert.equal((await db.collection(`once-${run}`).doc("k").get()).data()?.address, "nano_a", "the row names the account");

  const s = firestoreRequests(db, `req-${run}`);
  const expiresAt = Date.now() + 60_000;
  await s.create("key1", { id: "id1-".padEnd(24, "x"), starter: "ab", status: "waiting", expiresAt, label: "L" });
  await assert.rejects(s.create("key1", { id: "other", starter: "ab", status: "waiting", expiresAt }), "create never overwrites");
  const got = await s.get("key1");
  assert.equal(got?.expiresAt, expiresAt);
  assert.equal(got?.label, "L");
  await s.create("key2", { id: "key2", starter: "ab", status: "waiting", expiresAt, nonce: "n1", issuedAt: 5 });
  const berry = await s.get("key2");
  assert.equal(berry?.nonce, "n1", "a nano-signin-v1 request keeps its nonce");
  assert.equal(berry?.issuedAt, 5);
  assert.equal(got?.nonce, undefined, "and a request without one has none");
  assert.equal((await s.find("id1-".padEnd(24, "x")))?.key, "key1");
  const [a, b] = await Promise.all([s.finish("key1", "nano_a"), s.finish("key1", "nano_b")]);
  assert.equal(Number(a) + Number(b), 1, "two answers at once: one wins");
  const doc = (await db.collection(`req-${run}`).doc("key1").get()).data()!;
  assert.equal(doc.status, "signedin");
  assert.ok(doc.deleteAt && doc.createdAt && doc.signedAt);
});
