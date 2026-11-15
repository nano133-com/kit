// Sign in from Nanoterra (src/connect): the conformance suite on the Worker adapter (D1 on SQLite) and on the Node adapter (a real node:http server on
// 127.0.0.1 with Express's shape of request and answer), then what the suite cannot see from outside: the setup, the switch, a local dev server's
// cookies, the "works once" stores, the deadline of a pending cookie, the hooks, the screens and their words, and the rules on `after` and the site.
// nano133.com is a stand-in everywhere (a fake fetch): no request leaves the computer. The client id and the secret are test values.
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { CONNECT_RULES, connectConformance, connectTestAddress, tokenAnswer, type ConnectConformanceCase, type ConnectHarness } from "../src/connect/conformance.js";
import { createConnect, type ConnectOptions, type ConnectSession, type Player } from "../src/connect/core.js";
import { createD1Once } from "../src/connect/adapters/d1.js";
import { createFirestoreOnce } from "../src/connect/adapters/firestore.js";
import { CONNECT_CSP, CONNECT_WORDS, createMemoryOnce, readPlayer, pendingToken, bindOf, afterPath, siteOf, setupOf, ANSWER_MAX } from "../src/connect/index.js";
import { connectMiddleware, createNodeConnect, webRequest } from "../src/connect/node.js";
import { createWorkerConnect, setting } from "../src/connect/worker.js";
import { d1Over, noSqlite, sqlite } from "./shop-helpers.js";

const CLIENT_ID = "ng_00000000000000000001";
const SECRET = "ns_test-secret-never-real";
const CODE = "A".repeat(43);

/** The game's own sessions, in memory: a random token in `__Host-session` (or `session` on a local dev server) for an address. */
function sessions() {
  const byToken = new Map<string, { address: string; via: string }>();
  const nameOf = (req: Request) => (new URL(req.url).protocol === "https:" ? "__Host-session" : "session");
  const tokenIn = (cookie: string, name: string) => cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  return {
    byToken,
    async signIn(req: Request, player: Player, via = "nanoterra"): Promise<string> {
      const token = crypto.randomUUID().replace(/-/g, "");
      byToken.set(token, { address: player.address, via });
      return `${nameOf(req)}=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${nameOf(req) === "session" ? "" : "; Secure"}`;
    },
    async session(req: Request): Promise<ConnectSession | null> {
      const t = tokenIn(req.headers.get("Cookie") ?? "", nameOf(req));
      const s = t ? byToken.get(t) : undefined;
      return s ? { address: s.address } : null;
    },
    signedIn(cookie: string, name = "__Host-session"): string | null {
      const t = tokenIn(cookie, name);
      return (t && byToken.get(t)?.address) || null;
    },
    make(address: string, name = "__Host-session"): string {
      const token = crypto.randomUUID().replace(/-/g, "");
      byToken.set(token, { address, via: "wallet" });
      return `${name}=${token}`;
    },
  };
}

const run = (title: string, cases: ConnectConformanceCase[]) =>
  describe(title, () => {
    it("holds every rule of the suite", () => assert.deepEqual([...new Set(cases.map((c) => c.rule))], [...CONNECT_RULES]));
    for (const c of cases) it(`${c.rule} ${c.name}`, c.run);
  });

// ---- The suite on the Worker adapter (D1 on SQLite: the shop's d1.sql makes `hits`) ----

run(
  "connect conformance: the Worker adapter on D1",
  connectConformance(async (token) => {
    const db = d1Over(sqlite());
    const s = sessions();
    const connect = createWorkerConnect({ NANOTERRA_CLIENT_ID: CLIENT_ID, NANOTERRA_SECRET: SECRET, DB: db }, { fetch: token, signIn: (req, p) => s.signIn(req, p), session: s.session });
    const harness: ConnectHarness = {
      handle: async (req) => (await connect.handle(req)) ?? new Response("not found", { status: 404 }),
      clientId: CLIENT_ID,
      secret: SECRET,
      signedIn: async (cookie) => s.signedIn(cookie),
      sessionFor: async (address) => s.make(address),
    };
    return harness;
  }),
);

// ---- The suite on the Node adapter: a real server on 127.0.0.1, the Express middleware, the game's public origin https://game.test ----

