// A sign-in that opens an ADMIN must say so in what the wallet signs, and a signature for the game's sign-in must never answer an admin request (and the other way round).
// Berry Wallet signs the request's `uri` (the line "URI: ..." of its text); Nautilus signs the request's label. A site that keeps the two kinds of request in one store
// (the game's and the admin's) builds its options by the kind, and these tests pin what the package does with them.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { answerNanoSignin, checkNanoSignin, nanoSigninMessage, readNanoSignin, startNanoSignin, type NanoSigninOptions, type NanoSigninRequest } from "../src/nanosignin.js";
import { answerNautilus, checkNautilus, startNautilus, type NautilusOptions } from "../src/nautilus.js";
import { WalletRefused } from "../src/requests.js";
import { memoryRequests } from "../src/memory.js";
import { account, signBytes } from "./keys.js";

const me = account("admin text me");
const SITE = account("admin text site").address;
let clock = 1_795_000_000_000;
const sha = (text: string) => new Uint8Array(createHash("sha256").update(text, "utf8").digest());
const refusal = (p: Promise<unknown>) => p.then(() => "accepted", (e) => (e instanceof WalletRefused ? e.message : `other: ${e}`));
const url = (id: string) => `https://example.com/signin/nano/${id}`;

// ---- Berry Wallet ----

const store = () => memoryRequests();
const options = (s: ReturnType<typeof store>, uri: string, extra: Partial<NanoSigninOptions> = {}): NanoSigninOptions => ({ domain: "example.com", uri, store: s, now: () => clock, ...extra });
const GAME = "https://example.com/";
const ADMIN = "https://example.com/admin?from=US";
const berryAnswer = (req: NanoSigninRequest, message = nanoSigninMessage(req, me.address)) => ({ protocol: "nano-signin-v1", requestId: req.requestId, address: me.address, signatureType: "nano-ed25519-blake2b-sha256", message, signature: signBytes(me.privateKey, sha(message)) });

test("Berry: the signed text of an admin request names the admin in its URI line, and carries the start time", async () => {
  const s = store();
  const start = await startNanoSignin(options(s, ADMIN), { starter: "a".repeat(64), requestUrl: url, label: "admin:US" });
  const req = (await readNanoSignin(options(s, ADMIN), start.id, url))!;
  const text = nanoSigninMessage(req, me.address);
  assert.match(text, /\nURI: https:\/\/example\.com\/admin\?from=US\n/);
  assert.match(text, new RegExp(`\\nIssued At: ${new Date(clock).toISOString()}\\n`));
  assert.equal((await s.get(start.id))?.label, "admin:US", "the site's own note is kept with the request, so it can read the kind back before it answers the wallet");
});

test("Berry: a signature of the game's text never answers an admin request, and an admin signature never answers a game request", async () => {
  const s = store();
  const a = await startNanoSignin(options(s, ADMIN), { starter: "a".repeat(64), requestUrl: url, label: "admin:US" });
  const g = await startNanoSignin(options(s, GAME), { starter: "b".repeat(64), requestUrl: url });
  // The wallet of a person who was shown the GAME's text for request g signs it; an attacker presents that signature for the ADMIN request a (same nonce rules, other request).
  const gameReq = (await readNanoSignin(options(s, GAME), g.id, url))!;
  const adminReq = (await readNanoSignin(options(s, ADMIN), a.id, url))!;
  // (1) the game's signed text for g, sent to request a: the request id differs, and the text differs.
  assert.equal(await refusal(answerNanoSignin(options(s, ADMIN), a.id, { ...berryAnswer(gameReq), requestId: a.id }, url)), "The signed text is not this sign-in's.");
  // (2) even the SAME request, answered through the other kind's options, is refused: the options decide the text, so a site that picks them by the stored kind cannot be fooled.
  assert.equal(await refusal(answerNanoSignin(options(s, GAME), a.id, berryAnswer(adminReq), url)), "The signed text is not this sign-in's.");
  assert.equal(await refusal(answerNanoSignin(options(s, ADMIN), g.id, berryAnswer(gameReq), url)), "The signed text is not this sign-in's.");
  // (3) each is accepted only through its own kind's options, once.
  assert.equal(await refusal(answerNanoSignin(options(s, ADMIN), a.id, berryAnswer(adminReq), url)), "accepted");
  assert.equal(await refusal(answerNanoSignin(options(s, GAME), g.id, berryAnswer(gameReq), url)), "accepted");
});

