import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_LIMITS, ADMIN_SESSION_MS, createAdminHandler, createMemoryStore, loadGameSettings, type AdminHandler, type AdminSession, type AdminStore } from "../src/admin/index.js";
import { adminConformance, type ConformanceCase, type ConformanceHost, type Who } from "../src/admin/conformance.js";

const OWNER = `nano_1${"a".repeat(59)}`;
const OTHER = `nano_3${"b".repeat(59)}`;
const ORIGIN = "https://game.example";
const NOW = 1_800_000_000_000;
const DEFAULTS = { character: "nanoterra", signin: "exchange" } as const;

/** What a game's own session code does: the ADMIN cookie holds the kind of login (a stand-in for a token), and only that cookie is read. */
const KINDS: Record<string, AdminSession> = {
  owner: { address: OWNER, createdAt: NOW - 1000, via: "wallet" },
  nanoterra_login: { address: OWNER, createdAt: NOW - 1000, via: "nanoterra" },
  other_wallet: { address: OTHER, createdAt: NOW - 1000, via: "wallet" },
  expired_login: { address: OWNER, createdAt: NOW - ADMIN_SESSION_MS - 1, via: "wallet" },
};
const readSession = async (req: Request): Promise<AdminSession | null> => {
  const m = /(?:^|;\s*)admin=([a-z_]+)/.exec(req.headers.get("Cookie") ?? "");
  return (m && KINDS[m[1]]) || null;
};

function make(over: Partial<Parameters<typeof createAdminHandler>[0]> = {}) {
  const store = createMemoryStore();
  let n = 0;
  const handler = createAdminHandler({
    store,
    defaults: DEFAULTS,
    owner: OWNER,
    session: readSession,
    now: () => NOW,
    // A limiter of its own for each handler, so one test never uses up another's.
    limit: (() => {
      const hits = new Map<string, number>();
      return (key: string, limit: number) => {
        hits.set(key, (hits.get(key) ?? 0) + 1);
        return (hits.get(key) ?? 0) <= limit;
      };
    })(),
    check: async () => ({ scanned: true, settled: [], n: ++n }),
    ...over,
  });
  return { store, handler };
}

function hostFor(handler: AdminHandler, noOwner: AdminHandler, wrap?: (res: Response) => Response): ConformanceHost {
  return {
    routes: handler.routes,
    basePath: handler.basePath,
    origin: ORIGIN,
    async request(who: Who, req) {
      const headers = new Headers(req.headers);
      // game_login: a valid login of the PLAYERS' kind: it is in the game's own cookie, which the admin never reads.
      if (who === "game_login") headers.set("Cookie", "session=owner; admin=");
      else if (who !== "signed_out") headers.set("Cookie", `admin=${who === "no_address" ? "owner" : who}`);
      const target = who === "no_address" ? noOwner : handler;
      const res = await target.handle(new Request(ORIGIN + req.path, { method: req.method, headers, body: req.body }));
      const out = res ?? new Response("not for the admin", { status: 404 });
      return wrap ? wrap(out) : out;
    },
  };
}

const run = async (cases: ConformanceCase[]) => {
  for (const c of cases) await c.run();
};

// ---- the suite on a good host ----

test("the conformance suite passes on a handler with the memory store", async () => {
  const { handler } = make();
  const { handler: noOwner } = make({ owner: null });
  const cases = adminConformance(hostFor(handler, noOwner));
  assert.ok(cases.length >= 10);
  for (const c of cases) await c.run().catch((e: Error) => assert.fail(`${c.name}: ${e.message}`));
});

// ---- the suite has teeth: a host that breaks a rule fails it ----

