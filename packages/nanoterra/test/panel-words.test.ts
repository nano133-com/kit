// The words of the shop's sheets and of the player's sign-in sheet (happy-dom): the defaults stay short (the pay sheet at most 30 words, in TEST MODE and
// live; no sentence over 10 words), the safety lines stay, and a game's `words` reach the page. No real money: the live payee is a test address nobody
// holds the key for, and nothing is sent.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { Window } from "happy-dom";
import { createMemoryShop, createShopHandler } from "../src/shop/index.js";
import { LOOKS, testAddress } from "./shop-helpers.js";
import { DEFAULT_LEGAL } from "../src/admin/legal.js";

const ORIGIN = "https://game.example";
let shopPanel: typeof import("../src/shop/panel/index.js");
let signinPanel: typeof import("../src/player-signin/panel/index.js");
let win: Window;
const mounted: { destroy(): void }[] = [];

before(async () => {
  win = new Window({ url: ORIGIN });
  for (const [k, v] of Object.entries({ document: win.document, window: win, location: win.location, localStorage: win.localStorage, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent }))
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  shopPanel = await import("../src/shop/panel/index.js");
  signinPanel = await import("../src/player-signin/panel/index.js");
});
after(async () => {
  for (const m of mounted) m.destroy();
  await win.happyDOM.close();
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

// ---- counting what a player reads ----

const BLOCKS = new Set(["P", "H1", "H2", "H3", "DIV", "BUTTON", "SUMMARY", "LI", "UL", "HEADER", "DETAILS", "SECTION", "DIALOG"]);

/** The visible text, one line per block: hidden elements, aria-hidden ones and a closed fold's content (all but its summary) are left out. */
function visibleLines(root: Element): string[] {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
    line = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      line += node.textContent;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return;
    const block = BLOCKS.has(el.tagName) || (el.tagName === "A" && el.classList.contains("n133s-btn"));
    if (block) flush();
    // Inline parts are set apart on the page (a gap, a line of their own): a space keeps their words apart here.
    else line += " ";
    const closed = el.tagName === "DETAILS" && !el.hasAttribute("open");
    for (const child of Array.from(el.childNodes)) {
      if (closed && (child as Element).tagName !== "SUMMARY") continue;
      walk(child);
    }
    if (block) flush();
    else line += " ";
  };
  walk(root);
  flush();
  return lines;
}

const wordsOf = (text: string) => text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
const sentencesOf = (text: string) => text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim());
const longest = (lines: string[]) => Math.max(0, ...lines.flatMap(sentencesOf).map((s) => wordsOf(s).length));
const count = (lines: string[]) => lines.reduce((n, l) => n + wordsOf(l).length, 0);

/** A game with the real handler and the kit's three feed names (each answers $1). */
function game(payee: string | null) {
  const handler = createShopHandler({
    store: createMemoryShop(),
    catalogue: LOOKS,
    payee,
    player: async () => "p1",
    rate: { feeds: ["CoinGecko", "Kraken", "KuCoin"].map((name) => ({ name, url: `https://${name}.test/`, read: (j: { usd: number }) => j.usd })), fetch: async () => new Response(JSON.stringify({ usd: 1 })) },
    nodes: [],
  });
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const res = await handler.handle(new Request(`${ORIGIN}${input}`, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: ORIGIN } }));
    return res ?? new Response(JSON.stringify({ error: "No such route." }), { status: 404 });
  }) as unknown as typeof fetch;
  const owned: string[] = [];
  return { looks: LOOKS, fetch: fetchFn, owned: () => owned, signedIn: () => true, signIn: async () => true, worn: (l: { id: string }) => l.id === "plain", wear: () => {}, takeOff: () => {} };
}

async function paySheet(payee: string | null, words?: Parameters<typeof shopPanel.mountShop>[1]["words"]) {
  const el = document.createElement("div");
  document.body.append(el);
  const shop = shopPanel.mountShop(el, { ...game(payee), words });
  mounted.push(shop);
  shop.buy("red-coat");
  await settle();
  return el.querySelector("dialog")!;
}

