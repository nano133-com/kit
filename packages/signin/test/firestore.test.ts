// The Firestore stores, against an emulator. Runs only with FIRESTORE_EMULATOR_HOST set (never a real project).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { checkSignin, startSignin } from "../src/index.js";
import { firestoreOnce, firestoreStore } from "../src/firestoreStore.js";
import { MockLedger } from "./mockLedger.js";
import { firestoreStore as returnStore } from "@nano133/late-returns/firestore";
import { settleSigninRefunds } from "../src/refunds.js";
import { seedSigner } from "../../late-returns/examples/signer.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;

test("Firestore stores: a held amount, a sign-in, one payment once, once-keys", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "demo-signin" });
  const db = getFirestore();
  const tag = Math.random().toString(36).slice(2, 8);
  const store = firestoreStore(db, { sessions: `t${tag}_sessions`, amounts: `t${tag}_amounts`, payments: `t${tag}_payments`, returns: `t${tag}_returns` });
  const led = new MockLedger();
  const seed = createHash("sha256").update("fs signin wallet").digest("hex");
  const signer = seedSigner(seed);
  const address = signer.address, user = acct("fs user");
  const o = { rpc: led.rpc, store, config: { address }, pick: () => 9 };
  const s = await startSignin(o, { starter: "a" });
  await assert.rejects(startSignin(o, { starter: "b" }), /busy/);
  const h = led.pay(user, address, BigInt(s.amount), 0);
  const r = await checkSignin(o, s.id, h, { starter: "a" });
  assert.ok(r.state === "signedin" && r.account === user && r.mine);
  assert.equal((await db.collection(`t${tag}_payments`).doc(h).get()).data()?.session, s.id);
  // The return was recorded with the claim; a refund run sends it back once.
  assert.equal((await db.collection(`t${tag}_returns`).doc(h).get()).data()?.status, "pending");
  const rstore = returnStore(db, { returns: `t${tag}_returns`, used: [`t${tag}_payments`], meta: `t${tag}_wallet` });
  await assert.rejects(settleSigninRefunds({ rpc: led.rpc, signer, store: rstore }), /refusing/, "never against the emulator without mockLedger");
  assert.equal(await settleSigninRefunds({ rpc: led.rpc, signer, store: rstore, mockLedger: true }), 1);
  assert.equal(await settleSigninRefunds({ rpc: led.rpc, signer, store: rstore, mockLedger: true }), 0);
  const back = led.sendsFrom(address, user);
  assert.equal(back.length, 1);
  assert.equal(back[0][1].amount, BigInt(s.amount));
  const once = firestoreOnce(db, `t${tag}_once`);
  assert.equal(await once("k1", 60_000), true);
  assert.equal(await once("k1", 60_000), false);
});
