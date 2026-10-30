// The admin panel in a fake DOM (happy-dom), against the REAL handler and the memory store: the panel and the handler agree on every call.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import { CHARACTER_NEEDS_SIGNIN, CHARACTER_SIGNIN_OFF, SWITCHES, createAdminHandler, createMemoryStore, type AdminHandler, type AdminSession } from "../src/admin/index.js";
import type { Look } from "../src/looks/index.js";
import type { MountOptions } from "../src/admin/panel/index.js";

const OWNER = `nano_1${"a".repeat(59)}`;
const OTHER = `nano_3${"b".repeat(59)}`;
const ORIGIN = "https://game.example";
const NOW = Date.now();
const RAW_02 = (2n * 10n ** 29n).toString(); // 0.2 XNO
const LOOKS: Look[] = [
  { id: "classic", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } },
  { id: "mint-cap", name: "Mint Cap", priceUsd: 0.25, change: { body: "#3ddc97", hat: "cap", hatColor: "#1c6e4f" } },
  { id: "ember-wings", name: "Ember Wings", priceUsd: 0.25, change: { body: "#ff7a3d" }, slots: { wings: "ember", trail: "#ffcf5a" } },
];
const KINDS: Record<string, AdminSession> = {
  owner: { address: OWNER, createdAt: NOW - 1000, via: "wallet" },
  nanoterra_login: { address: OWNER, createdAt: NOW - 1000, via: "nanoterra" },
  other_wallet: { address: OTHER, createdAt: NOW - 1000, via: "wallet" },
};

let mountAdmin: typeof import("../src/admin/panel/index.js").mountAdmin;
let win: Window;
before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event });
  ({ mountAdmin } = await import("../src/admin/panel/index.js"));
});

function setup(over: { kind?: string | null; owner?: string | null; store?: ReturnType<typeof createMemoryStore>; check?: boolean } = {}) {
  const store = over.store ?? createMemoryStore({
    orders: [
      { id: "o1", player: OTHER, lookId: "mint-cap", usd: "0.25", amountRaw: RAW_02, status: "paid", createdAt: NOW - 100, expiresAt: NOW + 100, paidAt: NOW - 50, payer: OTHER, hash: "H1" },
      { id: "o2", player: OTHER, lookId: "mint-cap", usd: "0.25", amountRaw: RAW_02, status: "paid_late", createdAt: NOW - 90, expiresAt: NOW - 10, paidAt: NOW - 5, payer: OTHER, hash: "H2" },
    ],
    owned: [{ player: OTHER, lookId: "mint-cap", at: NOW - 40 }],
  });
  let kind: string | null = over.kind === undefined ? "owner" : over.kind;
  const handler: AdminHandler = createAdminHandler({
    store,
    defaults: { character: "nanoterra", signin: "exchange" },
    owner: over.owner === undefined ? OWNER : over.owner,
    session: async () => (kind ? KINDS[kind] ?? null : null),
    now: () => NOW,
    limit: () => true,
    lookName: (id) => LOOKS.find((l) => l.id === id)?.name,
    ...(over.check === false ? {} : { check: async () => ({ scanned: true, settled: [] }) }),
  });
  const calls: { method: string; path: string }[] = [];
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), ORIGIN);
    calls.push({ method: init?.method ?? "GET", path: url.pathname });
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") === "POST") headers.set("Origin", ORIGIN);
    const res = await handler.handle(new Request(url, { method: init?.method ?? "GET", headers, body: init?.body as string | undefined }));
    return res ?? new Response("{}", { status: 404 });
  }) as typeof fetch;
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as unknown as Node);
  const signOuts: number[] = [];
  const signIns: { done: () => void; into: HTMLElement }[] = [];
  const options: MountOptions = {
    looks: LOOKS,
    fetch: send,
    signOut: async () => {
      signOuts.push(1);
      kind = null;
    },
    signIn: (into, done) => signIns.push({ into, done }),
    defaultsFile: "game.config.json",
  };
  const mounted = mountAdmin(root, options);
  return { store, root, mounted, calls, signOuts, signIns, setKind: (k: string | null) => (kind = k) };
}
const text = (el: Element) => el.textContent ?? "";
const buttonWith = (root: Element, words: string) => [...root.querySelectorAll("button")].find((b) => text(b).trim().startsWith(words)) as HTMLButtonElement;
const tick = () => new Promise((r) => setTimeout(r, 10));
const tabOf = (root: Element, name: string) => [...root.querySelectorAll('[role="tab"]')].find((t) => text(t).startsWith(name)) as HTMLButtonElement;
const panelOf = (root: Element, id: string) => root.querySelector(`#n133-panel-${id}`) as HTMLElement;

