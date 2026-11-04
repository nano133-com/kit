// The unmatched payments (findUnmatched): the receives on the creator's address that no order recorded, from ONE account_history read on the game's own
// nodes. A paid and a paid-late payment are matched and never listed; a second payment of a paid amount, a wrong amount and a payment with no order are
// listed; sends, dust, unconfirmed receives, receives older than the shop and receives an open order may still take are not. A node failure lists
// nothing ("not read"). It runs on the memory, D1 (SQLite) and Firestore (the fake) stores. No real network: a mock fetch answers for the node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { createD1Shop } from "../src/shop/adapters/d1.js";
import { createFirestoreShop } from "../src/shop/adapters/firestore.js";
import { CLOCK_SLACK_MS, ORDER_TTL_MS, STEP_RAW, UNMATCHED_ENTRIES, createMemoryShop, findUnmatched, forgetNodeHealth, priceRaw, reserveOrder, type ShopStore } from "../src/shop/index.js";
import { createShop } from "../src/shop/worker.js";
import { LOOKS, d1Over, fakeFirestore, hash64, noSqlite, sqlite, testAddress } from "./shop-helpers.js";

const creator = testAddress();
const buyer = testAddress();
const stranger = testAddress();
const T0 = 1_800_000_000_000;
const NODE = { name: "mock", url: "https://node.example/rpc" };
const sec = (ms: number) => String(Math.floor(ms / 1000));

type Entry = Record<string, unknown>;
const receive = (amount: string, at: number, extra: Entry = {}): Entry => ({ type: "state", subtype: "receive", account: buyer, amount, link: hash64(), hash: hash64(), local_timestamp: sec(at), confirmed: "true", ...extra });
const sendOut = (to: string, amount: string, at: number): Entry => ({ type: "state", subtype: "send", account: to, amount, link: hash64(), hash: hash64(), local_timestamp: sec(at), confirmed: "true" });

/** A mock node: answers account_history with `answer` (or throws, or an error), and keeps every call. */
function mockNode(answer: (body: Record<string, unknown>) => unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, body });
    const a = answer(body);
    if (a instanceof Error) throw a;
    if (a instanceof Response) return a;
    return new Response(JSON.stringify(a), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, rpc: { fetch, timeoutMs: 1000 } };
}

const stores: [string, () => ShopStore][] = [
  ["memory", () => createMemoryShop()],
  ["D1", () => createD1Shop(d1Over(sqlite()))],
  ["Firestore", () => createFirestoreShop(fakeFirestore().db)],
];

for (const [name, make] of stores) {
  if (name === "D1" && noSqlite) continue;
  describe(`the unmatched payments (${name})`, () => {
    test("a mock history of matched, late, unmatched receives and sends: only the unmatched receives are listed, newest first, with hash, sender, amount and time", async () => {
      forgetNodeHealth();
      const store = make();
      const price = priceRaw(0.25, 1)!;
      const order = (now: number) => reserveOrder(store, { player: buyer, lookId: "red-coat", usd: "0.25", rate: 1, price, visitor: null, now });
      const paid = await order(T0);
      const late = await order(T0);
      const held = await order(T0 + 60_000);
      assert.notEqual(paid.amount, late.amount);
      const paidHash = hash64();
      const lateHash = hash64();
      assert.equal(await store.settle(paid, { hash: paidHash, payer: buyer, seenMs: T0 + 1000 }, T0 + 2000), "paid");
      assert.equal(await store.settle(late, { hash: lateHash, payer: buyer, seenMs: T0 + ORDER_TTL_MS + CLOCK_SLACK_MS + 60_000 }, T0 + ORDER_TTL_MS + CLOCK_SLACK_MS + 61_000), "paid_late");

      const wrong = (3333n * STEP_RAW).toString(); // 0.3333 XNO: no order asks for it
      const second = receive(paid.amount, T0 + 300_000); // the same amount again, after the order was paid
      const wrongIn = receive(wrong, T0 + 400_000, { account: stranger.replace(/^nano_/, "xrb_") });
      const history: Entry[] = [
        sendOut(stranger, wrong, T0 + 900_000), // the creator sent the wrong amount back
        receive("1", T0 + 800_000), // dust
        receive(held.amount, T0 + 700_000), // an open order's amount: the payment check decides it
        receive(wrong, T0 + 650_000, { confirmed: "false" }), // not confirmed
        sendOut(testAddress(), (5n * STEP_RAW).toString(), T0 + 600_000), // the creator paid someone
        receive(late.amount, T0 + ORDER_TTL_MS + CLOCK_SLACK_MS + 60_000, { link: lateHash }), // paid late: matched
        wrongIn,
        second,
        receive(paid.amount, T0 + 1000, { link: paidHash.toLowerCase() }), // paid: matched (any case)
        receive((7n * STEP_RAW).toString(), T0 + 500_000, { local_timestamp: "0" }), // the node keeps no time for it
        receive(paid.amount, T0 - CLOCK_SLACK_MS - 60_000), // older than the shop: the read ends here
        receive(wrong, T0 + 100_000), // after the end: never read
      ];
      const node = mockNode(() => ({ account: creator, history }));
      const r = await findUnmatched(store, { address: creator, nodes: [NODE], since: T0, rpc: node.rpc });
      assert.equal(r.read, true);
      if (!r.read) return;
      assert.deepEqual(r.payments, [
        { hash: String(wrongIn.link), sender: stranger, amountRaw: wrong, xno: "0.3333", at: Number(sec(T0 + 400_000)) * 1000, sentBack: true },
        { hash: String(second.link), sender: buyer, amountRaw: paid.amount, xno: "0.25", at: Number(sec(T0 + 300_000)) * 1000, sentBack: false },
      ]);
      assert.equal(r.waiting, 1);
      assert.equal(r.since, T0);
      assert.equal(r.more, false, "the read reached the shop's first order");
      assert.equal(r.entries, history.length);
      // ONE read, of this address, on the game's node, bounded; nothing else is asked.
      assert.deepEqual(node.calls, [{ url: NODE.url, body: { action: "account_history", account: creator, count: String(UNMATCHED_ENTRIES), raw: "true" } }]);
    });
  });
}

