// The plays' routes (createShopHandler with `plays`): an order for a play, the ready list and the use, on the memory store and on D1 with the plays'
// migration, and through the Worker (createShop). Who may see and use a credit, test mode, the limits, the wait, and the answer that says nothing about
// the round. No real money: a mock node, and the store's own settle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before, beforeEach, describe } from "node:test";
import { createD1Shop } from "../src/shop/adapters/d1.js";
import { DEFAULT_LEGAL } from "../src/admin/legal.js";
import { DAY_MS, MAX_READY_PER_PLAY, SCAN_GAP_MS, SHOP_LIMITS, createMemoryShop, createShopHandler, forgetBlocks, forgetNodeHealth, type Fetch, type ShopHandlerOptions, type ShopStore } from "../src/shop/index.js";
import { createShop, type ShopEnv } from "../src/shop/worker.js";
import { LOOKS, MockNode, PLAYS_SQL, d1Over, hash64, noSqlite, sqlite, testAddress } from "./shop-helpers.js";

const ORIGIN = "https://game.example";
const PLAYS = [
  { id: "extra-round", name: "Extra round", priceUsd: 0.05, use: "round" },
  { id: "level-2", name: "Level 2", priceUsd: 0.1, use: "level", useWithinDays: 7 },
];
const creator = testAddress();
const node = new MockNode();
before(async () => void (await node.start()));
after(async () => void (await node.stop()));
/** A Legal card: the owner confirmed, 18 and up off. */
const OPEN = { ...DEFAULT_LEGAL, adultsOnly: false, lawsConfirmedAt: 1 };
const feed: Fetch = async () => new Response(JSON.stringify({ usd: 1 }), { status: 200 });
let clock = 1_800_000_000_000;

function shop(o: Partial<ShopHandlerOptions> = {}, store: ShopStore = createMemoryShop()) {
  const h = createShopHandler({
    store,
    catalogue: LOOKS,
    plays: PLAYS,
    payee: creator,
    player: async (req) => req.headers.get("X-Test-Player"),
    nodes: [{ name: "mock", url: node.url }],
    rate: { feeds: [{ name: "Test feed", url: "https://feed.test/", read: (j) => j.usd }], fetch: feed },
    rpc: { timeoutMs: 1000 },
    now: () => clock,
    // The Legal card of a game whose owner confirmed, with no age step: the cases below the Legal card's own test the rest.
    legal: () => OPEN,
    ...o,
  });
  return { h, store };
}

type Handler = { handle(r: Request): Promise<Response | null> };
async function call(h: Handler, path: string, o: { player?: string | null; body?: unknown; method?: string; origin?: string | null } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (o.player) headers.set("X-Test-Player", o.player);
  const origin = o.origin === undefined ? ORIGIN : o.origin;
  if (origin) headers.set("Origin", origin);
  const method = o.method ?? (o.body === undefined ? "GET" : "POST");
  const res = await h.handle(new Request(`${ORIGIN}${path}`, { method, headers, body: method === "GET" ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body ?? {}) }));
  if (!res) return null;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A paid play order of `player`, settled by the store as the scan would. */
async function paidPlay(h: Handler, store: ShopStore, player: string, playId = "extra-round") {
  const made = await call(h, "/api/orders", { body: { playId }, player });
  assert.equal(made!.status, 201, JSON.stringify(made!.body));
  const o = (await store.order(made!.body.id))!;
  assert.equal(await store.settle(o, { hash: hash64(), payer: player, seenMs: clock }, clock), "paid");
  return o;
}
const use = (h: Handler, player: string | null, body: unknown) => call(h, "/api/plays/use", { body, player });

beforeEach(() => {
  clock += 3_600_000 * 10;
  node.sends = [];
  node.mode = "ok";
  forgetNodeHealth();
  forgetBlocks();
});