test("the owner sees every card: the two switches, the numbers, the Shelf, the orders and the looks that players own", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const all = text(root);
  for (const part of ["Overview", "Cosmetics", "Settings", "Game", SWITCHES.character.title, SWITCHES.signin.title, "Earned", "To send back", "Open now", "Shelf", "Mint Cap", "Orders", "All (2)", "Paid late (1)", "Players who own a look", "Signed in as", "Sign out"]) assert.ok(all.includes(part), part);
  assert.ok(all.includes("They start from game.config.json"));
  assert.ok(root.classList.contains("n133-admin"));
  const switches = [...root.querySelectorAll(".switch")];
  assert.deepEqual(switches.map((s) => s.getAttribute("aria-checked")), ["true", "true"]);
  assert.ok(text(root).includes("Send this amount back by hand"), "a late payment says what to do");
});

test("a press on a switch saves it, says Saved, and the character note changes with the sign-in switch", async () => {
  const { root, mounted, store, calls } = setup();
  await mounted.ready;
  assert.ok(text(root).includes(CHARACTER_NEEDS_SIGNIN));
  const signin = root.querySelectorAll(".switch")[1] as HTMLButtonElement;
  signin.click();
  await tick();
  assert.equal(signin.getAttribute("aria-checked"), "false");
  assert.ok(text(root).includes("Saved."));
  assert.equal(store.rows.get("setting:signin"), "none");
  assert.ok(text(root).includes(CHARACTER_SIGNIN_OFF));
  assert.ok(!text(root).includes(CHARACTER_NEEDS_SIGNIN));
  // The character switch off hides the note: it matters only while the character is On.
  (root.querySelectorAll(".switch")[0] as HTMLButtonElement).click();
  await tick();
  assert.equal(store.rows.get("setting:character"), "own");
  assert.equal((root.querySelector(".switch-needs") as HTMLElement).hidden, true);
  assert.deepEqual(calls.filter((c) => c.method === "POST").map((c) => c.path), ["/api/admin/game", "/api/admin/game"]);
});

test("a press that the server refuses shows the server's words and changes nothing on the page", async () => {
  const store = createMemoryStore();
  const { root, mounted } = setup({ store });
  await mounted.ready;
  const signin = root.querySelectorAll(".switch")[1] as HTMLButtonElement;
  // Break the store: the handler answers 500 with a fixed sentence.
  store.saveSettings = async () => {
    throw new Error("SECRET DETAIL");
  };
  signin.click();
  await tick();
  assert.equal(signin.getAttribute("aria-checked"), "true");
  assert.ok(text(root).includes("could not do that"));
  assert.ok(!text(root).includes("SECRET"));
});

test("the Shelf makes no call to the server: editing a draft and copying looks.json send nothing", async () => {
  const { root, mounted, calls } = setup();
  await mounted.ready;
  const before = calls.length;
  openLook(root, "Classic");
  const price = root.querySelector('input[type="number"]') as HTMLInputElement;
  assert.ok(price, "the editor opened");
  price.value = "0.5";
  price.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  assert.ok(text(root).includes("1 changed"), text(root).slice(0, 200));
  assert.equal(calls.length, before, "no request while the Shelf is edited");
  // Every call the page ever made is one of the admin's own three: summary, game, check. Never a looks route.
  for (const c of calls) assert.match(c.path, /^\/api\/admin\/(summary|game|check)$/);
});

