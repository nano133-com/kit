// "@nano133/nanoterra/maintenance": the signature (checked against node:crypto, the way nano133.com checks it), the teller, the gate and the
// "Back soon" page; and the admin handler's maintenance press (saved first, then told; a refusal says so; the times only grow).
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createAdminHandler, createMemoryStore, loadMaintenance, parsePatch, type AdminSession } from "../src/admin/index.js";
import { connectTestSecret } from "../src/connect/conformance.js";
import {
  MAINTENANCE_LABEL,
  MAINTENANCE_OPEN,
  MAINTENANCE_PATH,
  MAINTENANCE_WORDS,
  RETRY_AFTER_S,
  backSoonPage,
  isPageLoad,
  maintenanceGate,
  maintenanceMessage,
  maintenanceSignature,
  nanoterraTeller,
  secretHash,
  type Tell,
} from "../src/maintenance/index.js";

const CLIENT = "ng_0123456789abcdef0123";
const NOW = 1_800_000_000_000;
const OWNER = `nano_1${"a".repeat(59)}`;
const ORIGIN = "https://game.example";

/** nano133.com's check, written again with node:crypto: the HMAC keyed with the hex SHA-256 of the secret (the hash it keeps). */
const expected = (secret: string, on: boolean, at: number) =>
  createHmac("sha256", createHash("sha256").update(secret).digest("hex")).update(`${MAINTENANCE_LABEL}\n${CLIENT}\n${on ? "on" : "off"}\n${at}`).digest("hex");

test("the signature is the HMAC-SHA256 of the label, the client id, the state and the time, keyed with the secret's SHA-256 as hex (what nano133.com keeps)", async () => {
  const secret = connectTestSecret();
  assert.equal(await secretHash(secret), createHash("sha256").update(secret).digest("hex"));
  assert.equal(maintenanceMessage(CLIENT, true, NOW), `${MAINTENANCE_LABEL}\n${CLIENT}\non\n${NOW}`);
  const on = await maintenanceSignature(secret, CLIENT, true, NOW);
  assert.match(on, /^[0-9a-f]{64}$/);
  assert.equal(on, expected(secret, true, NOW));
  assert.equal(await maintenanceSignature(secret, CLIENT, false, NOW), expected(secret, false, NOW));
  // Each part changes it: the state, the time, the secret.
  assert.notEqual(await maintenanceSignature(secret, CLIENT, false, NOW), on);
  assert.notEqual(await maintenanceSignature(secret, CLIENT, true, NOW + 1), on);
  assert.notEqual(await maintenanceSignature(connectTestSecret(), CLIENT, true, NOW), on);
  // Spaces around the secret are dropped, as the connect's setup does.
  assert.equal(await maintenanceSignature(` ${secret}\n`, CLIENT, true, NOW), on);
});

test("the teller: null with no client id, a weak secret or a site that is not nano133.com or this machine; else one signed POST", async () => {
  const secret = connectTestSecret();
  assert.equal(nanoterraTeller({ clientId: undefined, secret }), null);
  assert.equal(nanoterraTeller({ clientId: "none", secret }), null);
  assert.equal(nanoterraTeller({ clientId: CLIENT, secret: undefined }), null);
  assert.equal(nanoterraTeller({ clientId: CLIENT, secret: `ns_${"x".repeat(43)}` }), null);
  assert.equal(nanoterraTeller({ clientId: CLIENT, secret, site: "https://evil.example" }), null);
  const sent: { url: string; init: RequestInit }[] = [];
  const tell = nanoterraTeller({
    clientId: CLIENT,
    secret,
    site: "http://127.0.0.1:9",
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch,
  })!;
  assert.deepEqual(await tell({ on: true, at: NOW }), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `http://127.0.0.1:9${MAINTENANCE_PATH}`);
  assert.equal(sent[0].init.method, "POST");
  assert.equal(sent[0].init.redirect, "manual");
  const body = JSON.parse(String(sent[0].init.body));
  assert.deepEqual(Object.keys(body).sort(), ["at", "client_id", "on", "sig"]);
  assert.equal(body.client_id, CLIENT);
  assert.equal(body.on, true);
  assert.equal(body.at, NOW);
  assert.equal(body.sig, expected(secret, true, NOW));
  // The secret never leaves the server: it is in no part of the request.
  assert.ok(!JSON.stringify(sent[0]).includes(secret));
  // nano133.com itself is the default site.
  const live: string[] = [];
  await nanoterraTeller({ clientId: CLIENT, secret, fetch: (async (url: string) => (live.push(url), new Response(null, { status: 200 }))) as typeof fetch })!({ on: false, at: NOW });
  assert.deepEqual(live, [`https://nano133.com${MAINTENANCE_PATH}`]);
});

