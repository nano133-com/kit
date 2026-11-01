// The conformance suite of the shop's money rules: a game that writes its own store (another database) runs it, and so proves that its store keeps every
// rule the package's adapters keep. The package runs it on the memory store, D1 (on SQLite) and Firestore.
//
//   import { shopStoreConformance, SHOP_CASE_TIMEOUT_MS } from "@nano133/nanoterra/shop/conformance";
//   for (const c of shopStoreConformance(async () => ({ store: myStore(), dump: () => allMyRowsAsText() }))) it(c.name, c.run, SHOP_CASE_TIMEOUT_MS);
//
// Each case gets a NEW, empty store from `make`, and is short (a few store calls): give each its own test, never one test for the whole suite. The times
// are fixed (no clock), the players are ids the suite can find in any text, and no case needs the network.

import { CLOCK_SLACK_MS } from "./match.js";
import { amountsFor, LATE_HOLD_MS, ORDER_TTL_MS, ShopBusy, newOrderId, reserveOrder } from "./orders.js";
import { priceRaw, xnoText } from "./amount.js";
import { FORGOTTEN, type ShopOrder, type ShopStore } from "./store.js";

export type ShopHarness = {
  store: ShopStore;
  /** Every row the store keeps (orders, owned looks, locks, recorded payments) as one text. `forget` must leave the player's id only where the money rules keep it. */
  dump(): Promise<string>;
};

export type ShopConformanceCase = { name: string; run: () => Promise<void> };

/** A time per case that is plenty for a remote store (a case makes at most about 60 store calls; 25 of them at once in one case). */
export const SHOP_CASE_TIMEOUT_MS = 60_000;

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

/** A player id the suite can find in any text. */
const id = (n: string) => `shop-player-${n}-3c9d`;
const ANN = id("ann");
const BOB = id("bob");
const CYD = id("cyd");
const T0 = 1_800_000_000_000;
const PRICE = priceRaw(0.25, 1)!; // 0.25 XNO
let hashes = 0;
/** A new send hash: 64 hex characters, upper case (as the scan gives it). */
const hash = () => (++hashes).toString(16).toUpperCase().padStart(8, "0").padEnd(64, "A");

const order = (store: ShopStore, player = ANN, now = T0, price = PRICE, lookId = "look-a") => reserveOrder(store, { player, lookId, usd: "0.25", rate: 1, price, visitor: `visitor-of-${player}`, now });
const pay = (store: ShopStore, o: ShopOrder, seenMs: number, now = seenMs, h = hash(), payer = o.player) => store.settle(o, { hash: h, payer, seenMs }, now);