test("'Check payments now' redraws with the answer's summary, keeps the same Game card, and keeps the Shelf's draft", async () => {
  const { root, mounted, calls } = setup();
  await mounted.ready;
  const card = root.querySelector(".game-card");
  openLook(root, "Classic");
  (root.querySelector('input[type="number"]') as HTMLInputElement).value = "0.75";
  (root.querySelector('input[type="number"]') as HTMLInputElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  buttonWith(root, "Check payments now").click();
  await tick();
  assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/admin/check"));
  assert.equal(root.querySelector(".game-card"), card, "the Game card is the same element");
  assert.equal((root.querySelector('input[type="number"]') as HTMLInputElement).value, "0.75", "the draft is kept");
});

test("a game with no payment check has no 'Check payments now' button", async () => {
  const { root, mounted } = setup({ check: false });
  await mounted.ready;
  assert.equal(buttonWith(root, "Check payments now"), undefined);
});

test("a visitor who is signed out gets the game's sign-in, and the panel loads when it is done", async () => {
  const { root, mounted, signIns, setKind } = setup({ kind: null });
  await mounted.ready;
  assert.ok(text(root).includes("Sign in with your game's address"));
  assert.equal(signIns.length, 1);
  assert.ok(!text(root).includes("Paid late"), "no data for a visitor");
  setKind("owner");
  signIns[0].done();
  await tick();
  assert.ok(text(root).includes("Orders"));
  assert.ok((root.querySelector("#n133-gate") as HTMLElement).hidden);
});

test("a wrong wallet, a Nanoterra sign-in and a missing owner address each get their own screen, and show no data", async () => {
  const wrong = setup({ kind: "other_wallet" });
  await wrong.mounted.ready;
  assert.ok(text(wrong.root).includes("Not the game's address"));
  assert.ok(text(wrong.root).includes("nano_3bbbb…bbbbbb"), "it says who is signed in, shortened");
  assert.ok(!text(wrong.root).includes(OTHER), "and never the whole address");
  assert.ok(!text(wrong.root).includes("Orders"));
  const nt = setup({ kind: "nanoterra_login" });
  await nt.mounted.ready;
  assert.ok(text(nt.root).includes("You signed in from Nanoterra"));
  const none = setup({ owner: null });
  await none.mounted.ready;
  assert.ok(text(none.root).includes("No owner address yet"));
  assert.ok(text(none.root).includes("Set the game's owner address"));
  // Sign out signs out of the ADMIN login only (the game gives the function) and loads again.
  buttonWith(wrong.root, "Sign out").click();
  await tick();
  assert.equal(wrong.signOuts.length, 1);
  assert.ok(text(wrong.root).includes("Sign in with your game's address"));
});

test("a fault in reading the two switches leaves the card out and the rest still shows", async () => {
  const store = createMemoryStore();
  store.readSettings = async () => {
    throw new Error("down");
  };
  const { root, mounted } = setup({ store });
  await mounted.ready;
  assert.equal(root.querySelector(".game-card"), null);
  assert.ok(text(root).includes("Orders"));
});

// ---- slots in the Shelf ----

const cardOf = (root: Element, name: string) => [...root.querySelectorAll(".shelf-card")].find((c) => text(c).includes(name)) as HTMLElement;
const typeInto = (input: Element, value: string) => {
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
};
const slotInputs = (card: Element) => [...card.querySelectorAll(".shelf-slot input")] as HTMLInputElement[];
const addSlot = (card: Element) => (buttonWith(card, "Add a slot") as HTMLButtonElement).click();
/** Opens the Shelf's editor (when it is closed) and then the card of one look: one card is open at a time. */
function openLook(root: Element, name: string) {
  if (!root.querySelector(".shelf-list.is-editing")) buttonWith(root, "Edit the shelf").click();
  buttonWith(cardOf(root, name), "Edit").click();
  assert.ok(cardOf(root, name).classList.contains("shelf-editing"), `the card of ${name} is open`);
}

test("slots: a look's slots show on its card, and the editor shows them as rows", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const chips = [...cardOf(root, "Ember Wings").querySelectorAll(".slot-chip")].map((c) => text(c));
  assert.deepEqual(chips, ["wings ember", "trail #ffcf5a"]);
  assert.equal(cardOf(root, "Ember Wings").querySelectorAll(".slot-chip .swatch").length, 1, "a colour value shows a swatch");
  assert.equal(cardOf(root, "Classic").querySelector(".slot-chip"), null);
  openLook(root, "Ember Wings");
  const inputs = slotInputs(cardOf(root, "Ember Wings"));
  assert.deepEqual(inputs.map((i) => i.value), ["wings", "ember", "trail", "#ffcf5a"]);
  assert.ok(text(cardOf(root, "Ember Wings")).includes("Slots (2 of 8)"));
  // The draft starts equal to the game's looks: no change yet.
  assert.ok(text(root).includes("No change yet"));
});

test("slots: add a slot to a look nobody owns; the change is listed and looks.json has it", async () => {
  const { root, mounted, calls } = setup();
  await mounted.ready;
  const before = calls.length;
  openLook(root, "Classic");
  addSlot(cardOf(root, "Classic"));
  let inputs = slotInputs(cardOf(root, "Classic"));
  assert.deepEqual(inputs.map((i) => i.value), ["slot-1", ""], "a new row has a name and no value");
  assert.ok(text(root).includes("Fix these first"), "an empty value is a mistake");
  typeInto(inputs[0], "wings");
  typeInto(inputs[1], "ember");
  assert.ok(!text(root).includes("Fix these first"), text(root).slice(text(root).indexOf("Fix these"), 200));
  assert.ok(text(root).includes("1 added, 1 changed") || text(root).includes("0 added, 1 changed, 0 removed"));
  assert.ok(text(root).includes("Classic: slots changed (wings)"));
  assert.ok(text(root).includes('"slots": { "wings": "ember" }'), "looks.json has the slot on the look's own line");
  assert.equal((buttonWith(root, "Copy looks.json") as HTMLButtonElement).disabled, false);
  assert.equal(calls.length, before, "no request while the slots are edited");
});

