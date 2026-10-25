// Derived-address mode: one address for each checkout, a clean quote, an exact check, a sweep, and returns.
// Test secrets only: none of these ever held money.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { claimCheckout, createCheckout, priceRaw, SweepLeaseLost, type CheckoutOptions } from "../src/index.js";
import {
  CLEAN_STEP_RAW,
  DEFAULT_SEED_LABEL,
  DERIVED_INDEX_CAP,
  cleanQuote,
  createDerivedCheckout,
  deriveAddress,
  derivedReturns,
  derivedSigner,
  stateBlockHash,
  sweepCheckout,
  sweepPaid,
  type DerivedOptions,
  type SweepOptions,
} from "../src/derived.js";
import { memoryStore } from "../src/memoryStore.js";
import { runLateReturns } from "../../late-returns/src/index.js";
import { memoryStore as lateStore } from "../../late-returns/src/memoryStore.js";
import { MockLedger } from "./mockLedger.js";
import { stateBlockHash as referenceHash } from "./blockHash.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;
const SECRET = "kit test secret 0123456789abcdef0123456789abcdef";
const DEST = acct("derived test destination");
const BUYER = acct("derived test buyer");
const THIEF = acct("derived test thief");
const XNO = 10n ** 30n;
const STEP = CLEAN_STEP_RAW;

function setup(extra: Partial<DerivedOptions> = {}) {
  const led = new MockLedger();
  const store = memoryStore();
  const o: DerivedOptions = { rpc: led.rpc, store, secret: SECRET, ...extra };
  const sweepOpts = (more: Partial<SweepOptions> = {}): SweepOptions => ({ rpc: led.rpc, store, secret: SECRET, destination: DEST, ...more });
  return { led, store, o, sweepOpts };
}
const price = priceRaw(0.05, 0.36);

/** Every block that came from `address` (its receive and its sends). */
const blocksOf = (led: MockLedger, address: string) => [...led.blocks.values()].filter((b) => b.account === address);

test("the quote: rounded UP to a whole 0.0001 XNO; below one step is an error", () => {
  assert.equal(cleanQuote(593n * STEP), 593n * STEP, "a clean price stays");
  assert.equal(cleanQuote(593n * STEP + 1n), 594n * STEP, "one raw over rounds up");
  assert.equal(cleanQuote(594n * STEP - 1n), 594n * STEP);
  assert.equal(cleanQuote(STEP), STEP, "exactly one step is allowed");
  assert.equal(cleanQuote(price), price, "priceRaw is already clean");
  for (const bad of [0n, 1n, STEP - 1n, -5n]) assert.throws(() => cleanQuote(bad), /below 0\.0001 XNO/);
  assert.throws(() => cleanQuote(5 as unknown as bigint), /bigint/);
});

test("the derivation: HMAC-SHA256 of the secret with the label, then legacy account n (same as nano133.com)", () => {
  // These four come from nano133.com's own deriveCheckoutAddress (its label is the site's), run on 2026-10-21.
  const site = "nano133 checkout seed v1";
  assert.equal(deriveAddress(SECRET, 0, site).address, "nano_3wyfxp4jirwgged941prk4bjzzuubqo4y7cmxiodsx1fchjiefx5d9wga3gw");
  assert.equal(deriveAddress(SECRET, 1, site).address, "nano_3fe7wpzz699qopsq7rp77od6gciqobukdn81jzzryc5f7xf6mi4fa3udibi4");
  assert.equal(deriveAddress(SECRET, 7, site).address, "nano_1sbjbgt86ofcxtp73iwangye33qj3hfcapmzncj3nkm36z18h4xzg4tm7huu");
  assert.equal(deriveAddress(SECRET, 999_999, site).address, "nano_16fqf8kyx4ssf7jbqi7pgkrz5epp81w36a5tspxr1koxaha1teeoq1hibhcu");
  // The package's default label is its own: it never gives the site's addresses.
  assert.notEqual(DEFAULT_SEED_LABEL, site);
  assert.notEqual(deriveAddress(SECRET, 0).address, deriveAddress(SECRET, 0, site).address);
  assert.equal(deriveAddress(SECRET, 0).address, deriveAddress(SECRET, 0, DEFAULT_SEED_LABEL).address);
  // The result has no private key, and each index has its own address.
  const a = deriveAddress(SECRET, 3);
  assert.deepEqual(Object.keys(a).sort(), ["address", "index", "publicKey"]);
  assert.equal(nanoWeb.tools.addressToPublicKey(a.address).toUpperCase(), a.publicKey);
  assert.notEqual(deriveAddress(SECRET, 4).address, a.address);
  assert.notEqual(deriveAddress(SECRET + "x", 3).address, a.address);
});