test("Berry: a shorter life for an admin request: it lives 2 minutes, and a signature is delivered for one more minute and then no more", async () => {
  const s = store();
  const o = options(s, ADMIN, { ttlMs: 120_000 });
  const start = await startNanoSignin(o, { starter: "a".repeat(64), requestUrl: url, label: "admin:US" });
  assert.equal(start.expiresAt, clock + 120_000);
  const req = (await readNanoSignin(o, start.id, url))!;
  clock += 100_000;
  assert.equal(await refusal(answerNanoSignin(o, start.id, berryAnswer(req), url)), "accepted");
  const late = { store: s, now: () => clock, deliverMs: 60_000 };
  clock += 20_000 + 60_000; // 20 s after it expired, plus 60 s
  assert.equal((await checkNanoSignin(late, start.id, "a".repeat(64))).mine, false, "after the short delivery window a late check signs nobody in");
  assert.equal((await checkNanoSignin({ store: s, now: () => clock }, start.id, "a".repeat(64))).mine, true, "the default window (an hour) is unchanged for a game sign-in");
});

test("Berry: a request answered after it expired is refused", async () => {
  const s = store();
  const o = options(s, ADMIN, { ttlMs: 120_000 });
  const start = await startNanoSignin(o, { starter: "a".repeat(64), requestUrl: url, label: "admin:US" });
  const req = (await readNanoSignin(o, start.id, url))!;
  clock += 121_000;
  assert.match(await refusal(answerNanoSignin(o, start.id, berryAnswer(req), url)), /expired/);
});

// ---- Nautilus ----

const nOptions = (s: ReturnType<typeof store>, extra: Partial<NautilusOptions> = {}): NautilusOptions => ({ site: "example.com", siteAddress: SITE, store: s, now: () => clock, ...extra });
const item = (link: string) => JSON.parse(Buffer.from(link.replace(/^nanoauth:/, ""), "base64url").toString("utf8"));
const nAnswer = (label: string) => {
  const formatted = `${Math.floor(clock / 1000)}:${label}:${SITE}`;
  const bytes = new Uint8Array(Buffer.from(formatted, "utf8"));
  return { account: me.address, signature: signBytes(me.privateKey, bytes), signed: Buffer.from(formatted, "utf8").toString("hex"), formatted, message: "x", label };
};
const answerUrl = (id: string) => `https://example.com/signin/nautilus?id=${id}`;

test("Nautilus: the signed label of an admin request names the admin and the place it started; a game label is as it always was", async () => {
  const s = store();
  const admin = await startNautilus(nOptions(s, { title: "ADMIN of example.com", note: "from US", message: "Sign in to the ADMIN of example.com. Started 19:14 UTC from US. If you did not start this, do not sign." }), { starter: "a".repeat(64), answerUrl });
  const game = await startNautilus(nOptions(s), { starter: "b".repeat(64), answerUrl });
  assert.equal(item(admin.link).label, `ADMIN of example.com sign-in ${admin.code} from US`);
  assert.equal(item(admin.link).message, "Sign in to the ADMIN of example.com. Started 19:14 UTC from US. If you did not start this, do not sign.");
  assert.equal(item(game.link).label, `example.com sign-in ${game.code}`);
  assert.ok(!item(admin.link).label.includes(":"), "no colon in a label: the signed text is <seconds>:<label>:<address>");
  const none = await startNautilus(nOptions(s, { title: "ADMIN of example.com" }), { starter: "c".repeat(64), answerUrl });
  assert.equal(item(none.link).label, `ADMIN of example.com sign-in ${none.code}`, "with no country there is no note");
});

