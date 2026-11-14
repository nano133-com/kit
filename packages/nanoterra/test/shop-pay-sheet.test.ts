// The pay sheet of 0.16.0 (design A, with the success of design B; Wes, 2026-11-14) in a fake DOM (happy-dom), against the REAL handler on the memory
// store where an order is made: the fixed lines that no creator option can change, the trust line only on a live order, the ways to pay gone when the order
// ended, the success that stays until its key, the creator's hooks, the offer step, and a game on the 0.15 API that changes nothing. No real money: the
// payee is a test address nobody holds the key for, and nothing is sent.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { Window } from "happy-dom";
import { createMemoryShop, createShopHandler, type PayView, type ShopStore } from "../src/shop/index.js";
import type { Look } from "../src/looks/look.js";
import { LOOKS, hash64, testAddress } from "./shop-helpers.js";

const ORIGIN = "https://game.example";
let panel: typeof import("../src/shop/panel/index.js");
let win: Window;
const mounted: { destroy(): void }[] = [];
const stops: (() => void)[] = [];

before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  panel = await import("../src/shop/panel/index.js");
});
after(async () => {
  for (const m of mounted) m.destroy();
  for (const s of stops) s();
  await win.happyDOM.close();
});

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Waits until `ok()` is true (2 s at most): an order goes through the real handler (WebCrypto), which takes longer under a full test run's load. */
const until = async (ok: () => unknown) => {
  const end = Date.now() + 2000;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};
const root = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

let visitors = 0;
/** A game on the real handler. `clock` moves the server's time (an order made "16 minutes ago" has ended). */
function game(o: { payee?: string | null; signedIn?: boolean } = {}) {
  const store: ShopStore = createMemoryShop();
  const clock = { at: Date.now() };
  const visitorKey = `visitor-${++visitors}`;
  let player: string | null = o.signedIn === false ? null : "p1";
  const handler = createShopHandler({
    store,
    catalogue: LOOKS,
    payee: o.payee === undefined ? testAddress() : o.payee,
    player: async () => player,
    rate: { feeds: ["CoinGecko", "Kraken"].map((name) => ({ name, url: `https://${name}.test/`, read: (j: { usd: number }) => j.usd })), fetch: async () => new Response(JSON.stringify({ usd: 1 })) },
    nodes: [],
    now: () => clock.at,
    // each game its own visitor: the shared limiter allows 10 orders in 10 minutes for one, and this file makes more
    visitor: async () => visitorKey,
  });
  const calls: string[] = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    const res = await handler.handle(new Request(`${ORIGIN}${input}`, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: ORIGIN } }));
    return res ?? new Response(JSON.stringify({ error: "No such route." }), { status: 404 });
  }) as unknown as typeof fetch;
  const worn = new Map<string, string>([["outfit", "plain"]]);
  const owned: string[] = [];
  const events: string[] = [];
  // The 0.15 options, and nothing of 0.16.0.
  const opts = {
    looks: LOOKS,
    fetch: fetchFn,
    owned: () => owned,
    signedIn: () => player !== null,
    signIn: async () => {
      events.push("signIn");
      player = "p1";
      return true;
    },
    worn: (l: Look) => worn.get(l.wear ?? "outfit") === l.id,
    wear: (l: Look) => void worn.set(l.wear ?? "outfit", l.id),
    onOwned: (id: string, l: Look) => {
      events.push(`owned:${id}`);
      owned.push(id);
      worn.set(l.wear ?? "outfit", l.id);
    },
  };
  /** Pays the player's held order, as the scan would (straight in the store: no node, no money). */
  const pay = async () => {
    const id = (await store.held())[0];
    await store.settle(id, { hash: hash64(), payer: testAddress(), seenMs: clock.at }, clock.at);
  };
  return { store, handler, clock, calls, events, opts, pay };
}

const wallet = (el: Element) => el.querySelector(".n133s-wallet, .n133s-foot a, .n133s-foot button") as HTMLElement | null;
/** Whether an element is shown: nothing hides it (the attribute) from it up to the sheet. */
const shown = (el: Element | null) => {
  for (let n = el; n; n = n.parentElement) if ((n as HTMLElement).hidden) return false;
  return !!el;
};