describe("the plays' routes", () => {
  test("a bad plays.json throws at once, before any sale: a refused field, a use outside the list, a look's id", () => {
    assert.throws(() => shop({ plays: [{ ...PLAYS[0], prize: "gold" }] }), /a play buys one use of the game, nothing else/);
    assert.throws(() => shop({ plays: [{ ...PLAYS[0], use: "spin" }] }), /"use" must be one of round, level, life, continue/);
    assert.throws(() => shop({ plays: [{ ...PLAYS[0], id: "red-coat" }] }), /a look's id too/);
    assert.throws(() => shop({ plays: { "extra-round": 1 } }), /must be a list/);
    assert.throws(() => shop({ playsBase: "/api/orders" }), /playsBase/);
    assert.doesNotThrow(() => shop({ plays: undefined }));
  });

  test("no sign-in is 401 on every route; a POST from another page is 403; a wrong method 405; other paths are not the shop's", async () => {
    const { h } = shop();
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" } }))!.status, 401);
    assert.deepEqual((await call(h, "/api/plays"))!.body, { error: "Sign in first." });
    assert.equal((await use(h, null, { playId: "extra-round", ref: "r1" }))!.status, 401);
    assert.equal((await call(h, "/api/plays/use", { body: { playId: "extra-round", ref: "r1" }, player: "p1", origin: "https://evil.example" }))!.status, 403);
    assert.equal((await call(h, "/api/plays", { body: {}, player: "p1" }))!.status, 405);
    assert.equal((await call(h, "/api/plays/use", { player: "p1" }))!.status, 405);
    for (const path of ["/api/plays/x", "/api/plays/use/x", "/api/play"]) assert.equal(await call(h, path, { player: "p1" }), null, path);
  });

  test("an order for a play: 201, the server's price, kind and playId; exactly one of lookId and playId", async () => {
    const { h, store } = shop();
    const r = await call(h, "/api/orders", { body: { playId: "extra-round", priceUsd: 0.0001, amount: "1" }, player: "p1" });
    assert.equal(r!.status, 201);
    assert.deepEqual(Object.keys(r!.body).sort(), ["address", "amount", "createdAt", "expiresAt", "id", "kind", "lookId", "playId", "prices", "refund", "status", "test", "uri", "usd", "xno"]);
    assert.deepEqual([r!.body.kind, r!.body.playId, r!.body.lookId, r!.body.usd, r!.body.xno, r!.body.uri], ["play", "extra-round", "extra-round", "0.05", "0.05", `nano:${creator}?amount=50000000000000000000000000000`]);
    assert.equal((await store.order(r!.body.id))!.kind, "play");
    assert.equal((await call(h, `/api/orders/${r!.body.id}`, { player: "p1" }))!.body.kind, "play", "the order's own view says so too");
    assert.deepEqual((await call(h, "/api/orders", { body: { playId: "extra-round", lookId: "red-coat" }, player: "p1" }))!.body, { error: "Send a lookId or a playId, not both." });
    assert.deepEqual((await call(h, "/api/orders", { body: { playId: "no-such" }, player: "p1" }))!.body, { error: "That play does not exist." });
    assert.deepEqual((await call(h, "/api/orders", { body: { playId: "red-coat" }, player: "p1" }))!.body, { error: "That play does not exist." }, "a look's id is not a play");
    assert.deepEqual((await call(h, "/api/orders", { body: { lookId: "extra-round" }, player: "p1" }))!.body, { error: "That look does not exist." }, "a play's id is not a look");
    // A look order's view is the same as before: no kind.
    assert.equal((await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" }))!.body.kind, undefined);
    // One waiting order per play comes back with the same amount.
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.id, r!.body.id);
  });

  test("test mode: a play's pay view has NO address and NO link", async () => {
    for (const o of [{ payee: null }, { testMode: true }] as Partial<ShopHandlerOptions>[]) {
      const { h } = shop(o);
      const r = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
      assert.equal(r!.status, 201);
      assert.equal(r!.body.test, true);
      assert.equal(r!.body.address, undefined);
      assert.equal(r!.body.uri, undefined);
      assert.ok(!JSON.stringify(r!.body).includes("nano:") && !JSON.stringify(r!.body).includes("nano_"), JSON.stringify(r!.body));
    }
  });

  test("a paid play (the check route against a mock node) gives one ready credit and no look", async () => {
    const { h } = shop();
    assert.deepEqual((await call(h, "/api/plays", { player: "p1" }))!.body, { plays: [{ playId: "extra-round", ready: 0, forSale: true }, { playId: "level-2", ready: 0, forSale: true }] });
    const made = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    node.sends.push({ hash: hash64(), from: testAddress(), to: creator, amount: made!.body.amount, seenMs: clock + 1000, confirmed: true });
    clock += SCAN_GAP_MS + 1;
    assert.equal((await call(h, `/api/orders/${made!.body.id}/check`, { player: "p1", body: {} }))!.body.status, "paid");
    assert.deepEqual((await call(h, "/api/plays", { player: "p1" }))!.body, { plays: [{ playId: "extra-round", ready: 1, forSale: true }, { playId: "level-2", ready: 0, forSale: true }] });
    assert.deepEqual((await call(h, "/api/plays", { player: "p2" }))!.body.plays[0], { playId: "extra-round", ready: 0, forSale: true }, "the player's own only");
    assert.deepEqual(await h.owned("p1"), []);
  });

  test("a late payment gives no credit", async () => {
    const { h } = shop();
    const made = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    node.sends.push({ hash: hash64(), from: testAddress(), to: creator, amount: made!.body.amount, seenMs: made!.body.expiresAt + 10 * 60_000, confirmed: true });
    clock = made!.body.expiresAt + 11 * 60_000;
    assert.equal((await call(h, `/api/orders/${made!.body.id}/check`, { player: "p1", body: {} }))!.body.status, "paid_late");
    assert.equal((await call(h, "/api/plays", { player: "p1" }))!.body.plays[0].ready, 0);
  });

  test("the use: 402 with none, 200 { used, again } and only those keys, once for each ref; 409 a ref of another play; 400 a bad ref", async () => {
    const { h, store } = shop();
    assert.deepEqual([(await use(h, "p1", { playId: "extra-round", ref: "round-1" }))!.status, (await use(h, "p1", { playId: "extra-round", ref: "round-1" }))!.body], [402, { error: "No round is ready. Buy one first." }]);
    assert.deepEqual((await use(h, "p1", { playId: "level-2", ref: "round-1" }))!.body, { error: "No level is ready. Buy one first." });
    await paidPlay(h, store, "p1");
    const first = await use(h, "p1", { playId: "extra-round", ref: "round-1" });
    assert.equal(first!.status, 200);
    assert.deepEqual(Object.keys(first!.body).sort(), ["again", "used"], "the answer says nothing about the round");
    assert.deepEqual(first!.body, { used: true, again: false });
    assert.deepEqual((await use(h, "p1", { playId: "extra-round", ref: "round-1" }))!.body, { used: true, again: true }, "the same ref again: the same answer");
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "round-2" }))!.status, 402, "a new ref needs a new credit");
    assert.deepEqual([(await use(h, "p1", { playId: "level-2", ref: "round-1" }))!.status, (await use(h, "p1", { playId: "level-2", ref: "round-1" }))!.body], [409, { error: "That round id was used for another play." }]);
    for (const ref of ["", "a b", "x".repeat(65), "a/b", 7, null, undefined]) assert.deepEqual((await use(h, "p1", { playId: "extra-round", ref }))!.body, { error: "That round id is not right." }, String(ref));
    assert.deepEqual((await use(h, "p1", { playId: "no-such", ref: "r" }))!.body, { error: "That play does not exist." });
    assert.equal((await use(h, "p1", "{not json"))!.status, 400);
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "x".repeat(64) }))!.status, 402, "64 characters is a good ref");
  });

  test("another player's credit looks like none", async () => {
    const { h, store } = shop();
    await paidPlay(h, store, "p1");
    assert.equal((await use(h, "p2", { playId: "extra-round", ref: "round-1" }))!.status, 402);
    assert.deepEqual((await use(h, "p1", { playId: "extra-round", ref: "round-1" }))!.body, { used: true, again: false });
    assert.equal((await use(h, "p2", { playId: "extra-round", ref: "round-1" }))!.status, 402, "p1's ref is not p2's");
  });

  test(`at most ${MAX_READY_PER_PLAY} credits of one play wait: the next order is 409 until one is used`, async () => {
    const { h, store } = shop({ limit: () => true });
    for (let i = 0; i < MAX_READY_PER_PLAY; i++) await paidPlay(h, store, "p1");
    const r = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual([r!.status, r!.body], [409, { error: "You have 5 rounds ready. Play one first." }]);
    assert.equal((await call(h, "/api/orders", { body: { playId: "level-2" }, player: "p1" }))!.status, 201, "another play is counted apart");
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "r-1" }))!.status, 200);
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.status, 201);
  });

  test(`the cap of ${MAX_READY_PER_PLAY} counts the play's open orders too: ready credits and orders that may still be paid stay under it`, async () => {
    const { h, store } = shop({ limit: () => true });
    for (let i = 0; i < MAX_READY_PER_PLAY - 1; i++) await paidPlay(h, store, "p1");
    const open = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.equal(open!.status, 201, "four ready and none open: one more order");
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.id, open!.body.id, "the same order comes back");
    // Its last minute: it is no longer offered again, but it may still be paid, so it still counts.
    clock = open!.body.expiresAt - 30_000;
    const r = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual([r!.status, r!.body], [409, { error: "You have 5 rounds ready or waiting for a payment. Play one first." }]);
    assert.equal((await call(h, "/api/orders", { body: { playId: "level-2" }, player: "p1" }))!.status, 201, "another play is counted apart");
    clock = open!.body.expiresAt + 1;
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.status, 201, "once it ended, a new order");
  });

  test("a credit past its wait (useWithinDays, default 30) is not ready and cannot be used", async () => {
    const { h, store } = shop();
    await paidPlay(h, store, "p1");
    await paidPlay(h, store, "p1", "level-2");
    clock += 7 * DAY_MS + 1;
    assert.deepEqual((await call(h, "/api/plays", { player: "p1" }))!.body.plays, [{ playId: "extra-round", ready: 1, forSale: true }, { playId: "level-2", ready: 0, forSale: true }]);
    assert.equal((await use(h, "p1", { playId: "level-2", ref: "r-1" }))!.status, 402, "level-2 waits 7 days");
    clock += 23 * DAY_MS;
    assert.equal((await call(h, "/api/plays", { player: "p1" }))!.body.plays[0].ready, 0);
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "r-2" }))!.status, 402, "extra-round waits 30 days");
  });

  test("a credit keeps the end it got when it was paid: a later plays.json with another useWithinDays moves no end", async () => {
    const store = createMemoryShop();
    const { h } = shop({}, store);
    await paidPlay(h, store, "p1", "level-2");
    const paidAt = clock;
    // The creator gives level-2 30 days, then 1 day: the credit paid with 7 keeps 7.
    const longer = shop({ plays: [PLAYS[0], { ...PLAYS[1], useWithinDays: 30 }] }, store).h;
    const shorter = shop({ plays: [PLAYS[0], { ...PLAYS[1], useWithinDays: 1 }] }, store).h;
    clock = paidAt + 2 * DAY_MS;
    assert.equal((await call(shorter, "/api/plays", { player: "p1" }))!.body.plays[1].ready, 1, "a shorter wait now does not end it early");
    clock = paidAt + 7 * DAY_MS + 1;
    assert.equal((await call(longer, "/api/plays", { player: "p1" }))!.body.plays[1].ready, 0, "a longer wait now does not make it last longer");
    assert.equal((await use(longer, "p1", { playId: "level-2", ref: "r-1" }))!.status, 402);
    const [c] = [...store.creditRows.values()];
    assert.deepEqual([c.grantedAt, c.expiresAt], [paidAt, paidAt + 7 * DAY_MS]);
    // A play that left plays.json: its credit cannot be used, and is not listed for the player.
    await paidPlay(h, store, "p2");
    const gone = shop({ plays: [PLAYS[1]] }, store).h;
    assert.deepEqual((await call(gone, "/api/plays", { player: "p2" }))!.body.plays, [{ playId: "level-2", ready: 0, forSale: true }]);
    assert.equal((await use(gone, "p2", { playId: "extra-round", ref: "r-1" }))!.status, 400);
  });

  test(`uses have their own limit (${SHOP_LIMITS.use.limit} a minute for a player), beside the orders'`, async () => {
    const keys: string[] = [];
    const { h } = shop({ limit: (key, limit, windowMs) => (keys.push(`${key} ${limit}/${windowMs}`), !(key.startsWith("use|") && keys.filter((k) => k.startsWith("use|")).length > 2)) });
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "r1" }))!.status, 402);
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "r2" }))!.status, 402);
    assert.deepEqual([(await use(h, "p1", { playId: "extra-round", ref: "r3" }))!.status, (await use(h, "p1", { playId: "extra-round", ref: "r3" }))!.body], [429, { error: "Too many tries. Wait a minute." }]);
    assert.deepEqual(keys[0], "use|p1 60/60000");
    // The default limiter, in memory: the 61st use in one minute is refused.
    const fresh = shop().h;
    let last = 0;
    for (let i = 0; i <= SHOP_LIMITS.use.limit; i++) last = (await use(fresh, "p-limit", { playId: "extra-round", ref: `r${i}` }))!.status;
    assert.equal(last, 429);
  });

  test("the server calls: use(player, playId, ref) and ready(player), for a game's own round route", async () => {
    const { h, store } = shop();
    assert.deepEqual(await h.use("p1", "extra-round", "r1"), { used: false, why: "none" });
    await paidPlay(h, store, "p1");
    assert.deepEqual(await h.ready("p1"), [{ playId: "extra-round", ready: 1 }, { playId: "level-2", ready: 0 }]);
    assert.deepEqual(await h.use("p1", "extra-round", "r1"), { used: true, again: false });
    assert.deepEqual(await h.use("p1", "extra-round", "r1"), { used: true, again: true });
    assert.deepEqual(await h.use("p1", "level-2", "r1"), { used: false, why: "other-play" });
    assert.deepEqual(await h.use("p1", "extra-round", "bad ref"), { used: false, why: "bad-ref" });
    assert.deepEqual(await h.use("p1", "nope", "r2"), { used: false, why: "no-play" });
    assert.equal(h.playsBase, "/api/plays");
  });

  test("a game with no plays: the list is empty and a play order or a use is refused", async () => {
    const { h } = shop({ plays: undefined });
    assert.deepEqual((await call(h, "/api/plays", { player: "p1" }))!.body, { plays: [] });
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.status, 400);
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "r1" }))!.status, 400);
  });
});

