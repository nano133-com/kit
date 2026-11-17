// The Maintenance card of /admin in a fake DOM (happy-dom), against the REAL handler and the memory store, with a stand-in for nano133.com.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import { MAINTENANCE_CARD, createAdminHandler, createMemoryStore, type AdminSession } from "../src/admin/index.js";
import type { TellResult } from "../src/maintenance/index.js";
import type { Look } from "../src/looks/index.js";

const OWNER = `nano_1${"a".repeat(59)}`;
const ORIGIN = "https://game.example";
const NOW = Date.now();
const LOOKS: Look[] = [{ id: "classic", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } }];
const SESSION: AdminSession = { address: OWNER, createdAt: NOW - 1000, via: "wallet" };

let mountAdmin: typeof import("../src/admin/panel/index.js").mountAdmin;
let win: Window;
before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event });
  ({ mountAdmin } = await import("../src/admin/panel/index.js"));
});

function setup(tell: "none" | (() => TellResult)) {
  const store = createMemoryStore();
  const told: boolean[] = [];
  const handler = createAdminHandler({
    store,
    defaults: { character: "nanoterra", signin: "exchange" },
    owner: OWNER,
    session: async () => SESSION,
    limit: () => true,
    maintenance: { tell: tell === "none" ? null : async ({ on }) => (told.push(on), tell()) },
  });
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), ORIGIN);
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") === "POST") headers.set("Origin", ORIGIN);
    return (await handler.handle(new Request(url, { method: init?.method ?? "GET", headers, body: init?.body as string | undefined }))) ?? new Response("{}", { status: 404 });
  }) as typeof fetch;
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as unknown as Node);
  const mounted = mountAdmin(root, { looks: LOOKS, fetch: send, signOut: async () => undefined, signIn: () => undefined });
  return { root, mounted, store, told };
}
const text = (el: Element | null) => el?.textContent ?? "";
const tick = () => new Promise((r) => setTimeout(r, 10));

test("the Maintenance card comes first in Settings; a press turns the game's maintenance on, Nanoterra is told, and the top bar says so", async () => {
  const { root, mounted, store, told } = setup(() => ({ ok: true }));
  await mounted.ready;
  const settings = root.querySelector("#n133-panel-settings .settings-grid")!;
  assert.ok(settings.firstElementChild?.classList.contains("maint-card"));
  const card = root.querySelector(".maint-card")!;
  const sw = card.querySelector(".switch") as HTMLButtonElement;
  assert.equal(sw.getAttribute("aria-checked"), "false");
  assert.ok(text(card).includes(MAINTENANCE_CARD.off));
  // Never pressed: nothing to tell, no line about Nanoterra, no chip.
  assert.equal((card.querySelector(".maint-told") as HTMLElement).hidden, true);
  assert.equal((root.querySelector(".chip-maint") as HTMLElement).hidden, true);
  sw.click();
  await tick();
  assert.equal(sw.getAttribute("aria-checked"), "true");
  assert.ok(text(card).includes(MAINTENANCE_CARD.on));
  assert.equal(text(card.querySelector(".maint-told")), MAINTENANCE_CARD.told);
  assert.equal((card.querySelector(".maint-again .btn") as HTMLElement).hidden, true);
  assert.equal((root.querySelector(".chip-maint") as HTMLElement).hidden, false);
  assert.equal(store.rows.get("setting:maintenance"), "on");
  assert.deepEqual(told, [true]);
  sw.click();
  await tick();
  assert.equal(sw.getAttribute("aria-checked"), "false");
  assert.equal((root.querySelector(".chip-maint") as HTMLElement).hidden, true);
  assert.deepEqual(told, [true, false]);
  root.remove();
});

test("Nanoterra did not answer: the card says 'Nanoterra not told yet' with the reason, and 'Tell Nanoterra again' tells it", async () => {
  let ok = false;
  const { root, mounted, told } = setup(() => (ok ? { ok: true } : { ok: false, error: "Nanoterra did not answer." }));
  await mounted.ready;
  const card = root.querySelector(".maint-card")!;
  (card.querySelector(".switch") as HTMLButtonElement).click();
  await tick();
  assert.equal(text(card.querySelector(".maint-told")), MAINTENANCE_CARD.notTold);
  assert.equal(text(card.querySelector(".maint-why")), "Nanoterra did not answer.");
  const again = card.querySelector(".maint-again .btn") as HTMLButtonElement;
  assert.equal(again.hidden, false);
  assert.equal(text(again), MAINTENANCE_CARD.retry);
  // The switch is on all the same: the game's own site follows it.
  assert.equal((card.querySelector(".switch") as HTMLElement).getAttribute("aria-checked"), "true");
  ok = true;
  again.click();
  await tick();
  assert.equal(text(card.querySelector(".maint-told")), MAINTENANCE_CARD.told);
  assert.equal(again.hidden, true);
  assert.deepEqual(told, [true, true]);
  root.remove();
});

test("the panel of a game that did not give the maintenance option has no Maintenance card and no chip", async () => {
  const store = createMemoryStore();
  const handler = createAdminHandler({ store, defaults: { character: "nanoterra", signin: "exchange" }, owner: OWNER, session: async () => SESSION, limit: () => true });
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => (await handler.handle(new Request(new URL(String(input), ORIGIN), init as RequestInit))) ?? new Response("{}", { status: 404 })) as typeof fetch;
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as unknown as Node);
  const mounted = mountAdmin(root, { looks: LOOKS, fetch: send, signOut: async () => undefined, signIn: () => undefined });
  await mounted.ready;
  assert.equal(root.querySelector(".maint-card"), null);
  assert.ok(root.querySelector(".game-card"));
  assert.equal((root.querySelector(".chip-maint") as HTMLElement).hidden, true);
  root.remove();
});

test("a game with no Nanoterra secret: the card says Nanoterra is not told and why, with no key to tell it again", async () => {
  const { root, mounted } = setup("none");
  await mounted.ready;
  const card = root.querySelector(".maint-card")!;
  (card.querySelector(".switch") as HTMLButtonElement).click();
  await tick();
  assert.equal(text(card.querySelector(".maint-told")), MAINTENANCE_CARD.cannotTell);
  assert.equal((card.querySelector(".maint-again .btn") as HTMLElement).hidden, true);
  root.remove();
});
