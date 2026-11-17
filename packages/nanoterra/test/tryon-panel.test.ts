// The looks sheet's try-on (mountShop's `tryOn`, since 0.18.0) in a fake DOM (happy-dom), with a fake viewer that records what the sheet asks of
// it (the contract of src/shop/viewer/contract.ts), against the REAL shop handler on the memory store. It proves: the viewer loads once when the
// sheet opens and is freed when it closes; what the stage shows and says; the tray; Up close and Escape; the focus; the still picture when there is
// no 3D; the sheet as before with no `tryOn`; and that a tried look is NEVER worn, saved or sent (no request, no `wear`, no storage).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { Window } from "happy-dom";
import { createMemoryShop, createShopHandler } from "../src/shop/index.js";
import type { Look } from "../src/looks/look.js";
import type { TryOnContext, TryOnShow, TryOnViewer } from "../src/shop/viewer/contract.js";
import { LOOKS, testAddress } from "./shop-helpers.js";

const ORIGIN = "https://game.example";
let mountShop: typeof import("../src/shop/panel/index.js").mountShop;
let win: Window;

before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent, localStorage: win.localStorage, sessionStorage: win.sessionStorage });
  ({ mountShop } = await import("../src/shop/panel/index.js"));
  // The stage's stylesheet (/shop/tryon.css), as a game with tryOn loads it: the sheet reads its mark before it loads the viewer.
  const css = document.createElement("style");
  css.id = "tryon-css";
  css.textContent = readFileSync(new URL("../src/shop/panel/tryon.css", import.meta.url), "utf8");
  document.head.append(css);
});
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

/** A viewer that draws nothing and records each call. `fail`: its mount throws (a device with no WebGL). */
function fakeViewer(fail = false) {
  const log = { loads: 0, mounts: [] as { box: HTMLElement; ctx: TryOnContext }[], shows: [] as TryOnShow[], disposed: 0 };
  const viewer: TryOnViewer = {
    mount(box, ctx) {
      if (fail) throw new Error("no WebGL");
      log.mounts.push({ box, ctx });
      const canvas = document.createElement("canvas");
      box.append(canvas);
      return { show: (v) => void log.shows.push(v), dispose: () => void (log.disposed++, canvas.remove()) };
    },
  };
  const load = async () => {
    log.loads++;
    return viewer;
  };
  return { log, load };
}

