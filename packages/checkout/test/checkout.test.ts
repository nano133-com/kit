import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { claimCheckout, createCheckout, uniqueAmount, nanoUri, priceRaw, toXno, verifyReceipt, xnoUsdRate, type CheckoutOptions } from "../src/index.js";
import { memoryStore } from "../src/memoryStore.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const acct = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0].address;
const SHOP = acct("checkout test shop");
const BUYER = acct("checkout test buyer");
const OTHER = acct("checkout test other");
const SECRET = "test receipt secret, not a real one";

function setup(extra: Partial<CheckoutOptions> = {}) {
  const led = new MockLedger();
  const store = memoryStore();
  const o: CheckoutOptions = { rpc: led.rpc, store, to: SHOP, receiptSecret: SECRET, ...extra };
  return { led, store, o };
}
const price = priceRaw(0.01, 0.36);

test("prices: dollars to raw, rounded up to 0.0001 XNO", () => {
  assert.equal(priceRaw(0.01, 0.5), 2n * 10n ** 28n);
  assert.equal(priceRaw(0.01, 0.3), 334n * 10n ** 26n);
  assert.equal(priceRaw(0.07, 0.7), 10n ** 29n, "no extra step from float noise");
  assert.equal(toXno(2n * 10n ** 28n + 734201n), "0.020000000000000000000000734201");
  assert.equal(nanoUri(SHOP, 5n), `nano:${SHOP}?amount=5`);
});

test("a checkout gets a unique amount; a held amount is not given twice", async () => {
  const { o, store } = setup({ tail: () => 42 });
  const a = await createCheckout(o, { item: "post:1", price });
  assert.equal(BigInt(a.amount) - price, 42n);
  assert.equal(store.locks.get(a.amount), a.expiresAt + a.graceMs, "locked until expiry + grace");
  await assert.rejects(createCheckout(o, { item: "post:1", price }), /no free amount/);
  let t = 41;
  const b = await createCheckout({ ...o, tail: () => t++ }, { item: "post:1", price });
  assert.notEqual(b.amount, a.amount);
});

test("the buyer pays: pending while unconfirmed, then paid with a receipt", async () => {
  const { o, led } = setup();
  const c = await createCheckout(o, { item: "post:1", price });
  assert.equal((await claimCheckout(o, c.id, null)).state, "waiting");
  const h = led.pay(BUYER, SHOP, BigInt(c.amount), 0, false);
  assert.equal((await claimCheckout(o, c.id, null)).state, "pending");
  led.blocks.get(h)!.confirmed = true;
  const r = await claimCheckout(o, c.id, null);
  assert.equal(r.state, "paid");
  if (r.state !== "paid") return;
  assert.equal(r.checkout.hash, h);
  assert.equal(r.checkout.payer, BUYER);
  const claims = verifyReceipt(SECRET, r.receipt, { item: "post:1" });
  assert.equal(claims?.hash, h);
  assert.equal(verifyReceipt(SECRET, r.receipt, { item: "post:2" }), null, "a receipt names its item");
  assert.equal(verifyReceipt("another secret", r.receipt, { item: "post:1" }), null, "another site's secret fails");
  assert.equal(verifyReceipt(SECRET, r.receipt!.slice(0, -2) + "xx", { item: "post:1" }), null, "a changed receipt fails");
  assert.equal(verifyReceipt(SECRET, r.receipt, { item: "post:1", now: Date.now() + 31 * 86_400_000 }), null, "it expires");
  const again = await claimCheckout(o, c.id, null);
  assert.ok(again.state === "paid" && again.again, "claiming again is safe");
});

test("an older payment of the same amount is skipped, not taken", async () => {
  const { o, led } = setup({ tail: () => 777 });
  const old = led.pay(BUYER, SHOP, price + 777n, 3 * 3600);
  const c = await createCheckout(o, { item: "post:1", price });
  assert.equal((await claimCheckout(o, c.id, null)).state, "waiting");
  assert.equal((await claimCheckout(o, c.id, old)).state, "waiting", "named by a browser: still not this checkout's");
  const fresh = led.pay(BUYER, SHOP, price + 777n, 0);
  const r = await claimCheckout(o, c.id, null);
  assert.ok(r.state === "paid" && r.checkout.hash === fresh);
});

