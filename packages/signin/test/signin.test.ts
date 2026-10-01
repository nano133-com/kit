import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { checkConfig, checkSignin, startSignin, type SigninOptions } from "../src/index.js";
import { checkSignatureSignin, verifyMessage, SigninError } from "../src/signature.js";
import { signinMessage } from "../src/message.js";
import { memoryOnce, memoryStore } from "../src/memoryStore.js";
import { MockLedger } from "./mockLedger.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const account = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0];
const SIGNIN = account("signin test address").address;
const USER = account("signin test user");
const OTHER = account("signin test other").address;

function setup(extra: Partial<SigninOptions> = {}) {
  const led = new MockLedger();
  const store = memoryStore();
  const o: SigninOptions = { rpc: led.rpc, store, config: { address: SIGNIN }, ...extra };
  return { led, store, o };
}

test("config: slots must stay below the next round amount", () => {
  checkConfig({ address: SIGNIN });
  assert.throws(() => checkConfig({ address: SIGNIN, slots: 10_000 }), /round amount/, "133e22 + 10,000 × 1e18 reaches 134e22");
  assert.throws(() => checkConfig({ address: SIGNIN, step: 10n ** 19n, slots: 1000 }), /round amount/, "1,000 × 1e19 reaches the base's next unit (1e22)");
  checkConfig({ address: SIGNIN, base: 10n ** 30n + 10n ** 24n, step: 10n ** 18n, slots: 999_999 });
  assert.throws(() => checkConfig({ address: "nano_bad" }), /address/);
  assert.throws(() => checkConfig({ address: SIGNIN, reuseMarginMs: 2 * 60_000 }), /clock allowance/, "the margin must be longer than the allowance");
  assert.throws(() => checkConfig({ address: SIGNIN, ttlMs: 0 }), /positive/);
  assert.throws(() => checkConfig({ address: SIGNIN, graceMs: -1 }), /positive/);
  assert.throws(() => checkConfig({ address: SIGNIN, earlyMs: 120_000 }), /earlyMs/);
});

test("start: 0.00000133nnnn XNO, reserved until expiry + grace + margin", async () => {
  const { o, store } = setup({ pick: () => 42 });
  const s = await startSignin(o, { starter: "browser-a" });
  assert.equal(s.amount, (133n * 10n ** 22n + 42n * 10n ** 18n).toString());
  assert.equal(store.locks.get(s.amount), s.expiresAt + 2 * 60_000 + 3 * 60_000);
  await assert.rejects(startSignin(o, { starter: "browser-b" }), /busy/, "the amount is held");
});

test("a payment signs in the starter browser only, once", async () => {
  const { o, led } = setup();
  const s = await startSignin(o, { starter: "browser-a" });
  assert.equal((await checkSignin(o, s.id, null, { starter: "browser-a" })).state, "waiting");
  const h = led.pay(USER.address, SIGNIN, BigInt(s.amount), 0, false);
  assert.equal((await checkSignin(o, s.id, null, { starter: "browser-a" })).state, "pending");
  led.blocks.get(h)!.confirmed = true;
  const r = await checkSignin(o, s.id, null, { starter: "browser-a" });
  assert.ok(r.state === "signedin" && r.account === USER.address && r.mine && !r.again);
  const other = await checkSignin(o, s.id, null, { starter: "browser-b" });
  assert.ok(other.state === "signedin" && !other.mine, "another browser learns it, but isn't the starter");
});

test("an older payment of the same amount is skipped", async () => {
  const { o, led } = setup({ pick: () => 7 });
  const amount = 133n * 10n ** 22n + 7n * 10n ** 18n;
  const old = led.pay(USER.address, SIGNIN, amount, 3600);
  const s = await startSignin(o, { starter: "a" });
  assert.equal((await checkSignin(o, s.id, null, { starter: "a" })).state, "waiting");
  assert.equal((await checkSignin(o, s.id, old, { starter: "a" })).state, "waiting");
  led.pay(USER.address, SIGNIN, amount, 0);
  assert.equal((await checkSignin(o, s.id, null, { starter: "a" })).state, "signedin");
});

test("wrong blocks, bad input, the grace, and one payment once", async () => {
  let now = Date.now();
  const { o, led, store } = setup({ now: () => now });
  const s = await startSignin(o, { starter: "a" });
  assert.equal((await checkSignin(o, s.id, "nothex", { starter: "a" })).state, "invalid");
  assert.equal((await checkSignin(o, s.id, led.pay(USER.address, OTHER, BigInt(s.amount), 0), { starter: "a" })).state, "wrong");
  assert.equal((await checkSignin(o, "nope", null, { starter: "a" })).state, "unknown");
  now += 16 * 60_000;
  led.pay(USER.address, SIGNIN, BigInt(s.amount), 0);
  assert.equal((await checkSignin(o, s.id, null, { starter: "a" })).state, "signedin", "inside the 2-minute grace it counts");
  const t = await startSignin(o, { starter: "b" });
  store.sessions.get(t.id)!.amount = s.amount; // forced: the store never gives one amount twice
  const h = store.sessions.get(s.id)!.hash!;
  assert.equal((await checkSignin(o, t.id, h, { starter: "b" })).state, "waiting", "the payment came before this sign-in began");
  led.blocks.get(h)!.at = Math.floor(now / 1000); // pretend it came inside this sign-in's window
  assert.equal((await checkSignin(o, t.id, h, { starter: "b" })).state, "used", "and still: one payment signs in once");
  now += 30 * 60_000;
  assert.equal((await checkSignin(o, t.id, null, { starter: "b" })).state, "expired");
});