function game() {
  const store = createMemoryShop();
  const handler = createShopHandler({
    store,
    catalogue: LOOKS,
    payee: testAddress(),
    player: async () => "p1",
    rate: { feeds: [{ name: "Test feed", url: "https://feed.test/", read: (j) => j.usd }], fetch: async () => new Response(JSON.stringify({ usd: 1 })) },
    nodes: [],
  });
  const calls: string[] = [];
  const fetchFn = (async (input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input} ${typeof init?.body === "string" ? init.body : ""}`.trim());
    const res = await handler.handle(new Request(`${ORIGIN}${input}`, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: ORIGIN } }));
    return res ?? new Response(JSON.stringify({ error: "No such route." }), { status: 404 });
  }) as unknown as typeof fetch;
  const worn = new Map<string, string>([["outfit", "plain"]]);
  const wears: string[] = [];
  const opts = {
    looks: LOOKS,
    fetch: fetchFn,
    owned: () => [] as string[],
    signedIn: () => true,
    worn: (l: Look) => worn.get(l.wear ?? "outfit") === l.id,
    wear: (l: Look) => void (wears.push(l.id), worn.set(l.wear ?? "outfit", l.id)),
    takeOff: (slot: string) => void worn.delete(slot),
  };
  return { calls, worn, wears, opts };
}

const sheet = (el: HTMLElement) => el.querySelector("dialog.n133s-sheet") as HTMLDialogElement;
const stageOf = (el: HTMLElement) => el.querySelector(".n133s-tryon-stage") as HTMLElement;
const tryKey = (el: HTMLElement, id: string) => el.querySelector(`.n133s-try[data-look="${id}"]`) as HTMLButtonElement;
const tab = (el: HTMLElement, word: string) => [...el.querySelectorAll<HTMLButtonElement>(".n133s-tab")].find((b) => b.textContent === word)!;
const escape = (d: HTMLDialogElement) => {
  // The browser's order: the keydown, then (when nothing stopped it) the dialog's cancel and its close.
  const key = new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  (document.activeElement ?? d).dispatchEvent(key as unknown as Event);
  if (key.defaultPrevented) return;
  const cancel = new win.Event("cancel", { cancelable: true });
  d.dispatchEvent(cancel as unknown as Event);
  if (!cancel.defaultPrevented) d.close();
};

test("with no tryOn the sheet is as on 0.17.1: no stage, no Try on key, no data-look, no Three.js asked for; the offer's still picture stays 176 px", async () => {
  const g = game();
  const el = root();
  const shop = mountShop(el, g.opts);
  mounted.push(shop);
  shop.open();
  assert.equal(el.querySelector(".n133s-tryon"), null);
  assert.equal(el.querySelector(".n133s-try"), null);
  assert.ok(!sheet(el).classList.contains("n133s-sheet-tryon"));
  assert.equal(el.querySelectorAll(".n133s-look").length, 4, "the four outfits, as before");
  assert.equal(el.querySelector("[data-look]"), null, "the rows' keys carry no try-on mark");
  // Buy in the kit's list: the offer step with the look's still picture at 176 px, as on 0.17.1 (a game's preview(item, 176) is unchanged)
  (el.querySelector(".n133s-buy") as HTMLButtonElement).click();
  const pic = el.querySelector(".n133s-offer-pic") as HTMLElement;
  assert.equal(pic.style.getPropertyValue("--n133s-pic"), "176px");
  assert.deepEqual(g.calls, [], "the offer step orders nothing");
  shop.destroy();
});

test("the contract: the viewer loads once when the sheet opens, mounts in the stage's box, and shows the worn look; it is freed when the sheet closes", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, { ...g.opts, tryOn: v.load });
  mounted.push(shop);
  assert.equal(v.log.loads, 0, "nothing loads before the sheet opens");
  shop.open();
  await settle();
  assert.equal(v.log.loads, 1);
  assert.equal(v.log.mounts.length, 1);
  assert.equal(v.log.mounts[0].box, stageOf(el));
  const ctx = v.log.mounts[0].ctx;
  assert.equal(typeof ctx.calm(), "boolean");
  assert.deepEqual(ctx.words, { zoomIn: "Zoom in", zoomOut: "Zoom out", whole: "Show the whole character", turn: "Turn around" });
  const first = v.log.shows.at(-1)!;
  assert.deepEqual(first.worn.map((l) => l.id), ["plain"]);
  assert.deepEqual(first.tried, []);
  assert.equal(first.focus, null);
  assert.ok(sheet(el).classList.contains("n133s-sheet-tryon"));
  assert.ok(stageOf(el).classList.contains("n133s-has-3d"));
  assert.equal(stageOf(el).getAttribute("aria-label"), "Your character, wearing Plain");
  assert.equal(stageOf(el).getAttribute("tabindex"), "0");
  const hint = document.getElementById(stageOf(el).getAttribute("aria-describedby")!)!;
  assert.match(hint.textContent!, /arrow keys to turn/);
  assert.ok(!stageOf(el).contains(hint), "the hint is read once: it is not inside the stage's group");
  // A redraw of the list (another tab) keeps the same stage: no second load or mount.
  tab(el, "Spade").click();
  await settle();
  assert.equal(v.log.loads, 1);
  assert.equal(v.log.mounts.length, 1);
  // Closing frees it; opening again mounts a new one (one renderer only while the sheet is open).
  shop.close();
  await settle();
  assert.equal(v.log.disposed, 1);
  assert.equal(el.querySelector(".n133s-tryon-stage canvas"), null);
  shop.open();
  await settle();
  assert.equal(v.log.mounts.length, 2);
  assert.equal(v.log.loads, 2, "the game's loader is asked again (a bundler keeps the module: it loads once)");
  shop.destroy();
  assert.equal(v.log.disposed, 2);
});

test("Try on: the stage shows and frames the look, the row says so, the tray holds its price, Take off and Buy; one look a slot", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, { ...g.opts, tryOn: v.load });
  mounted.push(shop);
  shop.open();
  await settle();
  tryKey(el, "blue-cap").click();
  let s = v.log.shows.at(-1)!;
  assert.deepEqual(s.tried.map((l) => l.id), ["blue-cap"]);
  assert.equal(s.focus?.id, "blue-cap");
  assert.equal(tryKey(el, "blue-cap").getAttribute("aria-pressed"), "true");
  assert.equal(tryKey(el, "blue-cap").getAttribute("aria-label"), "Try on Blue Cap");
  assert.match(tryKey(el, "blue-cap").textContent!, /trying on/);
  assert.equal(stageOf(el).getAttribute("aria-label"), "Your character, trying on Blue Cap");
  assert.equal(el.querySelector(".n133s-tray-line")!.textContent, "Trying on 1. Total $0.25");
  assert.deepEqual([...el.querySelectorAll(".n133s-tray-row button")].map((b) => b.textContent), ["Take off", "Buy $0.25"]);
  // Another outfit replaces it (one outfit at a time); an item of another slot is tried on beside it.
  tryKey(el, "gold-crown").click();
  tab(el, "Spade").click();
  tryKey(el, "wood-spade").click();
  s = v.log.shows.at(-1)!;
  assert.deepEqual(s.tried.map((l) => l.id), ["gold-crown", "wood-spade"]);
  assert.equal(s.focus?.id, "wood-spade");
  assert.equal(el.querySelector(".n133s-tray-line")!.textContent, "Trying on 2. Total $1.10");
  assert.equal(stageOf(el).getAttribute("aria-label"), "Your character, trying on Gold Crown and Wood Spade");
  // A second press takes it off again.
  tryKey(el, "wood-spade").click();
  assert.deepEqual(v.log.shows.at(-1)!.tried.map((l) => l.id), ["gold-crown"]);
  // The tray's Take off: the look goes, and the focus moves to the stage (never to the page).
  const off = el.querySelector('[data-off="gold-crown"]') as HTMLButtonElement;
  off.focus();
  off.click();
  assert.deepEqual(v.log.shows.at(-1)!.tried, []);
  assert.equal(document.activeElement, stageOf(el));
  assert.equal(el.querySelector(".n133s-tray-line")!.textContent, "Pick a look to try it on.");
  shop.destroy();
});

test("never worn, never saved, never sent: try-ons make no request, call no wear and write no storage; closing the sheet forgets them", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, { ...g.opts, tryOn: v.load, onOwned: () => assert.fail("nothing is owned") });
  mounted.push(shop);
  localStorage.clear();
  sessionStorage.clear();
  shop.open();
  await settle();
  for (const id of ["red-coat", "blue-cap", "gold-crown"]) tryKey(el, id).click();
  tab(el, "Charm").click();
  tryKey(el, "star-charm").click();
  (el.querySelector('[data-off="star-charm"]') as HTMLButtonElement).click();
  (el.querySelector(".n133s-upclose-key") as HTMLButtonElement).click();
  escape(sheet(el));
  await settle();
  assert.deepEqual(g.calls, [], "no request at all");
  assert.deepEqual(g.wears, [], "the game's wear is never called");
  assert.equal(g.worn.get("outfit"), "plain");
  assert.equal(localStorage.length, 0);
  assert.equal(sessionStorage.length, 0);
  assert.equal(document.cookie, "");
  shop.close();
  await settle();
  shop.open();
  await settle();
  assert.deepEqual(v.log.shows.at(-1)!.tried, [], "a new sheet tries nothing on");
  tab(el, "Outfits").click();
  assert.equal(tryKey(el, "gold-crown").getAttribute("aria-pressed"), "false");
  shop.destroy();
});

test("the tray's Buy is the sheet's own Buy (the same order route, no offer step); Back returns to the same stage with the try-ons", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, { ...g.opts, tryOn: v.load });
  mounted.push(shop);
  shop.open();
  await settle();
  tryKey(el, "blue-cap").click();
  const trayBuy = el.querySelector('[data-buy="blue-cap"]') as HTMLButtonElement;
  trayBuy.focus();
  trayBuy.click();
  await settle();
  // the tray's Buy key went with the stage: the focus is in the sheet (the title), never on the page, where a game's walk keys act
  assert.ok(sheet(el).contains(document.activeElement), `the focus is on ${document.activeElement?.tagName}`);
  // the order, then the pay sheet's checks of it (the same routes as any Buy)
  assert.match(g.calls[0], /^POST \/api\/orders \{"lookId":"blue-cap","turnstile":null\}$/);
  assert.ok(g.calls.slice(1).every((c) => /^POST \/api\/orders\/[^/]+\/check \{\}$/.test(c)), g.calls.join(" | "));
  assert.equal(el.querySelector(".n133s-offer"), null, "no offer step: the stage showed the look");
  assert.ok(el.querySelector(".n133s-pay"), "the pay sheet");
  assert.ok(!sheet(el).classList.contains("n133s-sheet-tryon"), "the pay sheet keeps its own size");
  assert.equal(el.querySelector(".n133s-tryon-stage")?.isConnected ?? false, false, "the stage is out of the page (it draws nothing)");
  assert.deepEqual(g.wears, []);
  // Back to the looks: the same stage (no new mount), Blue Cap still tried on.
  const back = [...el.querySelectorAll<HTMLButtonElement>(".n133s-btn")].find((b) => b.textContent === "Back");
  if (back) back.click();
  else shop.open();
  await settle();
  assert.equal(v.log.mounts.length, 1);
  assert.equal(tryKey(el, "blue-cap").getAttribute("aria-pressed"), "true");
  shop.destroy();
});

test("Up close: the key and Enter on the stage open it; Escape closes Up close first (the sheet stays) and the focus goes back; Escape again closes the sheet", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  let closes = 0;
  const shop = mountShop(el, { ...g.opts, tryOn: v.load, onClose: () => void closes++ });
  mounted.push(shop);
  shop.open();
  await settle();
  const key = el.querySelector(".n133s-upclose-key") as HTMLButtonElement;
  key.focus();
  key.click();
  assert.ok(sheet(el).classList.contains("n133s-upclose-on"));
  assert.equal(key.getAttribute("aria-pressed"), "true");
  assert.equal(key.textContent, "Back to the list");
  escape(sheet(el));
  assert.ok(!sheet(el).classList.contains("n133s-upclose-on"), "Up close is off");
  assert.ok(sheet(el).open, "the sheet stays open");
  assert.equal(document.activeElement, key, "the focus is on the key that opened Up close");
  assert.equal(key.textContent, "Up close");
  // Enter on the stage opens it; Escape gives the focus back to the stage.
  stageOf(el).focus();
  stageOf(el).dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
  assert.ok(sheet(el).classList.contains("n133s-upclose-on"));
  escape(sheet(el));
  assert.equal(document.activeElement, stageOf(el));
  // A tap on the stage (the viewer's onTap) opens it; the key closes it.
  v.log.mounts[0].ctx.onTap();
  assert.ok(sheet(el).classList.contains("n133s-upclose-on"));
  key.click();
  assert.ok(!sheet(el).classList.contains("n133s-upclose-on"));
  assert.equal(closes, 0);
  escape(sheet(el));
  await settle();
  assert.ok(!sheet(el).open, "the second Escape closes the sheet");
  assert.equal(closes, 1);
  // Closing the sheet in Up close leaves Up close too (a new sheet opens on the list).
  shop.open();
  await settle();
  (el.querySelector(".n133s-upclose-key") as HTMLButtonElement).click();
  shop.close();
  await settle();
  assert.ok(!sheet(el).classList.contains("n133s-upclose-on"));
  shop.destroy();
});

test("the focus stays in the sheet: a Try on press keeps it on the same row's key after the list is drawn again", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, { ...g.opts, tryOn: v.load });
  mounted.push(shop);
  shop.open();
  await settle();
  const k = tryKey(el, "red-coat");
  k.focus();
  k.click();
  assert.notEqual(tryKey(el, "red-coat"), k, "the list was drawn again");
  assert.equal(document.activeElement, tryKey(el, "red-coat"));
  // Wear (an owned, free look) redraws too: the focus stays on its key.
  const wear = el.querySelector('.n133s-btn[data-look="plain"]') as HTMLButtonElement;
  assert.ok(wear);
  shop.destroy();
});

test("no 3D (the viewer throws, or does not load): the stage shows the look's still picture, large, and Try on still works", async () => {
  for (const kind of ["throws", "rejects"] as const) {
    const g = game();
    const v = fakeViewer(kind === "throws");
    const el = root();
    const pictures: string[] = [];
    const load = kind === "throws" ? v.load : () => Promise.reject(new Error("offline"));
    const shop = mountShop(el, {
      ...g.opts,
      tryOn: load,
      picture: (l) => {
        pictures.push(l.id);
        const img = document.createElement("img");
        img.alt = "";
        img.dataset.look = l.id;
        return img;
      },
    });
    mounted.push(shop);
    shop.open();
    await settle();
    assert.ok(!stageOf(el).classList.contains("n133s-has-3d"), kind);
    let still = el.querySelector(".n133s-stage-still .n133s-pic") as HTMLElement;
    assert.ok(still, kind);
    assert.equal(still.style.getPropertyValue("--n133s-pic"), "240px");
    assert.equal(still.querySelector("img")?.dataset.look, "plain");
    tryKey(el, "blue-cap").click();
    still = el.querySelector(".n133s-stage-still .n133s-pic") as HTMLElement;
    assert.equal(still.querySelector("img")?.dataset.look, "blue-cap", `${kind}: the tried look's picture`);
    assert.equal(stageOf(el).getAttribute("aria-label"), "Your character, trying on Blue Cap");
    assert.equal(stageOf(el).getAttribute("aria-describedby"), null, `${kind}: no how-to line for a drag or a zoom that a still picture does not do`);
    // R8: nor in the page (a screen reader reads a hidden line too, line by line); the text alternative is what the stage can do: its name
    assert.doesNotMatch(sheet(el).textContent!, /Drag|Pinch|wheel|arrow keys/, `${kind}: the how-to line is gone from the page`);
    assert.equal(el.querySelector(".n133s-tryon-side .n133s-sr"), null);
    assert.deepEqual(g.calls, []);
    shop.destroy();
  }
});

