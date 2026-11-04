// The conformance suite of the shop's money rules: a game that writes its own store (another database) runs it, and so proves that its store keeps every
// rule the package's adapters keep. The package runs it on the memory store, D1 (on SQLite) and Firestore.
//
//   import { shopStoreConformance, SHOP_CASE_TIMEOUT_MS } from "@nano133/nanoterra/shop/conformance";
//   for (const c of shopStoreConformance(async () => ({ store: myStore(), dump: () => allMyRowsAsText() }))) it(c.name, c.run, SHOP_CASE_TIMEOUT_MS);
//
// Each case gets a NEW, empty store from `make`, and is short (a few store calls): give each its own test, never one test for the whole suite. The times
// are fixed (no clock), the players are ids the suite can find in any text, and no case needs the network. The plays' cases (a credit for a paid play,
// exactly one use) run unless `{ plays: false }`: a store of a game that sells looks only (D1 with no plays' migration) passes the others.

import { CLOCK_SLACK_MS } from "./match.js";
import { amountsFor, LATE_HOLD_MS, ORDER_TTL_MS, PLAY_LATE_HOLD_MS, ShopBusy, newOrderId, reserveOrder } from "./orders.js";
import { priceRaw, xnoText } from "./amount.js";
import { DAY_MS } from "./plays.js";
import { FORGOTTEN, type ShopOrder, type ShopStore } from "./store.js";

export type ShopHarness = {
  store: ShopStore;
  /** Every row the store keeps (orders, owned looks, credits and their uses, locks, recorded payments) as one text. `forget` must leave the player's id only where the money rules keep it. */
  dump(): Promise<string>;
};

export type ShopConformanceCase = { name: string; run: () => Promise<void> };

export type ShopConformanceOptions = {
  /** False leaves out the plays' cases (a store that sells looks only). Default true. */
  plays?: boolean;
};

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
const PLAY = "extra-round";
const LEVEL = "level-2";
const playOrder = (store: ShopStore, player = ANN, now = T0, price = PRICE, playId = PLAY, useDays?: number) =>
  reserveOrder(store, { player, lookId: playId, kind: "play", ...(useDays === undefined ? {} : { useDays }), usd: "0.25", rate: 1, price, visitor: `visitor-of-${player}`, now });
/** A paid play order: its credit is granted at `at + 1`. */
async function credit(store: ShopStore, player = ANN, at = T0, playId = PLAY, useDays?: number): Promise<ShopOrder> {
  const o = await playOrder(store, player, at, PRICE, playId, useDays);
  check((await pay(store, o, at + 1)) === "paid", "a play order in time is paid");
  return o;
}
/** The player's ready credits at `now` (default: early, so every credit that was granted is in its wait). */
const ready = async (store: ShopStore, player: string, now = T0) => JSON.stringify(await store.credits(player, now));