test("slots: a look that a player owns cannot have its slots changed: the mistake is shown, with the way out, and the copy buttons wait", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  openLook(root, "Mint Cap");
  const mint = cardOf(root, "Mint Cap");
  assert.ok(text(mint).includes("A player owns this look: its slots cannot change"));
  addSlot(mint);
  const inputs = slotInputs(cardOf(root, "Mint Cap"));
  typeInto(inputs[0], "wings");
  typeInto(inputs[1], "ember");
  assert.ok(text(root).includes('The slots of the look "mint-cap" (Mint Cap) changed, and a player owns it'));
  assert.ok(text(root).includes("Add a new look with the new slots instead") || text(root).includes("add a new look with the new slots"));
  assert.equal((buttonWith(root, "Copy looks.json") as HTMLButtonElement).disabled, true);
  // Take the slot away again: the mistake goes, and there is no change.
  buttonWith(cardOf(root, "Mint Cap"), "Remove").click();
  const removeButtons = [...cardOf(root, "Mint Cap").querySelectorAll(".shelf-slot button")];
  assert.equal(removeButtons.length, 0);
  assert.ok(!text(root).includes("Fix these first"));
  assert.ok(text(root).includes("No change yet"));
});

test("slots: a price, a name or a colour of an owned look may still change; only its slots are held", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  openLook(root, "Mint Cap");
  const price = cardOf(root, "Mint Cap").querySelector('input[type="number"]') as HTMLInputElement;
  typeInto(price, "0.5");
  assert.ok(!text(root).includes("Fix these first"));
  assert.ok(text(root).includes("1 changed"));
  assert.equal((buttonWith(root, "Copy looks.json") as HTMLButtonElement).disabled, false);
});

test("slots: a name twice, a bad name and a bad value are each named; at most 8 slots", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  openLook(root, "Classic");
  const card = () => cardOf(root, "Classic");
  addSlot(card());
  addSlot(card());
  let inputs = slotInputs(card());
  typeInto(inputs[0], "wings");
  typeInto(inputs[1], "ember");
  typeInto(inputs[2], "wings");
  typeInto(inputs[3], "flame");
  assert.ok(text(root).includes('the slot name "wings" is used twice'));
  assert.equal((buttonWith(root, "Copy looks.json") as HTMLButtonElement).disabled, true);
  typeInto(inputs[2], "Trail");
  assert.ok(text(root).includes('the slot name "Trail" must be 1 to 24 lowercase letters'));
  typeInto(inputs[2], "trail");
  typeInto(inputs[3], "Flame!");
  assert.ok(text(root).includes('"slots.trail" must be a word'));
  typeInto(inputs[3], "#ffcf5a");
  assert.ok(!text(root).includes("Fix these first"));
  // Up to 8, then Add is off.
  for (let i = 0; i < 6; i++) addSlot(card());
  assert.equal(slotInputs(card()).length, 16);
  assert.equal((buttonWith(card(), "Add a slot") as HTMLButtonElement).disabled, true);
  assert.ok(text(card()).includes("Slots (8 of 8)"));
});

test("slots: Duplicate copies the slots, and Start over brings the game's looks back", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  openLook(root, "Ember Wings");
  buttonWith(cardOf(root, "Ember Wings"), "Duplicate").click();
  const copy = cardOf(root, "Ember Wings copy");
  assert.deepEqual(slotInputs(copy).map((i) => i.value), ["wings", "ember", "trail", "#ffcf5a"]);
  assert.ok(text(root).includes("1 added"));
  buttonWith(root, "Start over").click();
  assert.ok(text(root).includes("No change yet"));
  assert.equal(cardOf(root, "Ember Wings copy"), undefined);
});

// ---- the Sign-ins card ----

function withLogins() {
  const store = createMemoryStore({ logins: true });
  store.logins.push({ at: NOW - 60_000, country: "US", browser: "Chrome on macOS" }, { at: NOW - 3_600_000, country: null, browser: "Safari on iOS" }, { at: NOW - 86_400_000, country: "DE", browser: "Firefox on Linux" });
  store.adminSessions = 2;
  return store;
}

test("sign-ins: the card lists them newest first with the country and the browser, and says what is kept", async () => {
  const store = withLogins();
  const { root, mounted } = setup({ store });
  await mounted.ready;
  const card = root.querySelector(".signins") as HTMLElement;
  assert.ok(card, "the Sign-ins card is there");
  const items = [...card.querySelectorAll("li")].map((li) => text(li));
  assert.equal(items.length, 3);
  assert.ok(items[0].includes("United States (US)") && items[0].includes("Chrome on macOS"), items[0]);
  assert.ok(items[1].includes("unknown country") && items[1].includes("Safari on iOS"), items[1]);
  assert.ok(items[2].includes("Germany (DE)"), items[2]);
  assert.ok(text(card).includes("only the time, the rough country and a short browser name are kept"));
});

test("sign-ins: the game's own words about what it keeps replace the default", async () => {
  const store = withLogins();
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as unknown as Node);
  const handler = createAdminHandler({ store, defaults: { character: "nanoterra", signin: "exchange" }, owner: OWNER, session: async () => KINDS.owner, now: () => NOW, limit: () => true });
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") === "POST") headers.set("Origin", ORIGIN);
    return (await handler.handle(new Request(new URL(String(input), ORIGIN), { method: init?.method ?? "GET", headers, body: init?.body as string | undefined })))!;
  }) as typeof fetch;
  const mounted = mountAdmin(root, { looks: LOOKS, fetch: send, signOut: async () => undefined, signIn: () => undefined, loginsNote: "This game keeps them for 30 days." });
  await mounted.ready;
  assert.ok(text(root.querySelector(".signins")!).includes("This game keeps them for 30 days."));
});