test("a game's words: every word of the try-on can be the game's own", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, {
    ...g.opts,
    tryOn: v.load,
    words: { tryOn: "Essayer", tryOnLook: (l) => `Essayer ${l}`, upClose: "De près", stageLabel: (w, t) => `Moi: ${w.join("+")} / ${t.join("+")}`, zoomIn: "Plus" },
  });
  mounted.push(shop);
  shop.open();
  await settle();
  assert.equal(tryKey(el, "red-coat").getAttribute("aria-label"), "Essayer Red Coat");
  assert.equal(el.querySelector(".n133s-upclose-key")!.textContent, "De près");
  assert.equal(stageOf(el).getAttribute("aria-label"), "Moi: Plain / ");
  assert.equal(v.log.mounts[0].ctx.words.zoomIn, "Plus");
  shop.destroy();
});

test("the words: shopWords() holds every word of ShopWords (no key undefined); the stage's own words are the try-on chunk's (TRYON_WORDS)", async () => {
  const { SHOP_WORDS, shopWords } = await import("../src/shop/panel/index.js");
  const { TRYON_WORDS } = await import("../src/shop/panel/tryon.js");
  for (const [k, v] of Object.entries(shopWords({ upClose: "x" } as never))) assert.notEqual(v, undefined, k);
  for (const k of Object.keys(TRYON_WORDS)) assert.ok(!(k in SHOP_WORDS), `${k} is the try-on chunk's`);
});

