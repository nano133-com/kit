// The payment match against a mock Nano node (the game starter's test/sweep.test.ts): the exact amount, after the order time, exactly once, and late
// payments. It runs on the D1 adapter (SQLite) and on the Firestore adapter (the fake). No real network: the node runs on 127.0.0.1 in this test.
import assert from "node:assert/strict";
import test, { after, before, beforeEach, describe } from "node:test";
import { createD1Shop } from "../src/shop/adapters/d1.js";
import { createFirestoreShop } from "../src/shop/adapters/firestore.js";
import { CLOCK_SLACK_MS, SCAN_GAP_MS, candidates, checkSend, forgetBlocks, forgetNodeHealth, priceRaw, reserveOrder, scanPayments, type ShopOrder, type ShopStore } from "../src/shop/index.js";
import { d1Over, fakeFirestore, hash64, MockNode, noSqlite, sqlite, testAddress, type Send } from "./shop-helpers.js";

const node = new MockNode();
const creator = testAddress();
const buyer = testAddress();
before(async () => void (await node.start()));
after(async () => void (await node.stop()));

const stores: [string, () => { store: ShopStore; owned: () => Promise<{ player: string; lookId: string; orderId: string }[]> }][] = [
  [
    "D1",
    () => {
      const db = sqlite();
      const store = createD1Shop(d1Over(db));
      return { store, owned: async () => (db.prepare("SELECT player, look_id AS lookId, order_id AS orderId FROM owned").all() as { player: string; lookId: string; orderId: string }[]).map((r) => ({ ...r })) };
    },
  ],
  [
    "Firestore",
    () => {
      const f = fakeFirestore();
      return { store: createFirestoreShop(f.db), owned: async () => [...f.col("owned").values()].map((d) => ({ player: d.data.player as string, lookId: d.data.lookId as string, orderId: d.data.orderId as string })) };
    },
  ],
];

