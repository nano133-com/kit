// The admin's sign-in panel in a fake DOM (happy-dom), inside the REAL admin panel (mountAdmin), against the REAL routes (the admin's sign-in, the
// player's, the admin handler) on the memory store: the gate shows the wallets, a wallet signs, the panel opens; NanChat only when it is on; the owner only.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import { NANCHAT_REFUSAL } from "../src/admin-signin/index.js";
import type { Look } from "../src/looks/index.js";
import { ORIGIN, OWNER, STRANGER, makeGame, type Account } from "./admin-signin-helpers.js";

const LOOKS: Look[] = [{ id: "classic", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } }];

let win: Window;
let panel: typeof import("../src/admin-signin/panel/index.js");
let adminPanel: typeof import("../src/admin/panel/index.js");
before(async () => {
  win = new Window({ url: ORIGIN });
  for (const [k, v] of Object.entries({ document: win.document, window: win, location: win.location, localStorage: win.localStorage, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent }))
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  panel = await import("../src/admin-signin/panel/index.js");
  adminPanel = await import("../src/admin/panel/index.js");
});

const settle = async (n = 40) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const byText = (root: Element, words: string) => Array.from(root.querySelectorAll("button, a")).find((b) => text(b).trim() === words) as HTMLElement | undefined;

/** A page of the game: its cookies, and a fetch that runs the real routes. `signAs`: the wallet signs right after the start, as `signAs` (no 2-second wait). */
function page(o: { nanchat?: boolean; panelNanchat?: boolean; signAs?: Account | null } = {}) {
  const g = makeGame("memory", { admin: { nanchat: o.nanchat === true } });
  // The page's clock is the real one: the panel compares a request's end with Date.now().
  g.clock.now = Date.now();
  const jar = new Map<string, string>();
  const calls: string[] = [];
  const send = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), ORIGIN);
    calls.push(url.pathname);
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
    if (url.pathname.endsWith("/start") && res.ok && o.signAs !== null) {
      const body = await res.clone().json();
      await g.answer(body.way, body, o.signAs ?? OWNER);
    }
    return res;
  }) as typeof fetch;
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  return { g, jar, calls, send, root, nanchat: o.panelNanchat ?? o.nanchat };
}

test("in mountAdmin: the gate shows Berry Wallet and Nautilus (Berry first, no NanChat), a QR code on a computer; the wallet signs and the admin opens", async () => {
  const p = page();
  const mounted = adminPanel.mountAdmin(p.root, { looks: LOOKS, fetch: p.send, signIn: panel.adminSignIn({ fetch: p.send, touch: false }), signOut: panel.adminSignOut({ fetch: p.send }) });
  await mounted.ready;
  await settle();
  const view = p.root.querySelector(".n133-admin-signin")!;
  assert.ok(view, "the gate holds the admin's sign-in");
  assert.ok(text(view).includes("signs in to the ADMIN of this game"));
  const tiles = Array.from(view.querySelectorAll(".n133s-tile"));
  assert.deepEqual(tiles.map((t) => t.getAttribute("data-way")), ["berry", "nautilus"]);
  assert.equal(view.querySelector(".n133s-tiles")!.getAttribute("data-count"), "2");
  (tiles[0] as HTMLElement).click();
  await settle();
  assert.deepEqual(p.calls.slice(0, 3), ["/api/admin/summary", "/api/admin-signin/start", "/api/admin-signin/check"]);
  assert.ok(p.jar.has("admin"), "the admin cookie is set");
  await settle();
  assert.equal((p.root.querySelector("#n133-data") as HTMLElement).hidden, false, "the admin opened");
  assert.ok(p.calls.filter((c) => c === "/api/admin/summary").length >= 2);
  // Sign out: the admin login only.
  const out = Array.from(p.root.querySelectorAll("button")).find((b) => text(b).trim() === "Sign out") as HTMLElement;
  out.click();
  await settle();
  assert.ok(p.calls.includes("/api/admin-signin/signout"));
  assert.equal(p.jar.has("admin"), false);
  assert.ok(p.root.querySelector(".n133-admin-signin"), "the gate shows the sign-in again");
  mounted.destroy();
});