test("sign-ins: Sign out everywhere takes two presses; Cancel goes back; Yes signs out, and the panel loads again", async () => {
  const store = withLogins();
  const { root, mounted, calls } = setup({ store });
  await mounted.ready;
  const card = root.querySelector(".signins") as HTMLElement;
  const first = buttonWith(card, "Sign out everywhere") as HTMLButtonElement;
  first.click();
  assert.equal(first.hidden, true);
  assert.ok(text(card).includes("This ends every admin sign-in, in every browser, this one too"));
  buttonWith(card, "Cancel").click();
  assert.equal(first.hidden, false);
  assert.ok(!calls.some((c) => c.path.endsWith("/signout-all")), "nothing was sent by a cancelled press");
  first.click();
  const summaries = calls.filter((c) => c.path.endsWith("/summary")).length;
  (buttonWith(card, "Yes, sign out everywhere") as HTMLButtonElement).click();
  await tick();
  assert.ok(calls.some((c) => c.method === "POST" && c.path === "/api/admin/signout-all"));
  assert.equal(store.adminSessions, 0);
  assert.equal(calls.filter((c) => c.path.endsWith("/summary")).length, summaries + 1, "the panel read the summary again");
});

test("sign-ins: a refused or failed sign-out shows the words and leaves the buttons usable", async () => {
  const store = withLogins();
  store.signOutEverywhere = async () => {
    throw new Error("SECRET_DETAIL");
  };
  const { root, mounted } = setup({ store });
  await mounted.ready;
  const card = root.querySelector(".signins") as HTMLElement;
  (buttonWith(card, "Sign out everywhere") as HTMLButtonElement).click();
  const yes = buttonWith(card, "Yes, sign out everywhere") as HTMLButtonElement;
  yes.click();
  await tick();
  assert.ok(text(card).includes("could not do that"));
  assert.ok(!text(card).includes("SECRET_DETAIL"));
  assert.equal(yes.disabled, false);
});

test("sign-ins: with a store that lists nothing, there is no card", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  assert.equal(root.querySelector(".signins"), null);
});

test("slots: an id that a player owns is never given to a new look, even when that look is not in looks.json now", async () => {
  // "mint-cap" is owned by a player (see the setup) but the game's looks do not have it: a new look named "Mint cap" must not take its id.
  const store = createMemoryStore({ owned: [{ player: OTHER, lookId: "mint-cap", at: NOW }] });
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as unknown as Node);
  const only = LOOKS.filter((l) => l.id !== "mint-cap");
  const handler = createAdminHandler({ store, defaults: { character: "nanoterra", signin: "exchange" }, owner: OWNER, session: async () => KINDS.owner, now: () => NOW, limit: () => true });
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") === "POST") headers.set("Origin", ORIGIN);
    return (await handler.handle(new Request(new URL(String(input), ORIGIN), { method: init?.method ?? "GET", headers, body: init?.body as string | undefined })))!;
  }) as typeof fetch;
  const mounted = mountAdmin(root, { looks: only, fetch: send, signOut: async () => undefined, signIn: () => undefined });
  await mounted.ready;
  buttonWith(root, "Edit the shelf").click();
  buttonWith(root, "Add a look").click();
  const card = [...root.querySelectorAll(".shelf-card")].at(-1) as HTMLElement;
  const name = card.querySelector('input[type="text"]') as HTMLInputElement;
  typeInto(name, "Mint cap");
  const json = (root.querySelector(".shelf-file pre")?.textContent ?? "") + text(root);
  // The new look is not "mint-cap": its id is the next free one, and the owned id is left for the look that players own.
  assert.ok(!/"id": "mint-cap"/.test(root.querySelector(".shelf-file pre")?.textContent ?? ""), json.slice(0, 300));
  assert.ok(/"id": "mint-cap-2"/.test(root.querySelector(".shelf-file pre")?.textContent ?? ""), json.slice(0, 300));
});

// ---- the tabs, the numbers, the Overview, the lists (0.4.0 layout) ----

