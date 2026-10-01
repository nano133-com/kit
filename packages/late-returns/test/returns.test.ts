import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { findLateReturns, publicKeyOf, runLateReturns, type LateReturnOptions, type StateBlock } from "../src/index.js";
import { memoryStore } from "../src/memoryStore.js";
import { seedSigner, stateBlockHash } from "../examples/signer.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const seedOf = (label: string) => createHash("sha256").update(label).digest("hex").toUpperCase();
const wallet = seedSigner(seedOf("late-returns test wallet"));
const payer = nanoWeb.wallet.legacyAccounts(seedOf("late-returns test payer"), 0, 0)[0].address;
const admin = nanoWeb.wallet.legacyAccounts(seedOf("late-returns test admin"), 0, 0)[0].address;
const XNO = 10n ** 30n;

/** A wallet that already holds 50 XNO of other money (a pool), and an options object. */
async function setup(extra: Partial<LateReturnOptions> = {}) {
  const led = new MockLedger();
  const store = memoryStore();
  const opening = led.pay(admin, wallet.address, 50n * XNO, 99999);
  const { block } = await wallet.receive({ frontier: null, balance: 0n, representative: admin, source: opening, amount: 50n * XNO, work: "0" });
  await led.rpc({ action: "process", block });
  const opts: LateReturnOptions = { rpc: led.rpc, store, signer: wallet, isClaimable: async () => false, never: [admin], ...extra };
  return { led, store, opts };
}
const back = (led: MockLedger) => led.sendsFrom(wallet.address, payer);

test("the block hash matches the network's (a real send block)", () => {
  const real: StateBlock = {
    account: "nano_3getnanons1aaqo5itbm8wdbzhtsp7tctd6p6qa7axwff7ocemzs3w381kfy",
    previous: "204EB3C8EA4995CEF7828EAF85B652A07C9EC2C19156AD5705F357E79BCA33BF",
    representative: "nano_1jtx5p8141zjtukz4msp1x93st7nh475f74odj8673qqm96xczmtcnanos1o",
    balance: "2988645132461232918155400000000",
    link: "1C901A4A9A72B216252E064C1E5B9A7EE1A1BBBAF7C82C51E743CFBC838E3C39",
  };
  assert.equal(stateBlockHash(real), "C6608C3F0D45BEC9E525FFAAD7D41841461FA237CAA6004F0FF0735356B03482");
  assert.equal(publicKeyOf(wallet.address), wallet.publicKey);
});

test("a late payment goes back once, and the pool is untouched", async () => {
  const { led, store, opts } = await setup();
  const late = led.pay(payer, wallet.address, 2n * XNO + 123n, 3 * 3600);
  const r = await runLateReturns(opts);
  assert.deepEqual(r, { ran: true, recorded: 1, sent: 1 });
  assert.equal(back(led).length, 1);
  assert.equal(back(led)[0][1].amount, 2n * XNO + 123n);
  assert.equal((await store.get(late))!.status, "returned");
  assert.equal(await store.isUsed(late), true, "marked used, so a late claim can't take it");
  assert.equal(led.balance(wallet.address), 50n * XNO);
  await runLateReturns(opts);
  assert.equal(back(led).length, 1, "the next run sends nothing more");
});

test("what stays: young, dust, used, claimable, from an excluded sender, unconfirmed", async () => {
  const claimable = 7n * 10n ** 29n + 5n;
  const { led, store, opts } = await setup({ isClaimable: async (p) => p.amount === claimable.toString() });
  led.pay(payer, wallet.address, 3n * XNO, 30 * 60);
  led.pay(payer, wallet.address, 5n * 10n ** 26n, 5 * 3600);
  store.used.add(led.pay(payer, wallet.address, 4n * XNO, 5 * 3600));
  led.pay(payer, wallet.address, claimable, 5 * 3600);
  led.pay(admin, wallet.address, 6n * XNO, 5 * 3600);
  led.pay(payer, wallet.address, 8n * XNO, 5 * 3600, false);
  const r = await runLateReturns(opts);
  assert.equal(r.recorded, 0);
  assert.equal(back(led).length + led.sendsFrom(wallet.address, admin).length, 0);
});

test("the node took the send but its answer was lost: still exactly one", async () => {
  const { led, opts } = await setup();
  led.pay(payer, wallet.address, 2n * XNO, 3 * 3600);
  led.faults.loseSendAnswer = true;
  await runLateReturns(opts);
  assert.equal(back(led).length, 1);
  await runLateReturns(opts);
  assert.equal(back(led).length, 1);
});

test("a crash before publishing, then a lock that expires during an overlapping run: still exactly one", async () => {
  const { led, store, opts } = await setup();
  const late = led.pay(payer, wallet.address, 2n * XNO, 3 * 3600);
  await runLateReturns({ ...opts, beforePublish: () => Promise.reject(new Error("crash")) });
  assert.equal(back(led).length, 0);
  assert.ok((await store.get(late))!.send, "the send was recorded, not published");
  let once = true;
  await runLateReturns({
    ...opts,
    beforePublish: async () => {
      if (!once) return;
      once = false;
      store.expireLock();
      await runLateReturns(opts);
    },
  });
  assert.equal(back(led).length, 1);
});

test("a recorded block that can never land (the frontier moved): a new one, once", async () => {
  const { led, store, opts } = await setup();
  const late = led.pay(payer, wallet.address, 2n * XNO, 3 * 3600);
  await runLateReturns({ ...opts, beforePublish: () => Promise.reject(new Error("crash")) });
  const old = (await store.get(late))!.send!.hash;
  // Something else moves the wallet's frontier (another receive).
  const other = led.pay(admin, wallet.address, 1n * XNO, 99999);
  const acc = led.accounts.get(wallet.address)!;
  const { block } = await wallet.receive({ frontier: acc.frontier, balance: acc.balance, representative: acc.rep, source: other, amount: 1n * XNO, work: "0" });
  await led.rpc({ action: "process", block });
  await runLateReturns(opts);
  assert.equal(back(led).length, 1);
  assert.notEqual(back(led)[0][0], old);
});

test("a payment the wallet already received is found in its history (includeReceived)", async () => {
  const { led, store, opts } = await setup({ includeReceived: true });
  const late = led.pay(payer, wallet.address, 2n * XNO, 3 * 3600);
  const acc = led.accounts.get(wallet.address)!;
  const { block } = await wallet.receive({ frontier: acc.frontier, balance: acc.balance, representative: acc.rep, source: late, amount: 2n * XNO, work: "0" });
  await led.rpc({ action: "process", block });
  await runLateReturns(opts);
  assert.equal(back(led).length, 1);
  assert.equal((await store.get(late))!.recv, "earlier");
  assert.equal(led.balance(wallet.address), 50n * XNO);
});

test("caps: 3 per run, 30 per day", async () => {
  const { led, store, opts } = await setup();
  for (let i = 1; i <= 5; i++) led.pay(payer, wallet.address, BigInt(i) * XNO + 9n, 4 * 3600);
  await findLateReturns(opts);
  assert.equal(store.returns.size, 3);
  store.days.set(new Date().toISOString().slice(0, 10), 30);
  await findLateReturns(opts);
  assert.equal(store.returns.size, 3);
});

test("defaults can be changed: a 1-hour wait and a 0.0001 XNO floor", async () => {
  const { led, opts } = await setup({ minAgeSec: 3600, minRaw: 10n ** 26n });
  led.pay(payer, wallet.address, 5n * 10n ** 26n, 90 * 60);
  const r = await runLateReturns(opts);
  assert.equal(r.sent, 1);
});