test("a short secret, an empty label and a bad index are refused", () => {
  assert.throws(() => deriveAddress("short", 0), /at least 32/);
  assert.throws(() => deriveAddress(SECRET, 0, ""), /label/);
  for (const bad of [-1, 1.5, NaN, DERIVED_INDEX_CAP, DERIVED_INDEX_CAP + 1]) assert.throws(() => deriveAddress(SECRET, bad), /index/);
  assert.equal(deriveAddress(SECRET, DERIVED_INDEX_CAP - 1).index, DERIVED_INDEX_CAP - 1);
});

test("the block hash agrees with the reference hash", async () => {
  const s = derivedSigner(SECRET, 2);
  const { block, hash } = await s.send({ frontier: "AB".repeat(32), balance: 5n * XNO, representative: DEST, to: DEST, amount: XNO, work: "0000000000000000" });
  assert.equal(hash, referenceHash(block));
  assert.equal(stateBlockHash(block), hash);
  assert.equal(s.address, deriveAddress(SECRET, 2).address);
  assert.ok(!JSON.stringify(Object.entries(s)).includes(nanoWeb.wallet.legacyAccounts(createHash("sha256").update("x").digest("hex"), 0, 0)[0].privateKey));
});

test("a derived checkout: a clean quote, its own address and index, the window and grace, no unique tail and no amount lock", async () => {
  const { o, store } = setup();
  let now = 1_800_000_000_000;
  const c = await createDerivedCheckout({ ...o, now: () => now }, { item: "post:1", price: price + 1n, ttlMs: 10 * 60_000, graceMs: 30 * 60_000, meta: { buyer: "x" } });
  assert.equal(c.amount, String(price + STEP), "price + 1 raw rounds up to the next step");
  assert.equal(BigInt(c.amount) % STEP, 0n, "no tail");
  assert.equal(c.index, 0);
  assert.equal(c.to, deriveAddress(SECRET, 0).address);
  assert.equal(c.expiresAt, now + 10 * 60_000);
  assert.equal(c.graceMs, 30 * 60_000);
  assert.equal(c.status, "waiting");
  assert.deepEqual(c.meta, { buyer: "x" });
  assert.equal(store.locks.size, 0, "no amount lock");
  assert.deepEqual(await store.get(c.id), c);
  // Two checkouts for the same price: the same clean amount at two addresses.
  now += 1000;
  const d = await createDerivedCheckout({ ...o, now: () => now }, { item: "post:1", price });
  assert.equal(c.amount === d.amount, false, "the second price is one step lower");
  const e = await createDerivedCheckout(o, { item: "post:1", price });
  const f = await createDerivedCheckout(o, { item: "post:1", price });
  assert.equal(e.amount, f.amount);
  assert.notEqual(e.to, f.to);
});

test("a price below one step is refused, and takes no index", async () => {
  const { o, store } = setup();
  await assert.rejects(createDerivedCheckout(o, { item: "x", price: STEP - 1n }), /below 0\.0001 XNO/);
  await assert.rejects(createDerivedCheckout({ ...o, secret: "short" }, { item: "x", price }), /at least 32/);
  assert.equal(store.index.next, 0);
  assert.equal(store.checkouts.size, 0);
});

test("two checkouts at once get two indexes and two addresses", async () => {
  const { o, store } = setup();
  const [a, b] = await Promise.all([createDerivedCheckout(o, { item: "x", price }), createDerivedCheckout(o, { item: "x", price })]);
  assert.deepEqual([a.index, b.index].sort(), [0, 1]);
  assert.notEqual(a.to, b.to);
  assert.equal(a.amount, b.amount);
  const many = await Promise.all(Array.from({ length: 25 }, () => createDerivedCheckout(o, { item: "x", price })));
  assert.equal(new Set(many.map((c) => c.index)).size, 25);
  assert.equal(new Set(many.map((c) => c.to)).size, 25);
  assert.equal(store.index.next, 27);
});