test("Nautilus: a game signature never answers an admin request, and an admin signature never answers a game request", async () => {
  const s = store();
  const a = await startNautilus(nOptions(s, { title: "ADMIN of example.com", note: "from US" }), { starter: "a".repeat(64), answerUrl });
  const g = await startNautilus(nOptions(s), { starter: "b".repeat(64), answerUrl });
  assert.equal(await refusal(answerNautilus(nOptions(s), a.id, nAnswer(item(g.link).label))), "The signed text is not this sign-in's.");
  assert.equal(await refusal(answerNautilus(nOptions(s), g.id, nAnswer(item(a.link).label))), "The signed text is not this sign-in's.");
  // Even with the same code in both labels (a one in 10^11 chance, forced here): the words around it differ.
  const forced = nAnswer(`example.com sign-in ${a.code}`);
  assert.equal(await refusal(answerNautilus(nOptions(s), a.id, forced)), "The signed text is not this sign-in's.");
  assert.equal(await refusal(answerNautilus(nOptions(s), a.id, nAnswer(item(a.link).label))), "accepted");
  assert.equal(await refusal(answerNautilus(nOptions(s), g.id, nAnswer(item(g.link).label))), "accepted");
});

test("Nautilus: an admin request takes the shorter life and the shorter delivery", async () => {
  const s = store();
  const o = nOptions(s, { title: "ADMIN of example.com", ttlMs: 120_000 });
  const a = await startNautilus(o, { starter: "a".repeat(64), answerUrl });
  assert.equal(a.expiresAt, clock + 120_000);
  assert.equal(await refusal(answerNautilus(o, a.id, nAnswer(item(a.link).label))), "accepted");
  clock += 120_000 + 61_000;
  assert.equal((await checkNautilus({ store: s, now: () => clock, deliverMs: 60_000 }, a.id, "a".repeat(64))).mine, false);
  assert.equal((await checkNautilus({ store: s, now: () => clock }, a.id, "a".repeat(64))).mine, true);
});

test("a bad deliverMs (a negative number, NaN, Infinity, not a number) is read as 0: nothing is delivered after the request ends, never the longest window; no deliverMs is the default hour", async () => {
  const s = store();
  const o = options(s, GAME);
  const start = await startNanoSignin(o, { starter: "a".repeat(64), requestUrl: url });
  const req = (await readNanoSignin(o, start.id, url))!;
  await answerNanoSignin(o, start.id, berryAnswer(req), url);
  // In time, every value still delivers: the window only matters after the request ends.
  for (const bad of [Number.NaN, -1, -5, Infinity, "3600000" as unknown as number, null as unknown as number]) {
    assert.equal((await checkNanoSignin({ store: s, now: () => clock, deliverMs: bad }, start.id, "a".repeat(64))).mine, true, `${String(bad)} in time`);
  }
  // After it ends (30 minutes later): the default delivers, a bad value does not.
  clock += 5 * 60_000 + 30 * 60_000;
  assert.equal((await checkNanoSignin({ store: s, now: () => clock }, start.id, "a".repeat(64))).mine, true, "no deliverMs: the default hour");
  assert.equal((await checkNanoSignin({ store: s, now: () => clock, deliverMs: undefined }, start.id, "a".repeat(64))).mine, true, "undefined is no deliverMs");
  for (const bad of [Number.NaN, -1, -5, Infinity, "3600000" as unknown as number, null as unknown as number]) {
    assert.equal((await checkNanoSignin({ store: s, now: () => clock, deliverMs: bad }, start.id, "a".repeat(64))).mine, false, `${String(bad)} 30 minutes after`);
  }
  assert.equal((await checkNanoSignin({ store: s, now: () => clock, deliverMs: 0 }, start.id, "a".repeat(64))).mine, false, "0 is no delivery after the request ends");
});

test("deliverMs can only shorten the window: a value above an hour (1e15, 2**53) is held to the hour", async () => {
  const s = store();
  const o = options(s, GAME);
  const start = await startNanoSignin(o, { starter: "a".repeat(64), requestUrl: url });
  const req = (await readNanoSignin(o, start.id, url))!;
  await answerNanoSignin(o, start.id, berryAnswer(req), url);
  clock += 5 * 60_000 + 61 * 60_000; // 61 minutes after the request ended
  for (const big of [1e15, 2 ** 53, 10 * 60 * 60_000]) {
    assert.equal((await checkNanoSignin({ store: s, now: () => clock, deliverMs: big }, start.id, "a".repeat(64))).mine, false, `${big} is held to an hour`);
  }
  assert.equal((await checkNanoSignin({ store: s, now: () => clock }, start.id, "a".repeat(64))).mine, false, "the default is the hour");
});