test("the trust line: on a live order only; never in test mode; never when the link does not pay the order's own address", async () => {
  const live = game();
  const a = root();
  const shopA = panel.mountShop(a, live.opts);
  mounted.push(shopA);
  shopA.buy("red-coat");
  await until(() => a.querySelector(".n133s-pay"));
  assert.equal(a.querySelector(".n133s-trust")?.textContent, "Paid straight to the creator. No network fee.");
  assert.equal(panel.TRUST_LINE, "Paid straight to the creator. No network fee.");

  const t = game({ payee: null });
  const b = root();
  const shopB = panel.mountShop(b, t.opts);
  mounted.push(shopB);
  shopB.buy("red-coat");
  await until(() => b.querySelector(".n133s-pay"));
  assert.ok(b.querySelector(".n133s-stamp"), "test mode");
  assert.equal(b.querySelector(".n133s-trust"), null, "no trust line in test mode: nothing can be paid");
  assert.ok(!b.textContent!.includes("No network fee"));

  // An answer whose link pays another address than the order's (never made by the kit's server): no claim.
  const base: PayView = { id: "x", lookId: "red-coat", usd: "0.25", amount: "1", xno: "0.25", status: "open", createdAt: Date.now(), expiresAt: Date.now() + 900_000, test: false, prices: [] };
  const other = testAddress();
  assert.equal(panel.trustShown({ ...base, address: testAddress(), uri: `nano:${other}?amount=1` }), false);
  assert.equal(panel.trustShown({ ...base, address: other, uri: `nano:${other}?amount=1` }), true);
  assert.equal(panel.trustShown({ ...base, test: true, address: other, uri: `nano:${other}?amount=1` }), false);
  assert.equal(panel.trustShown(base), false, "no address, no link");
});

test("the fixed lines: no creator option or word changes the amount, the link, the QR code, the price line, the stamp or the trust line", async () => {
  const g = game();
  const el = root();
  const words = { trust: "Free money!", TRUST_LINE: "Free money!", prices: () => "", amount: (x: string) => `${x} XNO` } as unknown as Parameters<typeof panel.mountShop>[1]["words"];
  const shop = panel.mountShop(el, {
    ...g.opts,
    words,
    preview: () => {
      const fake = document.createElement("span");
      fake.className = "n133s-trust";
      fake.textContent = "fake";
      return fake;
    },
    next: () => ({ label: "Go", run: () => {} }),
    celebrate: () => {},
    offer: true,
  });
  mounted.push(shop);
  shop.buy("blue-cap");
  await until(() => el.querySelector(".n133s-pay"));
  const pay = el.querySelector(".n133s-pay")!;
  const trust = pay.querySelector(".n133s-fine-lines .n133s-trust")!;
  assert.equal(trust.textContent, "Paid straight to the creator. No network fee.", "the kit's words, whatever the game's words say");
  assert.equal(pay.querySelector(".n133s-prices")!.textContent, "Powered by CoinGecko.", "CoinGecko's words stay");
  assert.equal(pay.querySelector(".n133s-amount strong")!.textContent, "0.25 XNO");
  const order = [...g.store.orders.values()][0];
  assert.equal((wallet(pay) as HTMLAnchorElement).getAttribute("href"), `nano:${order.address ?? g.handler.payee}?amount=${order.amount}`);
  assert.ok(pay.querySelector("svg.n133s-qr-code"));
  // the game's picture sits in its frame, decorative, and is no line of the sheet
  assert.equal(pay.querySelector(".n133s-item-pic .n133s-trust")!.closest("[aria-hidden='true']") !== null, true);

  const t = game({ payee: null });
  const el2 = root();
  const shop2 = panel.mountShop(el2, { ...t.opts, words: { walletOff: "Wallet: test", testNote: "" } });
  mounted.push(shop2);
  shop2.buy("blue-cap");
  await until(() => el2.querySelector(".n133s-pay"));
  assert.equal(el2.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY");
  assert.equal((el2.querySelector(".n133s-foot button") as HTMLButtonElement).disabled, true);
  assert.equal(el2.querySelector(".n133s-copy"), null, "no copy key for an amount nobody can pay");
});

test("the order ended (the server's answer): no wallet link, no QR code, no copy key; Check again stays; the ended words reach a screen reader", async () => {
  const g = game();
  const el = root();
  const shop = panel.mountShop(el, g.opts);
  mounted.push(shop);
  shop.buy("red-coat");
  await until(() => el.querySelector(".n133s-pay"));
  const pay = el.querySelector(".n133s-pay") as HTMLElement;
  assert.ok(shown(wallet(pay)) && (wallet(pay) as HTMLAnchorElement).getAttribute("href")!.startsWith("nano:"), "live: the wallet key works");
  g.clock.at += 16 * 60_000; // the server's clock past the order's end
  (pay.querySelector(".n133s-again") as HTMLButtonElement).click();
  await until(() => pay.dataset.state === "ended");
  assert.equal(pay.dataset.state, "ended");
  assert.equal(shown(wallet(pay)), false, "no wallet key");
  assert.equal(pay.querySelector("a[href^='nano:']"), null, "no link at all: a key a game's CSS shows again opens no wallet");
  assert.equal(shown(pay.querySelector(".n133s-qr")), false, "no QR code");
  assert.equal(shown(pay.querySelector(".n133s-copy")), false, "no copy key");
  assert.ok(shown(pay.querySelector(".n133s-again")), "Check again stays: a payment sent in time still counts");
  const status = pay.querySelector(".n133s-status")!;
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent, "This order ended. Paid in time? Wait here: it still counts.");
});