test("Berry Wallet on a computer shows its QR code; Nautilus's link is too long for the package's QR code, so its link shows (no fault); a phone gets one key", async () => {
  const p = page({ signAs: null });
  const v = panel.adminSigninView({ fetch: p.send, touch: false });
  p.root.append(v.node);
  (v.node.querySelector('[data-way="berry"]') as HTMLElement).click();
  await settle();
  assert.ok(v.node.querySelector(".n133s-qr svg"), "a QR code");
  assert.ok(text(v.node).includes("Scan this with Berry Wallet on your phone"));
  click(byText(v.node, "Back"));
  (v.node.querySelector('[data-way="nautilus"]') as HTMLElement).click();
  await settle();
  assert.ok(text(v.node).includes("Check that Nautilus shows the code"));
  assert.ok(byText(v.node, "open Nautilus on this computer"), "the link, not a fault");
  assert.doesNotMatch(text(v.node.querySelector(".n133s-status")), /qrModules|longer/);
  v.stop();
  const phone = panel.adminSigninView({ fetch: p.send, touch: true });
  p.root.append(phone.node);
  (phone.node.querySelector('[data-way="nautilus"]') as HTMLElement).click();
  await settle();
  const open = byText(phone.node, "Open Nautilus") as HTMLAnchorElement;
  assert.ok(open?.getAttribute("href")?.startsWith("nanoauth:"));
  phone.stop();
});

test("NanChat ON (server and panel): three tiles, Berry Wallet first, and the note that its text cannot say ADMIN; it signs in", async () => {
  const p = page({ nanchat: true });
  let done = 0;
  const signIn = panel.adminSignIn({ fetch: p.send, touch: true, nanchat: true });
  signIn(p.root, () => done++);
  const tiles = Array.from(p.root.querySelectorAll(".n133s-tile")).map((t) => t.getAttribute("data-way"));
  assert.deepEqual(tiles, ["berry", "nautilus", "nanchat"]);
  (p.root.querySelector('[data-way="nanchat"]') as HTMLElement).click();
  await settle();
  assert.equal(done, 1, JSON.stringify(text(p.root)));
  assert.ok(p.jar.has("admin"));
  // While it waits, it says that NanChat's text cannot say ADMIN.
  const q = page({ nanchat: true, signAs: null });
  const v = panel.adminSigninView({ fetch: q.send, touch: false, nanchat: true });
  q.root.append(v.node);
  (v.node.querySelector('[data-way="nanchat"]') as HTMLElement).click();
  await settle();
  assert.ok(text(v.node).includes(panel.ADMIN_NANCHAT_NOTE));
  assert.ok(text(v.node).includes("Scan this with your phone's camera"));
  v.stop();
});

test("NanChat off on the server: a panel that offers it shows the server's refusal and the tiles again", async () => {
  const p = page({ nanchat: false, panelNanchat: true, signAs: null });
  const v = panel.adminSigninView({ fetch: p.send, touch: true, nanchat: true });
  p.root.append(v.node);
  (v.node.querySelector('[data-way="nanchat"]') as HTMLElement).click();
  await settle();
  assert.equal(text(v.node.querySelector(".n133s-status")), NANCHAT_REFUSAL);
  assert.equal(v.node.querySelectorAll(".n133s-tile").length, 3);
  v.stop();
});

test("another wallet than the game's: the panel says so and offers Try again; no admin cookie", async () => {
  const p = page({ signAs: STRANGER });
  let done = 0;
  panel.adminSignIn({ fetch: p.send, touch: true })(p.root, () => done++);
  (p.root.querySelector('[data-way="berry"]') as HTMLElement).click();
  await settle();
  assert.equal(done, 0);
  assert.equal(text(p.root.querySelector(".n133s-status")), "That wallet is not this game's address. Choose the wallet that holds it.");
  assert.ok(byText(p.root, "Try again") && byText(p.root, "Choose another wallet"));
  assert.equal(p.jar.has("admin"), false);
});

test("a second call of the hook (the gate shows again) stops the first view's waiting", async () => {
  const p = page({ signAs: null });
  const signIn = panel.adminSignIn({ fetch: p.send, touch: true });
  const first = document.createElement("div");
  signIn(first, () => undefined);
  (first.querySelector('[data-way="berry"]') as HTMLElement).click();
  await settle();
  const checks = p.calls.filter((c) => c.endsWith("/check")).length;
  signIn(document.createElement("div"), () => undefined);
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(p.calls.filter((c) => c.endsWith("/check")).length, checks, "the first view stopped asking");
});

function click(el: Element | undefined) {
  assert.ok(el, "the key is there");
  (el as HTMLElement).click();
}
