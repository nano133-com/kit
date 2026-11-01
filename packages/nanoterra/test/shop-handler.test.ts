// The shop's routes (createShopHandler) on the memory store and on D1: the game starter's paths and answers, who may see an order, test mode, the order
// rules (limits, the person check, one open order per look, three at most), and the payment check route against a mock node. No real money.
import assert from "node:assert/strict";
import test, { after, before, beforeEach, describe } from "node:test";
import { createD1Shop } from "../src/shop/adapters/d1.js";
import { EXAMPLE_ADDRESS, SCAN_GAP_MS, createMemoryShop, createShopHandler, forgetBlocks, forgetNodeHealth, type Fetch, type ShopHandlerOptions, type ShopStore } from "../src/shop/index.js";
import { LOOKS, MockNode, d1Over, hash64, noSqlite, sqlite, testAddress } from "./shop-helpers.js";

const ORIGIN = "https://game.example";
const creator = testAddress();
const node = new MockNode();
before(async () => void (await node.start()));
after(async () => void (await node.stop()));

/** The price feed answers $1 per XNO, unless told otherwise. */
let feedPrice: number | null = 1;
const feed: Fetch = async () => {
  if (feedPrice === null) throw new Error("down");
  return new Response(JSON.stringify({ usd: feedPrice }), { status: 200 });
};
let clock = 1_800_000_000_000;

function shop(o: Partial<ShopHandlerOptions> = {}, store: ShopStore = createMemoryShop()) {
  const errors: unknown[] = [];
  const h = createShopHandler({
    store,
    catalogue: LOOKS,
    payee: creator,
    player: async (req) => req.headers.get("X-Test-Player"),
    nodes: [{ name: "mock", url: node.url }],
    rate: { feeds: [{ name: "Test feed", url: "https://feed.test/", read: (j) => j.usd }], fetch: feed },
    rpc: { timeoutMs: 1000 },
    now: () => clock,
    onError: (e) => errors.push(e),
    ...o,
  });
  return { h, store, errors };
}

async function call(h: ReturnType<typeof createShopHandler>, path: string, o: { player?: string | null; body?: unknown; method?: string; origin?: string | null } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (o.player) headers.set("X-Test-Player", o.player);
  const origin = o.origin === undefined ? ORIGIN : o.origin;
  if (origin) headers.set("Origin", origin);
  const method = o.method ?? (o.body === undefined ? "GET" : "POST");
  const res = await h.handle(new Request(`${ORIGIN}${path}`, { method, headers, body: method === "GET" ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body ?? {}) }));
  if (!res) return null;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
}

beforeEach(() => {
  feedPrice = 1;
  clock += 3_600_000 * 10;
  node.sends = [];
  node.mode = "ok";
  forgetNodeHealth();
  forgetBlocks();
});

