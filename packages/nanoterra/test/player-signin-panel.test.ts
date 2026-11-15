// The player's sign-in sheet in a fake DOM (happy-dom), against the REAL handler and the memory store: the passkey path end to end with a stand-in
// device (its PRF answer is a fixed vector, so the address is known), the spare key, the "no PRF" fault, a wallet start, and the sheet's open/close.
import assert from "node:assert/strict";
import test, { before, beforeEach } from "node:test";
import { Window } from "happy-dom";
import { createMemoryPlayerSignin, createPlayerSignin, type PasskeyScheme, type PlayerSignin } from "../src/player-signin/index.js";

const ORIGIN = "https://game.example";
const SAMPLE: PasskeyScheme = { input: "game.example player v1", salt: "game.example", info: "game.example player seed v1", versionByte: 1 };
const PRF = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

let panel: typeof import("../src/player-signin/panel/index.js");
let schemeVector: typeof import("../src/player-signin/index.js").schemeVector;
let win: Window;
let signin: PlayerSignin;
let jar = new Map<string, string>();

/** The page's fetch: the real handler, with the game's Origin and this browser's cookies. */
const fakeFetch = (async (input: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (jar.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  const res = (await signin.handle(new Request(`${ORIGIN}${input}`, { ...init, headers }))) ?? new Response("{}", { status: 404 });
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}) as unknown as typeof fetch;

type Device = { prf: "yes" | "no"; created: string[]; gets: number; answer: Uint8Array | null };
let device: Device;

/** A stand-in for the device's passkeys: it makes one, and at each use answers the PRF with `device.answer`. */
function installDevice() {
  const rawId = new Uint8Array(16).fill(7).buffer;
  const cred = (results?: unknown) => ({
    rawId,
    response: { userHandle: Uint8Array.from([SAMPLE.versionByte, ...new Uint8Array(31).fill(9)]).buffer },
    getClientExtensionResults: () => ({ prf: results === undefined ? { enabled: true } : { results: { first: results } } }),
  });
  Object.assign(win, {
    PublicKeyCredential: class {
      static async getClientCapabilities() {
        return { "extension:prf": device.prf === "yes" };
      }
    },
  });
  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: {
      async create(o: { publicKey: { user: { name: string } } }) {
        device.created.push(o.publicKey.user.name);
        return cred();
      },
      async get() {
        device.gets += 1;
        return cred(device.answer ? device.answer.slice().buffer : undefined);
      },
    },
  });
}

before(async () => {
  win = new Window({ url: ORIGIN });
  for (const [k, v] of Object.entries({ document: win.document, window: win, location: win.location, localStorage: win.localStorage, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent }))
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  panel = await import("../src/player-signin/panel/index.js");
  ({ schemeVector } = await import("../src/player-signin/index.js"));
});

beforeEach(() => {
  signin = createPlayerSignin({ store: createMemoryPlayerSignin() });
  jar = new Map();
  win.localStorage.clear();
  device = { prf: "yes", created: [], gets: 0, answer: PRF };
  installDevice();
  document.body.replaceChildren();
});

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const click = (el: Element | null | undefined) => {
  assert.ok(el, "the key is there");
  (el as HTMLElement).click();
};
const byText = (root: Element, text: string) => Array.from(root.querySelectorAll("button, a")).find((b) => b.textContent?.trim() === text);
const view = (extra: Partial<import("../src/player-signin/panel/index.js").PlayerSigninViewOptions> = {}) => {
  const signed: unknown[] = [];
  const v = panel.signInView({ name: "Game Example", scheme: SAMPLE, fetch: fakeFetch, onSignedIn: (p) => signed.push(p), ...extra });
  document.body.append(v.node);
  return { v, signed };
};

test("the ways: the passkey first where the browser reports PRF, then the three wallet apps", async () => {
  const { v } = view();
  await settle();
  const pk = v.node.querySelector(".n133s-pk")!;
  assert.match(pk.textContent!, /Use a passkey.*Face ID, Touch ID or your device PIN/);
  const tiles = Array.from(v.node.querySelectorAll(".n133s-tile")).map((t) => t.textContent);
  assert.deepEqual(tiles, ["BBerry Wallet", "NCNanChat", "NNautilus"]);
  assert.ok(pk.compareDocumentPosition(v.node.querySelector(".n133s-tile")!) & 4, "the passkey comes before the wallets");
});

