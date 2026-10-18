import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  answerNanoSignin,
  checkNanoSignin,
  nanoSigninMessage,
  nanoSigninRefusal,
  nanoSigninReply,
  readNanoSignin,
  startNanoSignin,
  NANO_SIGNIN_MAX_MS,
  type NanoSigninOptions,
  type NanoSigninRequest,
} from "../src/nanosignin.js";
import { WalletRefused } from "../src/requests.js";
import { memoryRequests } from "../src/memory.js";
import { account, signBytes, signHexText } from "./keys.js";

const me = account("nanosignin me");
let clock = 1_792_000_000_000;
const url = (id: string) => `https://example.com/signin/nano/${id}`;
const setup = (extra: Partial<NanoSigninOptions> = {}): NanoSigninOptions => ({ domain: "example.com", uri: "https://example.com/", store: memoryRequests(), now: () => clock, ...extra });
const start = (o: NanoSigninOptions, starter = "a".repeat(64)) => startNanoSignin(o, { starter, requestUrl: url });
const sha = (text: string) => new Uint8Array(createHash("sha256").update(text, "utf8").digest());
/** The wallet's POST: the request's message, signed as the wallet signs it (Ed25519-BLAKE2b over its SHA-256). */
const answer = (req: NanoSigninRequest, opts: { priv?: string; address?: string; message?: string } = {}) => {
  const address = opts.address ?? me.address;
  const message = opts.message ?? nanoSigninMessage(req, address);
  return { protocol: "nano-signin-v1", requestId: req.requestId, address, signatureType: "nano-ed25519-blake2b-sha256", message, signature: signBytes(opts.priv ?? me.privateKey, sha(message)) };
};
const refusal = (p: Promise<unknown>) => p.then(() => "accepted", (e) => (e instanceof WalletRefused ? e.message : `other: ${e}`));

test("the links: Berry Wallet's and any wallet's, with the request's address", async () => {
  const o = setup();
  const s = await start(o);
  assert.match(s.id, /^[0-9a-f]{32}$/);
  assert.equal(s.link, `berrypay://signin?request_uri=${encodeURIComponent(url(s.id))}`);
  assert.equal(s.walletLink, `nano://signin?request_uri=${encodeURIComponent(url(s.id))}`);
  assert.equal(s.expiresAt, clock + 5 * 60_000);
});

test("the request a wallet reads: these keys in this order, and a lifetime of 5 minutes at most", async () => {
  const o = setup({ ttlMs: 10 * 60_000 });
  const s = await start(o);
  const r = await readNanoSignin(o, s.id, url);
  assert.ok(r);
  assert.deepEqual(Object.keys(r), ["uri", "nonce", "domain", "network", "issuedAt", "protocol", "requestId", "requestUri", "expirationTime"]);
  assert.equal(r.uri, "https://example.com/");
  assert.equal(r.domain, "example.com");
  assert.equal(r.network, "nano:mainnet");
  assert.equal(r.protocol, "nano-signin-v1");
  assert.equal(r.requestId, s.id);
  assert.equal(r.requestUri, url(s.id));
  assert.match(r.nonce, /^[0-9a-f]{64}$/);
  assert.equal(Date.parse(r.expirationTime) - Date.parse(r.issuedAt), NANO_SIGNIN_MAX_MS, "a 10-minute ttl is held to 5");
  assert.equal(r.issuedAt, new Date(clock).toISOString());
});

test("the signed text, in the exact form Berry Wallet signed it on a live site", () => {
  // The fields of a request Berry Wallet signed on 2026-10-17 (its domain a test address); only the account differs.
  const req: NanoSigninRequest = {
    uri: "https://ab884199b728.ngrok.app/",
    nonce: "9f20a5d1989c358e939683ab57e9938e9c7e771a4e9326155c0d218e92f81ad4",
    domain: "ab884199b728.ngrok.app",
    network: "nano:mainnet",
    issuedAt: "2026-10-18T00:09:34.963Z",
    protocol: "nano-signin-v1",
    requestId: "2709ca4d0aa22ad2d2ab14164c5f57fe",
    requestUri: "https://ab884199b728.ngrok.app/r/2709ca4d0aa22ad2d2ab14164c5f57fe",
    expirationTime: "2026-10-18T00:14:34.963Z",
  };
  assert.equal(
    nanoSigninMessage(req, me.address),
    "ab884199b728.ngrok.app wants you to sign in with your Nano account:\n" +
      `${me.address}\n\nSign in to this website. This does not authorize any transactions.\n\n` +
      "URI: https://ab884199b728.ngrok.app/\nVersion: 1\nNetwork: nano:mainnet\n" +
      "Nonce: 9f20a5d1989c358e939683ab57e9938e9c7e771a4e9326155c0d218e92f81ad4\n" +
      "Issued At: 2026-10-18T00:09:34.963Z\nExpiration Time: 2026-10-18T00:14:34.963Z\n" +
      "Request ID: 2709ca4d0aa22ad2d2ab14164c5f57fe\n" +
      "Request URI: https://ab884199b728.ngrok.app/r/2709ca4d0aa22ad2d2ab14164c5f57fe\n",
  );
});

