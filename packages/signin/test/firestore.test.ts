// The Firestore stores, against an emulator. Runs only with FIRESTORE_EMULATOR_HOST set (never a real project).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { checkSignin, startSignin } from "../src/index.js";
import { firestoreOnce, firestoreStore } from "../src/firestoreStore.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;

test("Firestore stores: a held amount, a sign-in, one payment once, once-keys", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "demo-signin" });
  const db = getFirestore();
  const tag = Math.random().toString(36).slice(2, 8);
  const store = firestoreStore(db, { sessions: `t${tag}_sessions`, amounts: `t${tag}_amounts`, payments: `t${tag}_payments` });
  const led = new MockLedger();
  const address = acct("fs signin"), user = acct("fs user");
  const o = { rpc: led.rpc, store, config: { address }, pick: () => 9 };
  const s = await startSignin(o, { starter: "a" });
  await assert.rejects(startSignin(o, { starter: "b" }), /busy/);
  const h = led.pay(user, address, BigInt(s.amount), 0);
  const r = await checkSignin(o, s.id, h, { starter: "a" });
  assert.ok(r.state === "signedin" && r.account === user && r.mine);
  assert.equal((await db.collection(`t${tag}_payments`).doc(h).get()).data()?.session, s.id);
  const once = firestoreOnce(db, `t${tag}_once`);
  assert.equal(await once("k1", 60_000), true);
  assert.equal(await once("k1", 60_000), false);
});