test("no PRF: the passkey goes last, 'Not on this browser'; its press says so in plain words and offers the wallet apps", async () => {
  device.prf = "no";
  const { v } = view();
  await settle();
  const pk = v.node.querySelector(".n133s-pk")!;
  assert.match(pk.textContent!, /Not on this browser/);
  assert.ok(v.node.querySelector(".n133s-tile")!.compareDocumentPosition(pk) & 4, "the wallets come first");
  click(pk);
  await settle();
  assert.equal(v.node.querySelector(".n133s-step")?.textContent, "Not on this device yet");
  assert.equal(v.node.querySelector(".n133s-fault")?.getAttribute("data-fault"), "no-prf");
  assert.equal(v.node.querySelectorAll(".n133s-tile").length, 3);
  assert.equal(device.gets + device.created.length, 0, "the device was never asked");
});

test("Use my passkey: the device's PRF answer becomes the scheme's address, and the real handler signs it in", async () => {
  const { v, signed } = view();
  await settle();
  click(v.node.querySelector(".n133s-pk"));
  click(byText(v.node, "Use my passkey"));
  await settle(60);
  const want = await schemeVector(SAMPLE, Buffer.from(PRF).toString("hex"));
  assert.deepEqual(signed, [{ address: want.address, via: "passkey" }]);
  assert.match(v.node.textContent!, /Signed in as nano_/);
  // The server keeps a session for that address; the browser kept no seed.
  assert.equal(await signin.player(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: [...jar].map(([k, x]) => `${k}=${x}`).join("; ") } })), want.address);
  assert.doesNotMatch(JSON.stringify({ ...win.localStorage }), new RegExp(want.seed, "i"));
});