test("the order ended by the clock (the order's own expiresAt), before any answer: the ways to pay go at once; a late payment keeps them gone", async () => {
  let now = 1_000_000;
  const start: PayView = { id: "o1", lookId: "red-coat", usd: "0.25", amount: "1", xno: "0.25", status: "open", createdAt: now, expiresAt: now + 900_000, test: false, address: testAddress(), prices: ["Kraken"] };
  start.uri = `nano:${start.address}?amount=1`;
  let answer: PayView = start;
  const p = panel.payPanel(start, { lookName: "Red Coat", check: async () => answer, onPaid: () => {}, now: () => now, main: "wallet" });
  stops.push(p.stop);
  document.body.append(p.node);
  await settle();
  assert.equal(p.node.dataset.main, "wallet");
  assert.ok(shown(wallet(p.node)));
  // the wallet key leads on a phone: it comes before the QR code's fold
  assert.ok(p.node.querySelector(".n133s-foot")!.compareDocumentPosition(p.node.querySelector(".n133s-other")!) & 4);
  assert.equal(p.node.querySelector(".n133s-other summary")!.textContent, "Pay from another device");
  now += 900_000;
  await new Promise((r) => setTimeout(r, 1100)); // one tick of the clock
  assert.equal(p.node.dataset.state, "ended");
  assert.equal(p.node.querySelector("a[href^='nano:']"), null);
  answer = { ...start, status: "paid_late" };
  (p.node.querySelector(".n133s-again") as HTMLButtonElement).click();
  await settle();
  assert.equal(p.node.dataset.state, "late");
  assert.equal(p.node.querySelector("a[href^='nano:']"), null);
  assert.match(p.node.querySelector(".n133s-status")!.textContent!, /no look\. The creator sends it back\./);
  p.stop();
});