test("a good answer signs in once; the starter's browser only", async () => {
  const o = setup();
  const s = await start(o);
  const req = (await readNanoSignin(o, s.id, url))!;
  assert.deepEqual(await checkNanoSignin(o, s.id, "a".repeat(64)), { status: "waiting" });
  assert.equal(await answerNanoSignin(o, s.id, answer(req), url), me.address);
  const mine = await checkNanoSignin(o, s.id, "a".repeat(64));
  assert.equal(mine.status, "signedin");
  assert.equal(mine.account, me.address);
  assert.equal(mine.mine, true);
  assert.equal((await checkNanoSignin(o, s.id, "b".repeat(64))).mine, false, "another browser");
  // The wallet may send its answer again: the same account's valid answer is accepted again and changes nothing.
  assert.equal(await answerNanoSignin(o, s.id, answer(req), url), me.address, "the same answer again is accepted");
  assert.equal((await checkNanoSignin(o, s.id, "a".repeat(64))).account, me.address, "and the request still names the same account");
  const other = account("nanosignin other");
  assert.match(await refusal(answerNanoSignin(o, s.id, answer(req, { priv: other.privateKey, address: other.address }), url)), /already used/, "another account's answer after it");
  const forged = { ...answer(req), signature: answer(req, { priv: other.privateKey }).signature };
  assert.match(await refusal(answerNanoSignin(o, s.id, forged, url)), /does not match/, "a repeat with a wrong signature");
  assert.equal(await readNanoSignin(o, s.id, url), null, "a used request is not served again");
  assert.deepEqual(nanoSigninReply(s.id, me.address), { ok: true, success: true, accepted: true, approved: true, state: "approved", status: "approved", requestId: s.id, address: me.address, protocol: "nano-signin-v1" });
  assert.deepEqual(nanoSigninRefusal("x"), { error: true, statusCode: 401, message: "x" });
});

test("refusals, each with words for the person", async () => {
  const o = setup();
  const s = await start(o);
  const req = (await readNanoSignin(o, s.id, url))!;
  const good = answer(req);
  assert.match(await refusal(answerNanoSignin(o, "0".repeat(32), { ...good, requestId: "0".repeat(32) }, url)), /not known/);
  assert.match(await refusal(answerNanoSignin(o, s.id, { ...good, protocol: "nano-signin-v2" }, url)), /not for this sign-in/);
  assert.match(await refusal(answerNanoSignin(o, s.id, { ...good, requestId: "1".repeat(32) }, url)), /not for this sign-in/);
  assert.match(await refusal(answerNanoSignin(o, s.id, { ...good, signatureType: "nano-ed25519-blake2b" }, url)), /does not read/);
  assert.match(await refusal(answerNanoSignin(o, s.id, { ...good, address: "ban_" + me.address.slice(5) }, url)), /not a Nano address/);
  const other = { ...req, nonce: "0".repeat(64) };
  assert.match(await refusal(answerNanoSignin(o, s.id, answer(other), url)), /not this sign-in's/, "another request's nonce");
  assert.match(await refusal(answerNanoSignin(o, s.id, answer({ ...req, domain: "evil.example" }), url)), /not this sign-in's/, "another domain");
  assert.match(await refusal(answerNanoSignin(o, s.id, answer(req, { priv: account("someone").privateKey }), url)), /does not match/);
  const overText = { ...good, signature: signBytes(me.privateKey, new Uint8Array(Buffer.from(good.message, "utf8"))) };
  assert.match(await refusal(answerNanoSignin(o, s.id, overText, url)), /does not match/, "a signature over the text, not its SHA-256");
  assert.match(await refusal(answerNanoSignin(o, s.id, { ...good, signature: signHexText(me.privateKey, good.message) }, url)), /does not match/, "a purse's form");
  clock += 5 * 60_000 + 1;
  assert.match(await refusal(answerNanoSignin(o, s.id, good, url)), /expired/);
  assert.equal(await readNanoSignin(o, s.id, url), null, "an expired request is not served");
  assert.deepEqual(await checkNanoSignin(o, s.id, "a".repeat(64)), { status: "expired" });
  clock -= 5 * 60_000 + 1;
});

// The real wallet's answer, kept out of this repository (it names a person's account). NANO_SIGNIN_VECTOR: a file of
// JSON lines, one of them { method: "POST", body: "<the JSON Berry Wallet sent>" } for the request above.
const vector = process.env.NANO_SIGNIN_VECTOR;
test("Berry Wallet's own answer to that request signs in", { skip: vector ? false : "set NANO_SIGNIN_VECTOR to a captured answer" }, async () => {
  const { readFileSync } = await import("node:fs");
  const post = readFileSync(vector!, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.method === "POST" && e.body);
  const body = JSON.parse(post.body);
  const host = "ab884199b728.ngrok.app";
  const id = "2709ca4d0aa22ad2d2ab14164c5f57fe";
  const issuedAt = Date.parse("2026-10-18T00:09:34.963Z");
  const store = memoryRequests();
  const at = issuedAt + 10_000;
  const o: NanoSigninOptions = { domain: host, uri: `https://${host}/`, store, now: () => at };
  await store.create(id, { id, starter: "a".repeat(64), status: "waiting", expiresAt: issuedAt + NANO_SIGNIN_MAX_MS, nonce: "9f20a5d1989c358e939683ab57e9938e9c7e771a4e9326155c0d218e92f81ad4", issuedAt });
  const there = (i: string) => `https://${host}/r/${i}`;
  assert.equal(body.signatureType, "nano-ed25519-blake2b-sha256");
  assert.equal(await answerNanoSignin(o, id, body, there), body.address);
  assert.equal((await checkNanoSignin(o, id, "a".repeat(64))).mine, true);
});