test("Make a passkey: made, then used; the spare key shows its code only at the press, then the player is signed in", async () => {
  const { v, signed } = view();
  await settle();
  click(v.node.querySelector(".n133s-pk"));
  assert.equal(byText(v.node, "Make a passkey")?.className.includes("n133s-primary"), true, "a new visitor's main key is Make");
  click(byText(v.node, "Make a passkey"));
  await settle(60);
  assert.match(device.created[0], /^Game Example · \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  assert.equal(v.node.querySelector(".n133s-step")?.textContent, "Keep a spare key");
  const code = v.node.querySelector(".n133s-code")!;
  assert.equal(code.textContent, "", "no code before the press");
  click(byText(v.node, "Show my code"));
  const want = await schemeVector(SAMPLE, Buffer.from(PRF).toString("hex"));
  assert.equal(code.textContent!.replace(/\n/g, ""), want.seed);
  assert.equal(signed.length, 0, "not signed in before Continue");
  click(byText(v.node, "Continue"));
  await settle(60);
  assert.deepEqual(signed, [{ address: want.address, via: "passkey" }]);
  // Next visit: "Use my passkey" is the main key, and no spare key shows for an account opened before.
  const again = view();
  await settle();
  click(again.v.node.querySelector(".n133s-pk"));
  assert.equal(byText(again.v.node, "Use my passkey")?.className.includes("n133s-primary"), true);
});

test("a passkey that gives no PRF answer at use: the plain 'no PRF' words, and no sign-in", async () => {
  device.answer = null;
  const { v, signed } = view();
  await settle();
  click(v.node.querySelector(".n133s-pk"));
  click(byText(v.node, "Use my passkey"));
  await settle(40);
  assert.equal(v.node.querySelector(".n133s-fault")?.getAttribute("data-fault"), "no-prf");
  assert.equal(signed.length, 0);
});

test("a wallet: the start goes to the handler; with a mouse the game's QR hook draws the link, on a touch screen one key opens the app", async () => {
  const drawn: string[] = [];
  const { v } = view({ qr: (text) => (drawn.push(text), document.createElement("canvas")) });
  await settle();
  click(v.node.querySelectorAll(".n133s-tile")[0]);
  await settle(30);
  assert.equal(v.node.querySelector(".n133s-step")?.textContent, "Berry Wallet");
  assert.match(drawn[0], /^berrypay:\/\/signin\?request_uri=https%3A%2F%2Fgame\.example%2Fapi%2Fsignin%2Fnano%2F[0-9a-f]{32}$/);
  assert.match(v.node.querySelector(".n133s-status")!.textContent!, /Waiting for Berry Wallet/);
  v.stop();

  const touch = view({ touch: true });
  await settle();
  click(touch.v.node.querySelectorAll(".n133s-tile")[2]);
  await settle(30);
  const open = byText(touch.v.node, "Open Nautilus") as HTMLAnchorElement;
  assert.match(open.getAttribute("href")!, /^nanoauth:/);
  assert.match(touch.v.node.textContent!, /Check that Nautilus shows this code: [A-Z2-9]{4}-[A-Z2-9]{4}/);
  touch.v.stop();
});

test("a wallet on a computer: Nautilus's sign-in link (about 480 bytes) is a QR code that jsQR reads back; a qr hook that throws gives the sheet's own words, never its message", async () => {
  const { qrModules, qrSvg } = await import("../src/shop/panel/qr.js");
  const { default: jsQR } = await import("jsqr");
  for (const [i, way] of [[0, "berry"], [1, "nanchat"], [2, "nautilus"]] as const) {
    const links: string[] = [];
    const { v } = view({ touch: false, qr: (text) => (links.push(text), qrSvg(text, "QR") as unknown as HTMLElement) });
    await settle();
    click(v.node.querySelectorAll(".n133s-tile")[i]);
    await settle(30);
    const svg = v.node.querySelector(".n133s-qr svg");
    assert.ok(svg, `${way}: a QR code`);
    assert.doesNotMatch(v.node.textContent!, /qrModules|longer than|more than a QR/, `${way}: no encoder text`);
    // The SVG's path, read back as modules (one "M x y h1v1h-1z" a dark module, a quiet zone of 4), drawn 3 px a module and decoded.
    const n = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    assert.equal((svg as SVGElement).style.getPropertyValue("--n133-qr-modules"), String(n), "the module count for the sheet's whole-pixel size");
    // The quiet zone (review of 2026-11-15, F2): 4 light modules on each side, so the first dark module (the top-left finder's corner) is at (4, 4).
    assert.equal(n, qrModules(links[0]).length + 8, `${way}: the code and a quiet zone of 4 modules on each side`);
    assert.ok(svg.querySelector("path")!.getAttribute("d")!.startsWith("M4 4h1v1h-1z"), `${way}: the first dark module is at (4, 4)`);
    const px = 3;
    const rgba = new Uint8ClampedArray(n * px * n * px * 4).fill(255);
    for (const [, x, y] of svg.querySelector("path")!.getAttribute("d")!.matchAll(/M(\d+) (\d+)h1v1h-1z/g))
      for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) rgba.fill(0, ((Number(y) * px + dy) * n * px + Number(x) * px + dx) * 4, ((Number(y) * px + dy) * n * px + Number(x) * px + dx) * 4 + 3);
    const read = jsQR(rgba, n * px, n * px);
    assert.equal(read?.data, links[0], `${way}: jsQR reads the link (${new TextEncoder().encode(links[0]).length} bytes)`);
    if (way === "nautilus") assert.ok(links[0].length > 213, "Nautilus's link is longer than the 0.17.0 code held");
    v.stop();
  }
  // A game's qr hook that throws (an old encoder, a text too long for any code): the sheet's own words for a phone, the steps go on.
  const { v } = view({ touch: false, qr: () => { throw new Error("qrModules: the text is longer than this QR code holds (213 bytes)"); } });
  await settle();
  click(v.node.querySelectorAll(".n133s-tile")[2]);
  await settle(30);
  assert.equal(v.node.querySelector(".n133s-step")?.textContent, "Nautilus");
  assert.ok(v.node.querySelector(".n133s-qr-none"), "the words in place of the code");
  assert.match(v.node.textContent!, /Open this page on your phone to use Nautilus\./);
  assert.match(v.node.textContent!, /Check that Nautilus shows this code/);
  assert.doesNotMatch(v.node.textContent!, /qrModules|213 bytes/);
  assert.match(v.node.querySelector(".n133s-status")!.textContent!, /Waiting for Nautilus/);
  v.stop();
});

test("the sheet: open() resolves with the player after a sign-in, null after Escape; it is a modal dialog", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const sheet = panel.mountPlayerSignin(host, { name: "Game Example", scheme: SAMPLE, fetch: fakeFetch, closeAfterMs: 0 });
  const dialog = host.querySelector("[role=dialog]")!;
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(sheet.isOpen, false);
  const first = sheet.open();
  assert.equal(sheet.isOpen, true);
  host.querySelector(".n133s-sheet")!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(await first, null);
  assert.equal(sheet.isOpen, false);

  const second = sheet.open();
  await settle();
  click(host.querySelector(".n133s-pk"));
  click(byText(host, "Use my passkey"));
  const player = await second;
  assert.equal(player?.via, "passkey");
  await settle();
  assert.equal(sheet.isOpen, false, "it closed after the sign-in");
  sheet.destroy();
  assert.equal(host.children.length, 0);
});

