// The shop set up from the game starter's settings (createShop in "/shop/worker"): test mode until the owner's own address is set AND TEST_MODE is off,
// Turnstile only with both of its settings, the D1 limit of new orders, and what the page and the admin are told. D1 on SQLite, with the starter's tables.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXAMPLE_ADDRESS } from "../src/shop/index.js";
import { createShop, turnstileCheck, type ShopEnv } from "../src/shop/worker.js";
import { LOOKS, d1Over, noSqlite, sqlite, testAddress } from "./shop-helpers.js";

const STARTER = readFileSync(new URL("./fixtures/starter-0001_init.sql", import.meta.url), "utf8");
const ORIGIN = "https://game.example";
const owner = testAddress();
const env = (o: Partial<ShopEnv> = {}): ShopEnv => ({ DB: d1Over(sqlite(STARTER)), RECEIVE_ADDRESS: owner, TEST_MODE: "off", ...o });
const opts = { catalogue: LOOKS, player: async (req: Request) => req.headers.get("X-Test-Player"), rate: { fetch: async () => new Response(JSON.stringify({ nano: { usd: 1 }, result: { X: { c: ["1"] } }, data: { price: "1" } })) } };

if (noSqlite) test("the shop's Worker on SQLite", { skip: noSqlite }, () => {});
else {
  test("test mode stays on until the owner's own address is set AND TEST_MODE is off", () => {
    const cases: [Partial<ShopEnv>, boolean][] = [
      [{}, false],
      [{ TEST_MODE: undefined }, false],
      [{ TEST_MODE: "on" }, true],
      [{ TEST_MODE: " YES " }, true],
      [{ TEST_MODE: "true" }, true],
      [{ RECEIVE_ADDRESS: undefined }, true],
      [{ RECEIVE_ADDRESS: EXAMPLE_ADDRESS }, true],
      [{ RECEIVE_ADDRESS: "none" }, true],
      [{ RECEIVE_ADDRESS: owner.slice(0, -2) + "11" }, true],
    ];
    for (const [o, want] of cases) assert.equal(createShop(env(o), opts).testMode, want, JSON.stringify(o));
    assert.deepEqual(createShop(env({ RECEIVE_ADDRESS: ` ${owner.toUpperCase()} ` }), opts).payee, owner, "the address is cleaned");
  });

  test("the page's config: test mode and Turnstile's site key only when both settings are there", () => {
    assert.deepEqual(createShop(env(), opts).config(), { testMode: false, turnstileSiteKey: null });
    assert.deepEqual(createShop(env({ TURNSTILE_SITE_KEY: "site-key-1", TURNSTILE_SECRET: "none" }), opts).config(), { testMode: false, turnstileSiteKey: null });
    assert.deepEqual(createShop(env({ TURNSTILE_SITE_KEY: "site-key-1", TURNSTILE_SECRET: "secret-not-real" }), opts).config(), { testMode: false, turnstileSiteKey: "site-key-1" });
  });

  test("the admin's status: the address, test mode, the nodes and the starter's warnings", () => {
    const s = createShop(env({ RECEIVE_ADDRESS: EXAMPLE_ADDRESS, NODE_API_KEY: "skip" }), opts).status();
    assert.equal(s.address, null);
    assert.equal(s.testMode, true);
    assert.deepEqual(s.nodes, ["rpc.nano.to", "Rainstorm", "NanOslo"]);
    assert.deepEqual(s.warnings, [
      "Test mode: no receive address is set.",
      "Turnstile is OFF: sign-in and orders are not checked for bots. Add a free Turnstile widget (see README).",
      "No NODE_API_KEY: payments are checked on public Nano nodes only, which promise no uptime.",
    ]);
    // The game's own nodes (NANO_NODES) and no key: no warning about the key, since the public nodes are not the ones asked.
    const own = createShop(env({ NANO_NODES: "https://node.game.example/rpc, http://127.0.0.1:7076", TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET: "b" }), opts).status();
    assert.deepEqual(own.nodes, ["node.game.example", "127.0.0.1:7076"]);
    assert.deepEqual(own.warnings, []);
    // No key and no own node: the public nodes, and the warning.
    assert.ok(createShop(env({ TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET: "b" }), opts).status().warnings.some((w) => w.startsWith("No NODE_API_KEY")));
    const live = createShop(env({ NODE_API_KEY: "key-not-real", TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET: "b" }), opts).status();
    assert.deepEqual(live.warnings, []);
    assert.equal(live.nodes[0], "Nanswap Nodes");
    assert.ok(!JSON.stringify(live).includes("key-not-real"), "the key is never in the status");
  });

  test("an order through the Worker: the D1 limit (10 in 10 minutes for a visitor) and the person check with Turnstile's answer", async () => {
    const calls: string[] = [];
    const turnstileFetch = async (url: string, init?: RequestInit) => {
      calls.push(url);
      const form = init?.body as FormData;
      assert.equal(form.get("secret"), "secret-not-real");
      return new Response(JSON.stringify({ success: form.get("response") === "token-ok" }));
    };
    const e = env({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret-not-real" });
    const shop = createShop(e, { ...opts, fetch: turnstileFetch });
    const post = (player: string, body: unknown) =>
      shop.handle(new Request(`${ORIGIN}/api/orders`, { method: "POST", headers: { Origin: ORIGIN, "X-Test-Player": player, "CF-Connecting-IP": "203.0.113.9", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal((await post("p1", { lookId: "red-coat", turnstile: "token-bad" }))!.status, 403);
    assert.equal((await post("p1", { lookId: "red-coat", turnstile: "token-ok" }))!.status, 201);
    assert.ok(calls.every((u) => u === "https://challenges.cloudflare.com/turnstile/v0/siteverify"));
    // The same visitor (one IP) as other players: the limit is per visitor, for the whole game.
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await post(`p${i + 2}`, { lookId: "blue-cap", turnstile: "token-ok" }))!.status;
    assert.equal(last, 429);
  });

  test("turnstileCheck: off passes; on, a missing or long token fails without a call; a network fault fails", async () => {
    assert.equal(await turnstileCheck({}, undefined, null), true);
    const on = { TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET: "k" };
    let n = 0;
    const counted = async () => (n++, new Response("{}"));
    assert.equal(await turnstileCheck(on, "", null, counted), false);
    assert.equal(await turnstileCheck(on, "x".repeat(2049), null, counted), false);
    assert.equal(n, 0);
    assert.equal(await turnstileCheck(on, "t", null, async () => Promise.reject(new Error("down"))), false);
  });

  test("the cron's scan: no held order, no node call", async () => {
    const shop = createShop(env(), opts);
    assert.deepEqual(await shop.scan(), { scanned: false, settled: [] });
  });
}