/** The server of one case: it answers the four routes through `connectMiddleware`, and 404 for any other path. Closed when the run ends. */
const servers: Server[] = [];
async function nodeServer(connectOf: () => ReturnType<typeof createNodeConnect>): Promise<{ port: number }> {
  const connect = connectOf();
  const mw = connectMiddleware(connect, "https://game.test");
  const server = createServer((req, res) => {
    void mw(req as IncomingMessage & { originalUrl?: string }, res, (e?: unknown) => {
      res.statusCode = e ? 500 : 404;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { port: (server.address() as AddressInfo).port };
}
/** A Web Request sent to the local server as it is (headers, cookies, body), and its answer as a Web Response. */
function viaHttp(port: number, req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(req.url);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => (headers[k] = v));
    void req.text().then((body) => {
      const r = httpRequest({ host: "127.0.0.1", port, method: req.method, path: `${u.pathname}${u.search}`, headers: { ...headers, host: u.host } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) h.append(k, one);
          const status = res.statusCode ?? 500;
          resolve(new Response([101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: h }));
        });
      });
      r.on("error", reject);
      if (body) r.write(body);
      r.end();
    }, reject);
  });
}

describe("connect conformance: the Node adapter (node:http, Express's shape)", () => {
  const cases = connectConformance(async (token) => {
    const s = sessions();
    const { port } = await nodeServer(() =>
      createNodeConnect({
        clientId: CLIENT_ID,
        secret: SECRET,
        once: createMemoryOnce(),
        origins: ["https://game.test"],
        visitor: (req) => req.headers.get("X-Forwarded-For") ?? "local",
        fetch: token,
        signIn: (req, p) => s.signIn(req, p),
        session: s.session,
      }),
    );
    return { handle: (req) => viaHttp(port, req), clientId: CLIENT_ID, secret: SECRET, signedIn: async (cookie) => s.signedIn(cookie), sessionFor: async (address) => s.make(address) };
  });
  it("holds every rule of the suite", () => assert.deepEqual([...new Set(cases.map((c) => c.rule))], [...CONNECT_RULES]));
  for (const c of cases) it(`${c.rule} ${c.name}`, c.run);
  it("closes its servers", async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  });
});

// ---- What the suite cannot see from outside ----

/** A connect on Web requests with a stand-in token route that answers `answer`, in memory. */
function harness(over: Partial<ConnectOptions> = {}, answer: unknown = null) {
  const s = sessions();
  const calls: RequestInit[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Response(JSON.stringify(answer), { status: answer ? 200 : 400 });
  }) as unknown as typeof fetch;
  const connect = createConnect({ clientId: CLIENT_ID, secret: SECRET, once: createMemoryOnce(), fetch: fetcher, signIn: (req, p) => s.signIn(req, p), session: s.session, ...over });
  return { connect, s, calls };
}
let ip = 0;
const get = (c: ReturnType<typeof createConnect>, path: string, cookie?: string, origin = "https://game.test") => {
  ip += 1;
  return c.handle(new Request(`${origin}${path}`, { headers: { "CF-Connecting-IP": `192.0.2.${ip % 250}`, ...(cookie ? { Cookie: cookie } : {}) } })) as Promise<Response>;
};
const post = (c: ReturnType<typeof createConnect>, path: string, cookie: string | null, body = "", origin = "https://game.test") => {
  ip += 1;
  return c.handle(new Request(`${origin}${path}`, { method: "POST", headers: { "CF-Connecting-IP": `192.0.2.${ip % 250}`, Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body })) as Promise<Response>;
};
const STATE = "s".repeat(32);
const arrive = (c: ReturnType<typeof createConnect>, extra = "", origin = "https://game.test", name = "__Host-nanoterra-state") => get(c, `/nanoterra/callback?code=${CODE}&state=${STATE}`, `${name}=${STATE}${extra}`, origin);
const pairOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0] ?? null;
const bindIn = (html: string) => /name="bind" value="([0-9a-f]{32})"/.exec(html)?.[1];