test("the sheet keeps the keyboard focus when the passkey check answers and the ways are drawn again: the same choice, never taken from elsewhere", async () => {
  // The device's answer waits until the test lets it go, so the redraw comes after the focus moved.
  let answer!: () => void;
  const late = () => {
    const gate = new Promise<void>((r) => (answer = r));
    (win as unknown as { PublicKeyCredential: { getClientCapabilities(): Promise<unknown> } }).PublicKeyCredential.getClientCapabilities = async () => (await gate, { "extension:prf": true });
  };
  const host = document.createElement("div");
  const outside = document.createElement("input");
  document.body.append(host, outside);
  const isIn = (el: Element | null) => !!el && el.isConnected && host.contains(el);

  // 1. Opened: the first choice (the passkey's row) has the focus; the answer redraws it; the NEW row has it.
  late();
  let sheet = panel.mountPlayerSignin(host, { name: "Game Example", scheme: SAMPLE, fetch: fakeFetch });
  void sheet.open();
  const before = document.activeElement;
  assert.ok(before?.classList.contains("n133s-pk"), "open() focuses the passkey's row");
  answer();
  await settle();
  assert.notEqual(host.querySelector(".n133s-pk"), before, "the ways were drawn again");
  assert.ok(isIn(document.activeElement), "the focus is still in the sheet");
  assert.ok(document.activeElement?.classList.contains("n133s-pk"), "on the same choice");
  // Escape still reaches the sheet.
  document.activeElement!.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(sheet.isOpen, false, "Escape closed it");
  sheet.destroy();

  // 2. The player moved to Nautilus's tile before the answer: the focus stays on Nautilus's tile.
  late();
  sheet = panel.mountPlayerSignin(host, { name: "Game Example", scheme: SAMPLE, fetch: fakeFetch });
  void sheet.open();
  (host.querySelector('[data-way="nautilus"]') as HTMLElement).focus();
  answer();
  await settle();
  assert.ok(isIn(document.activeElement));
  assert.equal((document.activeElement as HTMLElement).dataset.way, "nautilus");
  sheet.destroy();

  // 3. The focus is on another control (the close key, the game's own input): the redraw never takes it.
  for (const where of ["close", "outside"] as const) {
    late();
    sheet = panel.mountPlayerSignin(host, { name: "Game Example", scheme: SAMPLE, fetch: fakeFetch });
    void sheet.open();
    const target = where === "close" ? (host.querySelector(".n133s-close") as HTMLElement) : outside;
    target.focus();
    answer();
    await settle();
    assert.equal(document.activeElement, target, `the focus stays on ${where}`);
    sheet.destroy();
  }
  // 4. No PRF: the passkey's row moves to the end, and keeps the focus.
  device.prf = "no";
  installDevice();
  late();
  (win as unknown as { PublicKeyCredential: { getClientCapabilities(): Promise<unknown> } }).PublicKeyCredential.getClientCapabilities = async () => ({ "extension:prf": false });
  sheet = panel.mountPlayerSignin(host, { name: "Game Example", scheme: SAMPLE, fetch: fakeFetch });
  void sheet.open();
  await settle();
  assert.ok(isIn(document.activeElement), "the focus is in the sheet after the 'no PRF' redraw");
  assert.ok(document.activeElement?.classList.contains("n133s-pk"));
  sheet.destroy();
  outside.remove();
});

test("hostFits: the passkey's id on its own host and subdomains only, never an IP address", () => {
  assert.equal(panel.hostFits("game.example", "game.example"), true);
  assert.equal(panel.hostFits("www.game.example", "game.example"), true);
  assert.equal(panel.hostFits("evilgame.example", "game.example"), false);
  assert.equal(panel.hostFits("127.0.0.1", "127.0.0.1"), false);
  assert.equal(panel.faultWords("wrong-host", "game.example").text, "Passkeys for this game work only on game.example.");
});

test("previewHost: no passkey by default on *.workers.dev, where a passkey would be lost at the move to the game's own domain", () => {
  assert.equal(panel.previewHost("my-game.me.workers.dev"), true);
  assert.equal(panel.previewHost("MY-GAME.workers.dev."), true);
  assert.equal(panel.previewHost("game.example"), false);
  assert.equal(panel.previewHost("notworkers.dev"), false);
  for (const [passkey, shown] of [[undefined, false], [true, true]] as const) {
    const view = panel.signInView({ name: "My Game", scheme: SAMPLE, rpId: "my-game.me.workers.dev", passkey, fetch: fakeFetch });
    assert.equal(view.node.querySelector(".n133s-pk") !== null, shown, `passkey ${passkey}`);
    view.stop();
  }
});
