// The Firestore store, against an emulator. Runs only with FIRESTORE_EMULATOR_HOST set (never a real project).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { claimCheckout, createCheckout, priceRaw } from "../src/index.js";
import { firestoreStore } from "../src/firestoreStore.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;

test("Firestore store: unique amounts, a claim, one payment once", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "demo-checkout" });
  const db = getFirestore();
  const tag = Math.random().toString(36).slice(2, 8);
  const store = firestoreStore(db, { checkouts: `t${tag}_checkouts`, amounts: `t${tag}_amounts`, payments: `t${tag}_payments` });
  const led = new MockLedger();
  const shop = acct("fs shop"), buyer = acct("fs buyer");
  const o = { rpc: led.rpc, store, to: shop, tail: () => 5 };
  const price = priceRaw(0.05, 0.5);
  const a = await createCheckout(o, { item: "x", price });
  await assert.rejects(createCheckout(o, { item: "x", price }), /no free amount/, "the held amount isn't given twice");
  const h = led.pay(buyer, shop, BigInt(a.amount), 0);
  const r = await claimCheckout(o, a.id, h);
  assert.equal(r.state, "paid");
  assert.equal((await db.collection(`t${tag}_payments`).doc(h).get()).data()?.checkout, a.id);
  assert.equal(await store.isUsed(h), true);
  assert.equal(await store.claimable(a.amount, Date.now()), false);
  // A payment already marked by a late return can't pay a checkout.
  const b = await createCheckout({ ...o, tail: () => 6 }, { item: "x", price });
  const h2 = led.pay(buyer, shop, BigInt(b.amount), 0);
  await db.collection(`t${tag}_payments`).doc(h2).set({ return: h2 });
  assert.equal((await claimCheckout(o, b.id, h2)).state, "used");
});