test("one payment pays one checkout", async () => {
  const { o, led, store } = setup();
  const a = await createCheckout(o, { item: "post:1", price });
  const h = led.pay(BUYER, SHOP, BigInt(a.amount), 0);
  assert.equal((await claimCheckout(o, a.id, h)).state, "paid");
  const b = await createCheckout(o, { item: "post:2", price });
  store.checkouts.get(b.id)!.amount = a.amount; // forced: the store never gives one amount twice
  assert.equal((await claimCheckout(o, b.id, h)).state, "used");
});

test("wrong blocks and bad input", async () => {
  const { o, led } = setup();
  const c = await createCheckout(o, { item: "post:1", price });
  assert.equal((await claimCheckout(o, c.id, "nothex")).state, "invalid");
  assert.equal((await claimCheckout(o, c.id, "E".repeat(64))).state, "waiting", "a block the node doesn't know");
  assert.equal((await claimCheckout(o, c.id, led.pay(BUYER, OTHER, BigInt(c.amount), 0))).state, "wrong", "paid to someone else");
  assert.equal((await claimCheckout(o, c.id, led.pay(BUYER, SHOP, BigInt(c.amount) + 1n, 0))).state, "wrong", "another amount");
  assert.equal((await claimCheckout(o, "nope", null)).state, "unknown");
});

test("after expiry plus grace, a checkout can't be claimed (its amount is free again)", async () => {
  let now = Date.now();
  const { o, led } = setup({ now: () => now });
  const c = await createCheckout(o, { item: "post:1", price, ttlMs: 15 * 60_000, graceMs: 60 * 60_000 });
  now += 70 * 60_000;
  led.pay(BUYER, SHOP, BigInt(c.amount), 0);
  assert.equal((await claimCheckout(o, c.id, null)).state, "paid", "inside the grace it counts");
  const d = await createCheckout(o, { item: "post:2", price });
  now += 80 * 60_000;
  assert.equal((await claimCheckout(o, d.id, null)).state, "expired");
});

test("the store answers Late Payment Return: used payments and claimable amounts", async () => {
  let now = Date.now();
  const { o, led, store } = setup({ now: () => now });
  const c = await createCheckout(o, { item: "post:1", price });
  assert.equal(await store.claimable(c.amount, now), true);
  const h = led.pay(BUYER, SHOP, BigInt(c.amount), 0);
  await claimCheckout(o, c.id, h);
  assert.equal(await store.isUsed(h), true);
  assert.equal(await store.claimable(c.amount, now), false, "a paid checkout claims nothing more");
  const d = await createCheckout(o, { item: "post:2", price });
  assert.equal(await store.claimable(d.amount, now + 2 * 3600_000), false, "after its grace, nothing can claim the amount");
});

test("the rate: the median of the feeds that answer, nonsense left out", async () => {
  const answers: Record<string, unknown> = {
    coingecko: { nano: { usd: 0.36 } },
    kraken: { result: { NANOUSD: { c: ["0.37"] } } },
    kucoin: { data: { price: "9999" } },
  };
  const fake = async (url: string) => ({ json: async () => answers[Object.keys(answers).find((k) => url.includes(k))!] });
  const r = await xnoUsdRate(fake);
  assert.deepEqual(r?.sources, ["coingecko", "kraken"]);
  assert.equal(r?.usd, 0.37);
  assert.equal(await xnoUsdRate(async () => ({ json: async () => ({}) })), null);
});

test("uniqueAmount: tries tails until the lock takes one", async () => {
  const taken = new Set([String(price + 1n), String(price + 2n)]);
  let t = 1;
  const a = await uniqueAmount(price, async (amt) => !taken.has(amt), { tail: () => t++ });
  assert.equal(a, String(price + 3n));
  assert.equal(await uniqueAmount(price, async () => false, { tries: 3 }), null);
});