export function shopStoreConformance(make: () => Promise<ShopHarness>, options: ShopConformanceOptions = {}): ShopConformanceCase[] {
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
    check((await store.countOpen(ANN, T0 + 100, "look-a")) === 1 && (await store.countOpen(ANN, T0 + 100, "look-c")) === 0 && (await store.countOpen(BOB, T0 + 100, "look-a")) === 1, "the counts of one look");
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

  if (options.plays === false) return cases;

  add("a paid play order gives ITS player ONE credit and no look; a second settle of the same order changes nothing", async ({ store }) => {
    const a = await playOrder(store);
    check(a.kind === "play" && (await store.order(a.id))?.kind === "play" && (await store.order(a.id))?.lookId === PLAY, `the order keeps its kind: ${JSON.stringify(await store.order(a.id))}`);
    const h = hash();
    check((await pay(store, a, T0 + 1000, T0 + 2000, h, BOB)) === "paid", "an exact payment in time pays a play order");
    check((await ready(store, ANN)) === `[{"playId":"${PLAY}","ready":1}]`, `the order's player has one credit: ${await ready(store, ANN)}`);
    check((await ready(store, BOB)) === "[]", "the payer gets no credit: one credit per order, the order's player's");
    check((await store.owned(ANN)).length === 0 && !(await store.owns(ANN, PLAY)), "a play is never owned");
    check((await pay(store, a, T0 + 1000, T0 + 3000, h)) === "taken" && (await pay(store, a, T0 + 1500, T0 + 3000)) === "taken", "a paid play order is never paid twice");
    check((await ready(store, ANN)) === `[{"playId":"${PLAY}","ready":1}]`, "still one credit");
    const end = T0 + 2000 + 30 * DAY_MS;
    check((await ready(store, ANN, end)).includes('"ready":1') && (await ready(store, ANN, end + 1)) === "[]", "the credit's wait (30 days when the order says none) counts from the settle");
    check((await store.usedHashes([h])).has(h) && (await store.order(a.id))?.amountLock === null, "the payment is recorded and the amount freed");
  });

  add("a play order holds its amount an hour after it ends, as a look's does, then the amount is free again", async ({ store }) => {
    const p = await playOrder(store);
    const l = await order(store, BOB);
    check(p.expiresAt === T0 + ORDER_TTL_MS && p.holdUntil === p.expiresAt + PLAY_LATE_HOLD_MS && PLAY_LATE_HOLD_MS === 60 * 60_000, `the play's hold: ${JSON.stringify(p)}`);
    check(l.holdUntil === l.expiresAt + LATE_HOLD_MS && LATE_HOLD_MS === 60 * 60_000, `the look's hold is an hour: ${JSON.stringify(l)}`);
    const back = await store.order(p.id);
    check(back?.holdUntil === p.holdUntil, "the store keeps the play's hold");
    const during = await order(store, CYD, p.holdUntil - 1);
    check(during.amount !== p.amount, "during its hold, the play's amount is not given again");
    const after = await order(store, id("dan"), p.holdUntil + 1);
    check(after.amount === p.amount, `after its hold the play's amount is free again: ${xnoText(after.amount)}`);
    check((await store.order(p.id))?.amountLock === null && (await pay(store, p, p.expiresAt + 1000, p.holdUntil + 2)) === "taken", "and a payment for the old play order can no longer settle it");
    check(l.holdUntil - l.expiresAt === p.holdUntil - p.expiresAt, "a play's order and a look's hold their amounts equally long");
  });

  add("a paid-late play order gives no credit, and frees its amount", async ({ store }) => {
    const a = await playOrder(store);
    const seen = a.expiresAt + CLOCK_SLACK_MS + 1;
    check((await pay(store, a, seen, seen + 1000)) === "paid_late", "late");
    const after = await store.order(a.id);
    check(after?.status === "paid_late" && after.amountLock === null && after.hash !== null && after.kind === "play", `late order: ${JSON.stringify(after)}`);
    check((await ready(store, ANN)) === "[]", "a late payment gives no credit");
    check((await store.useCredit(ANN, PLAY, "round-1", seen + 2000)).status === "none", "and nothing to use");
  });

  add("looks and plays share the reservation: a look order and a play order never hold one amount, also 25 made at the same instant", async ({ store }) => {
    const a = await order(store);
    const b = await playOrder(store, BOB);
    check(xnoText(a.amount) === "0.25" && xnoText(b.amount) === "0.2501", `amounts: ${xnoText(a.amount)}, ${xnoText(b.amount)}`);
    check((await store.order(a.id))?.kind === "look", "a look order reads as a look");
    const made = await Promise.all(Array.from({ length: 25 }, (_, i) => (i % 2 ? order(store, id(`m${i}`)) : playOrder(store, id(`m${i}`)))));
    const all = [a, b, ...made];
    check(new Set(all.map((o) => o.amount)).size === 27, `amounts: ${all.map((o) => xnoText(o.amount)).join(" ")}`);
    const held = await store.held();
    check(held.length === 27 && new Set(held.map((o) => o.amountLock)).size === 27, `held: ${held.length}`);
    check(held.filter((o) => o.kind === "play").length === 14, "the held play orders keep their kind");
  });

  add("a use takes the oldest unused credit of the play and marks it used, once", async ({ store }) => {
    const first = await credit(store, ANN, T0);
    const second = await credit(store, ANN, T0 + 5000);
    await credit(store, ANN, T0 + 6000, LEVEL);
    const u = await store.useCredit(ANN, PLAY, "round-1", T0 + 9000);
    check(u.status === "used" && u.credit.orderId === first.id, `the oldest is used: ${JSON.stringify(u)}`);
    check(u.status === "used" && u.credit.player === ANN && u.credit.playId === PLAY && u.credit.grantedAt === T0 + 1 && u.credit.usedAt === T0 + 9000 && u.credit.useRef === "round-1", `the credit: ${JSON.stringify(u)}`);
    check((await ready(store, ANN)) === `[{"playId":"${PLAY}","ready":1},{"playId":"${LEVEL}","ready":1}]`, `ready (by play id): ${await ready(store, ANN)}`);
    const v = await store.useCredit(ANN, PLAY, "round-2", T0 + 9500);
    check(v.status === "used" && v.credit.orderId === second.id, `then the next: ${JSON.stringify(v)}`);
    check((await store.useCredit(ANN, PLAY, "round-3", T0 + 9600)).status === "none", "then none");
    check((await ready(store, ANN)) === `[{"playId":"${LEVEL}","ready":1}]`, "the other play's credit waits");
  });

  add("the same ref again is \"again\" with the same credit, never a second one, also 20 calls with one ref at once", async ({ store }) => {
    for (let i = 0; i < 3; i++) await credit(store, ANN, T0 + i * 1000);
    const u = await store.useCredit(ANN, PLAY, "round:a", T0 + 5000);
    check(u.status === "used", "the first use");
    const again = await store.useCredit(ANN, PLAY, "round:a", T0 + 6000);
    check(again.status === "again" && u.status === "used" && again.credit.orderId === u.credit.orderId && again.credit.usedAt === T0 + 5000, `again: ${JSON.stringify(again)}`);
    const other = await store.useCredit(ANN, LEVEL, "round:a", T0 + 6000);
    check(other.status === "again" && other.credit.playId === PLAY, `a ref names one use, whatever play is asked: ${JSON.stringify(other)}`);
    check((await ready(store, ANN)).includes('"ready":2'), `two left: ${await ready(store, ANN)}`);
    const all = await Promise.all(Array.from({ length: 20 }, (_, i) => store.useCredit(ANN, PLAY, "round:b", T0 + 7000 + i)));
    const used = all.filter((r) => r.status === "used");
    check(used.length === 1 && all.every((r) => r.status === "used" || r.status === "again"), `20 at once with one ref: ${all.map((r) => r.status).join(",")}`);
    check(new Set(all.map((r) => (r.status === "none" ? "-" : r.credit.orderId))).size === 1, "every answer names the one credit");
    check((await ready(store, ANN)).includes('"ready":1'), `one left: ${await ready(store, ANN)}`);
    for (const bad of ["", "a b", "x".repeat(65), "a/b", "ü"]) {
      let threw = false;
      try {
        await store.useCredit(ANN, PLAY, bad, T0 + 9000);
      } catch {
        threw = true;
      }
      check(threw, `a bad ref (${JSON.stringify(bad)}) is refused`);
    }
  });

  add("20 uses with 20 refs at once and 3 credits: exactly 3 used, each credit once, and 17 none", async ({ store }) => {
    for (let i = 0; i < 3; i++) await credit(store, ANN, T0 + i * 1000);
    const all = await Promise.all(Array.from({ length: 20 }, (_, i) => store.useCredit(ANN, PLAY, `round-${i}`, T0 + 9000)));
    const used = all.flatMap((r) => (r.status === "used" ? [r.credit.orderId] : []));
    check(used.length === 3 && new Set(used).size === 3, `used: ${all.map((r) => r.status).join(",")}`);
    check(all.filter((r) => r.status === "none").length === 17, "the other 17 found none");
    check((await ready(store, ANN)) === "[]", "none left");
  });

  add("a credit keeps the end its order gave it at the grant: past it, it is not ready and cannot be used", async ({ store }) => {
    const o = await credit(store, ANN, T0, PLAY, 7);
    check((await store.order(o.id))?.useDays === 7, `the order keeps its days: ${JSON.stringify(await store.order(o.id))}`);
    const end = T0 + 1 + 7 * DAY_MS;
    check((await ready(store, ANN, end + 1)) === "[]" && (await ready(store, ANN, end)).includes('"ready":1'), "the end: granted at T0 + 1, seven days");
    check((await store.useCredit(ANN, PLAY, "round-1", end + 1)).status === "none", "past its end");
    const u = await store.useCredit(ANN, PLAY, "round-1", end);
    check(u.status === "used" && u.credit.expiresAt === end && u.credit.grantedAt === T0 + 1, `at its end (the same ref after a none): ${JSON.stringify(u)}`);
    await credit(store, ANN, T0 + 10, LEVEL);
    check((await ready(store, ANN, T0 + 11 + 30 * DAY_MS)).includes('"ready":1') && (await ready(store, ANN, T0 + 12 + 30 * DAY_MS)) === "[]", "an order with no days: 30");
  });

  add("another player's credit cannot be used, and each player's refs are their own", async ({ store }) => {
    await credit(store, ANN, T0);
    check((await store.useCredit(BOB, PLAY, "round-1", T0 + 100)).status === "none", "BOB cannot use ANN's credit");
    check((await ready(store, BOB)) === "[]" && (await ready(store, ANN)).includes('"ready":1'), "ANN's credit waits");
    check((await store.useCredit(ANN, PLAY, "round-1", T0 + 200)).status === "used", "ANN uses it");
    await credit(store, BOB, T0 + 300);
    const b = await store.useCredit(BOB, PLAY, "round-1", T0 + 400);
    check(b.status === "used" && b.credit.player === BOB, `BOB's own ref "round-1" uses BOB's own credit: ${JSON.stringify(b)}`);
  });

  add("a player's ref is never another player's, also when the two ids run together (\"x_\" + \"1r\" and \"x\" + \"_1r\")", async ({ store }) => {
    const left = `${id("eve")}_`;
    const right = id("eve");
    const l = await credit(store, left, T0);
    const r = await credit(store, right, T0 + 100);
    const a = await store.useCredit(left, PLAY, "1r", T0 + 200);
    check(a.status === "used" && a.credit.orderId === l.id && a.credit.player === left, `the first player uses their own credit: ${JSON.stringify(a)}`);
    const b = await store.useCredit(right, PLAY, "_1r", T0 + 300);
    check(b.status === "used" && b.credit.orderId === r.id && b.credit.player === right, `the second player's ref is new and uses their own credit (not "again" with the first's): ${JSON.stringify(b)}`);
    check((await ready(store, left)) === "[]" && (await ready(store, right)) === "[]", "each credit is used once");
    const a2 = await store.useCredit(left, PLAY, "1r", T0 + 400);
    const b2 = await store.useCredit(right, PLAY, "_1r", T0 + 400);
    check(a2.status === "again" && a2.credit.orderId === l.id && b2.status === "again" && b2.credit.orderId === r.id, `each ref answers with its own player's credit: ${JSON.stringify([a2, b2])}`);
    check((await store.useCredit(right, PLAY, "1r", T0 + 500)).status === "none" && (await store.useCredit(left, PLAY, "_1r", T0 + 500)).status === "none", "the other player's refs are new for each, and no credit is left");
  });

  add("the \"18 or older\" yes is kept for its player only, once (the first time, also many at once); forget deletes it and leaves another player's", async ({ store, dump }) => {
    check((await store.adult(ANN)) === null && (await store.adult(BOB)) === null, "a new store has no yes");
    await store.keepAdult(ANN, T0);
    await store.keepAdult(ANN, T0 + 5);
    check((await store.adult(ANN)) === T0, `the first yes keeps its time: ${await store.adult(ANN)}`);
    check((await store.adult(BOB)) === null, "ANN's yes is not BOB's");
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.keepAdult(BOB, T0 + 10 + i)));
    const bob = await store.adult(BOB);
    check(bob !== null && bob >= T0 + 10 && bob <= T0 + 19, `ten at once keep one yes: ${bob}`);
    const r = await store.forget(ANN, T0 + 100);
    check(r.waitUntil === null && r.deleted === 1 && r.kept === 0, `forget deletes the yes: ${JSON.stringify(r)}`);
    check((await store.adult(ANN)) === null && (await store.adult(BOB)) === bob, "ANN's yes went, BOB's stays");
    check(!(await dump()).includes(ANN), "the player's id is left nowhere");
  });

  add("forget deletes the player's credits, in one step with the payers: an unused credit's order keeps its payer (whoever paid) and the mark, a used one's keeps none", async ({ store, dump }) => {
    const used = await credit(store, ANN, T0);
    check((await store.useCredit(ANN, PLAY, "round-1", T0 + 100)).status === "used", "one credit used");
    // Two more paid from another wallet (BOB's) for ANN: one used, one not.
    const usedByBob = await playOrder(store, ANN, T0 + 110);
    check((await pay(store, usedByBob, T0 + 111, T0 + 111, hash(), BOB)) === "paid", "paid by BOB");
    const r2 = await store.useCredit(ANN, PLAY, "round-2", T0 + 120);
    check(r2.status === "used" && r2.credit.orderId === usedByBob.id, "BOB's credit for ANN is used");
    const unused = await credit(store, ANN, T0 + 200);
    const unusedByBob = await playOrder(store, ANN, T0 + 230);
    check((await pay(store, unusedByBob, T0 + 231, T0 + 231, hash(), BOB)) === "paid", "paid by BOB");
    const late = await playOrder(store, ANN, T0 + 300);
    await pay(store, late, late.expiresAt + CLOCK_SLACK_MS + 10);
    const look = await order(store, ANN, T0 + 400, PRICE, "look-a");
    await pay(store, look, T0 + 500);
    const bobs = await credit(store, BOB, T0 + 600);
    const at = late.holdUntil + 1;
    const r = await store.forget(ANN, at);
    check(r.waitUntil === null && r.deleted === 5 && r.kept === 6, `forget: ${JSON.stringify(r)} (deleted: one owned look and four credits; kept: six paid orders)`);
    check((await ready(store, ANN)) === "[]" && (await store.useCredit(ANN, PLAY, "round-9", at)).status === "none", "the player's credits are gone");
    const u = await store.order(used.id);
    check(u?.player === FORGOTTEN && u.payer === FORGOTTEN && u.visitor === null && u.status === "paid" && (u.forgotUnused ?? null) === null, `a used credit's order is a sale like a look's: ${JSON.stringify(u)}`);
    const n = await store.order(unused.id);
    check(n?.player === FORGOTTEN && n.payer === ANN && n.status === "paid" && n.kind === "play" && n.amount === unused.amount && n.hash !== null && n.forgotUnused === at, `an unused credit's order keeps its payer, its amount and the mark: ${JSON.stringify(n)}`);
    const ub = await store.order(usedByBob.id);
    check(ub?.payer === FORGOTTEN && (ub.forgotUnused ?? null) === null, `a used credit paid from another wallet keeps no payer (the round was played): ${JSON.stringify(ub)}`);
    const nb = await store.order(unusedByBob.id);
    check(nb?.payer === BOB && nb.forgotUnused === at, `an unused credit paid from another wallet keeps that payer and the mark: ${JSON.stringify(nb)}`);
    check((await store.order(late.id))?.payer === ANN && ((await store.order(late.id))?.forgotUnused ?? null) === null, "a late payment keeps its payer, with no mark");
    check((await store.order(look.id))?.payer === FORGOTTEN, "a paid look keeps no payer");
    check((await ready(store, BOB)).includes('"ready":1') && (await store.order(bobs.id))?.player === BOB, "another player's credit stays");
    const text = await dump();
    const left = text.split(ANN).length - 1;
    check(left === 2, `the player's id is left ${left} times in the store (only the unused credit's payer and the late payer may stay): ${text.slice(0, 400)}`);
    const again = await store.forget(ANN, at + 1);
    check(again.deleted === 0 && again.kept === 0 && again.waitUntil === null, `a second forget: ${JSON.stringify(again)}`);
    // Then BOB deletes their data: the payment of ANN's unused credit may still go back to BOB's wallet, so it keeps its payer; BOB's own credit goes.
    const b = await store.forget(BOB, at + 2);
    check(b.waitUntil === null && b.deleted === 1 && b.kept === 1, `BOB's forget: ${JSON.stringify(b)}`);
    check((await store.order(unusedByBob.id))?.payer === BOB && (await store.order(usedByBob.id))?.payer === FORGOTTEN, "an unused play BOB paid keeps BOB as its payer");
  });

  add("forget of a player who paid another player's play: a used credit's order keeps no payer, an unused one's keeps it until that credit's player deletes their data too", async ({ store }) => {
    const usedGift = await playOrder(store, BOB, T0);
    await pay(store, usedGift, T0 + 1, T0 + 1, hash(), ANN);
    check((await store.useCredit(BOB, PLAY, "round-1", T0 + 10)).status === "used", "BOB plays the gift");
    const gift = await playOrder(store, BOB, T0 + 20);
    await pay(store, gift, T0 + 21, T0 + 21, hash(), ANN);
    const at = gift.holdUntil + 1;
    const a = await store.forget(ANN, at);
    check(a.waitUntil === null && a.kept === 0, `ANN's forget: ${JSON.stringify(a)}`);
    check((await store.order(usedGift.id))?.payer === FORGOTTEN, "a played gift keeps no payer");
    check((await store.order(gift.id))?.payer === ANN && (await store.order(gift.id))?.player === BOB, "an unused gift keeps ANN as its payer: it may go back");
    const b = await store.forget(BOB, at + 1);
    check(b.waitUntil === null && b.kept === 2, `BOB's forget: ${JSON.stringify(b)}`);
    const g = await store.order(gift.id);
    check(g?.player === FORGOTTEN && g.payer === ANN && g.forgotUnused === at + 1, `the unused gift keeps its payer and gets the mark: ${JSON.stringify(g)}`);
    check((await store.order(usedGift.id))?.payer === FORGOTTEN && ((await store.order(usedGift.id))?.forgotUnused ?? null) === null, "the played gift has no mark");
  });

  return cases;
}
