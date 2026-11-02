// The owner's passkeys in the browser, in a fake DOM (happy-dom), inside the REAL admin panel (mountAdmin) against the REAL routes on the memory store, with
// a stand-in device (its PRF answer is fixed, so the passkey's address is known): the Passkey tile after the wallets, "Owner passkeys" in Settings (Add only
// with the wallet, the list, Remove), a linked passkey that opens the admin, and a removed one that does not.
import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";
import { Window } from "happy-dom";
import type { Look } from "../src/looks/index.js";
import type { PasskeyScheme } from "../src/player-signin/index.js";
import { ORIGIN, OWNER, makeGame } from "./admin-signin-helpers.js";

const LOOKS: Look[] = [{ id: "classic", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } }];
const SCHEME: PasskeyScheme = { input: "game.test player v1", salt: "game.test", info: "game.test player seed v1", versionByte: 1 };
const PRF = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
const prfHex = Buffer.from(PRF).toString("hex");

let win: Window;
let panel: typeof import("../src/admin-signin/panel/index.js");
let adminPanel: typeof import("../src/admin/panel/index.js");
let passkeyAddress = "";
type Device = { created: string[]; gets: number };
let device: Device;

/** A stand-in for the device's passkeys: it makes one, and at each use answers the PRF with PRF. */
function installDevice() {
  const rawId = new Uint8Array(16).fill(5).buffer;
  const cred = (results?: unknown) => ({
    rawId,
    response: { userHandle: Uint8Array.from([SCHEME.versionByte, ...new Uint8Array(31).fill(3)]).buffer },
    getClientExtensionResults: () => ({ prf: results === undefined ? { enabled: true } : { results: { first: results } } }),
  });
  Object.assign(win, { PublicKeyCredential: class {} });
  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: {
      async create(o: { publicKey: { user: { name: string } } }) {
        device.created.push(o.publicKey.user.name);
        return cred();
      },
      async get() {
        device.gets += 1;
        return cred(PRF.slice().buffer);
      },
    },
  });
}

before(async () => {
  win = new Window({ url: ORIGIN });
  for (const [k, v] of Object.entries({ document: win.document, window: win, location: win.location, localStorage: win.localStorage, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent }))
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  panel = await import("../src/admin-signin/panel/index.js");
  adminPanel = await import("../src/admin/panel/index.js");
  const { schemeVector } = await import("../src/player-signin/index.js");
  passkeyAddress = (await schemeVector(SCHEME, prfHex)).address;
});

beforeEach(() => {
  device = { created: [], gets: 0 };
  installDevice();
});

const settle = async (n = 60) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const byText = (root: Element, words: string) => Array.from(root.querySelectorAll("button, a")).find((b) => text(b).trim() === words) as HTMLElement | undefined;
function click(el: Element | undefined) {
  assert.ok(el, "the key is there");
  (el as HTMLElement).click();
}

/** A page of the game: its cookies, and a fetch that runs the real routes; a wallet's start is signed at once by the owner. */
function page(passkeys = true) {
  const g = makeGame("memory", { admin: { passkeys } });
  g.clock.now = Date.now();
  const jar = new Map<string, string>();
  const calls: string[] = [];
  const send = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), ORIGIN);
    calls.push(url.pathname);
    g.clock.now = Date.now();
    const headers = new Headers(init.headers);
    headers.set("Origin", ORIGIN);
    if (jar.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await g.route(new Request(url, { method: init.method ?? "GET", headers, body: init.body as string | undefined }));
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (/Max-Age=0/.test(line)) jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    if (url.pathname.endsWith("/start") && res.ok) {
      const body = await res.clone().json();
      await g.answer(body.way, body, OWNER);
    }
    return res;
  }) as typeof fetch;
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  return { g, jar, calls, send, root };
}