test("the pay sheet in TEST MODE: at most 30 words, no sentence over 10; the stamp word for word, nothing can be paid, the wallet key off with its reason", async (t) => {
  const sheet = await paySheet(null);
  const lines = visibleLines(sheet);
  t.diagnostic(`TEST MODE: ${count(lines)} words, longest sentence ${longest(lines)}: ${lines.join(" | ")}`);
  assert.ok(count(lines) <= 30, `${count(lines)} words`);
  assert.ok(longest(lines) <= 10, `a sentence of ${longest(lines)} words`);
  assert.equal(sheet.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY");
  assert.ok(lines.includes("Nothing can be paid here."));
  assert.equal((sheet.querySelector(".n133s-foot button") as HTMLButtonElement).disabled, true);
  assert.ok(lines.includes("Wallet off: test mode"));
  assert.ok(lines.some((l) => l.includes("Powered by CoinGecko")));
});

test("the pay sheet live: at most 30 words, no sentence over 10; send the exact amount, the order ends at the timer, Powered by CoinGecko", async (t) => {
  const sheet = await paySheet(testAddress());
  const lines = visibleLines(sheet);
  t.diagnostic(`live: ${count(lines)} words, longest sentence ${longest(lines)}: ${lines.join(" | ")}`);
  assert.ok(count(lines) <= 30, `${count(lines)} words`);
  assert.ok(longest(lines) <= 10, `a sentence of ${longest(lines)} words`);
  assert.ok(lines.some((l) => l.startsWith("Send exactly 0.25 XNO")));
  assert.ok(lines.some((l) => /^Ends in \d+:\d\d\.$/.test(l)));
  assert.ok(lines.includes("Price: Kraken, KuCoin. Powered by CoinGecko."));
  // The fold open: the amount and the address by hand, and the words that another amount does not match.
  sheet.querySelector("details")!.setAttribute("open", "");
  const open = visibleLines(sheet);
  t.diagnostic(`live, by hand open: ${count(open)} words, longest sentence ${longest(open)}`);
  assert.ok(longest(open) <= 10);
  assert.ok(open.includes("Another amount does not match."));
});

test("the looks sheet: its own words (beside the list) at most 30, no sentence over 10", async (t) => {
  const el = document.createElement("div");
  document.body.append(el);
  const g = game(null);
  const shop = shopPanel.mountShop(el, { ...g, signedIn: () => false });
  mounted.push(shop);
  shop.open();
  const sheet = el.querySelector("dialog")!;
  const all = visibleLines(sheet);
  const rows = visibleLines(sheet.querySelector(".n133s-looks")!);
  t.diagnostic(`looks: ${count(all)} words in all, ${count(all) - count(rows)} beside the list, longest sentence ${longest(all)}: ${all.join(" | ")}`);
  assert.ok(count(all) - count(rows) <= 30);
  assert.ok(longest(all) <= 10);
});

test("every default word of the two sheets: no sentence over 10 words; the late payment, the expired order and the faults keep their meaning", () => {
  // Each function with a long sample value: a two-word name, a host, the three feeds, a hat.
  const sample = (key: string, v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (typeof v === "function") {
      if (key === "prices") return [v(["CoinGecko", "Kraken", "KuCoin"])];
      if (key === "outfitLine") return ["cap", "beanie", "crown", "tophat", null].map((hat) => v(hat));
      return [v("Berry Wallet", 0), v("my-game.example.com", 0)];
    }
    if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => sample(k, x));
    return [];
  };
  for (const words of [shopPanel.SHOP_WORDS, signinPanel.PLAYER_SIGNIN_WORDS])
    for (const [key, v] of Object.entries(words))
      for (const text of sample(key, v)) for (const s of sentencesOf(text)) assert.ok(wordsOf(s).length <= 10, `${key}: "${s}" has ${wordsOf(s).length} words`);
  const w = shopPanel.SHOP_WORDS;
  assert.match(w.paidLate, /no look/);
  assert.match(w.paidLate, /creator sends it back/);
  assert.match(w.expired, /in time/);
  assert.equal(signinPanel.faultWords("wrong-host", "game.example").text, "Passkeys for this game work only on game.example.");
  assert.equal(signinPanel.faultWords("no-prf", "game.example").next, "wallets");
});