describe("connect: the setup and the switch", () => {
  it("is off until the client id (ng_ and 20 hex) and the secret (at most 100 characters) are set; start, callback and confirm answer 503, Not me still works", async () => {
    for (const [clientId, secret] of [
      [undefined, SECRET],
      [CLIENT_ID, undefined],
      [CLIENT_ID, "  "],
      ["ng_123", SECRET],
      ["NG_00000000000000000001", SECRET],
      [CLIENT_ID, "x".repeat(101)],
    ] as [string | undefined, string | undefined][]) {
      const { connect, calls } = harness({ clientId, secret }, tokenAnswer(connectTestAddress()));
      assert.equal(connect.ready, false);
      assert.equal((await get(connect, "/nanoterra/start")).status, 503);
      assert.equal((await arrive(connect)).status, 503);
      assert.equal((await post(connect, "/nanoterra/confirm", null)).status, 503);
      assert.equal((await post(connect, "/nanoterra/cancel", null)).status, 303);
      assert.equal(calls.length, 0);
    }
    assert.equal(harness().connect.ready, true);
  });

  it("the Worker adapter reads the settings as the starter did: none, skip, off and - are not set; spaces around are dropped", () => {
    for (const v of ["none", "SKIP", "off", "-", "", "  "]) assert.equal(setting(v), undefined);
    assert.equal(setting(`  ${CLIENT_ID} `), CLIENT_ID);
    const db = d1Over(sqlite());
    assert.equal(createWorkerConnect({ NANOTERRA_CLIENT_ID: "none", NANOTERRA_SECRET: SECRET, DB: db }, { signIn: async () => "" }).ready, false);
    assert.equal(createWorkerConnect({ NANOTERRA_CLIENT_ID: CLIENT_ID, NANOTERRA_SECRET: SECRET, DB: db }, { signIn: async () => "" }).ready, true);
    assert.throws(() => createWorkerConnect({ NANOTERRA_CLIENT_ID: CLIENT_ID, NANOTERRA_SECRET: SECRET }, { signIn: async () => "" }), /D1/);
  });

  it("the game's switch: while off, start, callback and confirm answer 'is off'; Not me works", async () => {
    let on = false;
    const { connect, calls } = harness({ enabled: () => on }, tokenAnswer(connectTestAddress()));
    for (const res of [await get(connect, "/nanoterra/start"), await arrive(connect), await post(connect, "/nanoterra/confirm", null)]) {
      assert.equal(res.status, 503);
      assert.match(await res.text(), /Sign-in from Nanoterra is off/);
    }
    assert.equal((await post(connect, "/nanoterra/cancel", null)).status, 303);
    assert.equal(calls.length, 0);
    on = true;
    assert.equal((await get(connect, "/nanoterra/start")).status, 302);
  });

  it("trades only with nano133.com, or with a stand-in on this computer: another site is 'not set up'", () => {
    assert.equal(siteOf(undefined), "https://nano133.com");
    assert.equal(siteOf("https://nano133.com"), "https://nano133.com");
    for (const ok of ["http://127.0.0.1:8788", "http://localhost:9000", "https://localhost", "http://[::1]:8000"]) assert.equal(siteOf(ok), new URL(ok).origin, ok);
    for (const bad of ["https://evil.test", "http://nano133.com", "https://nano133.com.evil.test", "https://127.0.0.1.nip.io", "javascript:alert(1)", "http://127.0.0.1:8788/api", "file:///tmp", "not a url"]) assert.equal(siteOf(bad), null, bad);
    assert.equal(setupOf(CLIENT_ID, SECRET, "https://evil.test"), null);
    assert.equal(createWorkerConnect({ NANOTERRA_CLIENT_ID: CLIENT_ID, NANOTERRA_SECRET: SECRET, NANOTERRA_ORIGIN: "https://evil.test", DB: d1Over(sqlite()) }, { signIn: async () => "" }).ready, false);
  });

  it("`after` is a path on this site, fixed in the code: another site, //host, a backslash, a space or a control character throws", () => {
    for (const ok of ["/", "/play", "/play?from=nanoterra", "/a/b#c"]) assert.equal(afterPath(ok), ok);
    for (const bad of ["", "play", "//evil.test", "/\\evil.test", "https://evil.test", "/ x", "/\u0000", "/‮", "\\\\evil", "/play\\x"]) assert.throws(() => afterPath(bad), TypeError, JSON.stringify(bad));
    assert.throws(() => createConnect({ clientId: CLIENT_ID, secret: SECRET, once: createMemoryOnce(), signIn: async () => "", after: "//evil.test" }), TypeError);
  });
});

