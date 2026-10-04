// perSenderPerDay: a sender's payments past the day's limit are kept (not sent) until releaseKept().
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { findLateReturns, releaseKept, runLateReturns, senderKey, type LateReturnOptions, type ReturnStore } from "../src/index.js";
import { memoryStore } from "../src/memoryStore.js";
import { firestoreStore } from "../src/firestoreStore.js";
import { seedSigner } from "../examples/signer.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const seedOf = (label: string) => createHash("sha256").update(label).digest("hex").toUpperCase();
const wallet = seedSigner(seedOf("late-returns limit wallet"));
const spammer = nanoWeb.wallet.legacyAccounts(seedOf("late-returns limit spammer"), 0, 0)[0].address;
const other = nanoWeb.wallet.legacyAccounts(seedOf("late-returns limit other"), 0, 0)[0].address;
const XNO = 10n ** 30n;
const MILLI = 10n ** 27n;

async function setup(store: ReturnStore, extra: Partial<LateReturnOptions> = {}) {
  const led = new MockLedger();
  const opening = led.pay(other, wallet.address, 50n * XNO, 99999);
  await led.rpc({ action: "process", block: (await wallet.receive({ frontier: null, balance: 0n, representative: other, source: opening, amount: 50n * XNO, work: "0" })).block });
  const opts: LateReturnOptions = { rpc: led.rpc, store, signer: wallet, isClaimable: async () => false, perRun: 50, ...extra };
  return { led, opts };
}

test("off by default: every late payment of one sender goes back", async () => {
  const { led, opts } = await setup(memoryStore());
  for (let i = 0; i < 6; i++) led.pay(spammer, wallet.address, MILLI + BigInt(i), 3 * 3600);
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 6);
});

test("perSenderPerDay: the sender's first N go back, the rest are kept; other senders and the day's count are untouched", async () => {
  const store = memoryStore();
  const { led, opts } = await setup(store, { perSenderPerDay: 3, perDay: 5 });
  const spam = Array.from({ length: 6 }, (_, i) => led.pay(spammer, wallet.address, MILLI + BigInt(i), 3 * 3600));
  const fine = Array.from({ length: 2 }, (_, i) => led.pay(other, wallet.address, 2n * MILLI + BigInt(i), 3 * 3600));
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 3, "3 back to the spammer");
  assert.equal(led.sendsFrom(wallet.address, other).length, 2, "the other sender's 2 go back: the kept ones didn't use the day's 5");
  const kept = spam.map((h) => store.returns.get(h)!).filter((r) => r.status === "kept");
  assert.equal(kept.length, 3);
  assert.ok(kept.every((r) => r.reason === "limit" && r.day === new Date().toISOString().slice(0, 10) && !r.returnHash && !r.recv), "kept: reason, day, never received or sent");
  assert.ok(spam.every((h) => store.used.has(h)), "every one is marked used (no checkout can claim a kept payment)");
  assert.equal(store.days.get(new Date().toISOString().slice(0, 10)), 5, "the day counts only real returns");
  assert.equal([...store.senders.keys()].some((k) => k.includes(spammer)), false, "the sender counter holds no address");
  for (const h of fine) assert.equal(store.returns.get(h)!.status, "returned");
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 3, "a later run sends no kept payment");
});

test("the next UTC day, the sender has a fresh limit", async () => {
  const store = memoryStore();
  const day1 = Date.now();
  const { led, opts } = await setup(store, { perSenderPerDay: 2, now: day1 });
  for (let i = 0; i < 3; i++) led.pay(spammer, wallet.address, MILLI + BigInt(i), 3 * 3600);
  assert.equal(await findLateReturns(opts), 2);
  for (let i = 0; i < 2; i++) led.pay(spammer, wallet.address, 3n * MILLI + BigInt(i), 3 * 3600);
  assert.equal(await findLateReturns({ ...opts, now: day1 + 86_400_000 }), 2, "2 more the next day");
  assert.equal([...store.returns.values()].filter((r) => r.status === "kept").length, 1);
  assert.equal(store.senders.get(senderKey(new Date(day1).toISOString().slice(0, 10), spammer)), 2);
});

test("releaseKept: a kept payment goes back exactly once, even after the site replaced the stored address", async () => {
  const store = memoryStore();
  const { led, opts } = await setup(store, { perSenderPerDay: 1 });
  led.pay(spammer, wallet.address, MILLI, 3 * 3600);
  const second = led.pay(spammer, wallet.address, MILLI + 1n, 3 * 3600);
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 1);
  store.returns.get(second)!.to = "h:replaced-by-the-site";
  assert.equal(await releaseKept(opts, second, "admin@example"), "released");
  assert.equal(store.returns.get(second)!.to, spammer, "the sender comes from the node again");
  assert.equal(await releaseKept(opts, second, "admin@example"), "not-kept", "a second release changes nothing");
  await runLateReturns(opts);
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 2, "sent back once");
  assert.equal(store.returns.get(second)!.status, "returned");
  assert.equal(store.returns.get(second)!.releasedBy, "admin@example");
  assert.equal(await releaseKept(opts, "A".repeat(64), "admin@example"), "missing");
});

test("perSenderPerDay with a store that can't keep payments: a clear error", async () => {
  const plain = memoryStore();
  const { opts } = await setup({ ...plain, senderLimit: undefined } as ReturnStore, { perSenderPerDay: 3 });
  await assert.rejects(findLateReturns(opts), /needs a store with senderLimit/);
});

test("Firestore store: kept, released, and the counter has a TTL date and no address", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "demo-late-returns" });
  const db = getFirestore();
  const tag = Math.random().toString(36).slice(2, 8);
  const store = firestoreStore(db, { returns: `t${tag}_returns`, used: [`t${tag}_payments`], meta: `t${tag}_meta`, days: `t${tag}_days` });
  const { led, opts } = await setup(store, { perSenderPerDay: 2, perDay: 3 });
  const spam = Array.from({ length: 4 }, (_, i) => led.pay(spammer, wallet.address, MILLI + BigInt(i), 3 * 3600));
  led.pay(other, wallet.address, 2n * MILLI, 3 * 3600);
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 2);
  assert.equal(led.sendsFrom(wallet.address, other).length, 1, "the day's 3 was not used by kept payments");
  const kept = (await Promise.all(spam.map((h) => store.get(h)))).filter((r) => r!.status === "kept");
  assert.equal(kept.length, 2);
  for (const h of spam) assert.equal((await db.collection(`t${tag}_payments`).doc(h).get()).exists, true, "marked used");
  const today = new Date().toISOString().slice(0, 10);
  const counter = await db.collection(`t${tag}_days`).doc(`sender-${senderKey(today, spammer)}`).get();
  assert.equal(counter.data()!.n, 2);
  assert.ok(counter.data()!.deleteAt, "a TTL date on the counter");
  assert.equal(JSON.stringify(counter.data()).includes(spammer) || counter.id.includes(spammer), false, "no address in the counter");
  assert.equal(await releaseKept(opts, kept[0]!.hash, "admin"), "released");
  await runLateReturns(opts);
  assert.equal(led.sendsFrom(wallet.address, spammer).length, 3, "the released one went back");
});