test("the cap: the last index works, the next one throws, a record past the cap moves nothing", async () => {
  const { o, store, led, sweepOpts } = setup();
  store.index.next = DERIVED_INDEX_CAP - 1;
  const last = await createDerivedCheckout(o, { item: "x", price });
  assert.equal(last.index, DERIVED_INDEX_CAP - 1);
  await assert.rejects(createDerivedCheckout(o, { item: "x", price }), /cap of 1000000/);
  assert.equal(store.index.next, DERIVED_INDEX_CAP, "a refused counter does not move");
  await assert.rejects(store.takeIndex(3), /cap of 3/);
  store.index.next = -1;
  await assert.rejects(createDerivedCheckout(o, { item: "x", price }), /whole number/);
  // A paid record whose index is past the cap: the sweep refuses it before it touches the ledger.
  const hash = led.pay(BUYER, last.to, BigInt(last.amount), 0);
  await store.markPaid(last.id, hash, BUYER, Date.now());
  store.checkouts.get(last.id)!.index = DERIVED_INDEX_CAP;
  await assert.rejects(sweepCheckout(sweepOpts(), last.id), /cap/);
  assert.equal(blocksOf(led, last.to).length, 0);
});

test("a store never gives one address to two checkouts", async () => {
  const { o, store } = setup();
  const a = await createDerivedCheckout(o, { item: "x", price });
  store.index.next = 0; // a reset counter
  await assert.rejects(createDerivedCheckout(o, { item: "x", price }), /already has a checkout/);
  assert.equal(store.checkouts.size, 1);
  assert.equal((await store.byAddress(a.to))?.id, a.id);
});

test("the exact amount pays: pending while unconfirmed, then paid; the amount and the address must both be exact", async () => {
  const { o, led, store } = setup();
  const c = await createDerivedCheckout(o, { item: "post:1", price });
  const other = await createDerivedCheckout(o, { item: "post:1", price });
  const Q = BigInt(c.amount);
  assert.equal((await claimCheckout(o, c.id, null)).state, "waiting");
  // One raw short, one raw over: never paid (a search finds nothing; a named block is wrong).
  const short = led.pay(BUYER, c.to, Q - 1n, 0);
  const over = led.pay(BUYER, c.to, Q + 1n, 0);
  assert.equal((await claimCheckout(o, c.id, null)).state, "waiting");
  assert.equal((await claimCheckout(o, c.id, short)).state, "wrong");
  assert.equal((await claimCheckout(o, c.id, over)).state, "wrong");
  // The exact amount at ANOTHER checkout's address is not this checkout's payment: the address names the checkout.
  const toOther = led.pay(BUYER, other.to, Q, 0);
  assert.equal((await claimCheckout(o, c.id, null)).state, "waiting");
  assert.equal((await claimCheckout(o, c.id, toOther)).state, "wrong");
  // The exact amount at its own address.
  const h = led.pay(BUYER, c.to, Q, 0, false);
  assert.equal((await claimCheckout(o, c.id, null)).state, "pending");
  led.blocks.get(h)!.confirmed = true;
  const r = await claimCheckout(o, c.id, null);
  assert.ok(r.state === "paid" && r.checkout.hash === h && r.checkout.payer === BUYER);
  assert.equal(r.state === "paid" && r.checkout.sweep?.status, "due", "a paid derived checkout is due for its sweep");
  assert.equal((await store.get(other.id))?.status, "waiting", "the other checkout is untouched");
  assert.equal((await claimCheckout(o, c.id, null)).state, "paid", "claiming again is safe");
});

test("a payment first seen before the window is skipped, and after expiry plus grace the checkout cannot be claimed", async () => {
  let now = Date.now();
  const { o, led } = setup({ now: () => now });
  const c = await createDerivedCheckout(o, { item: "x", price });
  led.pay(BUYER, c.to, BigInt(c.amount), 3 * 3600);
  assert.equal((await claimCheckout(o, c.id, null)).state, "waiting");
  const d = await createDerivedCheckout(o, { item: "x", price });
  now += 80 * 60_000;
  led.pay(BUYER, d.to, BigInt(d.amount), 0);
  assert.equal((await claimCheckout(o, d.id, null)).state, "expired");
});