test("the suite fails a host whose session code reads the players' cookie as the admin login", async () => {
  const bad = make({ session: async (req) => (/(?:^|;\s*)(?:admin|session)=(owner)/.exec(req.headers.get("Cookie") ?? "") ? KINDS.owner : null) });
  const { handler: noOwner } = make({ owner: null });
  await assert.rejects(run(adminConformance(hostFor(bad.handler, noOwner))), /game's players|game_login/);
});

test("the suite fails a handler that answers an unknown path before it checks the guard", async () => {
  const good = make();
  const { handler: noOwner } = make({ owner: null });
  const leaky: AdminHandler = {
    ...good.handler,
    async handle(req) {
      if (new URL(req.url).pathname.endsWith("/no-such-page") && !(req.headers.get("Cookie") ?? "").includes("admin=owner")) return new Response('{"error":"No such admin page."}', { status: 404 });
      return good.handler.handle(req);
    },
  };
  await assert.rejects(run(adminConformance(hostFor(leaky, noOwner))), /no-such-page/);
});

test("the suite fails a handler that adds a CORS header, or that drops no-store", async () => {
  const { handler } = make();
  const { handler: noOwner } = make({ owner: null });
  const cors = (res: Response) => {
    const out = new Response(res.body, res);
    out.headers.set("Access-Control-Allow-Origin", "*");
    return out;
  };
  await assert.rejects(run(adminConformance(hostFor(handler, noOwner, cors))), /CORS/);
  const cached = (res: Response) => {
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "public, max-age=60");
    return out;
  };
  await assert.rejects(run(adminConformance(hostFor(handler, noOwner, cached))), /no-store/);
});

test("the suite fails a handler that lets a cross-site POST through", async () => {
  const { handler } = make();
  const { handler: noOwner } = make({ owner: null });
  const noOriginCheck: AdminHandler = {
    ...handler,
    async handle(req) {
      const headers = new Headers(req.headers);
      headers.set("Origin", ORIGIN);
      const text = await req.text();
      return handler.handle(new Request(req.url, { method: req.method, headers, body: text === "" ? undefined : text }));
    },
  };
  await assert.rejects(run(adminConformance(hostFor(noOriginCheck, noOwner))), /another Origin|Sec-Fetch-Site|neither/);
});

// ---- the routes ----

const call = (h: AdminHandler, path: string, init: { method?: string; kind?: string; origin?: string | null; body?: string } = {}) => {
  const headers = new Headers();
  headers.set("Cookie", `admin=${init.kind ?? "owner"}`);
  if (init.origin !== null && (init.method ?? "GET") === "POST") headers.set("Origin", init.origin ?? ORIGIN);
  return h.handle(new Request(ORIGIN + path, { method: init.method ?? "GET", headers, body: init.body }));
};

test("a request that is not under the base path is not the admin's: null, and the guard is not asked", async () => {
  let asked = 0;
  const { handler } = make({ session: async () => (asked++, null) });
  assert.equal(await handler.handle(new Request(`${ORIGIN}/api/orders`)), null);
  assert.equal(await handler.handle(new Request(`${ORIGIN}/api/administrators`)), null);
  assert.equal(await handler.handle(new Request(`${ORIGIN}/`)), null);
  assert.equal(asked, 0);
  // But the base itself and every spelling of it is the admin's.
  for (const p of ["/api/admin", "/api/admin/", "/API/ADMIN/summary", "/api//admin/summary", "/api/admin%2fsummary", "/api/%61dmin/summary"]) {
    const res = await handler.handle(new Request(ORIGIN + p));
    assert.ok(res, p);
    assert.equal(res.status, 401, p);
  }
});

test("GET game gives the defaults, and says that /admin has set nothing yet", async () => {
  const { handler } = make();
  const res = (await call(handler, "/api/admin/game"))!;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { character: "nanoterra", signin: "exchange", fromAdmin: { character: false, signin: false } });
});

