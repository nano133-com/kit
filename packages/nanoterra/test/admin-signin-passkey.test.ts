// The owner's linked passkeys (createAdminSignin({ passkeys: true }), since 0.12.0), beside the player's sign-in and the admin handler, on the memory store
// and on D1 (SQLite), with passkey purses made in this test: only a wallet session of the owner links a passkey, the passkey proves its key, a linked
// passkey's signature of the ADMIN text makes an admin login, and that login counts only while the link to the CURRENT owner exists. No network, no money.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { signinBody } from "@nano133/signin/purse";
import { ADMIN_PASSKEY_LIMIT, ADMIN_SESSION_MS, adminKey, adminLinkDomain, adminPasskeyDomain, createAdminSignin, createMemoryAdminSignin } from "../src/admin-signin/index.js";
import { Browser, HOST, ORIGIN, OWNER, STRANGER, makeGame, noSqlite, type Kind } from "./admin-signin-helpers.js";

const KINDS: Kind[] = noSqlite ? ["memory"] : ["memory", "d1"];
const BASE = "/api/admin-signin";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** A passkey purse's seed (the passkey's PRF gives one; here random bytes). */
const seed = () => randomBytes(32).toString("hex").toUpperCase();
const addressOf = (s: string) => signinBody("x", s).address;

function game(kind: Kind, extra: Parameters<typeof makeGame>[1] = {}) {
  const g = makeGame(kind, { ...extra, admin: { passkeys: true, ...extra.admin } });
  const link = (b: Browser, s: string, at = g.clock.now) => g.call(b, `${BASE}/passkey/link`, signinBody(adminLinkDomain(HOST), s, at));
  const signIn = (b: Browser, s: string, at = g.clock.now, domain = adminPasskeyDomain(HOST)) => g.call(b, `${BASE}/passkey`, signinBody(domain, s, at));
  /** A browser with an admin session of `address` made some way (`via`), written as the sign-in writes one. */
  const sessionAs = async (address: string, via: string, b = new Browser()) => {
    const token = randomBytes(32).toString("hex");
    await g.adminStore.createSession!({ idHash: await adminKey(token), address, createdAt: g.clock.now, expiresAt: g.clock.now + ADMIN_SESSION_MS, via });
    b.jar.set("admin", token);
    return b;
  };
  return { ...g, link, signIn, sessionAs };
}