describe("the routes", () => {
  test("answer only their own paths: POST {base}, GET {base}/{id}, POST {base}/{id}/check; anything else is not the shop's (null)", async () => {
    const { h } = shop();
    assert.equal(h.base, "/api/orders");
    for (const [path, method] of [["/api/orders", "GET"], ["/api/order", "POST"], ["/api/orders/xyz", "GET"], ["/api/orders/" + "a".repeat(24) + "/x", "GET"], ["/api/me", "GET"]]) {
      assert.equal(await call(h, path, { method, player: "p1" }), null, `${method} ${path}`);
    }
    assert.throws(() => createShopHandler({ ...shop().h, store: createMemoryShop(), catalogue: LOOKS, payee: null, player: async () => null, base: "/api/" }), /base/);
  });

  test("a bad looks file throws at once, before any sale", () => {
    assert.throws(() => shop({ catalogue: [{ id: "x", name: "X", priceUsd: 1, change: { body: "#000000" } }] }), /free/);
  });

  test("a visitor who is not signed in gets 401; a POST from another page 403 (before anything else)", async () => {
    const { h } = shop();
    assert.equal((await call(h, "/api/orders", { body: { lookId: "red-coat" } }))!.status, 401);
    assert.deepEqual((await call(h, "/api/orders", { body: { lookId: "red-coat" } }))!.body, { error: "Sign in first." });
    const foreign = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1", origin: "https://evil.example" });
    assert.deepEqual([foreign!.status, foreign!.body], [403, { error: "This call must come from the game's own page." }]);
    assert.equal((await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1", origin: null }))!.status, 403, "no Origin and no Sec-Fetch-Site");
  });

  test("a new order: 201 and the pay view, with the creator's address and the exact amount in the link; the price is the server's", async () => {
    const { h } = shop();
    const r = await call(h, "/api/orders", { body: { lookId: "red-coat", priceUsd: 0.01, amount: "1" }, player: "p1" });
    assert.equal(r!.status, 201);
    assert.deepEqual(Object.keys(r!.body).sort(), ["address", "amount", "createdAt", "expiresAt", "id", "lookId", "prices", "status", "test", "uri", "usd", "xno"]);
    assert.match(r!.body.id, /^[0-9a-f]{24}$/);
    assert.deepEqual(
      { ...r!.body, id: "-" },
      { id: "-", lookId: "red-coat", usd: "0.25", amount: "250000000000000000000000000000", status: "open", createdAt: clock, expiresAt: clock + 15 * 60_000, xno: "0.25", test: false, address: creator, uri: `nano:${creator}?amount=250000000000000000000000000000`, prices: ["Test feed"] },
    );
    assert.equal(r!.res.headers.get("Cache-Control"), "no-store");
  });

  test("the order's own words for each refusal (the starter's)", async () => {
    const { h, store } = shop();
    const ask = (body: unknown, player = "p1") => call(h, "/api/orders", { body, player });
    assert.deepEqual((await ask({ lookId: "no-such" }))!.body, { error: "That look does not exist." });
    assert.deepEqual((await ask({ lookId: "plain" }))!.body, { error: "That look is free: it is already yours." });
    assert.deepEqual([(await ask("{not json"))!.status, (await ask("{not json"))!.body], [400, { error: "That request is not readable." }]);
    assert.equal((await ask("x".repeat(9000)))!.status, 400, "a body over 8 KB");
    // Owned already.
    const made = await ask({ lookId: "red-coat" });
    const o = (await store.order(made!.body.id))!;
    await store.settle(o, { hash: hash64(), payer: "p1", seenMs: clock }, clock);
    assert.deepEqual([(await ask({ lookId: "red-coat" }))!.status, (await ask({ lookId: "red-coat" }))!.body], [409, { error: "You already own this look." }]);
    // No price (a new store: the price above is kept 5 minutes).
    feedPrice = null;
    const fresh = shop().h;
    const none = await call(fresh, "/api/orders", { body: { lookId: "blue-cap" }, player: "p2" });
    assert.deepEqual([none!.status, none!.body], [503, { error: "Prices are not available now. Try again later." }]);
  });

  test("one waiting order per look comes back with the same amount; three open orders at most", async () => {
    const { h } = shop();
    const a = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
    const again = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
    assert.deepEqual([again!.status, again!.body.id, again!.body.amount], [200, a!.body.id, a!.body.amount]);
    await call(h, "/api/orders", { body: { lookId: "blue-cap" }, player: "p1" });
    await call(h, "/api/orders", { body: { lookId: "gold-crown" }, player: "p1" });
    const fourth = await call(h, "/api/orders", { body: { lookId: "wood-spade" }, player: "p1" });
    assert.deepEqual([fourth!.status, fourth!.body], [429, { error: "You have orders waiting. Pay one or wait until it ends." }]);
    // Another player at the same price gets the next free step (0.25 and 0.2501 are p1's red-coat and blue-cap).
    const b = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p2" });
    assert.equal(b!.body.xno, "0.2502");
  });

  test("the limit counts new orders per visitor, then the person check; the visitor hash is kept on the order", async () => {
    const seen: string[] = [];
    const { h, store } = shop({
      visitor: async () => "vhash",
      limit: (key) => (seen.push(key), seen.length <= 2),
      personCheck: async (token) => token === "good",
    });
    const bad = await call(h, "/api/orders", { body: { lookId: "red-coat", turnstile: "bad" }, player: "p1" });
    assert.deepEqual([bad!.status, bad!.body], [403, { error: "The person check failed. Try again." }]);
    const ok = await call(h, "/api/orders", { body: { lookId: "red-coat", turnstile: "good" }, player: "p1" });
    assert.equal(ok!.status, 201);
    assert.equal((await store.order(ok!.body.id))!.visitor, "vhash");
    const many = await call(h, "/api/orders", { body: { lookId: "blue-cap", turnstile: "good" }, player: "p1" });
    assert.deepEqual([many!.status, many!.body], [429, { error: "Too many orders. Wait a few minutes." }]);
    assert.deepEqual(seen, ["order|vhash", "order|vhash", "order|vhash"]);
  });

  test("every amount of a price held: 503 with the starter's words", async () => {
    const { h } = shop({ catalogue: [{ id: "free", name: "Free", priceUsd: 0, change: { body: "#ffffff" } }, { id: "tiny", name: "Tiny", priceUsd: 0.01, change: { body: "#000000" } }] });
    // $0.01 at $1 is 100 steps: 11 amounts.
    for (let i = 0; i < 11; i++) assert.equal((await call(h, "/api/orders", { body: { lookId: "tiny" }, player: `p${i}` }))!.status, 201);
    const r = await call(h, "/api/orders", { body: { lookId: "tiny" }, player: "p99" });
    assert.deepEqual([r!.status, r!.body], [503, { error: "Many players are paying this price right now. Try again in a minute." }]);
  });

  test("another player's order looks the same as no order at all; a GET of the check route, or a POST of the order, is not allowed", async () => {
    const { h } = shop();
    const made = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
    const path = `/api/orders/${made!.body.id}`;
    assert.equal((await call(h, path, { player: "p1" }))!.status, 200);
    assert.deepEqual([(await call(h, path, { player: "p2" }))!.status, (await call(h, path, { player: "p2" }))!.body], [404, { error: "No such order." }]);
    assert.equal((await call(h, path, { player: null }))!.status, 401);
    assert.equal((await call(h, `/api/orders/${"f".repeat(24)}`, { player: "p1" }))!.status, 404);
    assert.deepEqual((await call(h, `${path}/check`, { player: "p1" }))!.body, { error: "Not allowed." });
    assert.equal((await call(h, path, { player: "p1", body: {} }))!.status, 405);
  });

  test("the check route scans the creator's address and answers the paid order; the player then owns the look", async () => {
    const { h } = shop();
    const made = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
    node.sends.push({ hash: hash64(), from: testAddress(), to: creator, amount: made!.body.amount, seenMs: clock + 1000, confirmed: true });
    clock += SCAN_GAP_MS + 1;
    const r = await call(h, `/api/orders/${made!.body.id}/check`, { player: "p1", body: {} });
    assert.equal(r!.body.status, "paid");
    assert.deepEqual(await h.owned("p1"), ["red-coat"]);
    assert.deepEqual(await h.owned("p2"), []);
  });

  test("a store fault is a plain 500 that shows nothing of it; the game hears it", async () => {
    const broken = { ...createMemoryShop(), owns: async () => Promise.reject(new Error("SECRET-DB-DETAIL")) } as ShopStore;
    const { h, errors } = shop({}, broken);
    const r = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
    assert.deepEqual([r!.status, r!.body], [500, { error: "Something went wrong. Try again." }]);
    assert.match(String(errors[0]), /SECRET-DB-DETAIL/);
  });
});

describe("test mode", () => {
  for (const [why, o] of [
    ["no address", { payee: null }],
    ["the example address", { payee: EXAMPLE_ADDRESS }],
    ["an address with a wrong checksum", { payee: creator.slice(0, -1) + (creator.endsWith("1") ? "3" : "1") }],
    ["testMode with a real address", { testMode: true }],
  ] as [string, Partial<ShopHandlerOptions>][]) {
    test(`${why}: the pay view has NO address and NO link, and says test`, async () => {
      const { h } = shop(o);
      assert.equal(h.testMode, true);
      const r = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
      assert.equal(r!.status, 201);
      assert.equal(r!.body.test, true);
      assert.equal(r!.body.address, undefined);
      assert.equal(r!.body.uri, undefined);
      assert.ok(!JSON.stringify(r!.body).includes("nano:") && !JSON.stringify(r!.body).includes("nano_"), JSON.stringify(r!.body));
      const again = await call(h, `/api/orders/${r!.body.id}`, { player: "p1" });
      assert.ok(!JSON.stringify(again!.body).includes("nano_"));
    });
  }
});

if (!noSqlite)
  test("the same routes on the D1 adapter: an order, the same order again, and another player's 404", async () => {
    const { h } = shop({}, createD1Shop(d1Over(sqlite())));
    const a = await call(h, "/api/orders", { body: { lookId: "blue-cap" }, player: "p1" });
    assert.equal(a!.status, 201);
    assert.equal((await call(h, "/api/orders", { body: { lookId: "blue-cap" }, player: "p1" }))!.body.id, a!.body.id);
    assert.equal((await call(h, `/api/orders/${a!.body.id}`, { player: "p2" }))!.status, 404);
  });
