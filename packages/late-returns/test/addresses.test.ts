// More receiving addresses (one per checkout): scanned, received and returned with their own signers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { findLateReturns, runLateReturns, type LateReturnOptions, type Signer } from "../src/index.js";
import { memoryStore } from "../src/memoryStore.js";
import { seedSigner } from "../examples/signer.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const seedOf = (label: string) => createHash("sha256").update(label).digest("hex").toUpperCase();
const wallet = seedSigner(seedOf("late-returns addresses wallet"));
const derived = [0, 1, 2].map((i) => seedSigner(seedOf("late-returns addresses derived"), i));
const payer = nanoWeb.wallet.legacyAccounts(seedOf("late-returns addresses payer"), 0, 0)[0].address;
const XNO = 10n ** 30n;
const MILLI = 10n ** 27n;
const signerFor = async (a: string): Promise<Signer | null> => derived.find((d) => d.address === a) ?? null;

function setup(extra: Partial<LateReturnOptions> = {}) {
  const led = new MockLedger();
  const store = memoryStore();
  const opts: LateReturnOptions = { rpc: led.rpc, store, signer: wallet, isClaimable: async () => false, perRun: 50, ...extra };
  return { led, store, opts };
}
const back = (led: MockLedger, from: Signer) => led.sendsFrom(from.address, payer);

test("default: an extra address is never looked at", async () => {
  const { led, opts } = setup();
  led.pay(payer, derived[0].address, XNO, 3 * 3600);
  assert.deepEqual(await runLateReturns(opts), { ran: true, recorded: 0, sent: 0 });
  assert.equal(back(led, derived[0]).length, 0);
});

test("a payment to a derived address is received there and returned from there, once", async () => {
  const { led, store, opts } = setup({ addresses: derived.map((d) => d.address), signerFor });
  const own = led.pay(payer, wallet.address, 2n * XNO, 3 * 3600);
  const late = led.pay(payer, derived[1].address, 3n * XNO + 7n, 3 * 3600);
  const r = await runLateReturns(opts);
  assert.deepEqual(r, { ran: true, recorded: 2, sent: 2 });
  assert.equal(back(led, wallet).length, 1, "the wallet's own payment goes back from the wallet");
  assert.equal(back(led, derived[1]).length, 1, "the derived payment goes back from its own address");
  assert.equal(back(led, derived[1])[0][1].amount, 3n * XNO + 7n);
  assert.equal(back(led, derived[0]).length + back(led, derived[2]).length, 0);
  assert.equal(led.balance(derived[1].address), 0n);
  assert.equal((await store.get(late))!.status, "returned");
  assert.equal((await store.get(own))!.status, "returned");
  await runLateReturns(opts);
  assert.equal(back(led, derived[1]).length, 1, "the next run sends nothing more");
});

test("addresses may be a function; isClaimable is told which address got the payment", async () => {
  const seen: string[] = [];
  const { led, opts } = setup({ addresses: async () => [derived[2].address], signerFor, isClaimable: async (p) => (seen.push(p.to), p.to === derived[2].address) });
  led.pay(payer, derived[2].address, XNO, 3 * 3600);
  assert.equal(await findLateReturns(opts), 0, "claimable, so it stays");
  assert.deepEqual(seen, [derived[2].address]);
});

test("the limits count across all addresses together", async () => {
  const { led, opts } = setup({ addresses: derived.map((d) => d.address), signerFor, perRun: 2 });
  for (const [i, d] of derived.entries()) led.pay(payer, d.address, MILLI + BigInt(i), 3 * 3600);
  assert.equal(await findLateReturns(opts), 2, "perRun 2 stops the scan after two, whatever the address");
  const day = setup({ addresses: derived.map((d) => d.address), signerFor, perDay: 1 });
  for (const [i, d] of derived.entries()) day.led.pay(payer, d.address, MILLI + BigInt(i), 3 * 3600);
  assert.equal(await findLateReturns(day.opts), 1, "perDay 1 counts all addresses");
  const sender = setup({ addresses: derived.map((d) => d.address), signerFor, perSenderPerDay: 1 });
  for (const [i, d] of derived.entries()) sender.led.pay(payer, d.address, MILLI + BigInt(i), 3 * 3600);
  assert.equal(await findLateReturns(sender.opts), 1, "perSenderPerDay 1: one sender, one return in all");
});

test("a derived address' own sends and a payment from one derived address to another do not come back", async () => {
  const { led, opts } = setup({ addresses: derived.map((d) => d.address), signerFor });
  led.pay(derived[0].address, derived[1].address, XNO, 3 * 3600);
  assert.equal(await findLateReturns(opts), 0);
});

test("no signer for an address: its return waits, the others still go", async () => {
  const { led, store, opts } = setup({ addresses: derived.map((d) => d.address), signerFor: async (a) => (a === derived[0].address ? null : signerFor(a)) });
  const stuck = led.pay(payer, derived[0].address, XNO, 3 * 3600);
  led.pay(payer, derived[1].address, XNO + 1n, 3 * 3600);
  const r = await runLateReturns(opts);
  assert.equal(r.sent, 1);
  assert.equal((await store.get(stuck))!.status, "pending");
  assert.match((await store.get(stuck))!.error ?? "", /no signer/);
});

test("addresses without signerFor is an error", async () => {
  const { opts } = setup({ addresses: [derived[0].address] });
  await assert.rejects(findLateReturns(opts), /signerFor/);
});