for (const kind of KINDS) {
  test(`[${kind}] the owner's wallet session links a passkey; the passkey's ADMIN signature then opens /admin with a session of its own`, async () => {
    const g = game(kind);
    const owner = await g.adminLogin("berry");
    const pk = seed();
    const linked = await g.link(owner, pk);
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.equal(linked.body!.address, addressOf(pk));
    assert.deepEqual(linked.body!.passkeys, [{ address: addressOf(pk), createdAt: g.clock.now }]);
    assert.equal(linked.body!.canChange, true);
    assert.equal(linked.body!.limit, ADMIN_PASSKEY_LIMIT);

    g.clock.now += 60_000;
    const phone = new Browser(ORIGIN, { "CF-IPCountry": "DE", "User-Agent": CHROME_MAC });
    const r = await g.signIn(phone, pk);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { status: "signedin", address: addressOf(pk), linkedTo: OWNER.address });
    assert.match(r.res.headers.get("Set-Cookie")!, /^admin=[0-9a-f]{64}; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax$/);
    assert.deepEqual(await g.admin.session(phone.request("/")), { address: addressOf(pk), createdAt: g.clock.now, via: "passkey", linkedTo: OWNER.address });
    const summary = await g.call(phone, "/api/admin/summary");
    assert.equal(summary.status, 200, "the admin handler lets the linked passkey in");
    assert.equal(summary.body!.address, OWNER.address, "the page names the game's address, not the passkey's");
    assert.deepEqual((await g.admin.recentLogins(1))[0], { at: g.clock.now, country: "DE", browser: "Chrome on macOS" }, "the passkey's login is on the sign-in list");
    // The list, for the passkey's own session: no changes from it.
    const list = await g.call(phone, `${BASE}/passkeys`, {});
    assert.deepEqual(list.body, { passkeys: [{ address: addressOf(pk), createdAt: g.clock.now - 60_000 }], limit: ADMIN_PASSKEY_LIMIT, via: "passkey", canChange: false, you: addressOf(pk) });
    if (g.db) {
      const rows = g.db.prepare("SELECT address, via, scope, expires_at - created_at AS life FROM sessions WHERE via = 'passkey'").all() as { address: string; via: string; scope: string; life: number }[];
      assert.deepEqual(rows.map((x) => [x.address, x.scope, Number(x.life)]), [[addressOf(pk), "admin", ADMIN_SESSION_MS]]);
      assert.deepEqual(g.db.prepare("SELECT owner, address FROM admin_passkeys").all().map((x) => ({ ...(x as object) })), [{ owner: OWNER.address, address: addressOf(pk) }]);
    }
    // Sign-out ends the passkey's login like any admin login.
    await g.call(phone, `${BASE}/signout`, {});
    assert.equal(await g.admin.session(phone.request("/")), null);
  });

  test(`[${kind}] a link needs a live WALLET session of the owner: none, a passkey's session, another wallet's or the player's login are refused`, async () => {
    const g = game(kind);
    const pk = seed();
    const none = await g.link(new Browser(), pk);
    assert.equal(none.status, 401);
    const stranger = await g.link(await g.sessionAs(STRANGER.address, "wallet"), pk);
    assert.deepEqual([stranger.status, stranger.body!.reason], [403, "other_address"]);
    const nanoterra = await g.link(await g.sessionAs(OWNER.address, "nanoterra"), pk);
    assert.deepEqual([nanoterra.status, nanoterra.body!.reason], [403, "nanoterra"]);
    // The player's own login (the owner's address) is not an admin login.
    const player = new Browser();
    const header = await g.player.signIn(new Request(`${ORIGIN}/`), OWNER.address, "wallet");
    player.jar.set("session", /session=([0-9a-f]{64})/.exec(header)![1]);
    assert.equal((await g.link(player, pk)).status, 401);
    // A linked passkey's session cannot add another passkey, nor remove one.
    const owner = await g.adminLogin("nautilus");
    const first = seed();
    assert.equal((await g.link(owner, first)).status, 200);
    const phone = new Browser();
    assert.equal((await g.signIn(phone, first)).status, 200);
    const more = await g.link(phone, pk);
    assert.deepEqual([more.status, more.body!.reason], [403, "wallet_only"]);
    const rm = await g.call(phone, `${BASE}/passkey/unlink`, { address: addressOf(first) });
    assert.deepEqual([rm.status, rm.body!.reason], [403, "wallet_only"]);
    assert.equal((await g.call(new Browser(), `${BASE}/passkey/unlink`, { address: addressOf(first) })).status, 401);
    assert.equal((await g.call(new Browser(), `${BASE}/passkeys`, {})).status, 401);
    assert.deepEqual((await g.call(owner, `${BASE}/passkeys`, {})).body!.passkeys.map((p: { address: string }) => p.address), [addressOf(first)], "nothing else was linked");
    // A link from another site's page is refused, even with the owner's cookie.
    const foreign = new Browser("https://evil.example");
    foreign.jar = new Map(owner.jar);
    const res = await g.route(new Request(`${ORIGIN}${BASE}/passkey/link`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: `admin=${owner.jar.get("admin")}` }, body: JSON.stringify(signinBody(adminLinkDomain(HOST), pk, g.clock.now)) }));
    assert.equal(res.status, 403);
  });

  test(`[${kind}] at most ${ADMIN_PASSKEY_LIMIT} passkeys; the same one twice is 'linked already'; a removal makes room`, async () => {
    const g = game(kind);
    const owner = await g.adminLogin("berry");
    const seeds = Array.from({ length: ADMIN_PASSKEY_LIMIT }, seed);
    for (const s of seeds) assert.equal((await g.link(owner, s)).status, 200);
    const full = await g.link(owner, seed());
    assert.deepEqual([full.status, full.body!.reason, full.body!.error], [409, "full", `You have ${ADMIN_PASSKEY_LIMIT} passkeys. Remove one first.`]);
    g.clock.now += 1;
    const again = await g.link(owner, seeds[3]);
    assert.deepEqual([again.status, again.body!.reason], [409, "exists"]);
    const rm = await g.call(owner, `${BASE}/passkey/unlink`, { address: addressOf(seeds[0]) });
    assert.deepEqual([rm.status, rm.body!.removed, rm.body!.passkeys.length], [200, true, ADMIN_PASSKEY_LIMIT - 1]);
    assert.equal((await g.call(owner, `${BASE}/passkey/unlink`, { address: "nano_x" })).status, 400);
    assert.equal((await g.link(owner, seed())).status, 200);
  });

  test(`[${kind}] the signed texts: each fits one use only; a replayed, an old and another key's signature are refused`, async () => {
    const g = game(kind);
    const owner = await g.adminLogin("berry");
    const pk = seed();
    // A link signed with the SIGN-IN text, or the player's text, links nothing.
    const asSignin = await g.call(owner, `${BASE}/passkey/link`, signinBody(adminPasskeyDomain(HOST), pk, g.clock.now));
    assert.equal(asSignin.status, 401);
    assert.equal((await g.call(owner, `${BASE}/passkey/link`, signinBody(HOST, pk, g.clock.now))).status, 401);
    assert.equal((await g.call(owner, `${BASE}/passkeys`, {})).body!.passkeys.length, 0);
    const body = signinBody(adminLinkDomain(HOST), pk, g.clock.now);
    assert.equal((await g.call(owner, `${BASE}/passkey/link`, body)).status, 200);
    // The link signature again (after a removal, so the link itself would be new): used.
    await g.call(owner, `${BASE}/passkey/unlink`, { address: addressOf(pk) });
    const replay = await g.call(owner, `${BASE}/passkey/link`, body);
    assert.deepEqual([replay.status, replay.body!.error], [409, "That passkey signature was used already. Try again."]);
    g.clock.now += 1;
    assert.equal((await g.link(owner, pk)).status, 200, "a new signature (another time) links it again");

    // Sign-in: the LINK text, the player's text (the host alone) and another host's text open nothing.
    const b = new Browser();
    assert.equal((await g.signIn(b, pk, g.clock.now, adminLinkDomain(HOST))).status, 401, "a link signature is not a sign-in");
    assert.equal((await g.signIn(b, pk, g.clock.now, HOST)).status, 401, "a player's passkey signature never opens /admin");
    assert.equal((await g.signIn(b, pk, g.clock.now, adminPasskeyDomain("evil.example"))).status, 401, "another host's");
    assert.equal(b.jar.has("admin"), false);
    // Old, and from the future.
    const old = await g.signIn(b, pk, g.clock.now - 5 * 60_000 - 1);
    assert.deepEqual([old.status, old.body!.error], [400, "That signature is too old. Check the clock of this device, then try again."]);
    assert.equal((await g.signIn(b, pk, g.clock.now + 5 * 60_000 + 1)).status, 400);
    // Another key's signature under this address.
    const mine = signinBody(adminPasskeyDomain(HOST), pk, g.clock.now);
    const theirs = signinBody(adminPasskeyDomain(HOST), seed(), g.clock.now);
    assert.equal((await g.call(b, `${BASE}/passkey`, { ...mine, signature: theirs.signature })).status, 401);
    assert.equal((await g.call(b, `${BASE}/passkey`, {})).status, 400);
    // Once only.
    assert.equal((await g.call(b, `${BASE}/passkey`, mine)).status, 200);
    const twice = await g.call(new Browser(), `${BASE}/passkey`, mine);
    assert.deepEqual([twice.status, twice.res.headers.get("Set-Cookie")], [409, null]);
  });

  test(`[${kind}] an unlinked passkey makes no login, even with a good signature`, async () => {
    const g = game(kind);
    const b = new Browser();
    const r = await g.signIn(b, seed());
    assert.deepEqual([r.status, r.body!.reason], [403, "not_linked"]);
    assert.equal(r.res.headers.get("Set-Cookie"), null);
    assert.equal(b.jar.has("admin"), false);
    // A passkey linked to ANOTHER owner (an old owner address) is not linked to this one.
    const pk = seed();
    await g.adminStore.linkPasskey!(STRANGER.address, addressOf(pk), g.clock.now);
    assert.equal((await g.signIn(b, pk)).status, 403);
    // With no owner address, no passkey signs in.
    const none = game(kind, { owner: null });
    assert.deepEqual([(await none.signIn(new Browser(), seed())).status, (await none.signIn(new Browser(), seed())).body!.reason], [403, "no_address"]);
  });

  test(`[${kind}] the session is read with the link on every request: a removal or a new owner address ends the passkey's access at the next request`, async () => {
    const g = game(kind);
    const owner = await g.adminLogin("berry");
    const pk = seed();
    await g.link(owner, pk);
    const phone = new Browser();
    assert.equal((await g.signIn(phone, pk)).status, 200);
    assert.equal((await g.call(phone, "/api/admin/summary")).status, 200);
    // The owner moves to another address: the same row, the same cookie, a sign-in made for the new owner.
    const moved = createAdminSignin({ store: g.adminStore, owner: STRANGER.address, now: () => g.clock.now, passkeys: true });
    assert.equal(await moved.session(phone.request("/")), null, "a link to the old owner opens nothing for the new one");
    // Passkeys turned off: no passkey session.
    const off = createAdminSignin({ store: g.adminStore, owner: OWNER.address, now: () => g.clock.now });
    assert.equal(await off.session(phone.request("/")), null);
    assert.equal(await off.handle(phone.request(`${BASE}/passkeys`, {})), null, "no passkey route while they are off");
    // The owner removes the link: the next request is refused, and the session row is gone.
    const rm = await g.call(owner, `${BASE}/passkey/unlink`, { address: addressOf(pk) });
    assert.deepEqual([rm.status, rm.body!.removed, rm.body!.passkeys], [200, true, []]);
    assert.equal(await g.admin.session(phone.request("/")), null);
    assert.equal((await g.call(phone, "/api/admin/summary")).status, 401);
    // Linked again (a new signature): the old session stays ended.
    g.clock.now += 1000;
    assert.equal((await g.link(owner, pk)).status, 200);
    assert.equal(await g.admin.session(phone.request("/")), null, "a removal ended the passkey's sessions for good");
    // The owner's wallet session is untouched by all this.
    assert.equal((await g.admin.session(owner.request("/")))?.via, "wallet");
  });

  test(`[${kind}] the passkey sign-in counts with the starts and asks the person check`, async () => {
    let calls = 0;
    // The wallet start (no token: the test's own start) and the link count too: 3 calls pass, the 4th is too many.
    const g = game(kind, { admin: { personCheck: async (t, req) => t === "ok" || new URL(req.url).pathname.endsWith("/start"), limit: () => ++calls <= 3 } });
    const owner = await g.adminLogin("berry");
    const pk = seed();
    await g.link(owner, pk);
    const no = await g.call(new Browser(), `${BASE}/passkey`, { ...signinBody(adminPasskeyDomain(HOST), pk, g.clock.now), turnstile: "bad" });
    assert.equal(no.status, 403);
    const many = await g.call(new Browser(), `${BASE}/passkey`, { ...signinBody(adminPasskeyDomain(HOST), pk, g.clock.now), turnstile: "ok" });
    assert.equal(many.status, 429);
  });
}

test("passkeys: true needs a store with the passkey methods; the package's stores have them", () => {
  const { linkPasskey: _drop, ...bare } = createMemoryAdminSignin();
  assert.throws(() => createAdminSignin({ store: bare, owner: OWNER.address, passkeys: true }), /linkPasskey/);
  assert.doesNotThrow(() => createAdminSignin({ store: bare, owner: OWNER.address }));
  assert.doesNotThrow(() => createAdminSignin({ store: createMemoryAdminSignin(), owner: OWNER.address, passkeys: true }));
});

test("the two texts a passkey signs name the ADMIN, and neither is the player's text", () => {
  assert.equal(adminPasskeyDomain("game.test"), "ADMIN of game.test");
  assert.equal(adminLinkDomain("game.test"), "Link this passkey to the ADMIN of game.test");
  const s = seed();
  const texts = [HOST, adminPasskeyDomain(HOST), adminLinkDomain(HOST)].map((d) => signinBody(d, s, 1).signature);
  assert.equal(new Set(texts).size, 3);
});