test("a node failure lists nothing: no answer, an error, an HTTP fault, a list that is not a history, another address's history", async () => {
  const store = createMemoryShop();
  const answers: (() => unknown)[] = [
    () => new Error("connection refused"),
    () => ({ error: "Internal server error" }),
    () => new Response("oops", { status: 500 }),
    () => ({ account: creator, history: { not: "a list" } }),
    () => ({ account: testAddress(), history: [receive((3n * STEP_RAW).toString(), T0 + 1000)] }),
  ];
  for (const a of answers) {
    forgetNodeHealth();
    const r = await findUnmatched(store, { address: creator, nodes: [NODE, { name: "second", url: "https://node2.example/rpc" }], since: T0, rpc: mockNode(a).rpc });
    assert.equal(r.read, false, JSON.stringify(a()));
    assert.ok(!("payments" in r));
  }
  const failing: Pick<ShopStore, "usedHashes" | "held"> = { usedHashes: async () => Promise.reject(new Error("db down")), held: async () => [] };
  const r = await findUnmatched(failing, { address: creator, nodes: [NODE], since: T0, rpc: mockNode(() => ({ account: creator, history: [receive((3n * STEP_RAW).toString(), T0 + 1000)] })).rpc });
  assert.deepEqual(r, { read: false, error: "db down" }, "a store that cannot be read lists nothing either");
});

test("no address, no order, a new address: no read when there is nothing to compare; an empty list only when the node said so", async () => {
  const store = createMemoryShop();
  const node = mockNode(() => ({ error: "Account not found" }));
  assert.equal((await findUnmatched(store, { address: null, nodes: [NODE], since: T0, rpc: node.rpc })).read, false);
  assert.deepEqual(await findUnmatched(store, { address: creator, nodes: [NODE], since: null, rpc: node.rpc }), { read: true, payments: [], since: null, entries: 0, more: false, waiting: 0 });
  assert.equal(node.calls.length, 0, "no order: the node is not asked");
  forgetNodeHealth();
  assert.deepEqual(await findUnmatched(store, { address: creator, nodes: [NODE], since: T0, rpc: node.rpc }), { read: true, payments: [], since: T0, entries: 0, more: false, waiting: 0 });
  forgetNodeHealth();
  assert.deepEqual(await findUnmatched(store, { address: creator, nodes: [NODE], since: T0, rpc: mockNode(() => ({ account: creator, history: "" })).rpc }), { read: true, payments: [], since: T0, entries: 0, more: false, waiting: 0 });
});

test("the bound: at most UNMATCHED_ENTRIES entries are read (also when a node gives more), `more` says so, and the store is asked in chunks of 50", async () => {
  forgetNodeHealth();
  const asked: number[] = [];
  const store: Pick<ShopStore, "usedHashes" | "held"> = { usedHashes: async (h) => (asked.push(h.length), new Set()), held: async () => [] };
  const history = Array.from({ length: UNMATCHED_ENTRIES + 30 }, (_, i) => receive(((BigInt(i) + 2n) * STEP_RAW).toString(), T0 + 10_000_000 - i * 1000));
  const r = await findUnmatched(store, { address: creator, nodes: [NODE], since: T0, rpc: mockNode(() => ({ account: creator, history, previous: hash64() })).rpc });
  assert.ok(r.read);
  if (!r.read) return;
  assert.equal(r.payments.length, UNMATCHED_ENTRIES);
  assert.equal(r.entries, UNMATCHED_ENTRIES);
  assert.equal(r.more, true);
  assert.ok(asked.every((n) => n <= 50) && asked.reduce((a, b) => a + b, 0) === UNMATCHED_ENTRIES, asked.join(","));
});

if (!noSqlite)
  test("the Worker's shop reads its own address on its own nodes (shop.unmatched for the admin's `unmatched`)", async () => {
    forgetNodeHealth();
    const STARTER = readFileSync(new URL("./fixtures/starter-0001_init.sql", import.meta.url), "utf8");
    const node = mockNode(() => ({ account: creator, history: [receive((3n * STEP_RAW).toString(), T0 + 1000)] }));
    const shop = createShop({ DB: d1Over(sqlite(STARTER)), RECEIVE_ADDRESS: creator, TEST_MODE: "off", NANO_NODES: NODE.url }, { catalogue: LOOKS, player: async () => null, rpc: node.rpc });
    const r = await shop.unmatched(T0 + 5000, T0);
    assert.ok(r.read && r.payments.length === 1 && r.payments[0].sender === buyer);
    assert.deepEqual(node.calls.map((c) => [c.url, c.body.action, c.body.account]), [[NODE.url, "account_history", creator]]);
  });