test("the teller: every refusal and a dead network say why, in words with no secret", async () => {
  const secret = connectTestSecret();
  for (const status of [400, 401, 409, 422, 429, 500, 302]) {
    const tell = nanoterraTeller({ clientId: CLIENT, secret, fetch: (async () => new Response("{}", { status })) as typeof fetch })!;
    const r = await tell({ on: true, at: NOW });
    assert.equal(r.ok, false, String(status));
    assert.ok(!r.ok && r.error.length > 10 && !r.error.includes(secret), String(status));
  }
  const dead = nanoterraTeller({
    clientId: CLIENT,
    secret,
    fetch: (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  })!;
  assert.deepEqual(await dead({ on: true, at: NOW }), { ok: false, error: "Nanoterra did not answer." });
});

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => new Request(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers: init.headers });
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", Accept: "text/html,application/xhtml+xml" };
const page = () => backSoonPage({ name: "Echo <Island>", stylesheets: ["/back-soon.css"] });

test("a page load is a GET or HEAD that the browser marks as a navigation, or (with no such mark) asks for HTML", () => {
  assert.equal(isPageLoad(req("/", { headers: NAV })), true);
  assert.equal(isPageLoad(req("/", { method: "HEAD", headers: NAV })), true);
  assert.equal(isPageLoad(req("/", { headers: { Accept: "text/html" } })), true);
  assert.equal(isPageLoad(req("/", { method: "POST", headers: NAV })), false);
  assert.equal(isPageLoad(req("/api/x", { headers: { "Sec-Fetch-Mode": "cors", Accept: "text/html" } })), false);
  assert.equal(isPageLoad(req("/assets/a.js", { headers: { "Sec-Fetch-Mode": "no-cors" } })), false);
  assert.equal(isPageLoad(req("/", { headers: { Accept: "*/*" } })), false);
  assert.equal(isPageLoad(req("/")), false);
});

test("the gate: off lets everything through; on, a player's page load gets Back soon (503, Retry-After, no-store) and nothing else is stopped", async () => {
  assert.equal(await maintenanceGate(req("/", { headers: NAV }), false, { page }), null);
  const res = (await maintenanceGate(req("/", { headers: NAV }), true, { page }))!;
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), String(RETRY_AFTER_S));
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Type") ?? "", /^text\/html/);
  const html = await res.text();
  assert.ok(html.includes(`<h1 class="n133-back-soon-title">${MAINTENANCE_WORDS.title}</h1>`));
  assert.ok(html.includes("Echo &#60;Island&#62; is under maintenance."));
  // A HEAD gets the same answer with no body.
  const head = (await maintenanceGate(req("/", { method: "HEAD", headers: NAV }), true, { page }))!;
  assert.equal(head.status, 503);
  assert.equal(await head.text(), "");
  // Any other path of the game's pages too.
  assert.equal((await maintenanceGate(req("/index.html", { headers: NAV }), true, { page }))!.status, 503);
  // Not stopped: the admin page and its calls and sign-in, the API, the files, the listing file, a POST, a page of the game's own `open`.
  for (const p of [...MAINTENANCE_OPEN, "/admin/", "/api/admin/game", "/api/admin-signin/start"]) assert.equal(await maintenanceGate(req(p, { headers: NAV }), true, { page }), null, p);
  assert.equal(await maintenanceGate(req("/api/plays/use", { method: "POST", headers: { "Sec-Fetch-Mode": "cors" } }), true, { page }), null);
  assert.equal(await maintenanceGate(req("/api/game/save", { headers: { "Sec-Fetch-Mode": "cors" } }), true, { page }), null);
  assert.equal(await maintenanceGate(req("/assets/game.js", { headers: { "Sec-Fetch-Mode": "no-cors" } }), true, { page }), null);
  assert.equal(await maintenanceGate(req("/nano-game.json", { headers: { Accept: "application/json" } }), true, { page }), null);
  assert.equal(await maintenanceGate(req("/owner-help", { headers: NAV }), true, { page, open: (p) => p === "/owner-help" }), null);
  // A path that only starts like an open one is not open.
  assert.equal((await maintenanceGate(req("/administrator", { headers: NAV }), true, { page }))!.status, 503);
  // The game may answer with a Response of its own: the gate still makes it a 503 that no cache keeps.
  const own = (await maintenanceGate(req("/", { headers: NAV }), true, { page: () => new Response("<p>Back soon</p>", { headers: { "Content-Type": "text/html", "X-Own": "1" } }) }))!;
  assert.equal(own.status, 503);
  assert.equal(own.headers.get("X-Own"), "1");
  assert.equal(own.headers.get("Cache-Control"), "no-store");
});