test("paid: the success stays open until its key; the key closes the sheet, then runs the game's next; a screen reader hears it; the game's moment runs once", async () => {
  const g = game();
  const el = root();
  const order: string[] = [];
  const celebrated: string[] = [];
  const shop = panel.mountShop(el, {
    ...g.opts,
    next: (item) => ({ label: "Wear it now", run: () => void order.push(`next:${item.kind}:${shop.isOpen}`) }),
    celebrate: (item, calm) => void celebrated.push(`${item.kind}:${calm}`),
    onClose: () => void order.push("closed"),
  });
  mounted.push(shop);
  shop.buy("red-coat");
  await until(() => el.querySelector(".n133s-pay"));
  await g.pay();
  (el.querySelector(".n133s-again") as HTMLButtonElement).click();
  await until(() => (el.querySelector(".n133s-pay") as HTMLElement).dataset.state !== "waiting");
  const pay = el.querySelector(".n133s-pay") as HTMLElement;
  assert.equal(pay.dataset.state, "paid");
  assert.ok(shop.isOpen, "the sheet stays on the success");
  assert.ok(shown(pay.querySelector(".n133s-success")));
  assert.equal(pay.querySelector(".n133s-success-title")!.textContent, "Red Coat is yours");
  assert.equal(pay.querySelector(".n133s-success-line")!.textContent, "You are wearing it now.", "the game's worn() says yes after onOwned");
  assert.equal(pay.querySelector(".n133s-sr[role='status']")!.textContent, "Paid.");
  assert.deepEqual(celebrated, ["look:false"]);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(shop.isOpen, "still open: nothing closes it by itself");
  const key = pay.querySelector(".n133s-next") as HTMLButtonElement;
  assert.equal(key.textContent, "Wear it now");
  key.click();
  assert.equal(shop.isOpen, false);
  assert.deepEqual(order, ["closed", "next:look:false"], "the sheet closes first, then the game's next runs");
  assert.deepEqual(g.events, ["owned:red-coat"]);
});

