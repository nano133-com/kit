// The Firestore store, against an emulator. Runs only with FIRESTORE_EMULATOR_HOST set (never a real project).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { claimCheckout, createCheckout, priceRaw, SweepLeaseLost } from "../src/index.js";
import { createDerivedCheckout, derivedReturns, sweepCheckout, sweepPaid } from "../src/derived.js";
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

test("Firestore store, derived-address mode: an atomic counter, one address each, a claim, the sweep once, the lease", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "demo-checkout" });
  const db = getFirestore();
  const tag = Math.random().toString(36).slice(2, 8);
  const store = firestoreStore(db, { checkouts: `t${tag}_checkouts`, amounts: `t${tag}_amounts`, payments: `t${tag}_payments`, counter: `t${tag}_index/counter` });
  const led = new MockLedger();
  const secret = "kit firestore test secret 0123456789abcdef0123456789";
  const dest = acct("fs destination"), buyer = acct("fs derived buyer");
  const o = { rpc: led.rpc, store, secret };
  const price = priceRaw(0.05, 0.5);
  // Ten checkouts at once: ten indexes, ten addresses, no amount lock.
  const made = await Promise.all(Array.from({ length: 10 }, () => createDerivedCheckout(o, { item: "x", price })));
  assert.deepEqual(made.map((c) => c.index).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(new Set(made.map((c) => c.to)).size, 10);
  assert.equal((await db.collection(`t${tag}_amounts`).get()).size, 0, "no amount lock");
  assert.equal((await db.doc(`t${tag}_index/counter`).get()).data()?.next, 10);
  await assert.rejects(store.takeIndex(10), /cap of 10/);
  // The same address is never saved twice.
  assert.equal(await store.createDerived({ ...made[0], id: "another-id" }), false);
  assert.equal((await store.byAddress(made[3].to))?.id, made[3].id);
  assert.equal(await store.byAddress(acct("fs unknown")), null);
  // The old claimable() ignores derived checkouts; the address answers for them.
  assert.equal(await store.claimable(made[0].amount, Date.now()), false);
  assert.equal((await store.derivedAddresses(Date.now(), 100)).length, 10);
  assert.equal((await store.derivedAddresses(Date.now() + 30 * 86_400_000, 100)).length, 0);
  const d = derivedReturns({ store, secret });
  assert.equal(await d.isClaimable({ amount: made[0].amount, to: made[0].to }), true);
  assert.equal(await d.isClaimable({ amount: String(BigInt(made[0].amount) + 1n), to: made[0].to }), false);
  assert.equal((await d.signerFor(made[4].to))?.address, made[4].to);
  // Pay one, claim, sweep.
  const c = made[0];
  assert.equal((await sweepCheckout({ ...o, destination: dest }, c.id)), "waiting");
  const h = led.pay(buyer, c.to, BigInt(c.amount), 0);
  const r = await claimCheckout(o, c.id, h);
  assert.ok(r.state === "paid" && r.checkout.sweep?.status === "due");
  assert.equal((await store.unswept(10)).length, 1);
  const runs = await Promise.all([sweepCheckout({ ...o, destination: dest }, c.id), sweepCheckout({ ...o, destination: dest }, c.id)]);
  assert.deepEqual([...runs].sort(), ["busy", "swept"], "the lease lets one run work");
  assert.equal(led.sendsFrom(c.to, dest).length, 1);
  const done = (await store.get(c.id))!;
  assert.equal(done.sweep?.status, "done");
  assert.equal(done.sweep?.lease, null);
  assert.equal(await store.isUsed(done.sweep!.hash!), true, "the sweep's send is a used payment");
  assert.equal((await store.unswept(10)).length, 0);
  assert.deepEqual(await sweepPaid({ ...o, destination: dest }), { swept: 0, busy: 0, failed: [] });
  assert.equal(led.sendsFrom(c.to, dest).length, 1);
  // The lease fence.
  const e = made[1];
  await claimCheckout(o, e.id, led.pay(buyer, e.to, BigInt(e.amount), 0));
  assert.equal(await store.claimSweep(e.id, "a", 1000, 500), true);
  assert.equal(await store.claimSweep(e.id, "b", 1100, 500), false);
  await assert.rejects(store.patchSweep(e.id, "b", { recv: "X" }, 1100, 500), SweepLeaseLost);
  await store.patchSweep(e.id, "a", { recv: "R", send: null }, 1100, 500);
  assert.equal((await store.get(e.id))!.sweep?.recv, "R");
  assert.equal(await store.claimSweep(e.id, "b", 1700, 500), true, "an expired lease is taken over");
  await assert.rejects(store.finishSweep(e.id, "a", "H".repeat(64), 1800), SweepLeaseLost);
});