test("the Cake case: a wallet that cuts a tailed amount to 0.0593 pays a derived quote of 0.0593, and never matched the old tailed quote", async () => {
  // The old way: one shared address, a unique amount with a tail. Cake Wallet sent 0.0593 for 0.059300000000000000000000801448.
  const led = new MockLedger();
  const old = memoryStore();
  const SHOP = acct("derived test old shop");
  const oldOpts: CheckoutOptions = { rpc: led.rpc, store: old, to: SHOP, tail: () => 801_448 };
  const tailed = await createCheckout(oldOpts, { item: "post:1", price: 593n * STEP });
  assert.equal(tailed.amount, "59300000000000000000000801448");
  const cut = 593n * STEP; // what the wallet sent
  const sent = led.pay(BUYER, SHOP, cut, 0);
  assert.equal((await claimCheckout(oldOpts, tailed.id, null)).state, "waiting", "the old way never matches the rounded amount");
  assert.equal((await claimCheckout(oldOpts, tailed.id, sent)).state, "wrong");
  // The new way: the quote is clean, so the rounded amount IS the quote.
  const { o, led: led2, store } = setup();
  const c = await createDerivedCheckout(o, { item: "post:1", price: 593n * STEP });
  assert.equal(c.amount, cut.toString());
  const h = led2.pay(BUYER, c.to, cut, 0);
  const r = await claimCheckout(o, c.id, null);
  assert.ok(r.state === "paid" && r.checkout.hash === h);
  assert.equal(await store.isUsed(h), true);
});

test("the sweep receives the one paid block and sends exactly the quote to the fixed destination, once", async () => {
  const { o, led, store, sweepOpts } = setup();
  // A record that tries to name its own destination: the sweep never reads it.
  const c = await createDerivedCheckout(o, { item: "x", price, meta: { destination: THIEF, to: THIEF } });
  const Q = BigInt(c.amount);
  assert.equal(await sweepCheckout(sweepOpts(), c.id), "waiting", "not paid yet");
  const h = led.pay(BUYER, c.to, Q, 0);
  await claimCheckout(o, c.id, h);
  assert.equal(await sweepCheckout(sweepOpts(), c.id), "swept");
  const sends = led.sendsFrom(c.to, DEST);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][1].amount, Q, "exactly the quote");
  assert.equal(led.sendsFrom(c.to, THIEF).length, 0, "never the record's destination");
  assert.equal(led.balance(c.to), 0n);
  assert.equal(led.balance(DEST), 0n, "the destination has it waiting, not received");
  assert.ok(led.received.has(h), "the paid block was received");
  const done = (await store.get(c.id))!;
  assert.equal(done.sweep?.status, "done");
  assert.equal(done.sweep?.hash, sends[0][0]);
  assert.equal(done.sweep?.lease, null);
  assert.equal(await store.isUsed(sends[0][0]), true, "the sweep's own send is marked used");
  // A second run sends nothing.
  const before = led.blocks.size;
  assert.equal(await sweepCheckout(sweepOpts(), c.id), "already");
  assert.deepEqual(await sweepPaid(sweepOpts()), { swept: 0, busy: 0, failed: [] });
  assert.equal(led.blocks.size, before);
  assert.equal(led.sendsFrom(c.to, DEST).length, 1);
});

test("two runs at once send once", async () => {
  const { o, led, sweepOpts } = setup();
  const c = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
  const r = await Promise.all([sweepCheckout(sweepOpts(), c.id), sweepCheckout(sweepOpts(), c.id)]);
  assert.deepEqual([...r].sort(), ["busy", "swept"]);
  assert.equal(led.sendsFrom(c.to, DEST).length, 1);
});

test("a run that dies after it recorded the send publishes that same block once; an answer lost on its way back is found on the ledger", async () => {
  const { o, led, store, sweepOpts } = setup();
  const a = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, a.id, led.pay(BUYER, a.to, BigInt(a.amount), 0));
  await assert.rejects(
    sweepCheckout(
      sweepOpts({
        beforePublish: () => {
          throw new Error("the process stopped");
        },
      }),
      a.id,
    ),
    /process stopped/,
  );
  const mid = (await store.get(a.id))!;
  assert.ok(mid.sweep?.send?.hash && mid.sweep.recv, "the send was recorded before it was published");
  assert.equal(mid.sweep?.status, "due");
  assert.equal(mid.sweep?.error, "the process stopped");
  assert.equal(led.sendsFrom(a.to, DEST).length, 0);
  assert.equal(await sweepCheckout(sweepOpts(), a.id), "swept");
  assert.equal(led.sendsFrom(a.to, DEST).length, 1);
  assert.equal(led.sendsFrom(a.to, DEST)[0][0], mid.sweep!.send!.hash, "the recorded block is the one that landed");
  // The node took the send but its answer was lost.
  const b = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, b.id, led.pay(BUYER, b.to, BigInt(b.amount), 0));
  led.faults.loseSendAnswer = true;
  await assert.rejects(sweepCheckout(sweepOpts(), b.id), /timeout/);
  assert.equal(led.sendsFrom(b.to, DEST).length, 1, "it landed");
  assert.equal((await store.get(b.id))!.sweep?.status, "due");
  assert.equal(await sweepCheckout(sweepOpts(), b.id), "swept");
  assert.equal(led.sendsFrom(b.to, DEST).length, 1, "and the second run did not send again");
});