test("the Back soon page: the name as text, the game's stylesheets, no script, no inline style, not for search engines", () => {
  const html = backSoonPage({ name: `"><script>alert(1)</script>`, stylesheets: ["/back-soon.css", '/x.css"onload="y'] });
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\sstyle=|<style/i.test(html));
  assert.ok(!/\son\w+=/i.test(html));
  assert.ok(html.includes('<link rel="stylesheet" href="/back-soon.css">'));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.startsWith("<!doctype html>"));
});

const SESSION: AdminSession = { address: OWNER, createdAt: NOW - 1000, via: "wallet" };

function make(tell: Tell | null | "no card", now = () => NOW) {
  const store = createMemoryStore();
  const handler = createAdminHandler({ store, defaults: { character: "nanoterra", signin: "exchange" }, owner: OWNER, session: async () => SESSION, now, limit: () => true, ...(tell === "no card" ? {} : { maintenance: { tell } }) });
  const press = async (body: unknown) => {
    const res = (await handler.handle(new Request(`${ORIGIN}/api/admin/game`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) })))!;
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { store, handler, press };
}

test("a maintenance press is saved first (the game's site follows it at once), then told; nano133.com's yes is kept as 'told'", async () => {
  const told: { on: boolean; at: number }[] = [];
  const { store, press } = make(async (s) => (told.push(s), { ok: true }));
  const on = await press({ maintenance: "on" });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.maintenance, { on: true, at: NOW, told: true, canTell: true });
  assert.deepEqual(told, [{ on: true, at: NOW }]);
  assert.equal(store.rows.get("setting:maintenance"), "on");
  assert.equal(store.rows.get("setting:maintenanceAt"), String(NOW));
  assert.equal(store.rows.get("setting:maintenanceToldAt"), String(NOW));
  assert.equal(await loadMaintenance(store), true);
  // The clock has not moved (or went back): the next press is still later than the last, so nano133.com keeps it.
  const off = await press({ maintenance: "off" });
  assert.deepEqual(off.body.maintenance, { on: false, at: NOW + 1, told: true, canTell: true });
  assert.deepEqual(told[1], { on: false, at: NOW + 1 });
  assert.equal(await loadMaintenance(store), false);
  // A press of the state it has tells nano133.com again, with a new time.
  await press({ maintenance: "off" });
  assert.deepEqual(told[2], { on: false, at: NOW + 2 });
  // Nothing but the three maintenance rows were written.
  assert.deepEqual([...store.rows.keys()].sort(), ["setting:maintenance", "setting:maintenanceAt", "setting:maintenanceToldAt"]);
});