test("a game's words reach the shop's sheets: a text and a function; CoinGecko's words stay even when the game's words leave them out", async () => {
  const sheet = await paySheet(testAddress(), { sendExactly: "Pay exactly", buyTitle: (look) => `Get ${look}`, prices: () => "Prix", stillWaiting: undefined });
  assert.equal(sheet.querySelector(".n133s-title")!.textContent, "Get Red Coat");
  assert.equal(sheet.querySelector(".n133s-exact")!.textContent, "Pay exactly");
  assert.equal(sheet.querySelector(".n133s-prices")!.textContent, "Prix Powered by CoinGecko.");
  assert.equal(shopPanel.shopWords({ stillWaiting: undefined }).stillWaiting, shopPanel.SHOP_WORDS.stillWaiting, "undefined keeps the default");
  const test = await paySheet(null, { walletOff: "Wallet: test" });
  assert.equal(test.querySelector(".n133s-foot button")!.textContent, "Wallet: test");
  assert.equal(test.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY", "the stamp is not the game's to change");
});

test("a game's words reach the sign-in sheet: a text, a function, and one fault (faultWords takes the words)", async () => {
  const words = { lead: "Kein Passwort.", waitingFor: (wallet: string) => `Warte auf ${wallet}…`, faults: { cancelled: { title: "Abgebrochen", text: "Kein Passkey." } } };
  const host = document.createElement("div");
  document.body.append(host);
  const sheet = signinPanel.mountPlayerSignin(host, { name: "Game Example", passkey: false, words: { ...words, title: "Anmelden" }, fetch: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch });
  mounted.push(sheet);
  void sheet.open();
  assert.equal(host.querySelector(".n133s-title")!.textContent, "Anmelden");
  assert.equal(host.querySelector(".n133s-lead")!.textContent, "Kein Passwort.");
  assert.equal(host.querySelector(".n133s-or")!.textContent, "Choose your wallet", "a key left out keeps its default");
  assert.deepEqual(signinPanel.faultWords("cancelled", "game.example", words), { title: "Abgebrochen", text: "Kein Passkey.", next: "stay" });
  assert.equal(signinPanel.faultWords("unsupported", "game.example", words).title, "No passkeys here");
  assert.equal(signinPanel.playerSigninWords(words).waitingFor("NanChat"), "Warte auf NanChat…");
});

test("the sign-in sheet's ways: short, no sentence over 10 words", async (t) => {
  const v = signinPanel.signInView({ name: "Game Example", passkey: false, fetch: (async () => new Response("{}")) as unknown as typeof fetch });
  document.body.append(v.node);
  const lines = visibleLines(v.node);
  t.diagnostic(`sign-in ways: ${count(lines)} words, longest sentence ${longest(lines)}: ${lines.join(" | ")}`);
  assert.ok(count(lines) <= 30);
  assert.ok(longest(lines) <= 10);
  v.stop();
});

// ---- a play's sheets: the "18 or older" step and the pay sheet with the creator's refund words (the sample words) ----

const PLAYS = [{ id: "extra-round", name: "Extra round", priceUsd: 0.05, use: "round" }];

/** A play's sheet as the player first sees it: with `adultsOnly` the "18 or older" step, else the pay sheet (with the sample refund words). */
async function playSheet(payee: string | null, adultsOnly: boolean) {
  const handler = createShopHandler({
    store: createMemoryShop(),
    catalogue: LOOKS,
    plays: PLAYS,
    legal: () => ({ ...DEFAULT_LEGAL, adultsOnly, lawsConfirmedAt: 1 }),
    payee,
    player: async () => "p1",
    rate: { feeds: ["CoinGecko", "Kraken", "KuCoin"].map((name) => ({ name, url: `https://${name}.test/`, read: (j: { usd: number }) => j.usd })), fetch: async () => new Response(JSON.stringify({ usd: 1 })) },
    nodes: [],
  });
  const fetchFn = (async (input: string, init?: RequestInit) => {
    const res = await handler.handle(new Request(`${ORIGIN}${input}`, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: ORIGIN } }));
    return res ?? new Response(JSON.stringify({ error: "No such route." }), { status: 404 });
  }) as unknown as typeof fetch;
  const el = document.createElement("div");
  document.body.append(el);
  const shop = shopPanel.mountShop(el, { looks: LOOKS, plays: PLAYS, fetch: fetchFn, owned: () => [], signedIn: () => true, signIn: async () => true, worn: () => false, wear: () => {} });
  mounted.push(shop);
  shop.buyPlay("extra-round");
  await settle();
  return el.querySelector("dialog")!;
}

// The creator's refund words are the creator's own (as a look's name is): the kit's words stay at most 30 beside them, and the sample words are short too
// (at most 15, no sentence over 10).
test("a play's sheets: the 18-or-older step, and the pay sheet in TEST MODE and live: the kit's words at most 30 beside the creator's refund words, no sentence over 10", async (t) => {
  for (const [name, payee, adultsOnly] of [["the 18-or-older step", null, true], ["a play in TEST MODE", null, false], ["a play live", testAddress(), false]] as const) {
    const sheet = await playSheet(payee, adultsOnly);
    const lines = visibleLines(sheet);
    const refund = sheet.querySelector(".n133s-refund");
    const own = refund ? count(lines) - count(visibleLines(refund)) : count(lines);
    t.diagnostic(`${name}: ${own} words of the kit (${count(lines)} with the refund words), longest sentence ${longest(lines)}: ${lines.join(" | ")}`);
    assert.ok(own <= 30, `${name}: ${own} words`);
    assert.ok(longest(lines) <= 10, `${name}: a sentence of ${longest(lines)} words`);
    if (refund) assert.ok(count(visibleLines(refund)) <= 15, "the sample refund words are short");
    if (adultsOnly) assert.ok(lines.includes("Paid rounds are for players 18 and up."));
    else {
      assert.ok(lines.includes("1 round. Used once."));
      assert.ok(lines.includes("Not used? Ask for your money back within 14 days. Write to the game's owner."));
    }
    if (!adultsOnly && payee === null) assert.equal(sheet.querySelector(".n133s-stamp")!.textContent, "TEST MODE: DO NOT PAY");
  }
  const w = shopPanel.SHOP_WORDS;
  assert.equal(w.playFor(shopPanel.playPrice(0.05)), "Play for 5¢");
  assert.equal(w.playReady("round", 1), "1 round ready");
  assert.equal(w.playReady("life", 2), "2 lives ready");
  assert.equal(w.playPaid("round"), "Paid. Your round is ready.");
  assert.equal(w.playLine("round"), "1 round. Used once.");
  assert.deepEqual([0.005, 0.25, 0.9999, 1, 1.5].map(shopPanel.playPrice), ["0.5¢", "25¢", "99.99¢", "$1.00", "$1.50"]);
  assert.match(w.playLate("round"), /no round/);
});