test("an earlier run's send is found by what it did, even when 55 blocks came after it", async () => {
  // The recorded block never landed, but another block of the same send did (the same frontier, destination and amount, another
  // representative, so another hash), and the address made 55 more blocks since: the newest 50 do not hold it.
  const { o, led, store, sweepOpts } = setup();
  const c = await createDerivedCheckout(o, { item: "x", price });
  const Q = BigInt(c.amount);
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, Q, 0));
  await assert.rejects(sweepCheckout(sweepOpts({ beforePublish: () => { throw new Error("the process stopped"); } }), c.id), /process stopped/);
  const intent = (await store.get(c.id))!.sweep!.send!;
  const signer = derivedSigner(SECRET, c.index!);
  const landed = await signer.send({ frontier: intent.root, balance: BigInt(intent.block.balance) + Q, representative: THIEF, to: DEST, amount: Q, work: "0" });
  assert.notEqual(landed.hash.toUpperCase(), intent.hash.toUpperCase());
  await led.rpc({ action: "process", block: landed.block });
  for (let i = 0; i < 55; i++) {
    const acc = led.accounts.get(c.to)!;
    const other = led.pay(BUYER, c.to, 1n, 0);
    const { block } = await signer.receive({ frontier: acc.frontier, balance: acc.balance, representative: acc.rep, source: other, amount: 1n, work: "0" });
    await led.rpc({ action: "process", block });
  }
  assert.ok(blocksOf(led, c.to).length > 56, "more than 50 blocks follow the send, so the newest 50 do not reach it");
  assert.equal(await sweepCheckout(sweepOpts(), c.id), "swept");
  assert.equal(led.sendsFrom(c.to, DEST).length, 1, "no second send");
  assert.equal(led.sendsFrom(c.to, DEST)[0][0], landed.hash.toUpperCase());
  assert.equal((await store.get(c.id))!.sweep?.hash, landed.hash.toUpperCase());
});

test("a recorded send whose frontier moved: \"not found\" for the chain means no successor, and another error leaves the sweep due", async () => {
  const { o, led, store, sweepOpts } = setup();
  const c = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
  await assert.rejects(sweepCheckout(sweepOpts({ beforePublish: () => { throw new Error("the process stopped"); } }), c.id), /process stopped/);
  // Something else moves the address's frontier, so the recorded block cannot be published again and the chain must be asked.
  const signer = derivedSigner(SECRET, c.index!);
  const acc = led.accounts.get(c.to)!;
  const other = led.pay(BUYER, c.to, 1n, 0);
  const { block } = await signer.receive({ frontier: acc.frontier, balance: acc.balance, representative: acc.rep, source: other, amount: 1n, work: "0" });
  await led.rpc({ action: "process", block });
  const failing = (message: string): typeof led.rpc => async (body) => {
    if (body.action === "account_history") throw new Error(message);
    return led.rpc(body);
  };
  await assert.rejects(sweepCheckout(sweepOpts({ rpc: failing("the node is down") }), c.id), /node is down/);
  assert.equal(led.sendsFrom(c.to, DEST).length, 0, "nothing was sent");
  assert.equal((await store.get(c.id))!.sweep?.status, "due");
  assert.equal(await sweepCheckout(sweepOpts({ rpc: failing("Block not found") }), c.id), "swept", "no successor: a new block");
  assert.equal(led.sendsFrom(c.to, DEST).length, 1);
});