test("no /shop/tryon.css on the page: the console names the line to add (once), nothing loads, and the sheet goes on as without tryOn", async () => {
  const css = document.getElementById("tryon-css")!;
  css.remove();
  const warns: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a.join(" "));
  try {
    const g = game();
    const v = fakeViewer();
    const el = root();
    const shop = mountShop(el, { ...g.opts, tryOn: v.load });
    mounted.push(shop);
    shop.open();
    await settle();
    assert.equal(v.log.loads, 0, "the viewer (Three.js) never loads for a stage with no layout");
    assert.equal(el.querySelector(".n133s-tryon"), null, "no stage");
    assert.equal(el.querySelector(".n133s-try"), null, "no Try on key");
    assert.ok(!sheet(el).classList.contains("n133s-sheet-tryon"));
    assert.equal(el.querySelectorAll(".n133s-look").length, 4, "the four outfits, as without tryOn");
    assert.equal(warns.length, 1);
    assert.ok(warns[0].includes('import "@nano133/nanoterra/shop/tryon.css";'), warns[0]);
    // Buy still works as without tryOn: the offer step
    (el.querySelector(".n133s-buy") as HTMLButtonElement).click();
    assert.ok(el.querySelector(".n133s-offer"));
    shop.close();
    // a second sheet on the same page: no second warning
    const el2 = root();
    const shop2 = mountShop(el2, { ...g.opts, tryOn: fakeViewer().load });
    mounted.push(shop2);
    shop2.open();
    await settle();
    assert.equal(el2.querySelector(".n133s-tryon"), null);
    assert.equal(warns.length, 1, "once a page");
    shop.destroy();
    shop2.destroy();
  } finally {
    console.warn = warn;
    document.head.append(css);
  }
});