test("tabs: five real tabs, the Overview first; a press or an arrow key changes the tab, and only its panel shows", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const tabs = [...root.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
  assert.deepEqual(tabs.map((t) => text(t.querySelector(".tab-label")!)), ["Overview", "Cosmetics", "Orders", "Players", "Settings"]);
  assert.deepEqual(tabs.map((t) => t.getAttribute("aria-selected")), ["true", "false", "false", "false", "false"]);
  assert.deepEqual(tabs.map((t) => t.tabIndex), [0, -1, -1, -1, -1], "only the chosen tab is in the Tab order");
  assert.equal(panelOf(root, "overview").hidden, false);
  assert.equal(panelOf(root, "orders").hidden, true);
  tabOf(root, "Orders").click();
  assert.equal(panelOf(root, "orders").hidden, false);
  assert.equal(panelOf(root, "overview").hidden, true);
  assert.equal(tabOf(root, "Orders").getAttribute("aria-selected"), "true");
  tabOf(root, "Orders").dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
  assert.equal(panelOf(root, "players").hidden, false);
  tabOf(root, "Players").dispatchEvent(new win.KeyboardEvent("keydown", { key: "End", bubbles: true }) as unknown as Event);
  assert.equal(panelOf(root, "settings").hidden, false);
  tabOf(root, "Settings").dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
  assert.equal(panelOf(root, "overview").hidden, false, "after the last tab comes the first");
  // The counts on the tabs.
  assert.equal(text(tabOf(root, "Cosmetics").querySelector(".tab-count")!), "3");
  assert.equal(text(tabOf(root, "Orders").querySelector(".tab-count")!), "2");
});

test("tabs: the Shelf's open card and its draft stay when the creator goes to another tab and back, and after a new read", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  tabOf(root, "Cosmetics").click();
  openLook(root, "Mint Cap");
  typeInto(cardOf(root, "Mint Cap").querySelector('input[type="number"]')!, "0.5");
  tabOf(root, "Orders").click();
  tabOf(root, "Cosmetics").click();
  assert.equal((cardOf(root, "Mint Cap").querySelector('input[type="number"]') as HTMLInputElement).value, "0.5");
  await mounted.reload();
  assert.equal(tabOf(root, "Cosmetics").getAttribute("aria-selected"), "true", "a new read keeps the tab");
  assert.equal((cardOf(root, "Mint Cap").querySelector('input[type="number"]') as HTMLInputElement).value, "0.5");
});

test("numbers: four tiles; a paid-late order makes 'To send back' red, and a press on it opens the Orders tab on that status", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const tiles = [...root.querySelectorAll(".kpi")] as HTMLButtonElement[];
  assert.deepEqual(tiles.map((t) => text(t.querySelector(".kpi-label")!)), ["Earned", "Open now", "To send back", "Players"]);
  assert.equal(text(tiles[0].querySelector(".kpi-value")!), "0.2 XNO");
  assert.ok(text(tiles[0]).includes("$0.25 · 1 order"));
  assert.ok(tiles[2].classList.contains("is-alert"));
  tiles[2].click();
  assert.equal(panelOf(root, "orders").hidden, false);
  const pressed = [...panelOf(root, "orders").querySelectorAll(".seg-btn")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => text(b));
  assert.deepEqual(pressed, ["Paid late (1)"]);
  assert.equal(panelOf(root, "orders").querySelectorAll(".order").length, 1);
  tiles[3].click();
  assert.equal(panelOf(root, "players").hidden, false);
});

test("numbers: with no late payment 'To send back' says so and is not red", async () => {
  const store = createMemoryStore({ orders: [{ id: "o1", player: OTHER, lookId: "mint-cap", usd: "0.25", amountRaw: RAW_02, status: "paid", createdAt: NOW - 100, expiresAt: NOW + 100, paidAt: NOW - 50, payer: OTHER, hash: "H1" }] });
  const { root, mounted } = setup({ store });
  await mounted.ready;
  const late = root.querySelector(".kpi-late") as HTMLElement;
  assert.ok(text(late).includes("Nothing to send back"));
  assert.ok(!late.classList.contains("is-alert"));
});

test("overview: the best sellers, the last orders and the two switches; a key opens each tab", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const overview = panelOf(root, "overview");
  const best = overview.querySelector(".best-card") as HTMLElement;
  assert.equal(best.hidden, false);
  assert.ok(text(best).includes("Mint Cap") && text(best).includes("$0.25") && text(best).includes("1 sale · 100%"), text(best));
  assert.equal(overview.querySelectorAll(".recent-card .order").length, 2);
  assert.equal((overview.querySelector(".start-card") as HTMLElement).hidden, true, "a game with orders gets no first steps");
  const glance = text(overview.querySelector(".glance-card")!);
  assert.ok(glance.includes(SWITCHES.character.title) && glance.includes("On"), glance);
  // A switch pressed in Settings shows on the Overview at once.
  (root.querySelectorAll(".switch")[1] as HTMLButtonElement).click();
  await tick();
  const pills = [...overview.querySelectorAll(".glance-card .pill")].map((p) => text(p));
  assert.deepEqual(pills.slice(0, 2), ["On", "Off"]);
  buttonWith(overview, "See all orders").click();
  assert.equal(panelOf(root, "orders").hidden, false);
});

test("overview: a game with no order yet gets three first steps instead of empty lists", async () => {
  const { root, mounted } = setup({ store: createMemoryStore() });
  await mounted.ready;
  const overview = panelOf(root, "overview");
  assert.equal((overview.querySelector(".start-card") as HTMLElement).hidden, false);
  assert.ok(text(overview).includes("No sales yet"));
  assert.equal((overview.querySelector(".best-card") as HTMLElement).hidden, true);
  assert.equal((overview.querySelector(".recent-card") as HTMLElement).hidden, true);
  buttonWith(overview, "Open the shelf").click();
  assert.equal(panelOf(root, "cosmetics").hidden, false);
});