describe("connect: a local dev server (plain http on this computer)", () => {
  it("names its cookies without __Host- and without Secure there only, and reads the plain name there only", async () => {
    const { connect } = harness({}, tokenAnswer(connectTestAddress()));
    const started = await get(connect, "/nanoterra/start", undefined, "http://127.0.0.1:8787");
    const state = new URL(started.headers.get("Location")!).searchParams.get("state")!;
    assert.deepEqual(started.headers.getSetCookie(), [`nanoterra-state=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`]);
    const shown = await arrive(connect, "", "http://127.0.0.1:8787", "nanoterra-state");
    assert.equal(shown.status, 200);
    assert.match(shown.headers.getSetCookie()[0], /^nanoterra-pending=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=300; HttpOnly; SameSite=Lax$/);
    assert.equal(shown.headers.getSetCookie()[1], "nanoterra-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    // The same request to a real host on http: the __Host- names, and the plain cookie is not read.
    assert.equal((await arrive(connect, "", "http://game.example", "nanoterra-state")).status, 400);
  });
});

describe("connect: the works-once stores", () => {
  it("D1: the starter's own row, nanoterra-pending|<id> in the 10-minute window of the deadline, once", { skip: noSqlite }, async () => {
    const db = sqlite();
    const once = createD1Once(d1Over(db));
    const until = Date.UTC(2026, 10, 15, 12, 4, 0);
    assert.equal(await once("a".repeat(24), until, "confirm"), true);
    assert.equal(await once("a".repeat(24), until, "cancel"), false);
    assert.equal(await once("b".repeat(24), until, "confirm"), true);
    const rows = db.prepare("SELECT key, win, count FROM hits ORDER BY key").all() as { key: string; win: number; count: number }[];
    assert.deepEqual(rows.map((r) => [r.key, r.win]), [[`nanoterra-pending|${"a".repeat(24)}`, Math.floor(until / 600_000)], [`nanoterra-pending|${"b".repeat(24)}`, Math.floor(until / 600_000)]]);
  });

  it("Firestore: one document made with create (two at once: one wins), a deleteAt a day after the deadline, no address", async () => {
    const docs = new Map<string, Record<string, unknown>>();
    const db = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          create: async (data: Record<string, unknown>) => {
            await new Promise((r) => setTimeout(r, 1));
            if (docs.has(`${name}/${id}`)) throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
            docs.set(`${name}/${id}`, data);
          },
        }),
      }),
    };
    const once = createFirestoreOnce(db, { now: () => 1000 });
    const results = await Promise.all([once("c".repeat(24), 5000, "confirm"), once("c".repeat(24), 5000, "confirm")]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.deepEqual(docs.get(`nanoterra_once/${"c".repeat(24)}`), { use: "confirm", at: 1000, deleteAt: new Date(5000 + 86_400_000) });
    const other = createFirestoreOnce({ collection: () => ({ doc: () => ({ create: async () => Promise.reject(Object.assign(new Error("down"), { code: 14 })) }) }) });
    await assert.rejects(other("d".repeat(24), 1, "cancel"), /down/);
  });

  it("memory: once, and it forgets old ids when it grows", async () => {
    const once = createMemoryOnce(() => 10);
    assert.equal(await once("x", 5, "confirm"), true);
    assert.equal(await once("x", 5, "confirm"), false);
    for (let i = 0; i < 5001; i++) await once(`k${i}`, 5, "confirm");
    await once("y", 50, "confirm");
    assert.ok(once.size() < 10);
  });
});

describe("connect: the pending cookie", () => {
  it("runs out after 5 minutes; another key, or a cookie for a bad address, is refused", async () => {
    let t = Date.now();
    const address = connectTestAddress();
    const { connect, s } = harness({ now: () => t }, tokenAnswer(address));
    const shown = await arrive(connect);
    const pending = pairOf(shown, "__Host-nanoterra-pending")!;
    const bind = bindIn(await shown.text())!;
    t += 301_000;
    const late = await post(connect, "/nanoterra/confirm", pending, `bind=${bind}`);
    assert.equal(late.status, 400);
    assert.match(await late.text(), /That sign-in has run out/);
    const player = readPlayer(tokenAnswer(address))!;
    const other = await pendingToken("another key", player, t);
    assert.equal((await post(connect, "/nanoterra/confirm", `__Host-nanoterra-pending=${other}`, `bind=${await bindOf(other)}`)).status, 400);
    const bad = await pendingToken(SECRET, { ...player, address: "nano_notanaddress" }, t);
    assert.equal((await post(connect, "/nanoterra/confirm", `__Host-nanoterra-pending=${bad}`, `bind=${await bindOf(bad)}`)).status, 400);
    const good = await pendingToken(SECRET, player, t);
    const ok = await post(connect, "/nanoterra/confirm", `__Host-nanoterra-pending=${good}`, `bind=${await bindOf(good)}`);
    assert.equal(ok.status, 303);
    assert.equal(s.signedIn(ok.headers.getSetCookie().join("; ").split(";")[0]), address);
  });

  it("holds the address, the name, the look and the record, never the items, and stays small for a player with 64 items", async () => {
    const items = Array.from({ length: 64 }, (_, i) => `item.${String(i).padStart(2, "0")}${"x".repeat(40)}`);
    const name = `<img src=x onerror=alert(1)> & "q" 'a'`;
    const { connect } = harness({}, tokenAnswer(connectTestAddress(), { username: name, character: { v: 1, look: { skin: "#f2c29b", hair: "#3a2a1e", shirt: "#2a9df4", pants: "#1e2a4a", shoes: "#ffffff" }, items } }));
    const shown = await arrive(connect);
    const cookie = shown.headers.getSetCookie()[0];
    assert.ok(cookie.length < 600, `${cookie.length}`);
    const payload = JSON.parse(Buffer.from(cookie.split("=")[1].split(".")[0], "base64url").toString());
    assert.deepEqual(Object.keys(payload).sort(), ["a", "exp", "j", "l", "n", "r"]);
  });

  it("a press of Continue reads the bind from a form body of at most 1,024 bytes", async () => {
    const { connect } = harness({}, tokenAnswer(connectTestAddress()));
    const shown = await arrive(connect);
    const pending = pairOf(shown, "__Host-nanoterra-pending")!;
    const bind = bindIn(await shown.text())!;
    assert.equal((await post(connect, "/nanoterra/confirm", pending, `bind=${bind}&pad=${"x".repeat(1100)}`)).status, 400);
  });
});

