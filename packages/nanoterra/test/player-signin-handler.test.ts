// The player sign-in's routes, on the memory store, with keys made in this test: the passkey purse's signature (a sample scheme with fixed
// vectors), Berry Wallet, Nautilus and NanChat; the sessions, the sign-out and "Delete my data". No network, no money.
import assert from "node:assert/strict";
import test from "node:test";
import { nanoSigninMessage, nanchatMessage } from "@nano133/signin";
import { signinBody } from "@nano133/signin/purse";
import { checkScheme, createMemoryPlayerSignin, createPlayerSignin, schemeVector, type PasskeyScheme, type PlayerSigninOptions } from "../src/player-signin/index.js";
import { account, sha256, signBytes, signText } from "./player-signin-keys.js";

const ORIGIN = "http://game.test";
const HOST = "game.test";

// A SAMPLE scheme, frozen in this test as a game freezes its own. Its vectors were made one time and must never change.
const SAMPLE: PasskeyScheme = { input: "game.test player v1", salt: "game.test", info: "game.test player seed v1", versionByte: 1 };
const VECTORS = [
  { prf: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", seed: "1D381908B38B64514BA2671287F2113FA851FC7DF7D7911E32FEDED9A997326D", address: "nano_1fjhmh9d93qoktzxk14sn8ohf8pzeiijesnp1u5wfejwxamkpcxoup1etgmp" },
  { prf: "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0", seed: "EEB2BD4630E09DAD390EA361640E2B15D494AC65A864511AAC8ABACCBA7DCE66", address: "nano_1e76a45o3iwkt8qfideayk3byyacsgutkueirhiatj5p8ciay5j4zp33n3xx" },
];

/** A browser: it keeps its cookies and sends the game's Origin. */
class Browser {
  cookies = new Map<string, string>();
  constructor(readonly origin = ORIGIN) {}
  keep(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = decodeURIComponent(pair.slice(i + 1).trim());
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  request(path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json", Origin: this.origin, ...extra };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    return new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
}

let clock = 1_790_000_000_000;
function setup(extra: Partial<PlayerSigninOptions> = {}) {
  const store = createMemoryPlayerSignin();
  const signin = createPlayerSignin({ store, siteAddress: account("the game").address, now: () => clock, ...extra });
  const call = async (b: Browser, path: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await signin.handle(b.request(path, body, headers));
    assert.ok(res, `${path} is a route`);
    b.keep(res);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, res };
  };
  /** A wallet app's call: no cookie, no Origin. */
  const wallet = async (path: string, body?: unknown) => {
    const res = await signin.handle(new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    if (!res) return null;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { store, signin, call, wallet };
}

test("the sample scheme's frozen vectors: one PRF output, one seed, one address, for ever", async () => {
  for (const v of VECTORS) assert.deepEqual(await schemeVector(SAMPLE, v.prf), { seed: v.seed, address: v.address });
  // The same code gives nano133.com's own frozen vector (@nano133/signin's test holds it): the derivation is the package's, unchanged.
  assert.deepEqual(await schemeVector({ input: "nano133.com purse v1", salt: "nano133.com", info: "nano133 purse seed v1", versionByte: 1 }, VECTORS[0].prf), {
    seed: "A3D5687C6751378F395095094E54C4C112D4E93BFFF12469EA2D84B0818B33BF",
    address: "nano_14kjq638aessbe71bp4b958uz8emcqqxctd4sbq1imnp9ckxzmzjgcou4kge",
  });
  // One character more is another account for every player.
  assert.notEqual((await schemeVector({ ...SAMPLE, info: `${SAMPLE.info} ` }, VECTORS[0].prf)).address, VECTORS[0].address);
  for (const bad of [{ ...SAMPLE, input: "" }, { ...SAMPLE, salt: " " }, { ...SAMPLE, versionByte: 0 }, { ...SAMPLE, versionByte: 1.5 }, { ...SAMPLE, info: "x".repeat(201) }]) assert.throws(() => checkScheme(bad));
  await assert.rejects(schemeVector(SAMPLE, "00"), /64 hex/);
});

test("passkey: the purse's signature signs the browser in with a new session, once", async () => {
  const { call, signin, store } = setup();
  const b = new Browser();
  const body = signinBody(HOST, VECTORS[0].seed, clock);
  const r = await call(b, "/api/signin/passkey", body);
  assert.deepEqual(r.body, { status: "signedin", address: VECTORS[0].address });
  const cookie = r.res.headers.get("Set-Cookie")!;
  assert.match(cookie, /^session=[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/, "the starter's cookie, on http");
  assert.equal(await signin.player(b.request("/api/me")), VECTORS[0].address);
  assert.deepEqual(await signin.session(b.request("/api/me")), { address: VECTORS[0].address, createdAt: clock, via: "passkey" });
  // Only the hash of the token is kept.
  const [row] = [...store.sessionRows.values()];
  assert.notEqual(row.idHash, b.cookies.get("session"));
  // The same signature again (a replay): refused, and no second session.
  const again = await call(new Browser(), "/api/signin/passkey", body);
  assert.equal(again.status, 409);
  assert.equal(store.sessionRows.size, 1);
});

test("passkey: a stale signature, one for another host, another key's and a broken address are refused, and sign nobody in", async () => {
  const { call, store } = setup();
  const b = new Browser();
  const stale = await call(b, "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock - 5 * 60_000 - 1));
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /too old/);
  const future = await call(b, "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock + 5 * 60_000 + 1));
  assert.equal(future.status, 400);
  const otherHost = await call(b, "/api/signin/passkey", signinBody("evil.example", VECTORS[0].seed, clock));
  assert.equal(otherHost.status, 401, "a signature made for another site counts nowhere here");
  const mine = signinBody(HOST, VECTORS[0].seed, clock);
  const theirs = signinBody(HOST, VECTORS[1].seed, clock);
  assert.equal((await call(b, "/api/signin/passkey", { ...mine, signature: theirs.signature })).status, 401, "another key's signature under this address");
  assert.equal((await call(b, "/api/signin/passkey", { ...mine, address: mine.address.slice(0, -1) + (mine.address.endsWith("1") ? "3" : "1") })).status, 400, "a wrong checksum");
  assert.equal((await call(b, "/api/signin/passkey", {})).status, 400);
  assert.equal(store.sessionRows.size, 0);
  assert.equal(b.cookies.has("session"), false);
});

test("the browser's calls must come from the game's own page; another host is refused when the domain is set", async () => {
  const { call } = setup();
  const evil = new Browser("http://evil.example");
  assert.equal((await call(evil, "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock))).status, 403);
  assert.equal((await call(evil, "/api/signin/start", { way: "berry" })).status, 403);
  assert.equal((await call(evil, "/api/signin/check", { id: "x" })).status, 403);

  const pinned = setup({ domain: "mygame.com" });
  const res = await pinned.signin.handle(new Browser().request("/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock)));
  assert.equal(res?.status, 403);
  assert.match((await res!.json()).error, /mygame\.com/);
});

test("Berry Wallet: a valid answer signs in the browser that started it, once; another browser is 'elsewhere'", async () => {
  const { call, wallet, store } = setup();
  const b = new Browser();
  const start = await call(b, "/api/signin/start", {});
  assert.equal(start.status, 200);
  assert.equal(start.body.way, "berry");
  assert.equal(start.body.link, `berrypay://signin?request_uri=${encodeURIComponent(`${ORIGIN}/api/signin/nano/${start.body.id}`)}`);
  assert.match(b.cookies.get("starter") ?? "", /^[0-9a-f]{64}$/);
  const read = await wallet(`/api/signin/nano/${start.body.id}`);
  assert.equal(read?.status, 200);
  assert.equal(read?.body.domain, HOST);
  assert.equal((await call(b, "/api/signin/check", { id: start.body.id })).body.status, "waiting");

  const player = account("berry player");
  const message = nanoSigninMessage(read!.body, player.address);
  const forged = await wallet(`/api/signin/nano/${start.body.id}`, { protocol: "nano-signin-v1", requestId: start.body.id, address: player.address, signatureType: "nano-ed25519-blake2b-sha256", message, signature: signBytes(account("forger").privateKey, sha256(message)) });
  assert.equal(forged?.status, 401);
  const answer = await wallet(`/api/signin/nano/${start.body.id}`, { protocol: "nano-signin-v1", requestId: start.body.id, address: player.address, signatureType: "nano-ed25519-blake2b-sha256", message, signature: signBytes(player.privateKey, sha256(message)) });
  assert.deepEqual(answer, { status: 204, body: null });

  assert.equal((await call(new Browser(), "/api/signin/check", { id: start.body.id })).body.status, "elsewhere", "a browser that did not start it");
  const check = await call(b, "/api/signin/check", { id: start.body.id });
  assert.deepEqual(check.body, { status: "signedin", address: player.address });
  assert.match(check.res.headers.get("Set-Cookie")!, /^session=[0-9a-f]{64}; /);
  assert.deepEqual((await call(b, "/api/signin/check", { id: start.body.id })).body, { status: "used" });
  assert.equal(store.sessionRows.size, 1);
  assert.equal([...store.sessionRows.values()][0].via, "wallet");
});

test("Nautilus and NanChat: a valid answer signs in the browser that started it", async () => {
  const { call, wallet } = setup();
  const player = account("nautilus player");
  const b = new Browser();
  const start = await call(b, "/api/signin/start", { way: "nautilus" });
  assert.equal(start.status, 200);
  const label = `${HOST} sign-in ${start.body.code}`;
  const formatted = `${Math.floor(clock / 1000)}:${label}:${account("the game").address}`;
  const bytes = new TextEncoder().encode(formatted);
  const answer = await wallet(`/api/signin/nautilus?id=${start.body.id}`, { account: player.address, signature: signBytes(player.privateKey, bytes), signed: Buffer.from(bytes).toString("hex"), formatted });
  assert.equal(answer?.status, 200);
  assert.equal(answer?.body.status, 0, JSON.stringify(answer?.body));
  assert.deepEqual((await call(b, "/api/signin/check", { id: start.body.id, way: "nautilus" })).body, { status: "signedin", address: player.address });

  const chat = account("nanchat player");
  const c = new Browser();
  const s2 = await call(c, "/api/signin/start", { way: "nanchat" });
  const nonce = /nonce%3A%20([0-9a-f]{32})/.exec(s2.body.link)![1];
  const text = nanchatMessage(HOST, nonce);
  const a2 = await wallet("/api/signin/nanchat", { account: chat.address, signature: signText(chat.privateKey, `Signed Message: ${text}`), message: text });
  assert.equal(a2?.body.ok, true, JSON.stringify(a2?.body));
  assert.deepEqual((await call(c, "/api/signin/check", { id: s2.body.id, way: "nanchat" })).body, { status: "signedin", address: chat.address });
});

test("a way the game does not offer is refused; the passkey route can be off", async () => {
  const { call } = setup({ ways: ["berry"], passkey: false });
  assert.equal((await call(new Browser(), "/api/signin/start", { way: "nautilus" })).status, 400);
  assert.equal((await call(new Browser(), "/api/signin/start", { way: "anything" })).status, 400);
  const { signin } = setup({ passkey: false });
  assert.equal(await signin.handle(new Browser().request("/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock))), null);
});

test("sessions: sign-out ends this one, a session ends after its days, signIn makes the game's own (nanoterra) one, https uses __Host-", async () => {
  const { call, signin } = setup();
  const b = new Browser();
  await call(b, "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock));
  assert.ok(await signin.player(b.request("/api/me")));
  const out = await call(b, "/api/signout", {});
  assert.deepEqual(out.body, { ok: true });
  assert.match(out.res.headers.get("Set-Cookie")!, /^session=; Path=\/; Max-Age=0;/);
  assert.equal(await signin.player(new Browser().request("/api/me")), null);

  const c = new Browser();
  c.keep(new Response(null, { headers: { "Set-Cookie": await signin.signIn(c.request("/api/me"), VECTORS[1].address, "nanoterra") } }));
  assert.deepEqual(await signin.session(c.request("/api/me")), { address: VECTORS[1].address, createdAt: clock, via: "nanoterra" });
  clock += 30 * 86_400_000;
  assert.equal(await signin.player(c.request("/api/me")), null, "30 days later");
  await assert.rejects(signin.signIn(c.request("/api/me"), "nano_not", "wallet"));

  const secure = createPlayerSignin({ store: createMemoryPlayerSignin(), now: () => clock });
  const req = new Request("https://game.test/api/signin/passkey", { method: "POST", headers: { Origin: "https://game.test", "Content-Type": "application/json" }, body: JSON.stringify(signinBody(HOST, VECTORS[0].seed, clock)) });
  const res = await secure.handle(req);
  assert.match(res!.headers.get("Set-Cookie")!, /^__Host-session=[0-9a-f]{64}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/);
  // A cookie with the plain name does not count on https.
  const token = /__Host-session=([0-9a-f]{64})/.exec(res!.headers.get("Set-Cookie")!)![1];
  assert.equal(await secure.player(new Request("https://game.test/api/me", { headers: { Cookie: `session=${token}` } })), null);
  assert.equal(await secure.player(new Request("https://game.test/api/me", { headers: { Cookie: `__Host-session=${token}` } })), VECTORS[0].address);
});

test("forget: 'Delete my data' ends every session of the player and leaves the others", async () => {
  const { call, signin, store } = setup();
  const a = new Browser();
  const b = new Browser();
  await call(a, "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock));
  await call(b, "/api/signin/passkey", signinBody(HOST, VECTORS[1].seed, clock));
  assert.ok((await signin.forget(VECTORS[0].address)) >= 2, "the session and the once-only row");
  assert.equal(await signin.player(a.request("/api/me")), null);
  assert.equal(await signin.player(b.request("/api/me")), VECTORS[1].address);
  assert.ok(![...store.onceRows.values(), ...store.sessionRows.values()].some((r) => r.address === VECTORS[0].address));
});

test("sharedPaths: the admin's calls and the wallets' calls for unknown requests answer null; without it, a refusal", async () => {
  const shared = setup({ sharedPaths: true });
  for (const path of ["/api/signin/start", "/api/signin/check", "/api/signout"]) assert.equal(await shared.signin.handle(new Browser().request(path, { scope: "admin" })), null, path);
  assert.equal(await shared.wallet(`/api/signin/nano/${"a".repeat(32)}`), null);
  assert.equal(await shared.wallet(`/api/signin/nautilus?id=${"A".repeat(24)}`, {}), null);
  // The body of a passed call is still whole for the game.
  const req = new Browser().request("/api/signin/start", { scope: "admin", way: "berry" });
  assert.equal(await shared.signin.handle(req), null);
  assert.deepEqual(await req.json(), { scope: "admin", way: "berry" });

  const alone = setup();
  assert.equal((await alone.call(new Browser(), "/api/signin/start", { scope: "admin" })).status, 400);
  const unknown = await alone.wallet(`/api/signin/nano/${"a".repeat(32)}`);
  assert.deepEqual(unknown, { status: 404, body: { error: true, statusCode: 401, message: "This sign-in expired." } });
  assert.equal(await alone.signin.handle(new Browser().request("/api/other", {})), null, "not a sign-in route");
});

test("the limits: sign-ins per visitor, through the game's limiter; a store fault is a plain 500", async () => {
  const keys: string[] = [];
  const { call } = setup({ limit: (key) => (keys.push(key), key !== "signin|blocked"), visitor: async () => "blocked" });
  assert.equal((await call(new Browser(), "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock))).status, 429);
  assert.equal((await call(new Browser(), "/api/signin/start", {})).status, 429);
  assert.deepEqual(keys, ["signin|blocked", "signin|blocked"]);

  const errors: unknown[] = [];
  const broken = createMemoryPlayerSignin();
  broken.createSession = async () => {
    throw new Error("disk full");
  };
  const s = createPlayerSignin({ store: broken, now: () => clock, onError: (e) => errors.push(e) });
  const res = await s.handle(new Browser().request("/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock)));
  assert.equal(res?.status, 500);
  assert.doesNotMatch(await res!.text(), /disk/);
  assert.equal(errors.length, 1);

  const person = setup({ personCheck: async (token) => token === "ok" });
  assert.equal((await person.call(new Browser(), "/api/signin/passkey", signinBody(HOST, VECTORS[0].seed, clock))).status, 403);
  assert.equal((await person.call(new Browser(), "/api/signin/passkey", { ...signinBody(HOST, VECTORS[0].seed, clock), turnstile: "ok" })).status, 200);
});
