import assert from "node:assert/strict";
import { test } from "node:test";
import { answerNautilus, checkNautilus, nautilusReply, startNautilus, type NautilusOptions } from "../src/nautilus.js";
import { WalletRefused } from "../src/requests.js";
import { memoryRequests } from "../src/memory.js";
import { account, signBytes, signHexText } from "./keys.js";

const SITE = account("nautilus site").address;
const me = account("nautilus me");
let clock = 1_790_000_000_000;
const setup = (): NautilusOptions => ({ site: "example.com", siteAddress: SITE, store: memoryRequests(), now: () => clock });
const start = (o: NautilusOptions, starter = "a".repeat(64)) => startNautilus(o, { starter, answerUrl: (id) => `https://example.com/signin/nautilus?id=${id}` });
const item = (link: string) => JSON.parse(Buffer.from(link.replace(/^nanoauth:/, ""), "base64url").toString("utf8"));
const answer = (label: string, opts: { secs?: number; priv?: string; account?: string; addr?: string; signed?: string } = {}) => {
  const formatted = `${opts.secs ?? Math.floor(clock / 1000)}:${label}:${opts.addr ?? SITE}`;
  const bytes = new Uint8Array(Buffer.from(formatted, "utf8"));
  return { account: opts.account ?? me.address, signature: signBytes(opts.priv ?? me.privateKey, bytes), signed: opts.signed ?? Buffer.from(formatted, "utf8").toString("hex"), formatted, message: "x", label };
};
const refusal = (p: Promise<unknown>) => p.then(() => "accepted", (e) => (e instanceof WalletRefused ? e.message : `other: ${e}`));

test("the link: base64url JSON with the label, the site's address and where to post", async () => {
  const o = setup();
  const s = await start(o);
  assert.match(s.link, /^nanoauth:[A-Za-z0-9_-]+$/);
  assert.match(s.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const it = item(s.link);
  assert.equal(it.label, `example.com sign-in ${s.code}`);
  assert.equal(it.account, SITE);
  assert.deepEqual(it.method, { type: "post", url: `https://example.com/signin/nautilus?id=${s.id}` });
  assert.equal(it.separator, ":");
  assert.equal(it.message, "Sign in to example.com. No payment: your wallet only signs this request.");
});

test("a good answer signs in once; the starter's browser only", async () => {
  const o = setup();
  const s = await start(o);
  assert.deepEqual(await checkNautilus(o, s.id, "a".repeat(64)), { status: "waiting" });
  assert.equal(await answerNautilus(o, s.id, answer(item(s.link).label)), me.address);
  const mine = await checkNautilus(o, s.id, "a".repeat(64));
  assert.equal(mine.status, "signedin");
  assert.equal(mine.account, me.address);
  assert.equal(mine.mine, true);
  assert.equal((await checkNautilus(o, s.id, "b".repeat(64))).mine, false, "another browser");
  assert.match(await refusal(answerNautilus(o, s.id, answer(item(s.link).label))), /already used/);
});

test("refusals, each with words for the person", async () => {
  const o = setup();
  const s = await start(o);
  const label = item(s.link).label;
  assert.match(await refusal(answerNautilus(o, "x".repeat(24), answer(label))), /not known. Start again on example\.com/);
  assert.match(await refusal(answerNautilus(o, s.id, answer("example.com sign-in AAAA-AAAA"))), /not this sign-in's/);
  assert.match(await refusal(answerNautilus(o, s.id, answer(label, { addr: me.address }))), /not this sign-in's/);
  assert.match(await refusal(answerNautilus(o, s.id, answer(label, { secs: Math.floor(clock / 1000) - 301 }))), /time on this phone/);
  assert.match(await refusal(answerNautilus(o, s.id, answer(label, { signed: "00" }))), /not this sign-in's/);
  assert.match(await refusal(answerNautilus(o, s.id, answer(label, { priv: account("someone").privateKey }))), /does not match/);
  const purseForm = { ...answer(label), signature: signHexText(me.privateKey, answer(label).formatted) };
  assert.match(await refusal(answerNautilus(o, s.id, purseForm)), /does not match/, "a purse's form is not Nautilus's");
  assert.match(await refusal(answerNautilus(o, s.id, { ...answer(label), account: "ban_" + me.address.slice(5) })), /not a Nano address/);
  clock += 5 * 60_000 + 1;
  assert.match(await refusal(answerNautilus(o, s.id, answer(label))), /expired/);
  assert.equal((await checkNautilus(o, s.id)).status, "expired");
});

test("the reply Nautilus shows", () => {
  assert.deepEqual(nautilusReply("example.com"), { status: 0, message: "Signed in to example.com. You can go back to the page now.", label: "example.com" });
  assert.deepEqual(nautilusReply("example.com", "No."), { status: 1, message: "No.", label: "example.com" });
});

test("a site address that is not whole is refused at start", async () => {
  await assert.rejects(startNautilus({ ...setup(), siteAddress: SITE.slice(0, -1) + (SITE.endsWith("1") ? "3" : "1") }, { starter: "a", answerUrl: () => "x" }), /siteAddress/);
});
