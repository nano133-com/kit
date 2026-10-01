// The Firestore store, against an emulator. Runs only with FIRESTORE_EMULATOR_HOST set (never a real project).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { runLateReturns, type LateReturnOptions } from "../src/index.js";
import { firestoreStore } from "../src/firestoreStore.js";
import { seedSigner } from "../examples/signer.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const seedOf = (label: string) => createHash("sha256").update(label).digest("hex").toUpperCase();
const wallet = seedSigner(seedOf("late-returns fs wallet"));
const payer = nanoWeb.wallet.legacyAccounts(seedOf("late-returns fs payer"), 0, 0)[0].address;
const XNO = 10n ** 30n;

test("Firestore store: a late payment goes back once, through a lost answer and an overlapping run", { skip: !emulator && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (!getApps().length) initializeApp({ projectId: "demo-late-returns" });
  const db = getFirestore();
  const tag = Math.random().toString(36).slice(2, 8);
  const names = { returns: `t${tag}_returns`, used: [`t${tag}_payments`, `t${tag}_signins`], meta: `t${tag}_meta`, mark: [`t${tag}_payments`, `t${tag}_signins`], days: `t${tag}_days` };
  const store = firestoreStore(db, names);
  const led = new MockLedger();
  const opening = led.pay(payer, wallet.address, 50n * XNO, 99999);
  await led.rpc({ action: "process", block: (await wallet.receive({ frontier: null, balance: 0n, representative: payer, source: opening, amount: 50n * XNO, work: "0" })).block });
  const opts: LateReturnOptions = { rpc: led.rpc, store, signer: wallet, isClaimable: async () => false };
  const back = () => led.sendsFrom(wallet.address, payer);

  const claimed = led.pay(payer, wallet.address, 3n * XNO, 3 * 3600);
  await db.collection(names.used[0]).doc(claimed).set({ checkout: "x" });
  const late = led.pay(payer, wallet.address, 2n * XNO + 7n, 3 * 3600);
  led.faults.loseSendAnswer = true;
  await runLateReturns(opts);
  await runLateReturns(opts);
  assert.equal(back().length, 1, "one return only, the claimed payment stays");
  assert.equal(back()[0][1].amount, 2n * XNO + 7n);
  assert.equal((await store.get(late))!.status, "returned");
  assert.equal((await db.collection(names.used[0]).doc(late).get()).data()?.return, late, "the payment is marked used");
  assert.equal((await db.collection(names.used[1]).doc(late).get()).data()?.return, late, "in every `mark` collection");
  assert.equal((await db.collection(names.days).doc(`returns-${new Date().toISOString().slice(0, 10)}`).get()).data()?.n, 1, "the day is counted in `days`");

  const late2 = led.pay(payer, wallet.address, 4n * XNO, 3 * 3600);
  let once = true;
  await runLateReturns({
    ...opts,
    beforePublish: async () => {
      if (!once) return;
      once = false;
      await db.collection(names.meta).doc("lock").update({ until: 0 });
      await runLateReturns(opts);
    },
  });
  assert.equal(back().filter(([, b]) => b.amount === 4n * XNO).length, 1, "an overlapping run doesn't send it twice");
  assert.equal((await store.get(late2))!.status, "returned");
});
