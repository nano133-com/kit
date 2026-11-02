// The admin's sign-in routes (createAdminSignin), beside the player's sign-in and the admin handler, on the memory store and on D1 (SQLite), with keys
// made in this test: the fixed route, the answers, what each wallet signs, the times, once, the owner only, NanChat off and on, the two scopes kept
// apart, the cookies, sign-out, "Sign out everywhere" and the sign-in list. No network, no money.
import assert from "node:assert/strict";
import test from "node:test";
import { nanoSigninMessage } from "@nano133/signin";
import { ADMIN_SIGNIN_BASE, NANCHAT_REFUSAL, adminKey, createAdminSignin, createMemoryAdminSignin, shortBrowser } from "../src/admin-signin/index.js";
import { sha256Hex } from "../src/player-signin/index.js";
import { Browser, HOST, ORIGIN, OWNER, STRANGER, makeGame, nanoauthItem, noSqlite, type Kind } from "./admin-signin-helpers.js";

const KINDS: Kind[] = noSqlite ? ["memory"] : ["memory", "d1"];
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const START = "/api/admin-signin/start";
const CHECK = "/api/admin-signin/check";

for (const kind of KINDS) {
  test(`[${kind}] Berry Wallet: the fixed route, the starter cookie, the admin's page in the signed text, one login for the browser that started it, once`, async () => {
    const g = makeGame(kind);
    assert.equal(g.admin.base, ADMIN_SIGNIN_BASE);
    assert.equal(ADMIN_SIGNIN_BASE, "/api/admin-signin");
    const b = new Browser();
    const s = await g.call(b, START, { way: "berry" });
    assert.equal(s.status, 200);
    assert.deepEqual(Object.keys(s.body!).sort(), ["expiresAt", "id", "link", "walletLink", "way"]);
    assert.equal(s.body!.link, `berrypay://signin?request_uri=${encodeURIComponent(`${ORIGIN}/api/admin-signin/nano/${s.body!.id}`)}`);
    assert.match(s.res.headers.get("Set-Cookie")!, /^starter-admin=[0-9a-f]{64}; Path=\/; Max-Age=1800; HttpOnly; SameSite=Lax$/);
    assert.equal(s.body!.expiresAt - g.clock.now, 120_000, "an admin request lives 2 minutes");
    // What Berry Wallet reads and signs: the ADMIN page, with no query.
    const read = await g.wallet(`${ORIGIN}/api/admin-signin/nano/${s.body!.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.uri, `${ORIGIN}/admin`);
    assert.equal(read.body.domain, HOST);
    const text = nanoSigninMessage(read.body, OWNER.address);
    assert.ok(text.includes(`URI: ${ORIGIN}/admin\n`) && !text.includes("?"));
    assert.deepEqual((await g.call(b, CHECK, { id: s.body!.id, way: "berry" })).body, { status: "waiting" });
    assert.ok(g.accepted("berry", await g.answer("berry", s.body!)));
    assert.deepEqual((await g.call(new Browser(), CHECK, { id: s.body!.id, way: "berry" })).body, { status: "elsewhere" }, "a browser that did not start it");
    const done = await g.call(b, CHECK, { id: s.body!.id, way: "berry" });
    assert.deepEqual(done.body, { status: "signedin", address: OWNER.address });
    assert.match(done.res.headers.get("Set-Cookie")!, /^admin=[0-9a-f]{64}; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax$/);
    assert.deepEqual((await g.call(b, CHECK, { id: s.body!.id, way: "berry" })).body, { status: "used" });
    const copy = new Browser();
    copy.jar.set("starter-admin", b.jar.get("starter-admin")!);
    assert.deepEqual((await g.call(copy, CHECK, { id: s.body!.id, way: "berry" })).body, { status: "used" }, "a copied starter gets no second login");
    assert.deepEqual(await g.admin.session(b.request("/")), { address: OWNER.address, createdAt: g.clock.now, via: "wallet" });
    assert.equal((await g.call(b, "/api/admin/summary")).status, 200, "the admin handler lets the owner in with this session");
    // The database keeps the hash of "admin:" and the token, never the token or its plain hash.
    if (g.db) {
      const rows = g.db.prepare("SELECT id_hash, scope, via, expires_at - created_at AS life FROM sessions").all() as { id_hash: string; scope: string; via: string; life: number }[];
      assert.deepEqual(rows.map((r) => [r.scope, r.via, Number(r.life)]), [["admin", "wallet", 86_400_000]]);
      assert.equal(rows[0].id_hash, await adminKey(b.jar.get("admin")!));
      assert.notEqual(rows[0].id_hash, await sha256Hex(b.jar.get("admin")!));
    }
  });

  test(`[${kind}] Nautilus: the signed label says ADMIN and the country, the line says when and from where; it names the owner's address`, async () => {
    const g = makeGame(kind);
    const us = new Browser(ORIGIN, { "CF-IPCountry": "US", "User-Agent": CHROME_MAC });
    const s = await g.call(us, START, { way: "nautilus" });
    assert.equal(s.status, 200);
    assert.deepEqual(Object.keys(s.body!).sort(), ["code", "expiresAt", "id", "link", "way"]);
    const item = nanoauthItem(s.body!.link);
    assert.match(item.label, /^ADMIN of game\.test sign-in [A-Z2-9]{4}-[A-Z2-9]{4} from US$/);
    assert.equal(item.label, `ADMIN of game.test sign-in ${s.body!.code} from US`);
    assert.match(item.message, /^Sign in to the ADMIN of game\.test\. Started \d\d:\d\d UTC from US\. If you did not start this, do not sign\.$/);
    assert.equal(item.account, OWNER.address);
    assert.equal(item.method.url, `${ORIGIN}/api/admin-signin/nautilus?id=${s.body!.id}`);
    assert.equal(s.body!.expiresAt - g.clock.now, 120_000);
    const none = nanoauthItem((await g.call(new Browser(), START, { way: "nautilus" })).body!.link);
    assert.match(none.label, /^ADMIN of game\.test sign-in [A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(none.message.includes("from an unknown country"));
    // A signature of the player's label for this request is refused; the admin's own is accepted.
    const wrong = await g.answer("nautilus", s.body!, OWNER, (body) => {
      const formatted = body.formatted.replace("ADMIN of game.test", "game.test").replace(" from US", "");
      return { ...body, formatted, signed: undefined };
    });
    assert.equal(wrong.body.status, 1);
    assert.ok(g.accepted("nautilus", await g.answer("nautilus", s.body!)));
    assert.deepEqual((await g.call(us, CHECK, { id: s.body!.id, way: "nautilus" })).body, { status: "signedin", address: OWNER.address });
  });

  test(`[${kind}] the times: a request takes a signature for 2 minutes, is delivered one more minute, and no longer`, async () => {
    for (const way of ["berry", "nautilus"]) {
      const g = makeGame(kind);
      const t0 = g.clock.now;
      const late = new Browser();
      const a = await g.call(late, START, { way });
      g.clock.now = t0 + 121_000;
      assert.ok(!g.accepted(way, await g.answer(way, a.body!)), `${way}: a signature after 2 minutes is refused`);
      g.clock.now = t0;
      const b1 = new Browser();
      const r1 = await g.call(b1, START, { way });
      const b2 = new Browser();
      const r2 = await g.call(b2, START, { way });
      g.clock.now = t0 + 100_000;
      assert.ok(g.accepted(way, await g.answer(way, r1.body!)));
      assert.ok(g.accepted(way, await g.answer(way, r2.body!)));
      g.clock.now = t0 + 120_000 + 30_000;
      assert.deepEqual((await g.call(b1, CHECK, { id: r1.body!.id, way })).body, { status: "signedin", address: OWNER.address }, `${way}: in the minute of delivery`);
      g.clock.now = t0 + 120_000 + 61_000;
      assert.deepEqual((await g.call(b2, CHECK, { id: r2.body!.id, way })).body, { status: "elsewhere" }, `${way}: after the minute of delivery`);
      assert.equal(b2.jar.has("admin"), false);
    }
  });

  test(`[${kind}] only the owner's wallet makes an admin login: another wallet gets "not_owner", no session, the request stays unused; with no owner, nobody`, async () => {
    const g = makeGame(kind);
    const owner = await g.adminLogin("berry");
    const token = owner.jar.get("admin");
    const s = await g.call(owner, START, { way: "nautilus" });
    assert.ok(g.accepted("nautilus", await g.answer("nautilus", s.body!, STRANGER)));
    const refused = await g.call(owner, CHECK, { id: s.body!.id, way: "nautilus" });
    assert.deepEqual(refused.body, { status: "not_owner", address: STRANGER.address });
    assert.deepEqual(refused.res.headers.getSetCookie(), []);
    assert.equal(owner.jar.get("admin"), token, "the owner's own login stays");
    assert.equal((await g.call(owner, "/api/admin/summary")).status, 200);
    if (g.db) assert.equal(Number((g.db.prepare("SELECT COUNT(*) AS n FROM signin_requests WHERE account = ? AND delivered = 0").get(STRANGER.address) as { n: number }).n), 1, "the request stays unused");
    const none = makeGame(kind, { owner: null });
    const b = new Browser();
    const r = await none.call(b, START, { way: "berry" });
    assert.ok(none.accepted("berry", await none.answer("berry", r.body!)));
    assert.deepEqual((await none.call(b, CHECK, { id: r.body!.id, way: "berry" })).body, { status: "not_owner", address: OWNER.address });
    assert.equal(b.jar.has("admin"), false);
    // With no owner, Nautilus names the example address (nobody's key).
    assert.equal(nanoauthItem((await none.call(new Browser(), START, { way: "nautilus" })).body!.link).account, "nano_1111111111111111111111111111111111111111111111111111hifc8npp");
  });

  test(`[${kind}] NanChat is OFF by default: a start is refused with the starter's words, its answer route is not a route, a check finds nothing`, async () => {
    const g = makeGame(kind);
    const s = await g.call(new Browser(), START, { way: "nanchat" });
    assert.equal(s.status, 400);
    assert.equal(s.body!.error, NANCHAT_REFUSAL);
    assert.equal(NANCHAT_REFUSAL, "NanChat cannot open the admin yet. Use Berry Wallet or Nautilus.");
    assert.equal(await g.admin.handle(new Request(`${ORIGIN}/api/admin-signin/nanchat`, { method: "POST", body: "{}" })), null);
    assert.deepEqual((await g.call(new Browser(), CHECK, { id: "AbCdEfGhIjKlMnOpQrStUvWx", way: "nanchat" })).body, { status: "expired" });
    // The player's NanChat is not the admin's: a player's NanChat request asked at the admin's check gives nothing.
    const p = new Browser();
    const ps = await g.call(p, "/api/signin/start", { way: "nanchat" });
    assert.ok(g.accepted("nanchat", await g.answer("nanchat", ps.body!)));
    p.jar.set("starter-admin", p.jar.get("starter")!);
    assert.deepEqual((await g.call(p, CHECK, { id: ps.body!.id, way: "nanchat" })).body, { status: "expired" });
    assert.equal(p.jar.has("admin"), false);
  });

  test(`[${kind}] NanChat ON (nanchat: true): "Login to <host>" (it cannot name the admin), the owner only, once, its own browser`, async () => {
    const g = makeGame(kind, { admin: { nanchat: true } });
    const b = new Browser();
    const s = await g.call(b, START, { way: "nanchat" });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.deepEqual(Object.keys(s.body!).sort(), ["expiresAt", "id", "link", "way"]);
    const message = decodeURIComponent(/message=([^&]+)&/.exec(s.body!.link)![1]);
    assert.match(message, /^Login to game\.test nonce: [0-9a-f]{32}$/);
    assert.ok(s.body!.link.endsWith(`&url=${encodeURIComponent(`${ORIGIN}/api/admin-signin/nanchat`)}`));
    assert.equal(s.body!.expiresAt - g.clock.now, 120_000);
    // A stranger's signature: accepted by NanChat's route, but no admin login.
    const other = new Browser();
    const so = await g.call(other, START, { way: "nanchat" });
    assert.ok(g.accepted("nanchat", await g.answer("nanchat", so.body!, STRANGER)));
    assert.deepEqual((await g.call(other, CHECK, { id: so.body!.id, way: "nanchat" })).body, { status: "not_owner", address: STRANGER.address });
    const bad = await g.answer("nanchat", s.body!, OWNER, (body) => ({ ...body, signature: "0".repeat(128) }));
    assert.equal(bad.body.ok, false);
    assert.match(bad.body.error, /^NOT signed in/);
    assert.ok(g.accepted("nanchat", await g.answer("nanchat", s.body!)));
    assert.deepEqual((await g.call(new Browser(), CHECK, { id: s.body!.id, way: "nanchat" })).body, { status: "elsewhere" });
    assert.deepEqual((await g.call(b, CHECK, { id: s.body!.id, way: "nanchat" })).body, { status: "signedin", address: OWNER.address });
    assert.deepEqual((await g.call(b, CHECK, { id: s.body!.id, way: "nanchat" })).body, { status: "used" });
    assert.equal((await g.call(b, "/api/admin/summary")).status, 200);
    // Turned on, it is still not a player's sign-in: the admin's NanChat request is unknown to the player's check, with the cookie retyped too.
    const c = new Browser();
    const sc = await g.call(c, START, { way: "nanchat" });
    assert.ok(g.accepted("nanchat", await g.answer("nanchat", sc.body!)));
    c.jar.set("starter", `admin:${c.jar.get("starter-admin")}`);
    assert.deepEqual((await g.call(c, "/api/signin/check", { id: sc.body!.id, way: "nanchat" })).body, { status: "expired" });
    assert.equal(c.jar.has("session"), false);
  });

  test(`[${kind}] the scopes stay apart: a player's login, its token in the admin cookie, and a player's starter copied to the admin's name open nothing`, async () => {
    const g = makeGame(kind);
    // The owner signs in as a PLAYER with the same wallet: that login is the game's, not the admin's.
    const p = new Browser();
    const ps = await g.call(p, "/api/signin/start", { way: "berry" });
    assert.ok(g.accepted("berry", await g.answer("berry", ps.body!)));
    // Asked at the admin's check, with the player's starter copied to the admin's name: the admin holds no such request.
    p.jar.set("starter-admin", p.jar.get("starter")!);
    assert.deepEqual((await g.call(p, CHECK, { id: ps.body!.id, way: "berry" })).body, { status: "expired" });
    assert.equal(p.jar.has("admin"), false);
    assert.deepEqual((await g.call(p, "/api/signin/check", { id: ps.body!.id, way: "berry" })).body, { status: "signedin", address: OWNER.address });
    assert.equal((await g.call(p, "/api/admin/summary")).status, 401, "the owner's own player login does not open /admin");
    // The player's token in the admin cookie.
    p.jar.set("admin", p.jar.get("session")!);
    assert.equal(await g.admin.session(p.request("/")), null);
    assert.equal((await g.call(p, "/api/admin/summary")).status, 401);
    // The other way: an admin request, its starter retyped for the player's hashing ("admin:" + value) and copied: no player login.
    const a = new Browser();
    const as = await g.call(a, START, { way: "berry" });
    assert.ok(g.accepted("berry", await g.answer("berry", as.body!)));
    for (const forged of [`admin:${a.jar.get("starter-admin")}`, a.jar.get("starter-admin")!]) {
      const f = new Browser();
      f.jar.set("starter", forged);
      assert.deepEqual((await g.call(f, "/api/signin/check", { id: as.body!.id, way: "berry" })).body, { status: "expired" });
      assert.equal(f.jar.has("session"), false);
    }
    // A starter that is not 64 hex characters is no starter at all.
    for (const odd of ["x", "", "g".repeat(64), "A".repeat(64), "0".repeat(63)]) {
      const o = new Browser();
      o.jar.set("starter-admin", odd);
      assert.deepEqual((await g.call(o, CHECK, { id: as.body!.id, way: "berry" })).body, { status: "elsewhere" }, JSON.stringify(odd));
    }
    // Not used up by those tries: its own browser gets its admin login, and it is no player.
    assert.deepEqual((await g.call(a, CHECK, { id: as.body!.id, way: "berry" })).body, { status: "signedin", address: OWNER.address });
    a.jar.set("session", a.jar.get("admin")!);
    assert.equal(await g.player.player(a.request("/")), null, "an admin token in the player's cookie is no player");
    if (g.db) {
      // A session row is read only in its own scope: the admin row with its scope changed to 'play' opens nothing.
      g.db.prepare("UPDATE sessions SET scope = 'play' WHERE scope = 'admin'").run();
      assert.equal((await g.call(a, "/api/admin/summary")).status, 401);
    }
  });

  test(`[${kind}] sign-out ends this admin login only; "Sign out everywhere" ends every admin login and the requests not delivered, and no player's login`, async () => {
    const g = makeGame(kind);
    const both = new Browser();
    const ps = await g.call(both, "/api/signin/start", { way: "berry" });
    assert.ok(g.accepted("berry", await g.answer("berry", ps.body!, STRANGER)));
    await g.call(both, "/api/signin/check", { id: ps.body!.id, way: "berry" });
    await g.adminLogin("nautilus", OWNER, both);
    assert.equal((await g.call(both, "/api/admin/summary")).status, 200);
    const out = await g.call(both, "/api/admin-signin/signout", {});
    assert.deepEqual(out.body, { ok: true });
    assert.match(out.res.headers.get("Set-Cookie")!, /^admin=; Path=\/; Max-Age=0;/);
    assert.equal((await g.call(both, "/api/admin/summary")).status, 401);
    assert.equal(await g.player.player(both.request("/")), STRANGER.address, "the player's login stays");
    assert.equal((await g.call(new Browser(), "/api/admin-signin/signout", {})).status, 200, "a sign-out with no login is fine");
    assert.equal((await g.call(new Browser(ORIGIN, { Origin: "http://evil.example" }), "/api/admin-signin/signout", {})).status, 403, "not from another page");

    const a1 = await g.adminLogin("berry");
    const a2 = await g.adminLogin("nautilus");
    const pending = new Browser();
    const pr = await g.call(pending, START, { way: "berry" });
    assert.ok(g.accepted("berry", await g.answer("berry", pr.body!)));
    const waiting = new Browser();
    const wr = await g.call(waiting, START, { way: "nautilus" });
    const done = await g.call(a1, "/api/admin/signout-all", {});
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, { ok: true, signedOut: 2 });
    assert.equal((await g.call(a1, "/api/admin/summary")).status, 401);
    assert.equal((await g.call(a2, "/api/admin/summary")).status, 401);
    assert.notEqual((await g.call(pending, CHECK, { id: pr.body!.id, way: "berry" })).body!.status, "signedin");
    assert.ok(!g.accepted("nautilus", await g.answer("nautilus", wr.body!)), "a request that was waiting cannot be signed afterwards");
    assert.notEqual((await g.call(waiting, CHECK, { id: wr.body!.id, way: "nautilus" })).body!.status, "signedin");
    assert.equal(await g.player.player(both.request("/")), STRANGER.address, "the player's login stays");
  });

  test(`[${kind}] the sign-in list keeps the time, the country and a short browser name; a hostile browser text and country give only the fixed words`, async () => {
    const g = makeGame(kind);
    const first = await g.adminLogin("berry", OWNER, new Browser(ORIGIN, { "CF-IPCountry": "US", "User-Agent": CHROME_MAC }));
    g.clock.now += 1000;
    await g.adminLogin("nautilus", OWNER, new Browser(ORIGIN, { "User-Agent": "<script>alert(1)</script> \"); DROP TABLE admin_logins;--", "CF-IPCountry": "<s>" }));
    const s = await g.call(first, "/api/admin/summary");
    assert.deepEqual(s.body!.logins, [
      { at: g.clock.now, country: null, browser: "Unknown browser" },
      { at: g.clock.now - 1000, country: "US", browser: "Chrome on macOS" },
    ]);
    assert.equal(s.body!.canSignOutEverywhere, true);
    assert.equal(shortBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"), "Edge on Windows");
    if (g.db) {
      const dump = JSON.stringify(g.db.prepare("SELECT * FROM admin_logins").all());
      for (const never of ["Mozilla", "script", "198.51", OWNER.address]) assert.ok(!dump.includes(never), never);
    }
  });
}

test("on https the cookies are __Host-admin and __Host-starter-admin, and the plain names are not read", async () => {
  const store = createMemoryAdminSignin();
  const admin = createAdminSignin({ store, owner: OWNER.address, limit: () => true });
  const https = "https://game.test";
  const start = await admin.handle(new Request(`${https}/api/admin-signin/start`, { method: "POST", headers: { Origin: https, "Content-Type": "application/json" }, body: "{}" }));
  const cookie = start!.headers.get("Set-Cookie")!;
  assert.match(cookie, /^__Host-starter-admin=[0-9a-f]{64}; Path=\/; Max-Age=1800; HttpOnly; SameSite=Lax; Secure$/);
  const token = "c".repeat(64);
  const now = Date.now();
  store.sessionRows.set(await adminKey(token), { idHash: await adminKey(token), address: OWNER.address, createdAt: now, expiresAt: now + 86_400_000, via: "wallet" });
  const at = (c: string) => new Request(`${https}/x`, { headers: { Cookie: c } });
  assert.equal((await admin.session(at(`__Host-admin=${token}`)))?.address, OWNER.address);
  assert.equal(await admin.session(at(`admin=${token}`)), null, "a sibling subdomain can set the plain name");
  const out = await admin.signOut(at(`__Host-admin=${token}`));
  assert.match(out, /^__Host-admin=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(store.sessionRows.size, 0);
});

test("the session hook reads only the words it knows: a stored word other than wallet and nanoterra is 'unknown', and the guard refuses it", async () => {
  const store = createMemoryAdminSignin();
  const admin = createAdminSignin({ store, owner: OWNER.address });
  const now = Date.now();
  for (const [via, read] of [["wallet", "wallet"], ["nanoterra", "nanoterra"], ["ticket", "unknown"], ["", "unknown"], ["Wallet", "unknown"]]) {
    const token = (await sha256Hex(via + "x")).slice(0, 64);
    store.sessionRows.set(await adminKey(token), { idHash: await adminKey(token), address: OWNER.address, createdAt: now, expiresAt: now + 1000, via });
    assert.equal((await admin.session(new Request("http://game.test/", { headers: { Cookie: `admin=${token}` } }), now))?.via, read, via);
    assert.equal(await admin.session(new Request("http://game.test/", { headers: { Cookie: `admin=${token}` } }), now + 1000), null, "not at its end");
  }
});

test("the routes: the methods, a bad body, an unknown way, no id, another page, another host, the limit, the person check and a store fault", async () => {
  const g = makeGame("memory");
  const raw = (path: string, init: RequestInit = {}) => g.admin.handle(new Request(`${ORIGIN}${path}`, init));
  assert.equal(await raw("/api/admin-signin/other"), null, "not a route of the sign-in");
  assert.equal(await raw("/api/admin-signin/nano/xyz"), null);
  assert.equal((await raw(`/api/admin-signin/nano/${"a".repeat(32)}`, { method: "DELETE" }))!.status, 405);
  assert.deepEqual(await (await raw(`/api/admin-signin/nano/${"a".repeat(32)}`))!.json(), { error: true, statusCode: 401, message: "This sign-in expired." });
  assert.equal((await raw("/api/admin-signin/nautilus"))!.status, 405);
  assert.equal((await raw("/api/admin-signin/start"))!.status, 405);
  const post = (path: string, body: string, origin = ORIGIN) => raw(path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body });
  assert.equal((await post(START, "{}", "http://evil.example"))!.status, 403);
  assert.equal((await post(START, "not json"))!.status, 400);
  assert.equal((await post(START, JSON.stringify({ way: "passkey" })))!.status, 400);
  assert.equal((await post(START, JSON.stringify({ pad: "x".repeat(9000) })))!.status, 400);
  assert.equal((await post(CHECK, JSON.stringify({ way: "berry" })))!.status, 400);
  assert.deepEqual(await (await post(CHECK, JSON.stringify({ id: 5 })))!.json(), { error: "no request id" });
  // The domain: another host is refused, and the texts name the domain.
  const pinned = createAdminSignin({ store: createMemoryAdminSignin(), owner: OWNER.address, domain: "mygame.com" });
  const r = await pinned.handle(new Request(`${ORIGIN}${START}`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" }));
  assert.equal(r!.status, 403);
  assert.match((await r!.json()).error, /mygame\.com/);
  // The limit hook (the player's key), the person check.
  const keys: string[] = [];
  const limited = createAdminSignin({ store: createMemoryAdminSignin(), owner: OWNER.address, limit: (k) => (keys.push(k), false), visitor: async () => "v1" });
  assert.equal((await limited.handle(new Request(`${ORIGIN}${START}`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" })))!.status, 429);
  assert.deepEqual(keys, ["signin|v1"]);
  const person = createAdminSignin({ store: createMemoryAdminSignin(), owner: OWNER.address, limit: () => true, personCheck: async (t) => t === "ok" });
  assert.equal((await person.handle(new Request(`${ORIGIN}${START}`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" })))!.status, 403);
  assert.equal((await person.handle(new Request(`${ORIGIN}${START}`, { method: "POST", headers: { Origin: ORIGIN }, body: JSON.stringify({ turnstile: "ok" }) })))!.status, 200);
  // A store fault: a plain 500, and onError hears it.
  const errors: unknown[] = [];
  const broken = createMemoryAdminSignin();
  broken.requests = () => {
    throw new Error("disk full");
  };
  const b = createAdminSignin({ store: broken, owner: OWNER.address, limit: () => true, onError: (e) => errors.push(e) });
  const res = await b.handle(new Request(`${ORIGIN}${START}`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" }));
  assert.equal(res!.status, 500);
  assert.doesNotMatch(await res!.text(), /disk/);
  assert.equal(errors.length, 1);
  assert.equal(res!.headers.get("Cache-Control"), "no-store");
});

test("the options: another base and page; bad paths, cookie names and a shared name are refused", async () => {
  const store = createMemoryAdminSignin();
  const admin = createAdminSignin({ store, owner: OWNER.address, base: "/x/admin-login", page: "/backstage", limit: () => true });
  const s = await admin.handle(new Request(`${ORIGIN}/x/admin-login/start`, { method: "POST", headers: { Origin: ORIGIN }, body: "{}" }));
  const id = (await s!.json()).id;
  const read = await admin.handle(new Request(`${ORIGIN}/x/admin-login/nano/${id}`));
  assert.equal((await read!.json()).uri, `${ORIGIN}/backstage`);
  for (const bad of [{ base: "api" }, { base: "/api/" }, { page: "/admin?from=US" }, { page: "admin" }, { cookies: { session: "a b" } }, { cookies: { session: "same", starter: "same" } }]) assert.throws(() => createAdminSignin({ store, owner: null, ...bad }), JSON.stringify(bad));
});
