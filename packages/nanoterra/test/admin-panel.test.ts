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

test("the owner sees every card: the two switches, the numbers, the Shelf, the orders and the looks that players own", async () => {
  const { root, mounted } = setup();
  await mounted.ready;
  const all = text(root);
  for (const part of ["Game", SWITCHES.character.title, SWITCHES.signin.title, "Paid", "Paid late (send back)", "Open now", "Shelf", "Mint Cap", "Orders", "All (2)", "Paid late (1)", "Owned looks", "Signed in as", "Sign out"]) assert.ok(all.includes(part), part);
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
  buttonWith(root, "Edit the shelf").click();
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
  buttonWith(root, "Edit the shelf").click();
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