test("nano133.com refuses or does not answer: the switch still holds on the game's site, and the state says 'not told' with the reason", async () => {
  let answer: { ok: true } | { ok: false; error: string } = { ok: false, error: "Nanoterra did not answer." };
  const { store, press, handler } = make(async () => answer);
  const r = await press({ maintenance: "on" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.maintenance, { on: true, at: NOW, told: false, canTell: true, error: "Nanoterra did not answer." });
  assert.equal(await loadMaintenance(store), true);
  assert.equal(store.rows.has("setting:maintenanceToldAt"), false);
  // A later read still says "not told" (the error words are the press's own answer only).
  const get = (await handler.handle(new Request(`${ORIGIN}/api/admin/game`)))!;
  assert.deepEqual(((await get.json()) as Record<string, unknown>).maintenance, { on: true, at: NOW, told: false, canTell: true });
  // A tell that throws is "did not answer", never a 500.
  const thrower = make(async () => {
    throw new Error("boom");
  });
  const t = await thrower.press({ maintenance: "on" });
  assert.equal(t.status, 200);
  assert.equal(t.body.maintenance.error, "Nanoterra did not answer.");
  // The retry (the same state again) is told this time.
  answer = { ok: true };
  const again = await press({ maintenance: "on" });
  assert.deepEqual(again.body.maintenance, { on: true, at: NOW + 1, told: true, canTell: true });
});

test("a game with no Nanoterra secret: the switch works on its own site, and the state says it cannot tell", async () => {
  const { store, press } = make(null);
  const r = await press({ maintenance: "on" });
  assert.deepEqual(r.body.maintenance, { on: true, at: NOW, told: false, canTell: false });
  assert.equal(await loadMaintenance(store), true);
});

test("a game that did not give the maintenance option: no maintenance in its state, and a maintenance press is refused with nothing saved", async () => {
  const { store, press, handler } = make("no card");
  const get = (await handler.handle(new Request(`${ORIGIN}/api/admin/game`)))!;
  assert.equal("maintenance" in ((await get.json()) as Record<string, unknown>), false);
  const r = await press({ maintenance: "on" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "This game has no maintenance switch.");
  assert.equal(store.rows.size, 0);
  // Its other presses answer with no maintenance either.
  const s = await press({ emotes: "off" });
  assert.equal(s.status, 200);
  assert.equal("maintenance" in s.body, false);
});

test("a press can never set the handler's own times, and a bad maintenance word is refused", () => {
  assert.deepEqual(parsePatch({ maintenance: "on" }), { ok: true, patch: { maintenance: "on" } });
  assert.equal(parsePatch({ maintenance: true }).ok, false);
  assert.equal(parsePatch({ maintenance: "yes" }).ok, false);
  assert.equal(parsePatch({ maintenanceAt: NOW }).ok, false);
  assert.equal(parsePatch({ maintenanceToldAt: NOW }).ok, false);
  assert.equal(parsePatch({ maintenance: "on", maintenanceToldAt: NOW }).ok, false);
});

test("loadMaintenance: off for a new store, an odd word and a store that fails (the game stays open)", async () => {
  const store = createMemoryStore();
  assert.equal(await loadMaintenance(store), false);
  store.rows.set("setting:maintenance", "yes");
  assert.equal(await loadMaintenance(store), false);
  store.rows.set("setting:maintenance", "on");
  assert.equal(await loadMaintenance(store), true);
  assert.equal(await loadMaintenance({ readSettings: async () => Promise.reject(new Error("down")) }), false);
});

test("two presses in flight: an older press that nano133.com accepts late never marks the newer press as told", async () => {
  let release: () => void = () => undefined;
  let first = true;
  const { press } = make(async () => {
    if (first) {
      first = false;
      await new Promise<void>((r) => (release = r));
    }
    return { ok: true };
  });
  const slow = press({ maintenance: "on" });
  await new Promise((r) => setTimeout(r, 5));
  const fast = await press({ maintenance: "off" });
  assert.deepEqual(fast.body.maintenance, { on: false, at: NOW + 1, told: true, canTell: true });
  release();
  const late = await slow;
  // The late answer is for the older press: the state is the newer one's, and it stays told.
  assert.deepEqual(late.body.maintenance, { on: false, at: NOW + 1, told: true, canTell: true });
});