test("a payment from before the start never counts, by search or by hash", async () => {
  const { o, led } = setup({ pick: () => 11 });
  const amount = 133n * 10n ** 22n + 11n * 10n ** 18n;
  const early = led.pay(USER.address, SIGNIN, amount, 30); // inside the clock allowance, but before the start
  const waiting = led.pay(USER.address, SIGNIN, amount, 0); // already waiting when the sign-in begins
  const s = await startSignin(o, { starter: "a" });
  assert.deepEqual(new Set(s.before), new Set([early, waiting]));
  assert.equal((await checkSignin(o, s.id, null, { starter: "a" })).state, "waiting");
  assert.equal((await checkSignin(o, s.id, early, { starter: "a" })).state, "waiting");
  assert.equal((await checkSignin(o, s.id, waiting, { starter: "a" })).state, "waiting");
  led.received.add(early); // received since: no longer in "before"'s search, still too early by its time
  assert.equal((await checkSignin(o, s.id, early, { starter: "a" })).state, "waiting");
  led.pay(USER.address, SIGNIN, amount, 0);
  assert.equal((await checkSignin(o, s.id, null, { starter: "a" })).state, "signedin");
});

test("the starter browser gets the session only for deliverMs", async () => {
  let now = Date.now();
  const { o, led } = setup({ now: () => now });
  const s = await startSignin(o, { starter: "a" });
  led.pay(USER.address, SIGNIN, BigInt(s.amount), 0);
  assert.ok((await checkSignin(o, s.id, null, { starter: "a" })).state === "signedin");
  now += 9 * 60_000;
  const r = await checkSignin(o, s.id, null, { starter: "a" });
  assert.ok(r.state === "signedin" && r.mine && r.again);
  now += 2 * 60_000;
  const late = await checkSignin(o, s.id, null, { starter: "a" });
  assert.ok(late.state === "signedin" && !late.mine, "a replay after 10 minutes gets no session");
});

test("the search reads past many waiting payments; a claim records the return", async () => {
  const { led } = setup();
  const counts: string[] = [];
  const rpc: SigninOptions["rpc"] = (b, t) => {
    if (b.action === "receivable") counts.push(String(b.count));
    return led.rpc(b, t);
  };
  const store = memoryStore({ refunds: true });
  const o: SigninOptions = { rpc, store, config: { address: SIGNIN } };
  const s = await startSignin(o, { starter: "a" });
  for (let i = 0; i < 80; i++) led.pay(OTHER, SIGNIN, BigInt(s.amount) + 10n ** 24n, 0);
  const h = led.pay(USER.address, SIGNIN, BigInt(s.amount), 0);
  assert.equal((await checkSignin(o, s.id, null, { starter: "a" })).state, "signedin");
  assert.ok(counts.every((c) => Number(c) >= 1000));
  assert.deepEqual(store.returns.get(h), { hash: h, amount: s.amount, to: USER.address, status: "pending" });
});

test("signature sign-in: the right key, the right site, fresh, once", async () => {
  const at = Date.now();
  const sign = (domain: string, when = at) => nanoWeb.tools.sign(USER.privateKey, Buffer.from(signinMessage(domain, USER.address, when), "utf8").toString("hex"));
  const o = { domain: "example.com", useOnce: memoryOnce() };
  assert.equal(await checkSignatureSignin(o, { address: USER.address, at, signature: sign("example.com") }), USER.address);
  await assert.rejects(checkSignatureSignin(o, { address: USER.address, at, signature: sign("example.com") }), /already used/);
  await assert.rejects(checkSignatureSignin(o, { address: USER.address, at, signature: sign("other.site") }), (e) => e instanceof SigninError && e.status === 401, "another site's signature fails");
  const old = at - 6 * 60_000;
  await assert.rejects(checkSignatureSignin(o, { address: USER.address, at: old, signature: sign("example.com", old) }), /too old/);
  await assert.rejects(checkSignatureSignin(o, { address: OTHER, at, signature: sign("example.com") }), /does not match/, "someone else's address");
  await assert.rejects(checkSignatureSignin({ ...o, domain: " " }, { address: USER.address, at, signature: sign(" ") }), /domain/);
});

test("signature check: no second form of a signature, no small-order keys", () => {
  const msg = signinMessage("example.com", USER.address, 1);
  const sig = nanoWeb.tools.sign(USER.privateKey, Buffer.from(msg, "utf8").toString("hex"));
  assert.equal(verifyMessage(USER.address, msg, sig), true);
  // S + L: the same signature in a second form.
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const s = BigInt(`0x${Buffer.from(sig.slice(64), "hex").reverse().toString("hex")}`) + L;
  const sHex = Buffer.from(s.toString(16).padStart(64, "0"), "hex").reverse().toString("hex");
  assert.equal(verifyMessage(USER.address, msg, sig.slice(0, 64) + sHex), false);
  // The identity point as a public key: R = identity and S = 0 verify any message for it.
  const identity = "01" + "00".repeat(31);
  const weak = nanoWeb.tools.publicKeyToAddress(identity);
  const forged = identity + "00".repeat(32);
  assert.equal(verifyMessage(weak, msg, forged), false);
});
