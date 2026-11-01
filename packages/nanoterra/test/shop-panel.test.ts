// The Looks key and the shop's sheet in a fake DOM (happy-dom), against the REAL handler on the memory store: the list and its tabs, Buy through the game's
// sign-in hook, the pay sheet in TEST MODE (the stamp, no QR code, no address, the wallet key off) and live (the QR code and the nano: link), and onOwned
// when the order is paid. No real money: the payee is a test address nobody holds the key for, and nothing is sent.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { Window } from "happy-dom";
import { createMemoryShop, createShopHandler, type ShopStore } from "../src/shop/index.js";
import type { Look } from "../src/looks/look.js";
import { LOOKS, hash64, testAddress } from "./shop-helpers.js";

const ORIGIN = "https://game.example";
let mountShop: typeof import("../src/shop/panel/index.js").mountShop;
let win: Window;

before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  ({ mountShop } = await import("../src/shop/panel/index.js"));
});
// Every sheet is destroyed (its timers stop) and the fake window closes, so the test process ends.
const mounted: { destroy(): void }[] = [];
after(async () => {
  for (const m of mounted) m.destroy();
  await win.happyDOM.close();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) await tick();
};
const root = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

/** A game: the real handler, a player that signs in when asked, and what it wears. */
function game(o: { payee?: string | null; signedIn?: boolean } = {}) {
  const store: ShopStore = createMemoryShop();
  let player: string | null = o.signedIn === false ? null : "p1";
  const handler = createShopHandler({
    store,
    catalogue: LOOKS,
    payee: o.payee === undefined ? testAddress() : o.payee,
    player: async () => player,
    rate: { feeds: [{ name: "Test feed", url: "https://feed.test/", read: (j) => j.usd }], fetch: async () => new Response(JSON.stringify({ usd: 1 })) },
    nodes: [],
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
    takeOff: (slot: string) => void worn.delete(slot),
    onOwned: (id: string) => void (events.push(`owned:${id}`), owned.push(id)),
  };
  return { store, handler, calls, worn, owned, events, opts };
}

const sheet = (el: HTMLElement) => el.querySelector("dialog.n133s-sheet") as HTMLDialogElement;
const texts = (el: Element, sel: string) => [...el.querySelectorAll(sel)].map((e) => e.textContent?.trim());

test("the key opens the looks: the outfits first, a tab for each wear slot, every price before any step", async () => {
  const g = game();
  const el = root();
  const shop = mountShop(el, g.opts);
  const key = el.querySelector(".n133s-key") as HTMLButtonElement;
  assert.equal(key.textContent, "Looks");
  key.click();
  assert.ok(shop.isOpen);
  assert.deepEqual(texts(el, ".n133s-tab"), ["Outfits", "Spade", "Charm"]);
  assert.deepEqual(texts(el, ".n133s-look strong"), ["Plain", "Red Coat", "Blue Cap", "Gold Crown"]);
  assert.deepEqual(texts(el, ".n133s-look .n133s-btn"), ["Wearing", "Buy $0.25", "Buy $0.25", "Buy $1.00"]);
  (el.querySelectorAll(".n133s-tab")[1] as HTMLButtonElement).click();
  assert.deepEqual(texts(el, ".n133s-look strong"), ["No spade", "Wood Spade"], "an item tab starts with its plain choice");
  assert.deepEqual(texts(el, ".n133s-look .n133s-btn"), ["Wearing", "Buy $0.10"]);
  shop.destroy();
  assert.equal(el.children.length, 0);
});

test("key: false draws no key; the game opens the sheet with open() and its own Buy with buy(id)", async () => {
  const g = game();
  const el = root();
  const shop = mountShop(el, { ...g.opts, key: false });
  assert.equal(el.querySelector(".n133s-key"), null);
  shop.open();
  assert.ok(shop.isOpen);
  shop.close();
  assert.equal(shop.isOpen, false);
  shop.buy("red-coat");
  await settle();
  assert.equal(el.querySelector(".n133s-title")!.textContent, "Buy Red Coat");
  shop.destroy();
});

test("Buy with nobody signed in asks the game's sign-in first, then makes the order (the shop draws no sign-in of its own)", async () => {
  const g = game({ signedIn: false });
  const el = root();
  mounted[mounted.push(mountShop(el, g.opts)) - 1].buy("red-coat");
  await settle();
  assert.deepEqual(g.events, ["signIn"]);
  assert.equal(g.calls[0], "POST /api/orders");
  assert.ok(el.querySelector(".n133s-pay"));
});

test("Buy without a sign-in hook says to sign in, and makes no order", async () => {
  const g = game({ signedIn: false });
  const el = root();
  mounted[mounted.push(mountShop(el, { ...g.opts, signIn: undefined })) - 1].buy("red-coat");
  await settle();
  assert.equal(g.calls.length, 0);
  assert.match(el.querySelector(".n133s-status")!.textContent!, /sign in with Nano first/);
});

test("TEST MODE: the stamp says DO NOT PAY; no QR code, no address, no nano: link; the wallet key is off; no checks are made", async () => {
  const g = game({ payee: null });
  const el = root();
  mounted[mounted.push(mountShop(el, g.opts)) - 1].buy("red-coat");
  await settle();
  const pay = el.querySelector(".n133s-pay")!;
  assert.equal(pay.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY");
  assert.equal(pay.querySelector(".n133s-qr-code"), null);
  assert.equal(pay.querySelector("a[href]"), null);
  assert.ok(!pay.innerHTML.includes("nano_") && !pay.innerHTML.includes("nano:"));
  const wallet = pay.querySelector(".n133s-foot button") as HTMLButtonElement;
  assert.equal(wallet.textContent, "Open wallet (off in test mode)");
  assert.equal(wallet.disabled, true);
  assert.equal(pay.querySelector(".n133s-amount strong")!.textContent, "0.25 XNO");
  assert.deepEqual(g.calls, ["POST /api/orders"], "test mode does not wait for a payment");
});

test("live: the QR code of the exact nano: link, the wallet key, the address by hand; a paid order tells the game (onOwned) and the look is the player's", async () => {
  const payee = testAddress();
  const g = game({ payee });
  const el = root();
  const shop = mountShop(el, g.opts);
  shop.buy("blue-cap");
  await settle();
  const pay = el.querySelector(".n133s-pay")!;
  assert.equal(pay.querySelector(".n133s-stamp"), null);
  const link = pay.querySelector(".n133s-foot a") as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), `nano:${payee}?amount=250000000000000000000000000000`);
  const qr = pay.querySelector("svg.n133s-qr-code")!;
  assert.equal(qr.getAttribute("aria-label"), "QR code to pay 0.25 XNO");
  assert.ok((qr.querySelector("path")!.getAttribute("d") ?? "").length > 1000);
  assert.equal(pay.querySelector(".n133s-address")!.textContent, payee);
  assert.match(pay.querySelector(".n133s-status")!.textContent!, /Waiting for your payment/);
  // The payment arrives (recorded straight in the store; the scan has no node here), and the next check sees it.
  const id = g.calls.length && (await g.store.held())[0];
  assert.ok(id);
  await g.store.settle(id, { hash: hash64(), payer: testAddress(), seenMs: Date.now() }, Date.now());
  (pay.querySelector(".n133s-pay-side .n133s-btn") as HTMLButtonElement).click(); // "Check again" (hidden, but a click starts a check)
  await settle();
  assert.deepEqual(g.events, ["owned:blue-cap"]);
  assert.match(el.querySelector(".n133s-paid")!.textContent!, /Paid\. Thank you!/);
  shop.close();
  shop.open();
  assert.deepEqual(texts(el, ".n133s-look .n133s-btn").slice(0, 3), ["Wearing", "Buy $0.25", "Wear"], "Blue Cap is the player's now");
  shop.destroy();
});

test("a refusal shows the server's words and the way back to the looks", async () => {
  const g = game();
  g.owned.length = 0;
  const el = root();
  const shop = mountShop(el, { ...g.opts, looks: [...(LOOKS as Look[]), { id: "ghost", name: "Ghost", priceUsd: 0.5, change: { body: "#eeeeee" } }] });
  shop.buy("ghost");
  await settle();
  assert.equal(el.querySelector(".n133s-status")!.textContent, "That look does not exist.");
  (el.querySelector(".n133s-message .n133s-btn") as HTMLButtonElement).click();
  assert.ok(el.querySelector(".n133s-looks-view"));
  shop.destroy();
});

test("the theme: the game's word, else the page's data-n133-theme", () => {
  const g = game();
  document.documentElement.setAttribute("data-n133-theme", "dark");
  const a = root();
  mounted.push(mountShop(a, g.opts));
  assert.equal(a.querySelector(".n133-shop")!.getAttribute("data-theme"), "dark");
  const b = root();
  mounted.push(mountShop(b, { ...g.opts, theme: "light" }));
  assert.equal(b.querySelector(".n133-shop")!.getAttribute("data-theme"), "light");
  document.documentElement.removeAttribute("data-n133-theme");
});
