import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_LIMITS, ADMIN_SESSION_MS, createAdminHandler, createMemoryStore, loadGameSettings, type AdminHandler, type AdminSession, type AdminStore } from "../src/admin/index.js";
import { adminConformance, type ConformanceCase, type ConformanceHost, type Who } from "../src/admin/conformance.js";

const OWNER = `nano_1${"a".repeat(59)}`;
const OTHER = `nano_3${"b".repeat(59)}`;
const ORIGIN = "https://game.example";
const NOW = 1_800_000_000_000;
const DEFAULTS = { character: "nanoterra", signin: "exchange" } as const;
const RAW_02 = (2n * 10n ** 29n).toString(); // 0.2 XNO
const RAW_04 = (4n * 10n ** 28n).toString(); // 0.04 XNO

/** What a game's own session code does: the ADMIN cookie holds the kind of login (a stand-in for a token), and only that cookie is read. */
const KINDS: Record<string, AdminSession> = {
  owner: { address: OWNER, createdAt: NOW - 1000, via: "wallet" },
  nanoterra_login: { address: OWNER, createdAt: NOW - 1000, via: "nanoterra" },
  other_wallet: { address: OTHER, createdAt: NOW - 1000, via: "wallet" },
  expired_login: { address: OWNER, createdAt: NOW - ADMIN_SESSION_MS - 1, via: "wallet" },
  old_valid_row: { address: OWNER, createdAt: NOW - ADMIN_SESSION_MS - 1, via: "wallet" },
  unknown_via_login: { address: OWNER, createdAt: NOW - 1000, via: "ticket" },
};
/** What the game's own store refuses before the guard sees a login: a login it has expired, and one that its sign-out ended. */
const STORE_REFUSED = new Set(["expired_login", "signed_out_login"]);
const readSession = async (req: Request): Promise<AdminSession | null> => {
  const m = /(?:^|;\s*)admin=([a-z_]+)/.exec(req.headers.get("Cookie") ?? "");
  if (!m || STORE_REFUSED.has(m[1])) return null;
  return KINDS[m[1]] ?? null;
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

function hostFor(handler: AdminHandler, noOwner: AdminHandler, wrap?: (res: Response) => Response, otherRoutes: { method: string; path: string }[] = []): ConformanceHost {
  return {
    routes: handler.routes,
    basePath: handler.basePath,
    origin: ORIGIN,
    otherRoutes,
    async request(who: Who, req) {
      const headers = new Headers(req.headers);
      // game_login: a valid login of the PLAYERS' kind: it is in the game's own cookie, which the admin never reads.
      if (who === "game_login") headers.set("Cookie", "session=owner; admin=");
      else if (who === "game_token_as_admin") headers.set("Cookie", "admin=game_token_as_admin");
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
  const cases = adminConformance(hostFor(handler, noOwner, undefined, [{ method: "GET", path: "/api/admin/orders" }, { method: "POST", path: "/api/admin/debug" }]));
  assert.ok(cases.length >= 12);
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
  await assert.rejects(run(adminConformance(hostFor(noOriginCheck, noOwner))), /another Origin|Sec-Fetch-Site|neither|foreign page/);
});

// The four wirings that a security read wrote against the first suite; every one of them passed it. They must fail now.
test("the suite fails a game whose router serves an old admin route before the handler, with no guard (a route listed in otherRoutes)", async () => {
  const good = make();
  const { handler: noOwner } = make({ owner: null });
  const leaky: AdminHandler = {
    ...good.handler,
    async handle(req) {
      if (new URL(req.url).pathname === "/api/admin/orders") return new Response(JSON.stringify({ counts: { paid: 1 }, orders: [{ id: "x" }] }), { status: 200, headers: { "Cache-Control": "no-store" } });
      return good.handler.handle(req);
    },
  };
  await assert.rejects(run(adminConformance(hostFor(leaky, noOwner, undefined, [{ method: "GET", path: "/api/admin/orders" }]))), /\/api\/admin\/orders/);
});

test("the suite fails a game that keeps both scopes in one session table, so a player's token in the admin cookie opens the admin", async () => {
  const bad = make({ session: async (req) => (/(?:^|;\s*)admin=(owner|game_token_as_admin)\b/.test(req.headers.get("Cookie") ?? "") ? KINDS.owner : null) });
  const { handler: noOwner } = make({ owner: null });
  await assert.rejects(run(adminConformance(hostFor(bad.handler, noOwner))), /game_token_as_admin/);
});

test("the suite fails a game that reads an unknown login word as a wallet login (a fail-open map)", async () => {
  const bad = make({ session: async (req) => {
    const s = await readSession(req);
    return s ? { ...s, via: s.via === "nanoterra" ? "nanoterra" : "wallet" } : null;
  } });
  const { handler: noOwner } = make({ owner: null });
  await assert.rejects(run(adminConformance(hostFor(bad.handler, noOwner))), /unknown_via_login|did not know|fail closed|expected 403, got 200/);
});

test("the suite fails a game that answers a CORS preflight for a visitor", async () => {
  const good = make();
  const { handler: noOwner } = make({ owner: null });
  const preflight: AdminHandler = {
    ...good.handler,
    async handle(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": new URL(req.url).origin, "Access-Control-Allow-Credentials": "true", "Cache-Control": "no-store" } });
      return good.handler.handle(req);
    },
  };
  await assert.rejects(run(adminConformance(hostFor(preflight, noOwner))), /OPTIONS|CORS/);
});

test("the suite fails a game that gives a login a new creation time, so that an old login looks new (only the guard's age check could refuse it)", async () => {
  const bad = make({ session: async (req) => {
    const s = await readSession(req);
    return s ? { ...s, createdAt: NOW - 1000 } : null;
  } });
  const { handler: noOwner } = make({ owner: null });
  await assert.rejects(run(adminConformance(hostFor(bad.handler, noOwner))), /old_valid_row|expired_login|more than a day|expected 401, got 200/);
});

// What a second security read wrote against the second suite; every one of these passed it. They must fail now.
const cookieKind = (req: Request) => /(?:^|;\s*)admin=([a-z_]+)/.exec(req.headers.get("Cookie") ?? "")?.[1];

test("the suite fails a game whose router adds CORS for a foreign Origin, or that serves the data to a foreign page", async () => {
  const good = make();
  const { handler: noOwner } = make({ owner: null });
  const reflect: AdminHandler = {
    ...good.handler,
    async handle(req) {
      const res = await good.handler.handle(req);
      const origin = req.headers.get("Origin");
      if (!res || !origin) return res;
      const out = new Response(res.body, res);
      out.headers.set("Access-Control-Allow-Origin", origin);
      out.headers.set("Access-Control-Allow-Credentials", "true");
      return out;
    },
  };
  await assert.rejects(run(adminConformance(hostFor(reflect, noOwner))), /CORS/);
  // The handler's own refusal of a foreign page is what the suite needs: a wrapper that hides the foreign Origin from it gets the owner's data and fails.
  const hide: AdminHandler = {
    ...good.handler,
    async handle(req) {
      const headers = new Headers(req.headers);
      headers.delete("Origin");
      headers.delete("Sec-Fetch-Site");
      const text = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
      return good.handler.handle(new Request(req.url, { method: req.method, headers, body: text === "" ? undefined : text }));
    },
  };
  await assert.rejects(run(adminConformance(hostFor(hide, noOwner))), /foreign page|another page|Origin/);
});

test("the suite fails a game whose session renews the creation time of a login each time it is read (a rolling session)", async () => {
  let reads = 0;
  const bad = make({ session: async (req) => {
    if (cookieKind(req) !== "old_valid_row") return readSession(req);
    reads++;
    return reads === 1 ? KINDS.old_valid_row : { ...KINDS.old_valid_row, createdAt: NOW - 1000 };
  } });
  const { handler: noOwner } = make({ owner: null });
  await assert.rejects(run(adminConformance(hostFor(bad.handler, noOwner))), /old_valid_row/);
});

test("the suite fails a game that ignores its own expiry, or that still reads a login that sign-out ended", async () => {
  const { handler: noOwner } = make({ owner: null });
  const ignoresExpiry = make({ session: async (req) => (cookieKind(req) === "expired_login" ? KINDS.owner : readSession(req)) });
  await assert.rejects(run(adminConformance(hostFor(ignoresExpiry.handler, noOwner))), /expired_login|expired/);
  const keepsSignedOut = make({ session: async (req) => (cookieKind(req) === "signed_out_login" ? KINDS.owner : readSession(req)) });
  await assert.rejects(run(adminConformance(hostFor(keepsSignedOut.handler, noOwner))), /signed_out_login|sign-out/);
});

test("the suite fails an unguarded legacy write under another spelling of a route (not listed in otherRoutes), and an old route that refuses with data", async () => {
  const good = make();
  const { handler: noOwner } = make({ owner: null });
  const legacy: AdminHandler = {
    ...good.handler,
    async handle(req) {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/admin/game/") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Cache-Control": "no-store" } });
      return good.handler.handle(req);
    },
  };
  await assert.rejects(run(adminConformance(hostFor(legacy, noOwner))), /game\/|expected 401, 403, 404 or 405/);
  const leaky: AdminHandler = {
    ...good.handler,
    async handle(req) {
      if (new URL(req.url).pathname === "/api/admin/orders") return new Response(JSON.stringify({ error: "no", rows: [{ player: "x", hash: "y" }] }), { status: 403, headers: { "Cache-Control": "no-store" } });
      return good.handler.handle(req);
    },
  };
  await assert.rejects(run(adminConformance(hostFor(leaky, noOwner, undefined, [{ method: "GET", path: "/api/admin/orders" }]))), /carry only error, reason and signedInAs/);
});