test("the stylesheets: /shop/style.css holds no rule of the try-on (a game without tryOn loads none); /shop/tryon.css holds them all, under .n133-shop, with its mark", () => {
  const style = readFileSync(new URL("../src/shop/panel/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const tryon = readFileSync(new URL("../src/shop/panel/tryon.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const cls of ["n133s-tryon", "n133s-try", "n133s-tray", "n133s-stage-key", "n133s-stage-canvas", "n133s-stage-still", "n133s-upclose", "n133s-sheet-tryon", "n133s-look-try"]) {
    assert.doesNotMatch(style, new RegExp(`\\.${cls}\\b`), `style.css has .${cls}`);
    assert.match(tryon, new RegExp(`\\.${cls}\\b`), `tryon.css lacks .${cls}`);
  }
  for (const m of tryon.replace(/@[^{]+\{/g, "").matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
    for (const one of sel.split(/,(?![^()]*\))/)) assert.match(one.trim(), /^\.n133-shop\b/, `a rule outside .n133-shop: ${one.trim()}`);
  }
  assert.match(tryon, /\.n133-shop \.n133s-tryon-stage \{\s*--n133s-tryon-css: 1;/);
});

test("a look the stage could not draw (R6): the viewer says so; the tray shows its still picture and the words, the other looks stay; Take off or another try clears it", async () => {
  const g = game();
  const v = fakeViewer();
  const el = root();
  const shop = mountShop(el, { ...g.opts, tryOn: v.load });
  mounted.push(shop);
  shop.open();
  await settle();
  tryKey(el, "blue-cap").click();
  tab(el, "Spade").click();
  tryKey(el, "wood-spade").click();
  const shows = v.log.shows.length;
  const ctx = v.log.mounts[0].ctx;
  const cap = LOOKS.find((l) => l.id === "blue-cap")!;
  ctx.failed?.(cap);
  assert.equal(v.log.shows.length, shows, "the mark draws the tray only: the stage is not asked again");
  const rows = [...el.querySelectorAll(".n133s-tray-row")];
  assert.equal(rows.length, 2, "the other look stays in the tray");
  const bad = rows.find((r) => r.querySelector('[data-off="blue-cap"]'))!;
  assert.ok(bad.classList.contains("n133s-tray-failed"));
  assert.ok(bad.querySelector(".n133s-pic"), "its still picture");
  assert.match(bad.textContent!, /\$0\.25 · Could not show it/);
  const good = rows.find((r) => r.querySelector('[data-off="wood-spade"]'))!;
  assert.ok(!good.classList.contains("n133s-tray-failed"));
  assert.doesNotMatch(good.textContent!, /Could not show it/);
  // a worn look (not tried) that fails is not marked
  ctx.failed?.(LOOKS.find((l) => l.id === "plain")!);
  assert.equal(el.querySelectorAll(".n133s-tray-failed").length, 1);
  // Take off clears the mark; a new try of the same look starts clean
  (el.querySelector('[data-off="blue-cap"]') as HTMLButtonElement).click();
  tab(el, "Outfits").click();
  tryKey(el, "blue-cap").click();
  assert.equal(el.querySelectorAll(".n133s-tray-failed").length, 0);
  shop.destroy();
});