test("the sweep refuses a block that is not a confirmed send of the quote to that address, and moves nothing", async () => {
  const { o, led, store, sweepOpts } = setup();
  const bad = async (make: (c: { to: string; amount: string }) => string, why: RegExp) => {
    const c = await createDerivedCheckout(o, { item: "x", price });
    await store.markPaid(c.id, make(c), BUYER, Date.now()); // forced: a claim would never take it
    await assert.rejects(sweepCheckout(sweepOpts(), c.id), why);
    assert.equal(blocksOf(led, c.to).length, 0, "nothing was received or sent");
    const rec = (await store.get(c.id))!;
    assert.equal(rec.sweep?.status, "due");
    assert.equal(rec.sweep?.tries, 1);
    assert.match(rec.sweep?.error ?? "", why);
    assert.equal(rec.sweep?.lease, null, "the lease ends with the run");
  };
  await bad((c) => led.pay(BUYER, c.to, BigInt(c.amount), 0, false), /not a confirmed send/);
  await bad((c) => led.pay(BUYER, c.to, BigInt(c.amount) + 1n, 0), /not a confirmed send/);
  await bad((c) => led.pay(BUYER, c.to, BigInt(c.amount) - 1n, 0), /not a confirmed send/);
  await bad((c) => led.pay(BUYER, THIEF, BigInt(c.amount), 0), /not a confirmed send/);
  await bad(() => "A".repeat(64), /Block not found/);
  // A record with no valid block at all.
  const c = await createDerivedCheckout(o, { item: "x", price });
  await store.markPaid(c.id, "nothex", BUYER, Date.now());
  await assert.rejects(sweepCheckout(sweepOpts(), c.id), /no valid paid block/);
});

test("a record whose index does not give its address moves nothing", async () => {
  const { o, led, store, sweepOpts } = setup();
  const a = await createDerivedCheckout(o, { item: "x", price });
  const b = await createDerivedCheckout(o, { item: "x", price });
  const ha = led.pay(BUYER, a.to, BigInt(a.amount), 0);
  await claimCheckout(o, a.id, ha);
  // The index of another checkout: its key would sign for another address.
  store.checkouts.get(a.id)!.index = b.index;
  await assert.rejects(sweepCheckout(sweepOpts(), a.id), /does not give its address/);
  // The address of another checkout.
  store.checkouts.get(a.id)!.index = a.index;
  store.checkouts.get(a.id)!.to = b.to;
  await assert.rejects(sweepCheckout(sweepOpts(), a.id), /does not give its address/);
  assert.equal(blocksOf(led, a.to).length + blocksOf(led, b.to).length, 0);
  assert.equal(led.sendsFrom(a.to, DEST).length + led.sendsFrom(b.to, DEST).length, 0);
  // The right seed with the wrong label gives other addresses: nothing moves either.
  store.checkouts.get(a.id)!.to = a.to;
  await assert.rejects(sweepCheckout(sweepOpts({ label: "another label" }), a.id), /does not give its address/);
  // A bad destination, and a destination that is the address itself.
  await assert.rejects(sweepCheckout(sweepOpts({ destination: "nano_notanaddress" }), a.id), /destination/);
  await assert.rejects(sweepCheckout(sweepOpts({ destination: a.to }), a.id), /destination/);
  assert.equal(led.blocks.size, 1, "only the buyer's payment is on the ledger");
});

test("a send that is on the ledger must be this sweep's send", async () => {
  const { o, led, store, sweepOpts } = setup();
  const c = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
  await assert.rejects(sweepCheckout(sweepOpts({ beforePublish: () => { throw new Error("stop"); } }), c.id), /stop/);
  const intent = (await store.get(c.id))!.sweep!.send!;
  // The same record, but the destination in the code changed: the recorded block is not published for another destination.
  const other = acct("derived test other destination");
  assert.equal(await sweepCheckout(sweepOpts({ destination: other }), c.id), "swept");
  assert.equal(led.sendsFrom(c.to, other).length, 1, "a new block for the new destination");
  assert.equal(led.sendsFrom(c.to, DEST).length, 0);
  assert.notEqual((await store.get(c.id))!.sweep!.hash, intent.hash);
});

