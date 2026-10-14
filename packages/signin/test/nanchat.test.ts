import assert from "node:assert/strict";
import { test } from "node:test";
import { answerNanchat, checkNanchat, NANCHAT_PREFIX, nanchatKey, nanchatNonce, nanchatReply, startNanchat, type NanchatOptions } from "../src/nanchat.js";
import { WalletRefused } from "../src/requests.js";
import { memoryRequests } from "../src/memory.js";
import { account, signHexText, signText } from "./keys.js";

const me = account("nanchat me");
let clock = 1_790_000_000_000;
const setup = (): NanchatOptions => ({ host: "example.com", store: memoryRequests(), now: () => clock });
const start = (o: NanchatOptions, starter = "c".repeat(64)) => startNanchat(o, { starter, answerUrl: "https://example.com/signin/nanchat" });
const parts = (link: string) => {
  const m = /^https:\/\/nanchat\.com\/\?uri=nanauth:\/\/sign\?message=([^&]+)&url=([^&]+)$/.exec(link)!;
  return { message: decodeURIComponent(m[1]!), url: decodeURIComponent(m[2]!) };
};
const answer = (text: string, opts: { priv?: string; account?: string; bare?: boolean } = {}) => ({
  account: opts.account ?? me.address,
  signature: signText(opts.priv ?? me.privateKey, NANCHAT_PREFIX + text),
  message: opts.bare ? text : NANCHAT_PREFIX + text,
});
const refusal = (p: Promise<unknown>) => p.then(() => "accepted", (e) => (e instanceof WalletRefused ? e.message : `other: ${e}`));

test("the link, byte for byte as NanChat's developer page builds it", async () => {
  const s = await start(setup());
  const p = parts(s.link);
  assert.match(p.message, /^Login to example\.com nonce: [0-9a-f]{32}$/);
  assert.equal(p.url, "https://example.com/signin/nanchat");
  const nonce = p.message.slice(-32);
  assert.equal(s.link, `https://nanchat.com/?uri=nanauth://sign?message=Login%20to%20example.com%20nonce%3A%20${nonce}&url=https%3A%2F%2Fexample.com%2Fsignin%2Fnanchat`);
  assert.ok(!s.link.includes(s.id), "the browser's id is not in the link");
});

test("the nonce: with or without the prefix, only our host, only our text", () => {
  const n = "0123456789abcdef0123456789abcdef";
  assert.equal(nanchatNonce("example.com", `Login to example.com nonce: ${n}`), n);
  assert.equal(nanchatNonce("example.com", `${NANCHAT_PREFIX}Login to example.com nonce: ${n}`), n);
  assert.equal(nanchatNonce("example.com", `Login to exampleXcom nonce: ${n}`), null, "the dot is a dot");
  assert.equal(nanchatNonce("example.com", `Login to other.com nonce: ${n}`), null);
  assert.equal(nanchatNonce("example.com", `Login to example.com nonce: ${n} `), null);
  assert.equal(nanchatNonce("example.com", 7), null);
});

test("a good answer signs in once, by the browser's id; the starter's browser only", async () => {
  const o = setup();
  const s = await start(o);
  const text = parts(s.link).message;
  assert.equal(await answerNanchat(o, answer(text)), me.address);
  const c = await checkNanchat(o, s.id, "c".repeat(64));
  assert.equal(c.status, "signedin");
  assert.equal(c.mine, true);
  assert.equal(c.key, nanchatKey(text.slice(-32)));
  assert.equal((await checkNanchat(o, s.id, "d".repeat(64))).mine, false);
  assert.match(await refusal(answerNanchat(o, answer(text))), /already used/);
  const bare = await start(o);
  assert.equal(await answerNanchat(o, answer(parts(bare.link).message, { bare: true })), me.address, "a message without the prefix (NanChat's web page)");
});

test("refusals, each with words for the person", async () => {
  const o = setup();
  const s = await start(o);
  const text = parts(s.link).message;
  assert.match(await refusal(answerNanchat(o, answer(text, { account: "ban_" + me.address.slice(5) }))), /not a Nano address/);
  assert.match(await refusal(answerNanchat(o, { ...answer(text), signature: "xyz" })), /could not be read/);
  assert.match(await refusal(answerNanchat(o, answer(text.replace("example.com", "other.com")))), /not a sign-in to example\.com/);
  assert.match(await refusal(answerNanchat(o, answer(text.replace(/[0-9a-f]{32}$/, "f".repeat(32))))), /not known/);
  assert.match(await refusal(answerNanchat(o, answer(text, { priv: account("someone").privateKey }))), /does not match/);
  assert.match(await refusal(answerNanchat(o, { ...answer(text), signature: signHexText(me.privateKey, NANCHAT_PREFIX + text) })), /does not match/, "a purse's form is not NanChat's");
  clock += 5 * 60_000 + 1;
  assert.match(await refusal(answerNanchat(o, answer(text))), /expired/);
  assert.equal((await checkNanchat(o, s.id)).status, "expired");
});

test("the reply NanChat shows", () => {
  assert.equal(nanchatReply("example.com").ok, true);
  assert.match(nanchatReply("example.com").message!, /^Signed in to example\.com, in the browser that showed this request/);
  assert.deepEqual(nanchatReply("example.com", "no."), { ok: false, error: "NOT signed in: no." });
});