describe("the creator's Legal card in the shop", () => {
  const LIVES = [...PLAYS, { id: "extra-life", name: "Extra life", priceUsd: 0.02, use: "life" }, { id: "go-on", name: "Continue", priceUsd: 0.03, use: "continue" }];
  /** The store's rows as text: a refused order must write nothing (no order, no held amount, no credit, no yes). */
  const rows = (store: ReturnType<typeof createMemoryShop>) => JSON.stringify([[...store.orders.values()], [...store.creditRows.values()], [...store.adultRows]]);

  test("18 and up (the default): the first play order asks for the yes (403 needs age) and writes nothing; POST adult keeps it once; then the order is made", async () => {
    const store = createMemoryShop();
    const keys: string[] = [];
    const { h } = shop({ legal: () => ({ ...DEFAULT_LEGAL, lawsConfirmedAt: 1 }), limit: (key) => (keys.push(key), true) }, store);
    const before = rows(store);
    const no = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual([no!.status, no!.body], [403, { error: "Paid rounds are for players 18 and up.", needs: "age" }]);
    assert.equal(rows(store), before, "nothing was written");
    assert.deepEqual(keys, [], "nothing was counted either");
    // A look needs no yes.
    assert.equal((await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" }))!.status, 201);
    // The yes: only { adult: true }, from the game's own page, signed in.
    for (const body of [{}, { adult: "yes" }, { adult: 1 }, "not json"]) assert.equal((await call(h, "/api/plays/adult", { body, player: "p1" }))!.status, 400, JSON.stringify(body));
    assert.equal((await call(h, "/api/plays/adult", { body: { adult: true } }))!.status, 401);
    assert.equal((await call(h, "/api/plays/adult", { body: { adult: true }, player: "p1", origin: "https://evil.example" }))!.status, 403);
    assert.equal((await call(h, "/api/plays/adult", { player: "p1" }))!.status, 405);
    assert.equal(await store.adult("p1"), null);
    const yes = await call(h, "/api/plays/adult", { body: { adult: true }, player: "p1" });
    assert.deepEqual([yes!.status, yes!.body], [200, { adult: true }]);
    assert.equal(await store.adult("p1"), clock);
    assert.ok(keys.includes("adult|p1"), "the yes is limited for each player");
    const made = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.equal(made!.status, 201);
    // Another player still has to say it; the yes is the player's own.
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p2" }))!.body.needs, "age");
    // Off: no step at all.
    const { h: off } = shop({ legal: () => OPEN });
    assert.equal((await call(off, "/api/orders", { body: { playId: "extra-round" }, player: "p3" }))!.status, 201);
  });

  test("the yes: a limit for each player, and a game with no plays has none to give", async () => {
    let n = 0;
    const { h } = shop({ limit: (key, limit) => !key.startsWith("adult|") || ++n <= limit });
    for (let i = 0; i < SHOP_LIMITS.adult.limit; i++) assert.equal((await call(h, "/api/plays/adult", { body: { adult: true }, player: "p1" }))!.status, 200);
    assert.deepEqual((await call(h, "/api/plays/adult", { body: { adult: true }, player: "p1" }))!.body, { error: "Too many tries. Wait a few minutes." });
    const { h: none } = shop({ plays: undefined });
    assert.equal((await call(none, "/api/plays/adult", { body: { adult: true }, player: "p1" }))!.status, 400);
  });

  test("the refund rule: a play's order answer carries the creator's words with the days, the same order again too; a look's and a GET's do not", async () => {
    const { h } = shop({ legal: () => ({ ...OPEN, refundDays: 7, refundWords: "Ask me within {days} days." }) });
    const r = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual(r!.body.refund, { days: 7, text: "Ask me within 7 days." });
    assert.deepEqual((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.refund, { days: 7, text: "Ask me within 7 days." });
    assert.equal((await call(h, `/api/orders/${r!.body.id}`, { player: "p1" }))!.body.refund, undefined);
    assert.equal((await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" }))!.body.refund, undefined);
    const { h: plain } = shop({ legal: () => ({ ...DEFAULT_LEGAL, adultsOnly: false, lawsConfirmedAt: 1 }) });
    assert.equal((await call(plain, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.refund.text, "Not used? Ask for your money back within 14 days. Write to the game's owner.");
  });

  test("a life or a continue: refused while the switch is off (nothing written, forSale false); on sale when it is on; a credit paid before stays usable", async () => {
    let legal = { ...OPEN, sellLives: true };
    const store = createMemoryShop();
    const { h } = shop({ plays: LIVES, legal: () => legal }, store);
    await paidPlay(h, store, "p1", "extra-life");
    assert.equal((await call(h, "/api/orders", { body: { playId: "go-on" }, player: "p1" }))!.status, 201, "on: on sale");
    legal = { ...OPEN, sellLives: false };
    const before = rows(store);
    for (const playId of ["extra-life"]) {
      const no = await call(h, "/api/orders", { body: { playId }, player: "p2" });
      assert.deepEqual([no!.status, no!.body], [403, { error: "This game does not sell a life now.", reason: "not_for_sale" }]);
    }
    assert.deepEqual((await call(h, "/api/orders", { body: { playId: "go-on" }, player: "p2" }))!.body.reason, "not_for_sale");
    assert.equal(rows(store), before, "nothing was written");
    assert.deepEqual((await call(h, "/api/plays", { player: "p1" }))!.body.plays.map((p: { playId: string; forSale: boolean; ready: number }) => [p.playId, p.forSale, p.ready]), [["extra-round", true, 0], ["level-2", true, 0], ["extra-life", false, 1], ["go-on", false, 0]]);
    assert.deepEqual((await use(h, "p1", { playId: "extra-life", ref: "round-1" }))!.body, { used: true, again: false }, "the life paid before is still used");
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p2" }))!.status, 201, "a round is not held back");
    assert.deepEqual(await h.refusal("p2", "go-on"), { status: 403, error: "This game does not sell a continue now.", reason: "not_for_sale" });
    assert.equal(await h.refusal("p2", "extra-round"), null);
  });

  test("the owner's confirmation: outside test mode no play order until the owner confirmed (403 reason owner, nothing written); test mode and looks are not affected", async () => {
    const store = createMemoryShop();
    const { h } = shop({ legal: () => ({ ...OPEN, lawsConfirmedAt: null }) }, store);
    const before = rows(store);
    const no = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual([no!.status, no!.body], [403, { error: "The owner has not turned paid rounds on yet.", reason: "owner" }]);
    assert.equal(rows(store), before);
    assert.deepEqual((await call(h, "/api/plays", { player: "p1" }))!.body.plays.map((p: { forSale: boolean }) => p.forSale), [false, false]);
    assert.equal((await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" }))!.status, 201, "a look is not affected");
    const { h: test } = shop({ testMode: true, legal: () => ({ ...OPEN, lawsConfirmedAt: null }) });
    assert.equal((await call(test, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.status, 201, "test mode sells (nothing can be paid)");
  });

  test("no Legal hook, or a fault in it: the careful defaults (18 and up, no life or continue, no confirmation), told to onError", async () => {
    const errors: unknown[] = [];
    const store = createMemoryShop();
    const { h } = shop({ plays: LIVES, legal: undefined, testMode: true }, store);
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.needs, "age");
    await store.keepAdult("p1", clock);
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-life" }, player: "p1" }))!.body.reason, "not_for_sale");
    assert.equal((await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.status, 201);
    const { h: live } = shop({ legal: undefined });
    assert.equal((await call(live, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.reason, "owner");
    const { h: broken } = shop({ legal: () => { throw new Error("admin store down"); }, onError: (e) => errors.push(e) });
    assert.equal((await call(broken, "/api/orders", { body: { playId: "extra-round" }, player: "p1" }))!.body.reason, "owner");
    assert.match(String(errors[0]), /admin store down/);
  });

  test("the Legal card is read only for plays: a look's order, its view and its check never call it", async () => {
    let reads = 0;
    const { h } = shop({ plays: undefined, legal: () => (reads++, OPEN) });
    const r = await call(h, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" });
    await call(h, `/api/orders/${r!.body.id}`, { player: "p1" });
    await call(h, "/api/plays", { player: "p1" });
    assert.equal(reads, 0);
  });
});

if (!noSqlite) {
  const STARTER = readFileSync(new URL("./fixtures/starter-0001_init.sql", import.meta.url), "utf8");

  test("the same routes on D1 with the plays' migration: a paid play, one use, again, none", async () => {
    const db = sqlite(`${STARTER}\n${PLAYS_SQL}`);
    const { h, store } = shop({}, createD1Shop(d1Over(db), { plays: true }));
    await paidPlay(h, store, "p1");
    assert.equal((await call(h, "/api/plays", { player: "p1" }))!.body.plays[0].ready, 1);
    const all = await Promise.all(Array.from({ length: 5 }, () => use(h, "p1", { playId: "extra-round", ref: "round-1" })));
    assert.deepEqual(all.map((r) => r!.body.again).sort(), [false, true, true, true, true], "one use for one ref, also at once");
    assert.equal((await use(h, "p1", { playId: "extra-round", ref: "round-2" }))!.status, 402);
  });

  test("a D1 store with no plays' migration refuses a play order with a plain 500, before any payment", async () => {
    const errors: unknown[] = [];
    const { h, store } = shop({ onError: (e) => errors.push(e) }, createD1Shop(d1Over(sqlite(STARTER))));
    const r = await call(h, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual([r!.status, r!.body], [500, { error: "Something went wrong. Try again." }]);
    assert.match(String(errors[0]), /d1-plays\.sql/);
    assert.equal((await store.held()).length, 0, "nothing is held: nothing can be paid");
  });

  test("the Worker (createShop): with plays it uses the plays' tables; with none, the starter's tables as they are", async () => {
    const rate = { fetch: async () => new Response(JSON.stringify({ nano: { usd: 1 }, result: { X: { c: ["1"] } }, data: { price: "1" } })) };
    const player = async (req: Request) => req.headers.get("X-Test-Player");
    const env = (sql: string): ShopEnv => ({ DB: d1Over(sqlite(sql)), RECEIVE_ADDRESS: creator, TEST_MODE: "on" });
    const withPlays = createShop(env(`${STARTER}\n${PLAYS_SQL}`), { catalogue: LOOKS, plays: PLAYS, legal: () => OPEN, player, rate, now: () => clock });
    const r = await call(withPlays, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.deepEqual([r!.status, r!.body.kind, r!.body.test, r!.body.address], [201, "play", true, undefined]);
    const o = (await withPlays.store.order(r!.body.id))!;
    await withPlays.store.settle(o, { hash: hash64(), payer: "p1", seenMs: clock }, clock);
    assert.deepEqual(await withPlays.use("p1", "extra-round", "r1"), { used: true, again: false });
    const looksOnly = createShop(env(STARTER), { catalogue: LOOKS, player, rate, now: () => clock });
    assert.equal((await call(looksOnly, "/api/orders", { body: { lookId: "red-coat" }, player: "p1" }))!.status, 201);
    assert.deepEqual((await call(looksOnly, "/api/plays", { player: "p1" }))!.body, { plays: [] });
    assert.throws(() => createShop(env(STARTER), { catalogue: LOOKS, plays: [{ ...PLAYS[0], odds: 0.5 }], player }), /nothing else/);
  });

  test("the Worker (createShop): the D1 limits of uses, yeses and orders keep no player's id in `hits` (a salted hash), and still count", async () => {
    const rate = { fetch: async () => new Response(JSON.stringify({ nano: { usd: 1 }, result: { X: { c: ["1"] } }, data: { price: "1" } })) };
    const player = async (req: Request) => req.headers.get("X-Test-Player");
    const db = sqlite(`${STARTER}\n${PLAYS_SQL}`);
    const shopped = createShop({ DB: d1Over(db), RECEIVE_ADDRESS: creator, TEST_MODE: "on" }, { catalogue: LOOKS, plays: PLAYS, legal: () => ({ ...OPEN, adultsOnly: true }), player, rate, now: () => clock });
    const who = "player-id-7f3e";
    for (let i = 0; i < 3; i++) assert.equal((await use(shopped, who, { playId: "extra-round", ref: `r-${i}` }))!.status, 402);
    assert.equal((await call(shopped, "/api/plays/adult", { body: { adult: true }, player: who }))!.status, 200);
    assert.equal((await call(shopped, "/api/orders", { body: { playId: "extra-round" }, player: who }))!.status, 201);
    const rows = db.prepare("SELECT key, count FROM hits ORDER BY key").all() as { key: string; count: number }[];
    assert.ok(rows.every((r) => !r.key.includes(who)), JSON.stringify(rows));
    assert.deepEqual(rows.map((r) => [r.key.split("|")[0], /^[a-z]+\|[0-9a-f]{32}$/.test(r.key), r.count]), [["adult", true, 1], ["order", true, 1], ["use", true, 3]]);
  });

  test("the Worker (createShop): plays sold, then plays.json emptied: the held play order, paid, gives a credit and never a look, and forget deletes it", async () => {
    const rate = { fetch: async () => new Response(JSON.stringify({ nano: { usd: 1 }, result: { X: { c: ["1"] } }, data: { price: "1" } })) };
    const player = async (req: Request) => req.headers.get("X-Test-Player");
    const db = sqlite(`${STARTER}\n${PLAYS_SQL}`);
    const env: ShopEnv = { DB: d1Over(db), RECEIVE_ADDRESS: creator, TEST_MODE: "on" };
    const selling = createShop(env, { catalogue: LOOKS, plays: PLAYS, legal: () => OPEN, player, rate, now: () => clock });
    const r = await call(selling, "/api/orders", { body: { playId: "extra-round" }, player: "p1" });
    assert.equal(r!.status, 201);
    for (const plays of [[], undefined]) {
      const emptied = createShop(env, { catalogue: LOOKS, plays, player, rate, now: () => clock });
      assert.equal((await emptied.store.order(r!.body.id))?.kind, "play", "the order still reads as a play");
    }
    const emptied = createShop(env, { catalogue: LOOKS, plays: [], player, rate, now: () => clock });
    const o = (await emptied.store.order(r!.body.id))!;
    assert.equal(await emptied.store.settle(o, { hash: hash64(), payer: "nano_another_wallet", seenMs: clock }, clock), "paid");
    assert.deepEqual(await emptied.owned("p1"), [], "no owned look");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM owned").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM credits WHERE player = 'p1' AND used_at IS NULL").get() as { n: number }).n, 1, "the credit is there");
    assert.deepEqual(await emptied.use("p1", "extra-round", "r1"), { used: false, why: "no-play" }, "a play that left plays.json is not used");
    const f = await emptied.store.forget("p1", o.holdUntil + 1);
    assert.deepEqual(f, { deleted: 1, kept: 1, waitUntil: null });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM credits").get() as { n: number }).n, 0, "forget deleted the credit");
  });
}