test("a press is saved, read back, and writes only the two setting rows", async () => {
  const { handler, store } = make();
  const res = (await call(handler, "/api/admin/game", { method: "POST", body: JSON.stringify({ signin: "none" }) }))!;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { character: "nanoterra", signin: "none", fromAdmin: { character: false, signin: true } });
  const res2 = (await call(handler, "/api/admin/game", { method: "POST", body: JSON.stringify({ character: "own", signin: "exchange" }) }))!;
  assert.deepEqual(await res2.json(), { character: "own", signin: "exchange", fromAdmin: { character: true, signin: true } });
  assert.deepEqual([...store.rows.keys()].sort(), ["setting:character", "setting:signin"]);
  assert.equal(store.orders.length, 0);
  assert.equal(store.owned.length, 0);
});

test("a bad press is refused with its reason and saves nothing", async () => {
  const { handler, store } = make();
  for (const body of ['{"signin":"ticket"}', '{"character":"robot"}', '{"price":1}', "{}", "[]", "null", "not json", '{"signin":"none","extra":1}']) {
    const res = (await call(handler, "/api/admin/game", { method: "POST", body }))!;
    assert.equal(res.status, 400, body);
  }
  assert.equal(store.writes, 0);
  const big = (await call(handler, "/api/admin/game", { method: "POST", body: JSON.stringify({ signin: "none", pad: "x".repeat(ADMIN_LIMITS.gameBodyMax) }) }))!;
  assert.equal(big.status, 413);
  assert.equal(store.writes, 0);
});

test("a body with no length cannot be read past the limit", async () => {
  const { handler, store } = make();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1024;
      controller.enqueue(new Uint8Array(1024).fill(32));
      if (sent > 10_000_000) controller.close();
    },
  });
  const headers = new Headers({ Cookie: "admin=owner", Origin: ORIGIN });
  const res = (await handler.handle(new Request(`${ORIGIN}/api/admin/game`, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit)))!;
  assert.equal(res.status, 413);
  assert.ok(sent < 100_000, `read ${sent} bytes`);
  assert.equal(store.writes, 0);
});

test("a cross-site POST saves nothing", async () => {
  const { handler, store } = make();
  for (const origin of ["https://evil.example", "null", ORIGIN + ".evil.example", "http://game.example"]) {
    const res = (await call(handler, "/api/admin/game", { method: "POST", origin, body: JSON.stringify({ signin: "none" }) }))!;
    assert.equal(res.status, 403, origin);
  }
  assert.equal(store.writes, 0);
});

test("the limit: 30 presses a minute, then 429, and nothing more is saved", async () => {
  const { handler, store } = make();
  for (let i = 0; i < ADMIN_LIMITS.game.limit; i++) assert.equal((await call(handler, "/api/admin/game", { method: "POST", body: JSON.stringify({ signin: i % 2 ? "exchange" : "none" }) }))!.status, 200);
  const before = store.writes;
  assert.equal((await call(handler, "/api/admin/game", { method: "POST", body: JSON.stringify({ signin: "none" }) }))!.status, 429);
  assert.equal(store.writes, before);
});

test("the summary has the status, the numbers, and names for the looks", async () => {
  const { handler, store } = make({
    status: () => ({ address: OWNER, testMode: true, turnstile: false, nodes: ["a"], repo: "me/game", warnings: ["Test mode is on."] }),
    lookName: (id) => ({ "mint-cap": "Mint Cap" })[id],
  });
  store.orders.push(
    { id: "1", player: OTHER, lookId: "mint-cap", usd: "0.25", xno: "0.2", status: "paid", createdAt: NOW - 100, expiresAt: NOW + 100, paidAt: NOW - 50, payer: OTHER, hash: "H" },
    { id: "2", player: OTHER, lookId: "gone", usd: "0.05", xno: "0.04", status: "open", createdAt: NOW - 1000, expiresAt: NOW - 10, paidAt: null, payer: null, hash: null },
  );
  store.owned.push({ player: OTHER, lookId: "mint-cap", at: NOW - 40 });
  const s = await (await call(handler, "/api/admin/summary"))!.json();
  assert.equal(s.address, OWNER);
  assert.deepEqual(s.warnings, ["Test mode is on."]);
  assert.deepEqual(s.counts, { open: 0, paid: 1, expired: 1, paid_late: 0 });
  assert.equal(s.totals.paid.usd, "0.25");
  assert.equal(s.orders[0].look, "Mint Cap");
  assert.equal(s.orders[1].look, "gone");
  assert.deepEqual(s.players, [{ player: OTHER, looks: [{ id: "mint-cap", name: "Mint Cap", at: NOW - 40 }] }]);
});