test("the lease: another owner's write is refused, an expired lease is taken over", async () => {
  const { o, led, store } = setup();
  const c = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
  assert.equal(await store.claimSweep(c.id, "a", 1000, 500), true);
  assert.equal(await store.claimSweep(c.id, "b", 1100, 500), false, "held");
  await assert.rejects(store.patchSweep(c.id, "b", { recv: "X" }, 1100, 500), SweepLeaseLost);
  await assert.rejects(store.finishSweep(c.id, "b", "H".repeat(64), 1100), SweepLeaseLost);
  assert.equal(await store.claimSweep(c.id, "b", 1600, 500), true, "expired: taken over");
  await assert.rejects(store.patchSweep(c.id, "a", { recv: "X" }, 1700, 500), SweepLeaseLost, "the old owner is fenced out");
  await store.releaseSweep(c.id, "a");
  assert.equal((await store.get(c.id))!.sweep?.lease?.owner, "b", "another owner's release changes nothing");
  await store.patchSweep(c.id, "b", { recv: "R" }, 1700, 500);
  assert.equal((await store.get(c.id))!.sweep?.recv, "R");
});

test("sweepPaid sweeps what is due; a bad record fails alone and is tried after the others", async () => {
  const { o, led, store, sweepOpts } = setup();
  const cs = [];
  for (let i = 0; i < 4; i++) {
    const c = await createDerivedCheckout(o, { item: "x", price });
    await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
    cs.push(c);
  }
  store.checkouts.get(cs[0].id)!.index = 99; // a broken record
  const r = await sweepPaid(sweepOpts(), { max: 10 });
  assert.equal(r.swept, 3);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, cs[0].id);
  assert.match(r.failed[0].error, /does not give its address/);
  for (const c of cs.slice(1)) assert.equal(led.sendsFrom(c.to, DEST).length, 1);
  assert.equal(led.sendsFrom(cs[0].to, DEST).length, 0);
});

test("late returns: a payment of any other amount goes back in full from its own address; the exact quote and the sweep's own send stay", async () => {
  const { o, led, store, sweepOpts } = setup();
  // Late Payment Return waits 2 hours before it returns a payment: its clock runs 4 hours ahead (`now`), so every payment
  // here is old enough; the checkouts' own clock is the real one.
  // The wallet that Late Payment Return runs for (the shop's own wallet: here also the sweep's destination).
  const WALLET_SECRET = "kit test shop wallet secret 0123456789abcdef";
  const shop = derivedSigner(WALLET_SECRET, 0);
  const sweepTo = shop.address;
  const used = { has: (h: string) => store.used.has(h), add: (h: string) => void store.used.set(h, "late-return") } as unknown as Set<string>;
  const lateS = lateStore(used);
  const derived = derivedReturns({ store, secret: SECRET });
  const run = () =>
    runLateReturns({ rpc: led.rpc, store: lateS, signer: shop, ...derived, isClaimable: async (p) => derived.isClaimable(p), perRun: 20, now: Date.now() + 4 * 3600_000 });

  // Checkout A: paid exactly and claimed. Checkout B: waits; its buyer's wallet rounded the amount by one step.
  const a = await createDerivedCheckout(o, { item: "a", price });
  const b = await createDerivedCheckout(o, { item: "b", price: price + STEP });
  const paidA = led.pay(BUYER, a.to, BigInt(a.amount), 0);
  await claimCheckout(o, a.id, paidA);
  const roundedB = led.pay(BUYER, b.to, BigInt(b.amount) - STEP, 0);
  // A second exact payment at the paid address A, and an exact payment to checkout C after its window closed.
  const secondA = led.pay(BUYER, a.to, BigInt(a.amount), 0);
  const c = await createDerivedCheckout({ ...o, now: () => Date.now() - 10 * 3600_000 }, { item: "c", price });
  const lateC = led.pay(BUYER, c.to, BigInt(c.amount), 0);
  // The sweep of A sends the quote to the shop's wallet.
  assert.equal(await sweepCheckout(sweepOpts({ destination: sweepTo }), a.id), "swept");
  const sweepSend = led.sendsFrom(a.to, sweepTo)[0][0];

  // B's exact payment is still claimable, so while B is open nothing of it goes back. B's rounded payment is not B's.
  const r = await run();
  assert.equal(r.ran, true);
  assert.equal(r.sent, 3, "the rounded one, the second one and the late one");
  const back = (addr: string) => led.sendsFrom(addr, BUYER);
  assert.equal(back(b.to).length, 1);
  assert.equal(back(b.to)[0][1].amount, BigInt(b.amount) - STEP, "in full");
  assert.equal(back(a.to).length, 1);
  assert.equal(back(a.to)[0][1].amount, BigInt(a.amount), "the second payment, in full");
  assert.equal(back(c.to).length, 1);
  assert.equal(back(c.to)[0][1].amount, BigInt(c.amount), "the late exact payment, in full");
  assert.equal(led.balance(a.to), 0n);
  assert.equal(led.balance(b.to), 0n);
  assert.equal((await lateS.get(roundedB))!.status, "returned");
  assert.equal((await lateS.get(secondA))!.status, "returned");
  assert.equal((await lateS.get(lateC))!.status, "returned");
  // Not returned: A's paid block (used), the sweep's own send into the shop's wallet (used), and a waiting checkout's exact quote.
  assert.equal(await lateS.get(paidA), null);
  assert.equal(await lateS.get(sweepSend), null);
  const exactB = led.pay(BUYER, b.to, BigInt(b.amount), 0);
  assert.equal((await run()).recorded, 0, "B's exact payment can still be claimed");
  assert.equal(await lateS.get(exactB), null);
  // The next run sends nothing more.
  assert.deepEqual(await run(), { ran: true, recorded: 0, sent: 0 });
  assert.equal(back(a.to).length + back(b.to).length + back(c.to).length, 3);
  // Without a signer for the address, its return waits (a record whose index does not give its address).
  const d = await createDerivedCheckout(o, { item: "d", price });
  store.checkouts.get(d.id)!.index = a.index;
  const stuck = led.pay(BUYER, d.to, BigInt(d.amount) - STEP, 0);
  assert.equal((await run()).sent, 0);
  assert.equal((await lateS.get(stuck))!.status, "pending");
  assert.match((await lateS.get(stuck))!.error ?? "", /no signer/);
});