for (const [name, make] of stores) {
  if (name === "D1" && noSqlite) continue;
  describe(`the payment match (${name})`, () => {
    let store: ShopStore;
    let owned: () => Promise<{ player: string; lookId: string; orderId: string }[]>;
    let clock = 1_800_000_000_000;
    beforeEach(() => {
      ({ store, owned } = make());
      node.sends = [];
      node.mode = "ok";
      forgetNodeHealth();
      forgetBlocks();
      clock += 3_600_000 * 10;
    });

    const price = priceRaw(0.25, 1)!;
    const newOrder = (player = buyer, lookId = "red-coat") => reserveOrder(store, { player, lookId, usd: "0.25", rate: 1, price, visitor: null, now: clock });
    /** One scan, a little later each time (the scan gap). */
    const scan = () => {
      clock += SCAN_GAP_MS + 1;
      return scanPayments(store, { address: creator, at: clock, nodes: [{ name: "mock", url: node.url }], rpc: { timeoutMs: 1000 } });
    };
    const pay = (o: ShopOrder, extra: Partial<Send> = {}) => {
      const s: Send = { hash: hash64(), from: buyer, to: creator, amount: o.amount, seenMs: clock + 1000, confirmed: true, ...extra };
      node.sends.push(s);
      return s;
    };

    test("an exact payment after the order pays it and gives the look", async () => {
      const o = await newOrder();
      const s = pay(o);
      const r = await scan();
      assert.deepEqual(r.settled, [{ id: o.id, status: "paid" }]);
      assert.deepEqual(await store.order(o.id), { ...o, status: "paid", hash: s.hash, payer: buyer, paidAt: Math.floor(s.seenMs / 1000) * 1000, amountLock: null });
      assert.deepEqual(await owned(), [{ player: buyer, lookId: "red-coat", orderId: o.id }]);
    });

    test("a payment of another amount, to another address, or not a send, pays nothing", async () => {
      const o = await newOrder();
      pay(o, { amount: (BigInt(o.amount) + 1n).toString() }); // one raw more
      pay(o, { amount: (BigInt(o.amount) - 10n ** 26n).toString() }); // one step less
      pay(o, { to: testAddress() }); // someone else's address
      await scan();
      assert.equal((await store.order(o.id))!.status, "open");
      assert.deepEqual(await owned(), []);
      assert.equal(checkSend({ subtype: "receive", amount: o.amount, contents: { link_as_account: creator }, local_timestamp: "2000000000", confirmed: "true" }, creator, o.amount, 0).kind, "wrong");
    });

    test("a payment the node saw before the order (less the clock allowance) never counts", async () => {
      const o = await newOrder();
      pay(o, { seenMs: o.createdAt - CLOCK_SLACK_MS - 1000 });
      await scan();
      assert.equal((await store.order(o.id))!.status, "open");
      assert.equal(checkSend({ subtype: "send", amount: o.amount, contents: { link_as_account: creator }, local_timestamp: "0", confirmed: "true" }, creator, o.amount, o.createdAt).kind, "early");
    });

    test("an unconfirmed payment waits, and counts once it is confirmed", async () => {
      const o = await newOrder();
      const s = pay(o, { confirmed: false });
      await scan();
      assert.equal((await store.order(o.id))!.status, "open");
      s.confirmed = true;
      await scan();
      assert.equal((await store.order(o.id))!.status, "paid");
    });

    test("finds a payment the creator's wallet already received (the history)", async () => {
      const o = await newOrder();
      pay(o, { received: true });
      await scan();
      assert.equal((await store.order(o.id))!.status, "paid");
    });

    test("exactly once: more scans and a second settle give nothing more", async () => {
      const o = await newOrder();
      const s = pay(o);
      await scan();
      await scan();
      await scan();
      assert.equal((await owned()).length, 1);
      assert.equal(await store.settle(o, { hash: s.hash, payer: buyer, seenMs: s.seenMs }, clock), "taken");
      assert.equal((await owned()).length, 1);
    });

    test("one payment never pays a second order, even one that gets the same amount later", async () => {
      const first = await newOrder();
      pay(first);
      await scan();
      const second = await newOrder(testAddress());
      assert.equal(second.amount, first.amount);
      await scan();
      assert.equal((await store.order(second.id))!.status, "open");
      const hash = (await store.order(first.id))!.hash!;
      assert.equal(await store.settle(second, { hash, payer: buyer, seenMs: clock }, clock), "used");
      assert.equal((await store.order(second.id))!.status, "open");
    });

    test("two scans at the same instant ask the node once", async () => {
      await newOrder();
      clock += SCAN_GAP_MS + 1;
      node.calls = [];
      const both = await Promise.all([1, 2].map(() => scanPayments(store, { address: creator, at: clock, nodes: [{ name: "mock", url: node.url }] })));
      assert.equal(both.filter((b) => b.scanned).length, 1);
      assert.equal(node.calls.filter((c) => c.action === "receivable").length, 1);
    });

    test("a payment after the expiry is recorded as paid late, and gives no look", async () => {
      const o = await newOrder();
      clock = o.expiresAt + 10 * 60_000;
      const s = pay(o, { seenMs: clock - 1000 });
      const r = await scan();
      assert.deepEqual(r.settled, [{ id: o.id, status: "paid_late" }]);
      const after = await store.order(o.id);
      assert.equal(after?.status, "paid_late");
      assert.equal(after?.hash, s.hash);
      assert.equal(after?.amountLock, null);
      assert.deepEqual(await owned(), []);
    });

    test("a payment sent in time but found after the expiry still pays the order", async () => {
      const o = await newOrder();
      pay(o, { seenMs: o.expiresAt - 30_000 });
      clock = o.expiresAt + 20 * 60_000; // the player closed the page; the cron finds it later
      await scan();
      assert.equal((await store.order(o.id))!.status, "paid");
      assert.equal((await owned()).length, 1);
    });

    test("after the hold ends, nothing is matched to the old order any more (the node is not even asked)", async () => {
      const o = await newOrder();
      clock = o.holdUntil + 60_000;
      pay(o, { seenMs: clock - 1000 });
      const r = await scan();
      assert.equal(r.scanned, false);
      assert.equal((await store.order(o.id))!.status, "expired");
    });

    test("with no address (test mode with none set) there is no scan", async () => {
      const o = await newOrder();
      pay(o);
      const r = await scanPayments(store, { address: null, at: clock + SCAN_GAP_MS + 1, nodes: [{ name: "mock", url: node.url }] });
      assert.deepEqual(r, { scanned: false, settled: [] });
    });

    test("fails closed when the node is down: nothing is credited, and the next scan tries again", async () => {
      const o = await newOrder();
      pay(o);
      node.mode = "down";
      const r = await scan();
      assert.match(r.error ?? "", /no Nano node answered/);
      assert.equal((await store.order(o.id))!.status, "open");
      node.mode = "ok";
      forgetNodeHealth();
      await scan();
      assert.equal((await store.order(o.id))!.status, "paid");
    });
  });
}

test("candidates: both answer forms of receivable, and the history's receives", () => {
  const amounts = new Set(["100"]);
  const h = "A".repeat(64);
  assert.deepEqual([...candidates({ blocks: { [h]: "100" } }, null, amounts)], [[h, "100"]]);
  assert.deepEqual([...candidates({ blocks: { [h]: { amount: "100", source: "nano_x" } } }, null, amounts)], [[h, "100"]]);
  assert.deepEqual([...candidates({ blocks: "" }, { history: "" }, amounts)], []);
  assert.deepEqual([...candidates({ blocks: { "not-a-hash": "100" } }, null, amounts)], []);
  assert.deepEqual([...candidates(null, { history: [{ subtype: "receive", amount: "100", link: h.toLowerCase() }, { subtype: "send", amount: "100", link: "B".repeat(64) }] }, amounts)], [[h, "100"]]);
});