test("the whole path in mountAdmin: the wallet signs in, adds a passkey in Settings; the passkey then opens the admin with no Add or Remove; the wallet removes it, and it opens nothing", async () => {
  const p = page();
  const card = panel.ownerPasskeys({ scheme: SCHEME, name: "Game Test", fetch: p.send });
  const mounted = adminPanel.mountAdmin(p.root, {
    looks: LOOKS,
    fetch: p.send,
    signIn: panel.adminSignIn({ fetch: p.send, touch: true, passkeys: true, scheme: SCHEME, name: "Game Test" }),
    signOut: panel.adminSignOut({ fetch: p.send }),
    cards: [card],
  });
  await mounted.ready;
  await settle();
  // The gate: the wallets first (Berry Wallet first), then the passkey.
  const tiles = Array.from(p.root.querySelectorAll(".n133s-tile"));
  assert.deepEqual(tiles.map((t) => t.getAttribute("data-way")), ["berry", "nautilus", "passkey"]);
  assert.equal(p.root.querySelector(".n133s-tiles")!.getAttribute("data-count"), "3");
  assert.equal(text(p.root.querySelector(".n133s-or")), "Choose your wallet or your passkey");
  (tiles[0] as HTMLElement).click();
  await settle();
  assert.equal((p.root.querySelector("#n133-data") as HTMLElement).hidden, false, "the wallet opened the admin");

  // Settings: the card, after the Sign-ins card, with nothing linked yet.
  assert.equal(card.el.hidden, false);
  assert.ok(card.el.compareDocumentPosition(p.root.querySelector(".signins")!) & 2, "the card comes after the Sign-ins card");
  assert.equal(text(card.el.querySelector("h2")), "Owner passkeys");
  assert.ok(text(card.el).includes("It cannot move money: your money stays in your wallet."));
  assert.ok(text(card.el).includes("No passkey is linked yet."));
  click(byText(card.el, "Add a passkey"));
  assert.ok(byText(card.el, "Use a passkey I have") && byText(card.el, "Cancel"));
  click(byText(card.el, "Make a new passkey"));
  await settle();
  assert.equal(device.created.length, 1);
  assert.match(device.created[0], /^Game Test admin · /);
  assert.equal(text(card.el.querySelector(".passkey-status")), "Passkey added. It opens this admin page from now on.");
  assert.equal(card.el.querySelectorAll(".passkey-row").length, 1);
  assert.ok(text(card.el.querySelector(".passkey-row")).includes(passkeyAddress.slice(0, 10)));
  assert.deepEqual((await p.g.adminStore.passkeys!(OWNER.address)).map((x) => x.address), [passkeyAddress], "the server holds the link");

  // Sign out; the passkey signs in.
  click(Array.from(p.root.querySelectorAll("button")).find((b) => text(b).trim() === "Sign out"));
  await settle();
  click(p.root.querySelector('[data-way="passkey"]') ?? undefined);
  await settle();
  assert.equal(text(p.root.querySelector(".n133s-step")), "Passkey");
  click(byText(p.root, "Use my passkey"));
  await settle();
  assert.equal((p.root.querySelector("#n133-data") as HTMLElement).hidden, false, "the linked passkey opened the admin");
  assert.ok(p.calls.includes("/api/admin-signin/passkey"));
  assert.ok(text(card.el).includes("This passkey"));
  assert.equal(byText(card.el, "Add a passkey"), undefined, "a passkey's session adds nothing");
  assert.equal(byText(card.el, "Remove"), undefined, "nor removes");
  assert.ok(text(card.el).includes("Sign in with your wallet to add or remove a passkey."));

  // The wallet again: Remove, in two presses.
  click(Array.from(p.root.querySelectorAll("button")).find((b) => text(b).trim() === "Sign out"));
  await settle();
  click(p.root.querySelector('[data-way="berry"]') ?? undefined);
  await settle();
  click(byText(card.el, "Remove"));
  assert.ok(text(card.el).includes("Remove this passkey?"));
  click(byText(card.el, "Yes, remove"));
  await settle();
  assert.equal(text(card.el.querySelector(".passkey-status")), "Passkey removed.");
  assert.ok(text(card.el).includes("No passkey is linked yet."));

  // The removed passkey opens nothing.
  click(Array.from(p.root.querySelectorAll("button")).find((b) => text(b).trim() === "Sign out"));
  await settle();
  click(p.root.querySelector('[data-way="passkey"]') ?? undefined);
  await settle();
  click(byText(p.root, "Use my passkey"));
  await settle();
  assert.equal(text(p.root.querySelector(".n133s-status")), "This passkey is not linked to the game's address. Sign in with your wallet, then add this passkey in Settings.");
  assert.equal((p.root.querySelector("#n133-data") as HTMLElement).hidden, true);
  assert.equal(p.jar.has("admin"), false);
  mounted.destroy();
});

test("passkeys off on the game: no Passkey tile, and the Owner passkeys card does not show", async () => {
  const p = page(false);
  const card = panel.ownerPasskeys({ scheme: SCHEME, name: "Game Test", fetch: p.send });
  const mounted = adminPanel.mountAdmin(p.root, { looks: LOOKS, fetch: p.send, signIn: panel.adminSignIn({ fetch: p.send, touch: true }), signOut: panel.adminSignOut({ fetch: p.send }), cards: [card] });
  await mounted.ready;
  await settle();
  assert.deepEqual(Array.from(p.root.querySelectorAll(".n133s-tile")).map((t) => t.getAttribute("data-way")), ["berry", "nautilus"]);
  click(p.root.querySelector('[data-way="berry"]') ?? undefined);
  await settle();
  assert.equal((p.root.querySelector("#n133-data") as HTMLElement).hidden, false);
  assert.equal(card.el.hidden, true);
  mounted.destroy();
});

test("a passkey prompt the owner closes says so in plain words; the view needs the scheme and the name", async () => {
  const p = page();
  Object.defineProperty(globalThis.navigator, "credentials", { configurable: true, value: { get: async () => Promise.reject(Object.assign(new Error("closed"), { name: "NotAllowedError" })) } });
  const v = panel.adminSigninView({ fetch: p.send, touch: true, passkeys: true, scheme: SCHEME, name: "Game Test" });
  p.root.append(v.node);
  click(v.node.querySelector('[data-way="passkey"]') ?? undefined);
  click(byText(v.node, "Use my passkey"));
  await settle();
  assert.equal(text(v.node.querySelector(".n133s-status")), "The passkey was closed. Try again.");
  assert.equal(p.jar.has("admin"), false);
  v.stop();
  assert.throws(() => panel.adminSigninView({ passkeys: true, name: "Game Test" }));
  assert.throws(() => panel.adminSigninView({ passkeys: true, scheme: SCHEME }));
  assert.throws(() => panel.ownerPasskeys({ scheme: { ...SCHEME, versionByte: 0 }, name: "x" }));
});