test("the payment check route exists only when the game gives one, and answers with the scan and the summary", async () => {
  const { handler } = make();
  const res = (await call(handler, "/api/admin/check", { method: "POST", body: "{}" }))!;
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scan.scanned, true);
  assert.ok(body.summary.counts);
  const none = make({ check: undefined });
  assert.equal(none.handler.routes.some((r) => r.path.endsWith("/check")), false);
  assert.equal((await call(none.handler, "/api/admin/check", { method: "POST", body: "{}" }))!.status, 404);
});

test("a fault in the store gives a plain 500 that does not show the fault, and tells onError", async () => {
  const seen: unknown[] = [];
  const store: AdminStore = {
    async readSettings() {
      throw new Error("SQLITE_SECRET_DETAIL password=hunter2");
    },
    async saveSettings() {
      throw new Error("SQLITE_SECRET_DETAIL");
    },
    async summary() {
      throw new Error("SQLITE_SECRET_DETAIL");
    },
  };
  const { handler } = make({ store, onError: (e) => seen.push(e) });
  for (const [path, method, body] of [["/api/admin/game", "GET"], ["/api/admin/summary", "GET"], ["/api/admin/game", "POST", '{"signin":"none"}']] as const) {
    const res = (await call(handler, path, { method, body }))!;
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!/SQLITE|hunter2/.test(text), text);
  }
  assert.equal(seen.length, 3);
});

test("a fault in the session code lets nobody in (503), not even the owner", async () => {
  const { handler } = make({ session: async () => { throw new Error("db down"); } });
  for (const p of ["/api/admin/summary", "/api/admin/game", "/api/admin/nothing"]) assert.equal((await call(handler, p))!.status, 503, p);
});

test("a session that is the owner's but too old, with a shorter limit set by the host, is refused", async () => {
  const young = make({ maxAgeMs: 500 });
  assert.equal((await call(young.handler, "/api/admin/summary"))!.status, 401);
  const ok = make({ maxAgeMs: 5000 });
  assert.equal((await call(ok.handler, "/api/admin/summary"))!.status, 200);
});

test("the base path must be a path", () => {
  for (const basePath of ["", "admin", "/", "/api/admin/"]) assert.throws(() => make({ basePath }), /basePath/);
  const other = make({ basePath: "/_admin" });
  assert.deepEqual(other.handler.routes.map((r) => `${r.method} ${r.path}`), ["GET /_admin/summary", "GET /_admin/game", "POST /_admin/game", "POST /_admin/check"]);
});

test("loadGameSettings: the stored words, the defaults for a missing or odd word, and the defaults when the store fails", async () => {
  const store = createMemoryStore();
  assert.deepEqual(await loadGameSettings(store, DEFAULTS), { character: "nanoterra", signin: "exchange", fromAdmin: { character: false, signin: false } });
  store.rows.set("setting:character", "own");
  store.rows.set("setting:signin", "ticket"); // not a word a press can set: ignored
  assert.deepEqual(await loadGameSettings(store, DEFAULTS), { character: "own", signin: "exchange", fromAdmin: { character: true, signin: false } });
  const broken = { readSettings: async () => { throw new Error("down"); } };
  assert.deepEqual(await loadGameSettings(broken, { character: "own", signin: "none" }), { character: "own", signin: "none", fromAdmin: { character: false, signin: false } });
});