test("a read from another page is refused by the handler itself, as a write is: a foreign Origin, Origin null, Sec-Fetch-Site cross-site or same-site; the game's own page and a command-line tool are not", async () => {
  const { handler } = make();
  const get = (headers: Record<string, string>) => handler.handle(new Request(`${ORIGIN}/api/admin/summary`, { headers: { Cookie: "admin=owner", ...headers } }));
  for (const headers of [{ Origin: "https://evil.example" }, { Origin: "null" }, { Origin: `${ORIGIN}.evil.example` }, { Origin: "https://sibling.game.example" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await get(headers))!.status, 403, JSON.stringify(headers));
  }
  for (const headers of [{}, { Origin: ORIGIN }, { "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Site": "none" }, { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" }]) {
    assert.equal((await get(headers))!.status, 200, JSON.stringify(headers));
  }
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
    { id: "1", player: OTHER, lookId: "mint-cap", usd: "0.25", amountRaw: RAW_02, status: "paid", createdAt: NOW - 100, expiresAt: NOW + 100, paidAt: NOW - 50, payer: OTHER, hash: "H" },
    { id: "2", player: OTHER, lookId: "gone", usd: "0.05", amountRaw: RAW_04, status: "open", createdAt: NOW - 1000, expiresAt: NOW - 10, paidAt: null, payer: null, hash: null },
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

test("the status hook gets the store's numbers, so a warning can depend on them", async () => {
  let seen: unknown = null;
  const { handler, store } = make({
    status: (_now, summary) => {
      seen = summary.counts;
      return { address: OWNER, testMode: false, warnings: summary.counts.paid_late ? [`${summary.counts.paid_late} payment came late.`] : [] };
    },
  });
  store.orders.push({ id: "L", player: OTHER, lookId: "x", usd: "0.05", amountRaw: RAW_04, status: "paid_late", createdAt: NOW - 5, expiresAt: NOW - 1, paidAt: NOW, payer: OTHER, hash: "HL" });
  const s = await (await call(handler, "/api/admin/summary"))!.json();
  assert.deepEqual(s.warnings, ["1 payment came late."]);
  assert.deepEqual(seen, { open: 0, paid: 0, expired: 0, paid_late: 1 });
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

// ---- what the security read found ----

test("odd spellings of the base are the admin's, so the guard answers them (a bad percent code, backslashes, many levels of encoding); a path that only looks alike is not", async () => {
  let asked = 0;
  const { handler } = make({ session: async () => (asked++, null) });
  const mine = ["/api/%61dmin/summary%ZZ", "/api/%5c%5cadmin/summary", "/api/%5Cadmin/summary", "/api/admin%2f..%2fsummary", `/api/%${"25".repeat(10)}61dmin/summary`, "/API/ADMIN", "/api//admin//summary", "/api/ad%6din/x"];
  for (const p of mine) {
    const res = await handler.handle(new Request(ORIGIN + p));
    assert.ok(res, p);
    assert.equal(res.status, 401, p);
  }
  assert.equal(asked, mine.length);
  for (const p of ["/api/administrators", "/api/adminx/summary", "/api/ad", "/admin", "/api/orders/admin", "/", "/api/%25%25admin/summary"]) assert.equal(await handler.handle(new Request(ORIGIN + p)), null, p);
});

test("a fault in the game's now() or onError() never reaches the visitor as a raw error, and never lets anyone in", async () => {
  const boom = (word: string) => () => {
    throw new Error(word);
  };
  const a = make({ now: boom("SECRET7") });
  const res = (await call(a.handler, "/api/admin/summary"))!;
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes("SECRET7"));
  const b = make({ onError: boom("SECRET8"), store: { readSettings: boom("db"), saveSettings: boom("db"), summary: boom("db") } as unknown as AdminStore });
  const r2 = (await call(b.handler, "/api/admin/summary"))!;
  assert.equal(r2.status, 500);
  assert.ok(!(await r2.text()).includes("SECRET8"));
  const c = make({ onError: boom("SECRET9"), session: async () => { throw new Error("session down"); } });
  const r3 = (await call(c.handler, "/api/admin/summary"))!;
  assert.equal(r3.status, 503);
  assert.ok(!(await r3.text()).includes("SECRET9"));
});

test("the default limiter is not shared by two games in one process: another owner's presses do not use up this one's", async () => {
  const sessionFor = async (req: Request) => readSession(req);
  const a = createAdminHandler({ store: createMemoryStore(), defaults: DEFAULTS, owner: OWNER, session: sessionFor, now: () => NOW });
  const b = createAdminHandler({ store: createMemoryStore(), defaults: DEFAULTS, owner: OTHER, session: sessionFor, now: () => NOW });
  const press = (h: AdminHandler, kind: string) => h.handle(new Request(`${ORIGIN}/api/admin/game`, { method: "POST", headers: { Cookie: `admin=${kind}`, Origin: ORIGIN }, body: JSON.stringify({ signin: "none" }) }));
  for (let i = 0; i < ADMIN_LIMITS.game.limit; i++) assert.equal((await press(a, "owner"))!.status, 200);
  assert.equal((await press(a, "owner"))!.status, 429, "game A is at its limit");
  assert.equal((await press(b, "other_wallet"))!.status, 200, "game B's first press is not refused because of game A");
});

// ---- the sign-in list and "sign out everywhere" ----

const ago = (ms: number) => NOW - ms;

test("with a store that lists sign-ins, the summary lists the last 10, newest first, with only the time, the country and the browser; nothing more", async () => {
  const store = createMemoryStore({ logins: true });
  for (let i = 0; i < 14; i++) store.logins.push({ at: ago(i * 60_000), country: i === 3 ? "usa" : i === 4 ? null : "US", browser: `Firefox on Linux ${i}`, address: OWNER, ip: "203.0.113.9", userAgent: "Mozilla/5.0 (X11; Linux x86_64) very long text" });
  const { handler } = make({ store });
  const s = await (await call(handler, "/api/admin/summary"))!.json();
  assert.equal(s.logins.length, 10);
  assert.deepEqual(s.logins.map((l: { at: number }) => l.at), Array.from({ length: 10 }, (_, i) => ago(i * 60_000)));
  for (const l of s.logins) assert.deepEqual(Object.keys(l).sort(), ["at", "browser", "country"]);
  assert.equal(s.logins[3].country, null, 'a country that is not two capital letters ("usa") is not shown');
  assert.equal(s.logins[4].country, null);
  assert.equal(s.logins[0].country, "US");
  assert.ok(!JSON.stringify(s).includes("203.0.113.9") && !JSON.stringify(s).includes("Mozilla"), "no address and no browser text go out, even if the store gave them");
  assert.equal(s.canSignOutEverywhere, true);
});

test("a store that does not list sign-ins gives a summary with no list and no sign-out route", async () => {
  const { handler } = make();
  const s = await (await call(handler, "/api/admin/summary"))!.json();
  assert.equal(s.logins, undefined);
  assert.equal(s.canSignOutEverywhere, undefined);
  assert.equal(handler.routes.some((r) => r.path.endsWith("/signout-all")), false);
  assert.equal((await call(handler, "/api/admin/signout-all", { method: "POST", body: "{}" }))!.status, 404);
});

test("sign out everywhere: the owner ends every admin session and no player session; a visitor and another site cannot; it is limited", async () => {
  const store = createMemoryStore({ logins: true });
  store.adminSessions = 4;
  store.playSessions = 9;
  const { handler } = make({ store });
  assert.ok(handler.routes.some((r) => r.method === "POST" && r.path === "/api/admin/signout-all"));
  // Not from another site; not as a visitor.
  assert.equal((await call(handler, "/api/admin/signout-all", { method: "POST", origin: "https://evil.example", body: "{}" }))!.status, 403);
  assert.equal((await call(handler, "/api/admin/signout-all", { method: "POST", kind: "other_wallet", body: "{}" }))!.status, 403);
  assert.equal((await call(handler, "/api/admin/signout-all", { method: "POST", kind: "nobody", body: "{}" }))!.status, 401);
  assert.equal(store.adminSessions, 4, "nothing was deleted by a refused call");
  assert.equal((await call(handler, "/api/admin/signout-all", { method: "GET" }))!.status, 405);
  const res = (await call(handler, "/api/admin/signout-all", { method: "POST", body: "{}" }))!;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, signedOut: 4 });
  assert.equal(store.adminSessions, 0);
  assert.equal(store.playSessions, 9, "the players' sessions stay");
  // 5 a minute.
  for (let i = 0; i < ADMIN_LIMITS.signOutAll.limit - 1; i++) assert.equal((await call(handler, "/api/admin/signout-all", { method: "POST", body: "{}" }))!.status, 200);
  assert.equal((await call(handler, "/api/admin/signout-all", { method: "POST", body: "{}" }))!.status, 429);
});

test("a fault in signOutEverywhere gives the fixed 500 and no detail", async () => {
  const store = createMemoryStore({ logins: true });
  store.signOutEverywhere = async () => {
    throw new Error("SECRET_SQL_DETAIL");
  };
  const { handler } = make({ store });
  const res = (await call(handler, "/api/admin/signout-all", { method: "POST", body: "{}" }))!;
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes("SECRET_SQL_DETAIL"));
});

test("the conformance suite passes on a handler whose store lists sign-ins, and walks the new route too", async () => {
  const store = createMemoryStore({ logins: true });
  const { handler } = make({ store });
  const { handler: noOwner } = make({ owner: null, store });
  const host = hostFor(handler, noOwner, undefined, [{ method: "GET", path: "/api/admin/orders" }]);
  assert.ok(host.routes.some((r) => r.path.endsWith("/signout-all")));
  for (const c of adminConformance(host)) await c.run().catch((e: Error) => assert.fail(`${c.name}: ${e.message}`));
});