test("bestSellers: by money, then by owners; a look no longer in looks.json keeps its orders' name", async () => {
  const { bestSellers } = await import("../src/admin/panel/index.js");
  const orders = [
    { lookId: "a", look: "A", status: "paid", usd: "0.05" },
    { lookId: "b", look: "B", status: "paid", usd: "0.25" },
    { lookId: "gone", look: "Old Hat", status: "paid", usd: "0.05" },
    { lookId: "b", look: "B", status: "open", usd: "0.25" },
  ] as never;
  const players = [{ player: OTHER, looks: [{ id: "a", name: "A", at: 1 }, { id: "gone", name: "Old Hat", at: 1 }] }, { player: OWNER, looks: [{ id: "a", name: "A", at: 1 }] }];
  const best = bestSellers({ orders, players }, [{ id: "a", name: "Alpha", priceUsd: 0.05, change: { body: "#000000" } }]);
  assert.deepEqual(best.map((b) => [b.name, b.cents, b.owners]), [["B", 25, 0], ["Alpha", 5, 2], ["Old Hat", 5, 1]]);
});

test("shelf: filters and sorts: For sale, Free, Not sold yet; Best selling, price and name", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const names = () => [...panelOf(root, "cosmetics").querySelectorAll(".shelf-card .shelf-name")].map((n) => text(n));
  const filterKey = (words: string) => [...panelOf(root, "cosmetics").querySelectorAll(".seg-btn")].find((b) => text(b).startsWith(words)) as HTMLButtonElement;
  assert.deepEqual(names(), ["Mint Cap", "Classic", "Ember Wings"], "best selling first, then the file's order");
  assert.deepEqual([...panelOf(root, "cosmetics").querySelectorAll(".seg-btn")].map((b) => text(b)), ["All3", "For sale2", "Free1", "Not sold yet1"]);
  filterKey("Free").click();
  assert.deepEqual(names(), ["Classic"]);
  filterKey("Not sold yet").click();
  assert.deepEqual(names(), ["Ember Wings"]);
  filterKey("For sale").click();
  assert.deepEqual(names(), ["Mint Cap", "Ember Wings"]);
  filterKey("All").click();
  const sort = root.querySelector('select[aria-label="Sort the looks"]') as HTMLSelectElement;
  sort.value = "name";
  sort.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  assert.deepEqual(names(), ["Classic", "Ember Wings", "Mint Cap"]);
  const s2 = root.querySelector('select[aria-label="Sort the looks"]') as HTMLSelectElement;
  s2.value = "price-asc";
  s2.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  assert.deepEqual(names(), ["Classic", "Mint Cap", "Ember Wings"]);
});

test("shelf: the price on each card names its step of the ladder, and a look that sold shows its share", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  assert.equal(text(cardOf(root, "Mint Cap").querySelector(".price-pill")!), "25¢ · statement");
  assert.equal(text(cardOf(root, "Classic").querySelector(".price-pill")!), "Free");
  assert.ok(text(cardOf(root, "Mint Cap")).includes("100% of sales"));
  assert.equal(cardOf(root, "Ember Wings").querySelector(".share"), null);
});

test("shelf: one card is open at a time; Done closes it; a changed look is marked, and to see shows the game's looks with a note about the draft", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  openLook(root, "Classic");
  openLook(root, "Mint Cap");
  assert.equal(root.querySelectorAll(".shelf-editing").length, 1);
  assert.ok(cardOf(root, "Mint Cap").classList.contains("shelf-editing"));
  typeInto(cardOf(root, "Mint Cap").querySelector('input[type="number"]')!, "0.5");
  assert.ok(text(cardOf(root, "Mint Cap").querySelector(".marks")!).includes("Changed"), "the open card is marked at once");
  buttonWith(cardOf(root, "Mint Cap"), "Done").click();
  assert.equal(root.querySelectorAll(".shelf-editing").length, 0);
  assert.ok(cardOf(root, "Mint Cap").classList.contains("is-changed"));
  buttonWith(root, "Close the editor").click();
  // To see: the price the game has NOW, and a note that a draft waits.
  assert.equal(text(cardOf(root, "Mint Cap").querySelector(".price-pill")!), "25¢ · statement");
  assert.ok(text(root).includes("You have a draft that is not in your game yet: 0 added, 1 changed, 0 removed."));
  buttonWith(root, "Open the draft").click();
  assert.ok(root.querySelector(".shelf-list.is-editing"));
});

