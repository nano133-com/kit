// The Looks key and the shop's sheet in a fake DOM (happy-dom), against the REAL handler on the memory store: the list and its tabs, Buy through the game's
// sign-in hook, the pay sheet in TEST MODE (the stamp, no QR code, no address, the wallet key off) and live (the QR code and the nano: link), and onOwned
// when the order is paid. No real money: the payee is a test address nobody holds the key for, and nothing is sent.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { Window } from "happy-dom";
import { createMemoryShop, createShopHandler, priceRaw, reserveOrder, type ShopStore } from "../src/shop/index.js";
import { DEFAULT_LEGAL, type LegalState } from "../src/admin/legal.js";
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
function game(o: { payee?: string | null; signedIn?: boolean; catalogue?: Look[] } = {}) {
  const store: ShopStore = createMemoryShop();
  let player: string | null = o.signedIn === false ? null : "p1";
  const handler = createShopHandler({
    store,
    catalogue: o.catalogue ?? LOOKS,
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
    looks: o.catalogue ?? LOOKS,
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

test("the game's own Buy (buy(id)): a sign-in closed without a sign-in calls onSignInCancel and opens no list; a Buy in the kit's list goes back to the list", async () => {
  // The game's own looks sheet calls buy(id). The player closes the sign-in: the game gets its sheet back, and the kit opens nothing.
  const g = game({ signedIn: false });
  const cancels: string[] = [];
  let opens = 0;
  const el = root();
  const signIn = async () => (g.events.push("signIn"), false);
  const shop = mountShop(el, { ...g.opts, key: false, signIn, onOpen: () => void opens++, onSignInCancel: (id, look) => void cancels.push(`${id}:${look.name}`) });
  shop.buy("red-coat");
  assert.equal(shop.isOpen, false, "buy() starts on the next frame: a game's <dialog> that closed just before has had its close event");
  await settle();
  assert.deepEqual(g.events, ["signIn"]);
  assert.deepEqual(cancels, ["red-coat:Red Coat"]);
  assert.equal(shop.isOpen, false, "the kit's sheet stays shut");
  assert.equal(opens, 0);
  assert.equal(el.querySelector(".n133s-looks-view"), null, "no kit list");
  assert.equal(g.calls.length, 0, "no order");
  shop.destroy();

  // The same game, a Buy in the kit's own list: a closed sign-in goes back to the list, as before, and the hook does not run.
  const g2 = game({ signedIn: false });
  const el2 = root();
  const shop2 = mountShop(el2, { ...g2.opts, signIn, onSignInCancel: (id) => void cancels.push(id) });
  shop2.open();
  (el2.querySelector(".n133s-buy") as HTMLButtonElement).click();
  await settle();
  assert.ok(shop2.isOpen);
  assert.ok(el2.querySelector(".n133s-looks-view"), "the kit's list again");
  assert.deepEqual(cancels, ["red-coat:Red Coat"], "no second cancel");
  shop2.destroy();
});

test("the game's own Buy with a sign-in that works: the order and the pay sheet, and onSignInCancel does not run", async () => {
  const g = game({ signedIn: false });
  const cancels: string[] = [];
  const el = root();
  const shop = mountShop(el, { ...g.opts, key: false, onSignInCancel: (id) => void cancels.push(id) });
  shop.buy("red-coat");
  await settle();
  assert.deepEqual(g.events, ["signIn"]);
  assert.equal(g.calls[0], "POST /api/orders");
  assert.ok(el.querySelector(".n133s-pay"));
  assert.deepEqual(cancels, []);
  shop.destroy();
});

test("Buy without a sign-in hook says to sign in, and makes no order", async () => {
  const g = game({ signedIn: false });
  const el = root();
  mounted[mounted.push(mountShop(el, { ...g.opts, signIn: undefined })) - 1].buy("red-coat");
  await settle();
  assert.equal(g.calls.length, 0);
  assert.match(el.querySelector(".n133s-status")!.textContent!, /^Sign in first to buy a look\.$/);
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
  assert.equal(wallet.textContent, "Wallet off: test mode");
  assert.equal(wallet.disabled, true);
  assert.equal(pay.querySelector(".n133s-amount strong")!.textContent, "0.25 XNO");
  assert.equal(pay.querySelector(".n133s-exact"), null, "no \"Send exactly\" in test mode");
  assert.ok((pay.querySelector(".n133s-time-left") as HTMLElement).hidden, "no timer in test mode: nothing waits for a payment");
  assert.deepEqual(g.calls, ["POST /api/orders"], "test mode does not wait for a payment");
});

test("a fraction of a cent: the key says Buy $0.005 and the pay sheet asks for 0.005 XNO = $0.005, not a rounded cent", async () => {
  const half: Look = { id: "half", name: "Half", priceUsd: 0.005, change: { body: "#000000" } };
  const g = game({ payee: null, catalogue: [{ id: "plain", name: "Plain", priceUsd: 0, change: { body: "#4aa8ff" } }, half] });
  const el = root();
  const shop = mounted[mounted.push(mountShop(el, g.opts)) - 1];
  shop.open();
  await settle();
  assert.deepEqual(texts(el, ".n133s-look .n133s-btn"), ["Wearing", "Buy $0.005"]);
  shop.buy("half");
  await settle();
  const pay = el.querySelector(".n133s-pay")!;
  assert.equal(pay.querySelector(".n133s-amount strong")!.textContent, "0.005 XNO");
  assert.equal(pay.querySelector(".n133s-amount span:last-child")!.textContent, "= $0.005");
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
  assert.match(pay.querySelector(".n133s-status")!.textContent!, /Waiting for payment/);
  assert.equal(pay.querySelector(".n133s-exact")!.textContent, "Send exactly");
  assert.match(pay.querySelector(".n133s-time-left")!.textContent!, /^Ends in \d+:\d\d\.$/);
  assert.equal(pay.querySelector(".n133s-prices")!.textContent, "Price: Test feed.", "no CoinGecko among the feeds: no CoinGecko words");
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

test("a session that ended (401 at Buy): onSessionEnd runs, and the Sign in key signs in again even when signedIn() still says yes", async () => {
  const g = game({ signedIn: false });
  let ended = 0;
  const el = root();
  const shop = mountShop(el, { ...g.opts, signedIn: () => true, onSessionEnd: () => void ended++ });
  mounted.push(shop);
  shop.buy("red-coat");
  await settle();
  assert.equal(ended, 1);
  assert.deepEqual(g.events, [], "no sign-in yet: the game said yes");
  const again = [...el.querySelectorAll(".n133s-message .n133s-btn")].find((b) => b.textContent === "Sign in") as HTMLButtonElement;
  assert.ok(again, "the Sign in key");
  again.click();
  await settle();
  assert.deepEqual(g.events, ["signIn"]);
  assert.deepEqual(g.calls.slice(0, 2), ["POST /api/orders", "POST /api/orders"], "one refused order, then one after the new sign-in");
  assert.ok(el.querySelector(".n133s-pay"), "the order after the new sign-in");
});

// ---- plays: buyPlay, the "18 or older" step, the Play key, ready() ----

const PLAYS = [
  { id: "extra-round", name: "Extra round", priceUsd: 0.05, use: "round" },
  { id: "extra-life", name: "Extra life", priceUsd: 0.02, use: "life" },
];

/** A game that sells plays: the real handler with the creator's Legal card (`legal`), the plays' routes, and what the game heard. */
function playGame(o: { payee?: string | null; legal?: Partial<LegalState>; signedIn?: boolean } = {}) {
  const store = createMemoryShop();
  let player: string | null = o.signedIn === false ? null : "p1";
  const legal: LegalState = { ...DEFAULT_LEGAL, lawsConfirmedAt: 1, ...o.legal };
  const handler = createShopHandler({
    store,
    catalogue: LOOKS,
    plays: PLAYS,
    legal: () => legal,
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
  const events: string[] = [];
  const opts = {
    looks: LOOKS,
    plays: PLAYS,
    fetch: fetchFn,
    owned: () => [],
    signedIn: () => player !== null,
    signIn: async () => {
      events.push("signIn");
      player = "p1";
      return true;
    },
    worn: () => false,
    wear: () => {},
    onCredit: (id: string) => void events.push(`credit:${id}`),
  };
  return { store, handler, calls, events, opts, legal };
}

test("a play in TEST MODE: the \"18 or older\" step first (Not now closes, nothing is sold), the yes kept once, then the same pay sheet with the refund words before any step", async () => {
  const g = playGame({ payee: null });
  const el = root();
  const shop = mountShop(el, g.opts);
  mounted.push(shop);
  shop.buyPlay("extra-round");
  await settle();
  assert.equal(el.querySelector(".n133s-title")!.textContent, "Extra round");
  assert.deepEqual(texts(el, ".n133s-age .n133s-status, .n133s-age .n133s-btn"), ["Paid rounds are for players 18 and up.", "I am 18 or older", "Not now", ""]);
  assert.equal(document.activeElement, el.querySelector(".n133s-title"), "the focus is on the title, as the other sheets");
  assert.equal(el.querySelector(".n133s-pay"), null, "no pay sheet before the yes");
  (el.querySelectorAll(".n133s-age .n133s-btn")[1] as HTMLButtonElement).click(); // Not now
  await settle();
  assert.equal(shop.isOpen, false);
  assert.equal(g.store.orders.size, 0, "nothing was ordered");
  assert.equal(await g.store.adult("p1"), null);
  shop.buyPlay("extra-round");
  await settle();
  (el.querySelector(".n133s-age .n133s-primary") as HTMLButtonElement).click(); // I am 18 or older
  await settle();
  assert.ok((await g.store.adult("p1")) !== null, "the server kept the yes");
  assert.deepEqual(g.calls, ["POST /api/orders", "POST /api/orders", "POST /api/plays/adult", "POST /api/orders"]);
  const pay = el.querySelector(".n133s-pay")!;
  assert.equal(pay.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY");
  assert.equal((pay.querySelector(".n133s-foot button") as HTMLButtonElement).disabled, true);
  assert.ok(!pay.innerHTML.includes("nano_") && !pay.innerHTML.includes("nano:"));
  assert.equal(pay.querySelector(".n133s-pay-what")!.textContent, "1 round. Used once.");
  assert.equal(pay.querySelector(".n133s-amount strong")!.textContent, "0.05 XNO");
  const refund = pay.querySelector(".n133s-refund")!;
  assert.equal(refund.textContent, "Not used? Ask for your money back within 14 days. Write to the game's owner.");
  const main = [...pay.querySelector(".n133s-pay-main")!.children];
  assert.ok(main.indexOf(refund) < main.indexOf(pay.querySelector(".n133s-test-pay")!), "the refund words stand before any step");
  // Once per player: the next play goes straight to its pay sheet.
  shop.close();
  shop.buyPlay("extra-round");
  await settle();
  assert.equal(el.querySelector(".n133s-age"), null);
  assert.ok(el.querySelector(".n133s-pay"));
});

test("a play live: the QR code and the wallet key; paid: onCredit, \"Paid. Your round is ready.\", and the Play key turns to \"1 round ready\" and starts the round", async () => {
  const payee = testAddress();
  const g = playGame({ payee, legal: { adultsOnly: false, refundDays: 7, refundWords: "Ask me within {days} days." } });
  const el = root();
  const shop = mountShop(el, g.opts);
  mounted.push(shop);
  const started: string[] = [];
  const key = shop.playKey("extra-round", (id) => void started.push(id))!;
  document.body.append(key);
  assert.equal(shop.playKey("no-such", () => {}), null);
  assert.equal(key.textContent, "Play for 5¢", "the price on the key, before any step");
  key.click();
  await settle();
  const pay = el.querySelector(".n133s-pay")!;
  assert.equal(pay.querySelector(".n133s-stamp"), null);
  assert.match((pay.querySelector(".n133s-foot a") as HTMLAnchorElement).getAttribute("href")!, new RegExp(`^nano:${payee}\\?amount=50000000000000000000000000000$`));
  assert.ok(pay.querySelector("svg.n133s-qr-code"));
  assert.equal(pay.querySelector(".n133s-refund")!.textContent, "Ask me within 7 days.");
  const held = (await g.store.held())[0];
  await g.store.settle(held, { hash: hash64(), payer: testAddress(), seenMs: Date.now() }, Date.now());
  (pay.querySelector(".n133s-pay-side .n133s-btn") as HTMLButtonElement).click(); // Check again
  await settle();
  assert.deepEqual(g.events, ["credit:extra-round"]);
  assert.equal(el.querySelector(".n133s-paid")!.textContent, "Paid. Your round is ready.");
  assert.equal(key.textContent, "1 round ready");
  key.click();
  assert.deepEqual(started, ["extra-round"], "a press with a round ready starts it (the game's round start uses the credit)");
  assert.deepEqual(await shop.ready(), [{ playId: "extra-round", ready: 1, forSale: true }, { playId: "extra-life", ready: 0, forSale: false }]);
  await g.handler.use("p1", "extra-round", "round-1");
  await shop.ready();
  assert.equal(key.textContent, "Play for 5¢", "after the use, the key buys again");
  shop.destroy();
  assert.equal(key.isConnected, false, "destroy takes the key away");
});

test("a life while the creator does not sell one: its key hides after ready(); buyPlay shows the server's words and Back closes; a ready one still shows", async () => {
  const g = playGame({ legal: { adultsOnly: false } });
  const el = root();
  const shop = mountShop(el, g.opts);
  mounted.push(shop);
  const key = shop.playKey("extra-life", () => {})!;
  assert.equal(key.textContent, "Play for 2¢");
  await shop.ready();
  assert.equal(key.hidden, true, "not offered");
  shop.buyPlay("extra-life");
  await settle();
  assert.equal(el.querySelector(".n133s-message .n133s-status")!.textContent, "This game does not sell a life now.");
  assert.equal(g.store.orders.size, 0);
  (el.querySelector(".n133s-message .n133s-btn") as HTMLButtonElement).click();
  assert.equal(shop.isOpen, false, "Back goes back to the game");
  // A life paid before (a credit) stays usable, so its key shows.
  g.legal.sellLives = true;
  const o = await reserveOrder(g.store, { player: "p1", lookId: "extra-life", kind: "play", usd: "0.02", rate: 1, price: priceRaw(0.02, 1)!, visitor: null, now: Date.now() });
  await g.store.settle(o, { hash: hash64(), payer: "p1", seenMs: Date.now() }, Date.now());
  g.legal.sellLives = false;
  await shop.ready();
  assert.deepEqual([key.hidden, key.textContent], [false, "1 life ready"]);
});

test("a play with nobody signed in asks the game's sign-in first; a sign-in closed without one closes the sheet and orders nothing", async () => {
  const g = playGame({ signedIn: false, legal: { adultsOnly: false } });
  const el = root();
  const shop = mountShop(el, { ...g.opts, signIn: async () => (g.events.push("signIn"), false) });
  mounted.push(shop);
  shop.buyPlay("extra-round");
  await settle();
  assert.deepEqual(g.events, ["signIn"]);
  assert.equal(shop.isOpen, false);
  assert.deepEqual(g.calls, []);
  const box = root();
  const plain = mountShop(box, { ...g.opts, signIn: undefined });
  mounted.push(plain);
  plain.buyPlay("extra-round");
  await settle();
  assert.equal(box.querySelector(".n133s-message .n133s-status")?.textContent, "Sign in first to buy a round.");
});