test("the sweep's own send is a used payment: Late Payment Return never sends it back, even when its address is not on the list", async () => {
  const { o, led, store, sweepOpts } = setup();
  const shop = derivedSigner("kit test shop wallet secret 0123456789abcdef", 0);
  const c = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
  await sweepCheckout(sweepOpts({ destination: shop.address }), c.id);
  const sweepSend = led.sendsFrom(c.to, shop.address)[0][0];
  const derived = derivedReturns({ store, secret: SECRET });
  const returns = (used: Set<string>) =>
    runLateReturns({ rpc: led.rpc, store: lateStore(used), signer: shop, addresses: [], signerFor: derived.signerFor, isClaimable: derived.isClaimable, perRun: 20, now: Date.now() + 4 * 3600_000 });
  // The package's stores share one payments collection: the send is used, so nothing is recorded.
  const shared = { has: (h: string) => store.used.has(h), add: (h: string) => void store.used.set(h, "late-return") } as unknown as Set<string>;
  assert.equal((await returns(shared)).recorded, 0);
  // The control: a return store that does NOT share it would send the sweep's own money back to the derived address.
  assert.equal((await returns(new Set())).recorded, 1);
  assert.ok(sweepSend);
});

test("the sweep is done before it lets go of the lease, also with a slow store", async () => {
  const { o, led, store, sweepOpts } = setup();
  const c = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, c.id, led.pay(BUYER, c.to, BigInt(c.amount), 0));
  // A store whose writes take time: the end of the sweep must wait for finishSweep, then release the lease.
  const order: string[] = [];
  const slow = {
    ...store,
    async finishSweep(...a: Parameters<typeof store.finishSweep>) {
      await new Promise((r) => setTimeout(r, 25));
      order.push("finish");
      return store.finishSweep(...a);
    },
    async releaseSweep(...a: Parameters<typeof store.releaseSweep>) {
      order.push("release");
      return store.releaseSweep(...a);
    },
  };
  assert.equal(await sweepCheckout(sweepOpts({ store: slow }), c.id), "swept");
  assert.deepEqual(order, ["finish", "release"]);
  assert.equal((await store.get(c.id))!.sweep?.status, "done");
  // The same on a second path: a run that finds its send already on the ledger.
  const d = await createDerivedCheckout(o, { item: "x", price });
  await claimCheckout(o, d.id, led.pay(BUYER, d.to, BigInt(d.amount), 0));
  led.faults.loseSendAnswer = true;
  await assert.rejects(sweepCheckout(sweepOpts({ store: slow }), d.id), /timeout/);
  order.length = 0;
  assert.equal(await sweepCheckout(sweepOpts({ store: slow }), d.id), "swept");
  assert.deepEqual(order, ["finish", "release"]);
  assert.equal(led.sendsFrom(d.to, DEST).length, 1);
});