test("shelf: the price ladder and the hat choices set the look; a removed look can be put back", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  openLook(root, "Ember Wings");
  const card = () => cardOf(root, "Ember Wings");
  const steps = [...card().querySelectorAll(".ladder-step")] as HTMLButtonElement[];
  assert.deepEqual(steps.map((s) => text(s)), ["Freeeveryone", "1¢dye", "2¢charm", "5¢piece", "25¢statement", "50¢set", "$1outfit"]);
  steps[3].click();
  assert.equal((card().querySelector('input[type="number"]') as HTMLInputElement).value, "0.05");
  assert.equal(steps[3].getAttribute("aria-pressed"), "true");
  const crown = [...card().querySelectorAll('.hat-choice input')].find((i) => (i as HTMLInputElement).value === "crown") as HTMLInputElement;
  crown.checked = true;
  crown.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  assert.ok(text(root).includes("Ember Wings: price $0.25 to $0.05, hat none to crown"), text(root.querySelector(".shelf-foot")!));
  // The look's own Remove (the slots have Remove keys too).
  buttonWith(card().querySelector(".shelf-actions")!, "Remove").click();
  assert.ok(!cardOf(root, "Ember Wings"), "the look is out of the draft");
  assert.ok(text(root).includes("Removed: Ember Wings"));
  buttonWith(root.querySelector(".shelf-ghost")!, "Put back").click();
  assert.ok(cardOf(root, "Ember Wings"));
  assert.ok(text(root).includes("No change yet"));
});

test("shelfFilter and shelfSort are pure and keep the file's order for equal looks", async () => {
  const { shelfFilter, shelfSort } = await import("../src/admin/panel/index.js");
  const stats = new Map([["mint-cap", { owners: 1, paid: 1, paidCents: 25, late: 0 }]]);
  assert.deepEqual(LOOKS.filter((l) => shelfFilter(l, "unsold", stats.get(l.id))).map((l) => l.id), ["ember-wings"]);
  assert.deepEqual(shelfSort(LOOKS, "best", stats).map((l) => l.id), ["mint-cap", "classic", "ember-wings"]);
  assert.deepEqual(shelfSort(LOOKS, "price-desc", stats).map((l) => l.id), ["mint-cap", "ember-wings", "classic"]);
  assert.deepEqual(shelfSort(LOOKS, "file", stats).map((l) => l.id), LOOKS.map((l) => l.id));
});

test("orders: a search finds a look, an address or a block; no match says so; the hash is short with a copy key", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  tabOf(root, "Orders").click();
  const panel = panelOf(root, "orders");
  const search = panel.querySelector('input[type="search"]') as HTMLInputElement;
  typeInto(search, "mint");
  assert.equal(panel.querySelectorAll(".order").length, 2);
  assert.ok(text(panel).includes("2 orders of 2 match “mint”."));
  typeInto(search, "h2");
  assert.equal(panel.querySelectorAll(".order").length, 1, "the block H2");
  typeInto(search, "nothing-like-this");
  assert.equal(panel.querySelectorAll(".order").length, 0);
  assert.ok(text(panel).includes("No order matches your search."));
  typeInto(search, "");
  assert.equal(panel.querySelectorAll(".order").length, 2);
  assert.ok(panel.querySelector(".order-hash .copy-key"), "the block has a copy key");
});

test("orderMatches and playerMatches: upper or lower case does not matter; an empty search matches all", async () => {
  const { orderMatches, playerMatches } = await import("../src/admin/panel/index.js");
  const o = { id: "o", player: OTHER, lookId: "mint-cap", look: "Mint Cap", usd: "0.25", xno: "0.2", status: "paid", createdAt: 0, expiresAt: 0, paidAt: 0, payer: null, hash: "ABC" };
  assert.ok(orderMatches(o, "MINT"));
  assert.ok(orderMatches(o, "abc"));
  assert.ok(orderMatches(o, "  "));
  assert.ok(!orderMatches(o, "crown"));
  const p = { player: OTHER, looks: [{ id: "mint-cap", name: "Mint Cap", at: 0 }] };
  assert.ok(playerMatches(p, "mint cap"));
  assert.ok(playerMatches(p, OTHER.slice(0, 12).toUpperCase()));
  assert.ok(!playerMatches(p, "crown"));
});

test("players: each player with a short address, a copy key and their looks as chips", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const panel = panelOf(root, "players");
  const rows = panel.querySelectorAll(".player");
  assert.equal(rows.length, 1);
  assert.ok(text(rows[0]).includes("nano_3bbbb…bbbbbb"));
  assert.deepEqual([...rows[0].querySelectorAll(".look-chip")].map((c) => text(c)), ["Mint Cap"]);
  assert.ok(rows[0].querySelector(".copy-key"));
});

test("signing out takes the drawn data away: a signed-out page holds no orders", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  assert.ok(root.querySelector(".order"));
  buttonWith(root.querySelector(".topbar")!, "Sign out").click();
  await tick();
  assert.ok(text(root).includes("Sign in with your game's address"));
  assert.equal(root.querySelector(".order"), null);
  assert.ok(!text(root).includes("Mint Cap"));
});