export function shopStoreConformance(make: () => Promise<ShopHarness>): ShopConformanceCase[] {
  const cases: ShopConformanceCase[] = [];
  const add = (name: string, run: (h: ShopHarness) => Promise<void>) => cases.push({ name, run: async () => run(await make()) });

  add("an order asks for its price, and a second open order of the same price one step (0.0001 XNO) more", async ({ store }) => {
    const a = await order(store);
    const b = await order(store, BOB);
    check(xnoText(a.amount) === "0.25" && xnoText(b.amount) === "0.2501", `amounts: ${xnoText(a.amount)}, ${xnoText(b.amount)}`);
    const back = await store.order(a.id);
    check(back !== null && back.amount === a.amount && back.amountLock === a.amount && back.status === "open" && back.player === ANN, `read back: ${JSON.stringify(back)}`);
    check(back!.expiresAt === T0 + ORDER_TTL_MS && back!.holdUntil === T0 + ORDER_TTL_MS + LATE_HOLD_MS, "the times are kept");
  });

  add("no two held orders ever hold one amount, even when 25 are made at the same instant", async ({ store }) => {
    const made = await Promise.all(Array.from({ length: 25 }, (_, i) => order(store, id(`p${i}`))));
    check(new Set(made.map((o) => o.amount)).size === 25, `amounts: ${made.map((o) => xnoText(o.amount)).join(" ")}`);
    const held = await store.held();
    check(held.length === 25 && new Set(held.map((o) => o.amountLock)).size === 25, `held: ${held.length}`);
    const amounts = amountsFor(PRICE);
    check((await store.heldAmounts(amounts)).size === 25, "heldAmounts names the 25");
  });

  add("insert refuses an amount that another order holds, and writes nothing", async ({ store }) => {
    const a = await order(store);
    const copy: ShopOrder = { ...a, id: newOrderId(), player: BOB };
    check((await store.insert(copy)) === false, "a second order with a held amount was written");
    check((await store.order(copy.id)) === null, "the refused order is not there");
  });

  add("every amount of a price held: the next order is refused (busy)", async ({ store }) => {
    const small = priceRaw(0.003, 1)!; // 30 steps: 3 more allowed, 4 amounts in all
    for (let i = 0; i < 4; i++) await order(store, id(`s${i}`), T0, small);
    try {
      await order(store, id("s4"), T0, small);
    } catch (e) {
      check(e instanceof ShopBusy, `expected ShopBusy, got ${String(e)}`);
      return;
    }
    throw new Error("a fifth order got an amount");
  });

  add("an expired order keeps its amount until its hold ends; tidy marks it expired, then frees it", async ({ store }) => {
    const a = await order(store);
    const b = await order(store, BOB, a.expiresAt + 1000);
    check(b.amount !== a.amount, "the amount of an order that may still be paid late was given again");
    check((await store.order(a.id))?.status === "expired", "tidy marks an open order past its time expired");
    const c = await order(store, CYD, a.holdUntil + 1);
    check(c.amount === a.amount, "after the hold the amount is free again");
    const was = await store.order(a.id);
    check(was?.status === "expired" && was.amountLock === null, `the old order: ${JSON.stringify(was)}`);
  });

  add("a paid order gives the look to ITS player once, frees its amount at once, and records the payment", async ({ store }) => {
    const a = await order(store);
    const h = hash();
    check((await pay(store, a, T0 + 1000, T0 + 2000, h, BOB)) === "paid", "an exact payment in time pays");
    const after = await store.order(a.id);
    check(after?.status === "paid" && after.hash === h && after.payer === BOB && after.paidAt === T0 + 1000 && after.amountLock === null, `paid order: ${JSON.stringify(after)}`);
    check((await store.owns(ANN, "look-a")) && JSON.stringify(await store.owned(ANN)) === '["look-a"]', "the order's player owns the look");
    check(!(await store.owns(BOB, "look-a")) && (await store.owned(BOB)).length === 0, "the payer is not the owner: one owner per order");
    check((await store.usedHashes([h, hash()])).has(h) && (await store.usedHashes([h])).size === 1, "the payment is recorded");
    const next = await order(store, CYD, T0 + 3000);
    check(next.amount === a.amount, "a paid order's amount is free at once");
  });

  add("a paid order is never paid twice: the same payment or another one changes nothing", async ({ store }) => {
    const a = await order(store);
    const h = hash();
    await pay(store, a, T0 + 1000, T0 + 1000, h);
    check((await pay(store, a, T0 + 1000, T0 + 2000, h)) === "taken", "the same payment again");
    check((await pay(store, a, T0 + 1500, T0 + 2000)) === "taken", "another payment of a paid order");
    const after = await store.order(a.id);
    check(after?.hash === h && after.status === "paid", "the first payment stays");
    check((await store.owned(ANN)).length === 1, "one owned row");
  });

  add("one payment never pays a second order, even one that holds the same amount later", async ({ store }) => {
    const a = await order(store);
    const h = hash();
    await pay(store, a, T0 + 1000, T0 + 1000, h);
    const b = await order(store, BOB, T0 + 2000);
    check(b.amount === a.amount, "the next order holds the freed amount");
    check((await pay(store, b, T0 + 3000, T0 + 3000, h)) === "used", "a payment that paid an order pays no other");
    const after = await store.order(b.id);
    check(after?.status === "open" && after.amountLock === b.amount && after.hash === null, `the second order: ${JSON.stringify(after)}`);
    check(!(await store.owns(BOB, "look-a")), "no look for the second order");
  });

  add("a payment first seen after the order ended (beyond the clock allowance) is paid late: no look, the amount freed", async ({ store }) => {
    const a = await order(store);
    const seen = a.expiresAt + CLOCK_SLACK_MS + 1;
    check((await pay(store, a, seen, seen + 1000)) === "paid_late", "late");
    const after = await store.order(a.id);
    check(after?.status === "paid_late" && after.amountLock === null && after.hash !== null, `late order: ${JSON.stringify(after)}`);
    check((await store.owned(ANN)).length === 0, "a late payment gives no look");
  });

  add("a payment sent in time but recorded after the order expired still pays it", async ({ store }) => {
    const a = await order(store);
    await store.tidy(a.expiresAt + 20 * 60_000);
    check((await store.order(a.id))?.status === "expired", "expired first");
    check((await pay(store, a, a.expiresAt - 30_000, a.expiresAt + 20 * 60_000)) === "paid", "sent in time");
    check(await store.owns(ANN, "look-a"), "the look is given");
  });

  add("an expired order whose hold has ended cannot be paid: it is not held, and settle refuses it", async ({ store }) => {
    const a = await order(store);
    await store.tidy(a.holdUntil + 1);
    check((await store.held()).length === 0, "nothing is held after the hold");
    check((await pay(store, a, a.holdUntil, a.holdUntil + 2)) === "taken", "an order whose amount is no longer held");
    const after = await store.order(a.id);
    check(after?.status === "expired" && after.hash === null, `the order: ${JSON.stringify(after)}`);
    check((await store.owned(ANN)).length === 0, "no look");
  });

  add("the open orders of a player: the same look's newest, and the count", async ({ store }) => {
    const a = await order(store, ANN, T0, PRICE, "look-a");
    await order(store, ANN, T0 + 10, PRICE, "look-b");
    await order(store, BOB, T0 + 20, PRICE, "look-a");
    const same = await store.openOrder(ANN, "look-a", T0 + 60_000);
    check(same?.id === a.id, "the open order for that look");
    check((await store.openOrder(ANN, "look-a", a.expiresAt)) === null, "an order that ends before `until` is not offered again");
    check((await store.openOrder(CYD, "look-a", T0)) === null, "another player's order is not theirs");
    check((await store.countOpen(ANN, T0 + 100)) === 2 && (await store.countOpen(BOB, T0 + 100)) === 1, "the counts");
    check((await store.countOpen(ANN, a.expiresAt + 11)) === 0, "an order past its time is not counted");
  });

  add("amounts are kept as exact text, even with 39 digits", async ({ store }) => {
    const big = "100000000000000000000000000000000000000"; // 39 digits: 10^38 raw (10^8 XNO), a clean amount
    const o: ShopOrder = { id: newOrderId(), player: ANN, lookId: "look-a", usd: "1.00", rate: 1, amount: big, amountLock: big, status: "open", createdAt: T0, expiresAt: T0 + ORDER_TTL_MS, holdUntil: T0 + ORDER_TTL_MS + LATE_HOLD_MS, hash: null, payer: null, paidAt: null, visitor: null };
    check(await store.insert(o), "inserted");
    const back = await store.order(o.id);
    check(back?.amount === big && back.amountLock === big, `read back: ${back?.amount}`);
    check((await store.heldAmounts([big])).has(big), "held by its exact text");
  });

  add("the scan's claim: one caller in each gap, also at the same instant", async ({ store }) => {
    const all = await Promise.all(Array.from({ length: 5 }, () => store.claimScan(T0, 4000)));
    check(all.filter(Boolean).length === 1, `claims at once: ${all.join(",")}`);
    check(!(await store.claimScan(T0 + 3999, 4000)), "inside the gap");
    check(await store.claimScan(T0 + 4000, 4000), "after the gap");
  });

  add("the kept price comes back as it was saved", async ({ store }) => {
    check((await store.readRate()) === null, "no price at first");
    await store.saveRate({ usd: 0.8731, sources: ["CoinGecko", "Kraken"], at: T0 });
    const r = await store.readRate();
    check(r?.usd === 0.8731 && r.at === T0 && JSON.stringify(r.sources) === '["CoinGecko","Kraken"]', `rate: ${JSON.stringify(r)}`);
  });

  add("forget waits while an order of the player may still be paid, and deletes nothing", async ({ store }) => {
    const paid = await order(store, ANN, T0, PRICE, "look-a");
    await pay(store, paid, T0 + 1000);
    const waiting = await order(store, ANN, T0 + 2000, PRICE, "look-b");
    const r = await store.forget(ANN, waiting.expiresAt + 1);
    check(r.waitUntil === waiting.holdUntil && r.deleted === 0 && r.kept === 0, `forget: ${JSON.stringify(r)}`);
    check(await store.owns(ANN, "look-a"), "nothing was deleted");
    check((await store.order(paid.id))?.player === ANN, "the paid order still names the player");
  });

  add("forget leaves nothing of the player's except a late payment's payer (the creator sends it back)", async ({ store, dump }) => {
    const paid = await order(store, ANN, T0, PRICE, "look-a");
    await pay(store, paid, T0 + 1000);
    const late = await order(store, ANN, T0 + 10, PRICE, "look-b");
    await pay(store, late, late.expiresAt + CLOCK_SLACK_MS + 10);
    const never = await order(store, ANN, T0 + 20, PRICE, "look-c");
    const gift = await order(store, BOB, T0 + 30, PRICE, "look-d");
    await pay(store, gift, T0 + 1000, T0 + 1000, hash(), ANN);
    const at = never.holdUntil + 1;
    const r = await store.forget(ANN, at);
    check(r.waitUntil === null && r.kept === 2 && r.deleted === 2, `forget: ${JSON.stringify(r)}`);
    check((await store.owned(ANN)).length === 0 && !(await store.owns(ANN, "look-a")), "the owned looks are gone");
    check((await store.order(never.id)) === null, "an order that was never paid is gone");
    const p = await store.order(paid.id);
    check(p?.player === FORGOTTEN && p.payer === FORGOTTEN && p.visitor === null && p.hash !== null && p.status === "paid", `the paid order stays as a sale: ${JSON.stringify(p)}`);
    const l = await store.order(late.id);
    check(l?.player === FORGOTTEN && l.payer === ANN && l.visitor === null && l.status === "paid_late", `the late payment keeps its payer: ${JSON.stringify(l)}`);
    const g = await store.order(gift.id);
    check(g?.player === BOB && g.payer === FORGOTTEN && (await store.owns(BOB, "look-d")), `another player's order that ANN paid stays BOB's: ${JSON.stringify(g)}`);
    const text = await dump();
    const left = text.split(ANN).length - 1;
    check(left === 1, `the player's id is left ${left} times in the store (only the late payer may stay): ${text.slice(0, 400)}`);
    check((await store.usedHashes([p!.hash!])).size === 1, "the paid order's payment is still recorded (it never counts again)");
    const again = await store.forget(ANN, at + 1);
    check(again.deleted === 0 && again.kept === 0 && again.waitUntil === null, `a second forget: ${JSON.stringify(again)}`);
  });

  return cases;
}