test("a game on the 0.15 API (no 0.16.0 option): the same exports work; paid shows the success with \"Keep playing\", which closes; no wearing line when the game does not wear it", async () => {
  for (const name of ["mountShop", "looksView", "slotsOf", "PAY_TIMING", "isTestOrder", "payPanel", "qrModules", "qrSvg", "qrVersionFor", "COINGECKO_CREDIT", "SHOP_WORDS", "playPrice", "priceLine", "shopWords", "useWord"])
    assert.ok(name in panel, `${name} is still exported`);
  const g = game();
  const el = root();
  const shop = panel.mountShop(el, { ...g.opts, onOwned: (id: string) => void g.events.push(`owned:${id}`) }); // owns, but does not wear
  mounted.push(shop);
  shop.buy("blue-cap");
  await until(() => el.querySelector(".n133s-pay"));
  await g.pay();
  (el.querySelector(".n133s-again") as HTMLButtonElement).click();
  await until(() => (el.querySelector(".n133s-pay") as HTMLElement).dataset.state !== "waiting");
  assert.deepEqual(g.events, ["owned:blue-cap"]);
  assert.equal(el.querySelector(".n133s-success-line"), null, "the game does not wear it: no claim that it does");
  const key = el.querySelector(".n133s-next") as HTMLButtonElement;
  assert.equal(key.textContent, "Keep playing");
  key.click();
  assert.equal(shop.isOpen, false);
  // A game's onOwned that closes the sheet itself (the 0.15 way) still works: the sheet closes, and the game's moment does not run on a closed sheet.
  const g2 = game();
  const el2 = root();
  let moments = 0;
  const shop2: ReturnType<typeof panel.mountShop> = panel.mountShop(el2, { ...g2.opts, onOwned: () => shop2.close(), celebrate: () => void moments++ });
  mounted.push(shop2);
  shop2.buy("blue-cap");
  await until(() => el2.querySelector(".n133s-pay"));
  await g2.pay();
  (el2.querySelector(".n133s-again") as HTMLButtonElement).click();
  await until(() => (el2.querySelector(".n133s-pay") as HTMLElement).dataset.state !== "waiting");
  assert.equal(shop2.isOpen, false);
  assert.equal(moments, 0);
  // payPanel with the 0.15 options only
  const t: PayView = { id: "o", lookId: "red-coat", usd: "0.25", amount: "1", xno: "0.25", status: "open", createdAt: Date.now(), expiresAt: Date.now() + 900_000, test: true, prices: ["CoinGecko"] };
  const p = panel.payPanel(t, { lookName: "Red Coat", check: async () => t, onPaid: () => {} });
  stops.push(p.stop);
  assert.equal(p.node.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY");
  p.stop();
});

test("the offer step (the kit's own list): the look large and its price on one key; no sign-in and no order before the key; offer: false goes straight on", async () => {
  const g = game({ signedIn: false });
  const el = root();
  const shop = panel.mountShop(el, g.opts);
  mounted.push(shop);
  shop.open();
  (el.querySelector(".n133s-buy") as HTMLButtonElement).click();
  await settle();
  assert.equal(el.querySelector(".n133s-title")!.textContent, "Red Coat");
  assert.ok(el.querySelector(".n133s-offer .n133s-stage .n133s-pic"));
  assert.equal(el.querySelector(".n133s-offer-key")!.textContent, "Buy $0.25");
  assert.equal(el.querySelector(".n133s-trust"), null, "no trust line before an order: the kit does not know test mode yet");
  assert.deepEqual(g.events, []);
  assert.deepEqual(g.calls, []);
  (el.querySelector(".n133s-offer-key") as HTMLButtonElement).click();
  await until(() => el.querySelector(".n133s-pay"));
  assert.deepEqual(g.events, ["signIn"]);
  assert.equal(g.calls[0], "POST /api/orders", "the order only after the key");
  assert.ok(el.querySelector(".n133s-pay"));

  const g2 = game();
  const el2 = root();
  const shop2 = panel.mountShop(el2, { ...g2.opts, offer: false });
  mounted.push(shop2);
  shop2.open();
  (el2.querySelector(".n133s-buy") as HTMLButtonElement).click();
  await until(() => el2.querySelector(".n133s-pay"));
  assert.equal(el2.querySelector(".n133s-offer"), null);
  assert.equal(g2.calls[0], "POST /api/orders");
  // The game's own Buy never has the offer step: its shelf showed the look.
  const g3 = game();
  const el3 = root();
  const shop3 = panel.mountShop(el3, g3.opts);
  mounted.push(shop3);
  shop3.buy("red-coat");
  await until(() => el3.querySelector(".n133s-pay"));
  assert.equal(el3.querySelector(".n133s-offer"), null);
  assert.ok(el3.querySelector(".n133s-pay"));
});

test("the creator's preview: its picture at 64 px beside the line and 128 px on the success; a preview that throws falls back to the kit's own", async () => {
  const sizes: string[] = [];
  const g = game();
  const el = root();
  const shop = panel.mountShop(el, {
    ...g.opts,
    preview: (item, size) => {
      sizes.push(`${item.kind}:${item.kind === "look" ? item.look.id : item.play.id}:${size}`);
      const c = document.createElement("canvas");
      c.className = "game-pic";
      return c;
    },
  });
  mounted.push(shop);
  shop.buy("red-coat");
  await until(() => el.querySelector(".n133s-pay"));
  assert.ok(el.querySelector(".n133s-item-pic .game-pic"));
  await g.pay();
  (el.querySelector(".n133s-again") as HTMLButtonElement).click();
  await until(() => (el.querySelector(".n133s-pay") as HTMLElement).dataset.state !== "waiting");
  assert.ok(el.querySelector(".n133s-success-pic .game-pic"));
  assert.deepEqual(sizes, ["look:red-coat:64", "look:red-coat:128"]);
  const pic = panel.itemPicture("Mint Cap", 64, () => {
    throw new Error("the game's picture failed");
  });
  assert.equal(pic.textContent, "M");
  assert.equal(pic.getAttribute("aria-hidden"), "true");
});

test("reduced motion: the options' Less motion (reflectOptions on <html>) is calm too, and the game's moment hears it", () => {
  assert.equal(panel.calmNow(), false);
  document.documentElement.setAttribute("data-n133-opt-reduced-motion", "true");
  assert.equal(panel.calmNow(), true);
  document.documentElement.setAttribute("data-n133-opt-reduced-motion", "false");
  assert.equal(panel.calmNow(), false);
  document.documentElement.removeAttribute("data-n133-opt-reduced-motion");
});

test("the focus: back to the game's own key that opened the sheet, when it is still there", async () => {
  const g = game();
  const el = root();
  const mine = document.createElement("button");
  mine.textContent = "Buy";
  document.body.append(mine);
  mine.focus();
  const shop = panel.mountShop(el, { ...g.opts, key: false });
  mounted.push(shop);
  shop.open();
  assert.equal(document.activeElement, el.querySelector(".n133s-title"));
  shop.close();
  assert.equal(document.activeElement, mine, "the focus came back");
  mine.remove();
});