describe("connect: the game's hooks", () => {
  const pressed = (address: string) => tokenAnswer(address, { arrival: "press" });

  it("a press when the session here cannot be read: the old screen, no session, and a log line with no secret", async () => {
    const lines: string[] = [];
    const { connect } = harness(
      {
        session: async () => {
          throw new Error(`the database is down ${SECRET}`);
        },
        log: (m, d) => lines.push(`${m} ${JSON.stringify(d)}`),
      },
      pressed(connectTestAddress()),
    );
    const res = await arrive(connect);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Sign in as Ann\?/);
    assert.deepEqual(lines, ['the press could not be used {"error":"Error"}']);
  });

  it("a game with no session reader never skips the screen", async () => {
    const { connect } = harness({ session: undefined }, pressed(connectTestAddress()));
    const res = await arrive(connect);
    assert.equal(res.status, 200);
    assert.ok(bindIn(await res.text()));
  });

  it("signIn may answer a page instead (a rule of the game said no): it is sent with this flow's cookies dropped and no session", async () => {
    const refuse = async () => new Response("Too many sign-ins", { status: 429, headers: { "Content-Type": "text/plain" } });
    const { connect } = harness({ signIn: refuse }, pressed(connectTestAddress()));
    const res = await arrive(connect);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(res.headers.getSetCookie(), ["__Host-nanoterra-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
    const two = harness({ signIn: refuse }, tokenAnswer(connectTestAddress()));
    const shown = await arrive(two.connect);
    const done = await post(two.connect, "/nanoterra/confirm", pairOf(shown, "__Host-nanoterra-pending"), `bind=${bindIn(await shown.text())}`);
    assert.equal(done.status, 429);
    assert.deepEqual(done.headers.getSetCookie(), ["__Host-nanoterra-pending=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
  });

  it("signIn gets the player and how: a press with a new id, Continue with the pending cookie's id", async () => {
    const seen: { via: string; id: string; address: string; name: string }[] = [];
    const s = sessions();
    const signIn: ConnectOptions["signIn"] = async (req, p, how) => {
      seen.push({ ...how, address: p.address, name: p.username });
      return s.signIn(req, p);
    };
    const a = connectTestAddress();
    await arrive(harness({ signIn }, pressed(a)).connect);
    const b = connectTestAddress();
    const h = harness({ signIn }, tokenAnswer(b, { username: "Bea" }));
    const shown = await arrive(h.connect);
    await post(h.connect, "/nanoterra/confirm", pairOf(shown, "__Host-nanoterra-pending"), `bind=${bindIn(await shown.text())}`);
    assert.equal(seen.length, 2);
    assert.deepEqual([seen[0].via, seen[0].address, seen[0].name], ["press", a, "Ann"]);
    assert.deepEqual([seen[1].via, seen[1].address, seen[1].name], ["confirm", b, "Bea"]);
    assert.match(seen[0].id, /^[0-9a-f]{24}$/);
    assert.match(seen[1].id, /^[0-9a-f]{24}$/);
  });

  it("keep runs after the exchange and before any screen; arrived may answer first (Arcade's rules); a fault in arrived shows the old screen", async () => {
    const kept: string[] = [];
    const address = connectTestAddress();
    const early = harness({ keep: async (p) => void kept.push(p.address), arrived: async () => new Response(null, { status: 303, headers: { Location: "/" } }) }, pressed(address));
    const res = await arrive(early.connect);
    assert.equal(res.status, 303);
    assert.deepEqual(kept, [address]);
    assert.deepEqual(res.headers.getSetCookie(), ["__Host-nanoterra-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
    const faulty = harness(
      {
        arrived: async () => {
          throw new Error("down");
        },
        log: () => {},
      },
      pressed(connectTestAddress()),
    );
    const shown = await arrive(faulty.connect);
    assert.equal(shown.status, 200);
    assert.ok(bindIn(await shown.text()));
    // A refused state never reaches keep or arrived.
    const never = harness({ keep: async () => assert.fail("keep ran"), arrived: async () => assert.fail("arrived ran") }, pressed(address));
    assert.equal((await get(never.connect, `/nanoterra/callback?code=${CODE}&state=${STATE}`)).status, 400);
  });

  it("same: the game says whether the session here is the account Nanoterra named (Arcade's combined accounts)", async () => {
    const s = sessions();
    const a = connectTestAddress();
    const { connect } = harness({ session: async () => ({ address: "account-root-1", name: "Root" }), same: async (here) => here.address === "account-root-1", signIn: (req, p) => s.signIn(req, p) }, pressed(a));
    const res = await arrive(connect);
    assert.equal(res.status, 303);
    assert.deepEqual(res.headers.getSetCookie(), ["__Host-nanoterra-state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure"]);
    const other = harness({ session: async () => ({ address: "account-root-2", name: "Root" }), same: async () => false }, pressed(a));
    const html = await (await arrive(other.connect)).text();
    assert.match(html, /<h1>Switch to Ann\?<\/h1><p>You are signed in here as <strong>Root<\/strong>\.<\/p>/);
  });

  it("the default limit counts each route for a visitor (CF-Connecting-IP; an IPv6 address by its /64); a game's own limit replaces it", async () => {
    const { connect } = harness();
    const at = (v6: string) => connect.start(new Request("https://game.test/nanoterra/start", { headers: { "CF-Connecting-IP": v6 } }));
    let last = 0;
    for (let i = 0; i < 22 && last !== 429; i++) last = (await at(`2001:db8:1:2:${i}::1`)).status;
    assert.equal(last, 429);
    const scopes: string[] = [];
    const own = harness({ limit: (scope) => (scopes.push(scope), true) }, tokenAnswer(connectTestAddress()));
    await get(own.connect, "/nanoterra/start");
    await arrive(own.connect);
    await post(own.connect, "/nanoterra/confirm", null);
    assert.deepEqual(scopes, ["start", "callback", "confirm"]);
  });
});

describe("connect: the screens", () => {
  it("the starter's markup and words, a policy with no script and no frame, and the stylesheet /nanoterra.css", async () => {
    const address = connectTestAddress();
    const { connect } = harness({}, tokenAnswer(address));
    const res = await arrive(connect);
    const html = await res.text();
    assert.equal(res.headers.get("Content-Security-Policy"), CONNECT_CSP);
    assert.doesNotMatch(CONNECT_CSP, /script-src|unsafe/);
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
    assert.ok(html.includes('<link rel="stylesheet" href="/nanoterra.css"><title>Sign in as Ann?</title><main class="nt"><div class="nt-logo" aria-hidden="true"></div><div class="nt-card">'));
    assert.ok(html.includes(`<h1>Sign in as Ann?</h1><p>Nanoterra says you are <strong>Ann</strong>, with the address <code>${address.slice(0, 11)}…${address.slice(-6)}</code>.</p><p class="nt-guard">Press <strong>Continue</strong> only if you just pressed Play in Nanoterra yourself. If someone sent you this link, press <strong>Not me</strong>.</p><form method="post" action="/nanoterra/confirm"><input type="hidden" name="bind" value="`));
    assert.ok(html.includes('<button type="submit" class="primary">Continue as Ann</button></form><form method="post" action="/nanoterra/cancel"><button type="submit">Not me</button></form>'));
    const err = await get(connect, "/nanoterra/callback?code=x");
    assert.ok((await err.text()).includes('<h1>That sign-in did not work</h1><p>The sign-in code is missing or not valid. Press Play in Nanoterra again.</p><p class="nt-go"><a href="/">Play as a guest</a></p>'));
  });

  it("a game's words, stylesheets, head and logo label; every value escaped; ** is strong text", async () => {
    const { connect } = harness(
      {
        after: "/play",
        screens: {
          words: { signInTitle: "Play as {name}?", signInKey: "Yes, I am {name}", notMeKey: "<b>No</b>", signInLead: "From **Nanoterra** · {address}" },
          errors: { badCode: { title: "Oops", text: "Try again & again" } },
          stylesheets: ["/art/connect.css", '"><script>'],
          head: '<link rel="preload" href="/fonts/x.woff2" as="font" type="font/woff2" crossorigin>',
          logoLabel: 'Echo "Island"',
        },
      },
      tokenAnswer(connectTestAddress(), { username: "<i>Kai</i>" }),
    );
    const html = await (await arrive(connect)).text();
    assert.ok(html.includes('<link rel="preload" href="/fonts/x.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/art/connect.css"><link rel="stylesheet" href="&#34;&#62;&#60;script&#62;">'));
    assert.ok(html.includes('<div class="nt-logo" role="img" aria-label="Echo &#34;Island&#34;"></div>'));
    assert.ok(html.includes("<h1>Play as &#60;i&#62;Kai&#60;/i&#62;?</h1><p>From <strong>Nanoterra</strong> · <code>"));
    assert.ok(html.includes(">Yes, I am &#60;i&#62;Kai&#60;/i&#62;</button>"));
    assert.ok(html.includes("<button type=\"submit\">&#60;b&#62;No&#60;/b&#62;</button>"));
    assert.doesNotMatch(html, /<i>|<b>|<script>/);
    const err = await (await get(connect, "/nanoterra/callback?code=x")).text();
    assert.ok(err.includes('<h1>Oops</h1><p>Try again &#38; again</p><p class="nt-go"><a href="/play">Play as a guest</a></p>'));
  });

  it("render replaces the whole page; it gets the parts escaped and the kit's page; null keeps the kit's", async () => {
    const seen: string[] = [];
    const { connect } = harness(
      {
        screens: {
          csp: "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
          render: (screen) => {
            seen.push(screen.kind);
            if (screen.kind !== "signin") return null;
            assert.ok(screen.page.includes('<main class="nt">'));
            assert.equal(screen.html.name, "&#60;i&#62;Kai&#60;/i&#62;");
            assert.match(screen.bind!, /^[0-9a-f]{32}$/);
            return `<!doctype html><style>p{}</style><p>${screen.html.title}</p>${screen.html.confirm}${screen.html.cancel}`;
          },
        },
      },
      tokenAnswer(connectTestAddress(), { username: "<i>Kai</i>" }),
    );
    const res = await arrive(connect);
    const html = await res.text();
    assert.match(html, /^<!doctype html><style>p\{\}<\/style><p>Sign in as &#60;i&#62;Kai&#60;\/i&#62;\?<\/p><form method="post" action="\/nanoterra\/confirm"><input type="hidden" name="bind" value="[0-9a-f]{32}">/);
    assert.match(res.headers.get("Content-Security-Policy")!, /unsafe-inline/);
    await get(connect, "/nanoterra/callback?code=x");
    assert.deepEqual(seen, ["signin", "error"]);
    assert.deepEqual(Object.keys(CONNECT_WORDS).length, 10);
  });

  it("the switch names a session with no name by its short address", async () => {
    const bob = connectTestAddress();
    const { connect } = harness({ session: async () => ({ address: bob }) }, tokenAnswer(connectTestAddress(), { arrival: "press" }));
    const html = await (await arrive(connect)).text();
    assert.ok(html.includes(`You are signed in here as <strong>${bob.slice(0, 11)}…${bob.slice(-6)}</strong>.`));
    assert.ok(html.includes(`<button type="submit">Stay as ${bob.slice(0, 11)}…${bob.slice(-6)}</button>`));
  });
});

describe("connect: the token answer", () => {
  it("readPlayer keeps what it knows, as the starter did; the answer is read up to 32 KB, and a larger one is refused before it is read whole", async () => {
    const a = connectTestAddress();
    assert.deepEqual(readPlayer(tokenAnswer(a)), { username: "Ann", address: a, look: { skin: "#f2c29b", hair: "#3a2a1e", shirt: "#2a9df4", pants: "#1e2a4a", shoes: "#ffffff" }, record: null, items: ["hub.sun-hat"] });
    assert.deepEqual(readPlayer(tokenAnswer(a, { character: { v: 1, look: tokenAnswer(a).character.look, items: ["ok.id", 5, "BAD ID", "x".repeat(60), "a.b-c"] } }))!.items, ["ok.id", "a.b-c"]);
    assert.equal(readPlayer(tokenAnswer(a, { username: "Ann\u0007" })), null);
    assert.equal(ANSWER_MAX, 32 * 1024);
    // An answer of 20 KB (many owned items) still signs in: the starter's 4 KB bound refused it.
    const big = tokenAnswer(a, { pad: "x".repeat(20_000) });
    const { connect } = harness({}, big);
    assert.equal((await arrive(connect)).status, 200);
    // A body that streams without end is cut at the bound.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(ctl) {
        pulled += 1;
        ctl.enqueue(new Uint8Array(4096).fill(32));
      },
    });
    const lines: string[] = [];
    const s = createConnect({ clientId: CLIENT_ID, secret: SECRET, once: createMemoryOnce(), signIn: async () => "", log: (m) => lines.push(m), fetch: (async () => new Response(endless, { status: 200 })) as unknown as typeof fetch });
    assert.equal((await arrive(s)).status, 400);
    assert.ok(pulled < 12, `${pulled}`);
    assert.deepEqual(lines, ["the answer was too large"]);
  });

  it("a timeout of the token call is a refusal; the log names the error, never its message", async () => {
    const lines: string[] = [];
    const c = createConnect({
      clientId: CLIENT_ID,
      secret: SECRET,
      once: createMemoryOnce(),
      signIn: async () => "",
      log: (m, d) => lines.push(`${m} ${JSON.stringify(d)}`),
      fetch: (async () => {
        throw new DOMException(`timeout at https://nano133.com/api/nanoterra/token?code=${CODE}`, "TimeoutError");
      }) as unknown as typeof fetch,
    });
    assert.equal((await arrive(c)).status, 400);
    assert.deepEqual(lines, ['the exchange failed {"error":"TimeoutError"}']);
  });
});

describe("connect: the Node bridge", () => {
  it("webRequest builds the request at the game's public origin, never from the Host header; a parsed body is used as it is", async () => {
    const req = await webRequest({ method: "POST", url: "/nanoterra/confirm?x=1", headers: { host: "evil.test", cookie: "a=1", origin: "https://game.test" }, body: { bind: "b".repeat(32), other: 5 } }, "https://game.test");
    assert.equal(req.url, "https://game.test/nanoterra/confirm?x=1");
    assert.equal(await req.text(), `bind=${"b".repeat(32)}`);
    assert.equal(req.headers.get("cookie"), "a=1");
    await assert.rejects(webRequest({ url: "//evil.test/x", headers: {} }, "https://game.test"), TypeError);
    await assert.rejects(webRequest({ url: "/", headers: {} }, "http://game.test"), TypeError);
  });

  it("createNodeConnect needs the game's origins (https, or http on localhost) and its limit or its visitor", () => {
    const base = { clientId: CLIENT_ID, secret: SECRET, once: createMemoryOnce(), signIn: async () => "" };
    assert.throws(() => createNodeConnect({ ...base, origins: [], visitor: () => "x" }), TypeError);
    assert.throws(() => createNodeConnect({ ...base, origins: ["http://game.test"], visitor: () => "x" }), TypeError);
    assert.throws(() => createNodeConnect({ ...base, origins: ["https://game.test"] }), TypeError);
    assert.equal(createNodeConnect({ ...base, origins: ["https://game.test", "http://localhost:5173"], limit: () => true }).ready, true);
  });

  it("a game behind a proxy: the request's own address is http, its public origin https; a press from the public origin passes", async () => {
    const s = sessions();
    const a = connectTestAddress();
    const c = createNodeConnect({ clientId: CLIENT_ID, secret: SECRET, once: createMemoryOnce(), origins: ["https://game.test"], limit: () => true, signIn: (req, p) => s.signIn(req, p), fetch: (async () => new Response(JSON.stringify(tokenAnswer(a)))) as unknown as typeof fetch });
    // React Router behind Cloud Run sees http://game.test: the cookies are still __Host- (only localhost goes without).
    const shown = await c.callback(new Request(`http://game.test/nanoterra/callback?code=${CODE}&state=${STATE}`, { headers: { Cookie: `__Host-nanoterra-state=${STATE}` } }));
    assert.equal(shown.status, 200);
    const pending = pairOf(shown, "__Host-nanoterra-pending")!;
    const bind = bindIn(await shown.text())!;
    const done = await c.confirm(new Request("http://game.test/nanoterra/confirm", { method: "POST", headers: { Origin: "https://game.test", "Sec-Fetch-Site": "same-origin", Cookie: pending, "Content-Type": "application/x-www-form-urlencoded" }, body: `bind=${bind}` }));
    assert.equal(done.status, 303);
    const wrong = await c.confirm(new Request("http://game.test/nanoterra/confirm", { method: "POST", headers: { Origin: "http://game.test", Cookie: pending }, body: `bind=${bind}` }));
    assert.equal(wrong.status, 403);
  });
});
