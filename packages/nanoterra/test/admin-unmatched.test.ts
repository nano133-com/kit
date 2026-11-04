// "Unmatched payments" in the admin: the route (POST unmatched, only when the game gives the read; the owner only, from the game's own page, limited; the
// oldest order's time as `since`) and the Overview's card (hidden until the game gives the read; it asks nothing until "Check the address"; it draws text
// only; "Could not read" when the read failed). The panel runs in a fake DOM (happy-dom) against the REAL handler and the memory store.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import { ADMIN_LIMITS, createAdminHandler, createMemoryStore, type AdminSession } from "../src/admin/index.js";
import type { OrderRow } from "../src/admin/summary.js";
import type { UnmatchedResult } from "../src/shop/unmatched.js";

const OWNER = `nano_1${"a".repeat(59)}`;
const OTHER = `nano_3${"b".repeat(59)}`;
const ORIGIN = "https://game.example";
const NOW = 1_800_000_000_000;
const RAW_02 = (2n * 10n ** 29n).toString();
const KINDS: Record<string, AdminSession> = {
  owner: { address: OWNER, createdAt: NOW - 1000, via: "wallet" },
  nanoterra_login: { address: OWNER, createdAt: NOW - 1000, via: "nanoterra" },
  other_wallet: { address: OTHER, createdAt: NOW - 1000, via: "wallet" },
};
const order = (id: string, createdAt: number, status = "paid"): OrderRow => ({ id, player: OTHER, lookId: "mint-cap", usd: "0.25", amountRaw: RAW_02, status, createdAt, expiresAt: createdAt + 900_000, paidAt: createdAt + 1000, payer: OTHER, hash: `H${id}` });
const HASH = "A".repeat(64);
const LISTED: UnmatchedResult = { read: true, payments: [{ hash: HASH, sender: OTHER, amountRaw: RAW_02, xno: "0.2", at: NOW - 60_000, sentBack: false }], since: NOW - 5000, entries: 12, more: false, waiting: 1 };

function make(over: { unmatched?: ((now: number, since: number | null) => Promise<unknown>) | null; orders?: OrderRow[]; limit?: boolean } = {}) {
  const calls: (number | null)[] = [];
  const store = createMemoryStore({ orders: over.orders ?? [order("o1", NOW - 5000), order("o2", NOW - 9000, "paid_late"), order("o3", NOW - 100, "open")] });
  const unmatched = over.unmatched === null ? undefined : (over.unmatched ?? (async (_now: number, since: number | null) => (calls.push(since), LISTED)));
  const handler = createAdminHandler({
    store,
    defaults: { character: "nanoterra", signin: "exchange" },
    owner: OWNER,
    session: async (req) => KINDS[/admin=([a-z_]+)/.exec(req.headers.get("Cookie") ?? "")?.[1] ?? ""] ?? null,
    now: () => NOW,
    ...(over.limit ? {} : { limit: () => true }),
    ...(unmatched ? { unmatched } : {}),
  });
  const post = (who: string | null, headers: Record<string, string> = { Origin: ORIGIN }, method = "POST") =>
    handler.handle(new Request(`${ORIGIN}/api/admin/unmatched`, { method, headers: { ...headers, ...(who ? { Cookie: `admin=${who}` } : {}) }, body: method === "POST" ? "{}" : undefined }));
  return { handler, calls, post, store };
}

test("the route exists only when the game gives the read; the summary says so", async () => {
  const none = make({ unmatched: null });
  assert.equal(none.handler.routes.some((r) => r.path.endsWith("/unmatched")), false);
  assert.equal((await none.post("owner"))!.status, 404);
  const s1 = await (await none.handler.handle(new Request(`${ORIGIN}/api/admin/summary`, { headers: { Cookie: "admin=owner" } })))!.json();
  assert.equal(s1.canListUnmatched, undefined);
  const { handler } = make();
  assert.deepEqual(handler.routes.filter((r) => r.path.endsWith("/unmatched")), [{ method: "POST", path: "/api/admin/unmatched" }]);
  const s2 = await (await handler.handle(new Request(`${ORIGIN}/api/admin/summary`, { headers: { Cookie: "admin=owner" } })))!.json();
  assert.equal(s2.canListUnmatched, true);
});

test("the owner's POST from the game's page gets the list, with the oldest order's time as `since` (null with no order)", async () => {
  const { post, calls } = make();
  const res = (await post("owner"))!;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { unmatched: LISTED });
  assert.deepEqual(calls, [NOW - 9000]);
  const empty = make({ orders: [] });
  assert.equal((await empty.post("owner"))!.status, 200);
  assert.deepEqual(empty.calls, [null]);
});

test("a visitor who is not the owner, a GET, another page and a missing Origin are refused, and the nodes are never asked", async () => {
  const { post, calls } = make();
  assert.equal((await post(null))!.status, 401);
  assert.equal((await post("other_wallet"))!.status, 403);
  assert.equal((await post("nanoterra_login"))!.status, 403);
  assert.equal((await post("owner", { Origin: ORIGIN }, "GET"))!.status, 405);
  assert.equal((await post("owner", { Origin: "https://evil.example" }))!.status, 403);
  assert.equal((await post("owner", { "Sec-Fetch-Site": "cross-site" }))!.status, 403);
  assert.equal((await post("owner", {}))!.status, 403);
  assert.deepEqual(calls, []);
});

test("the read is limited: after ADMIN_LIMITS.unmatched.limit in a minute, 429 and no more reads", async () => {
  const { post, calls } = make({ limit: true });
  for (let i = 0; i < ADMIN_LIMITS.unmatched.limit; i++) assert.equal((await post("owner"))!.status, 200);
  assert.equal((await post("owner"))!.status, 429);
  assert.equal(calls.length, ADMIN_LIMITS.unmatched.limit);
});

test("a fault in the game's read gives the plain 500", async () => {
  const { post } = make({ unmatched: async () => Promise.reject(new Error("SECRET detail")) });
  const res = (await post("owner"))!;
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /SECRET/);
});

// ---- the panel ----

let mountAdmin: typeof import("../src/admin/panel/index.js").mountAdmin;
let win: Window;
before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event });
  ({ mountAdmin } = await import("../src/admin/panel/index.js"));
});

function mount(over: Parameters<typeof make>[0] = {}) {
  const { handler } = make(over);
  const sent: { method: string; path: string }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), ORIGIN);
    sent.push({ method: init?.method ?? "GET", path: url.pathname });
    const headers = new Headers(init?.headers);
    headers.set("Cookie", "admin=owner");
    if ((init?.method ?? "GET") === "POST") headers.set("Origin", ORIGIN);
    return (await handler.handle(new Request(url, { method: init?.method ?? "GET", headers, body: init?.body as string | undefined }))) ?? new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as unknown as Node);
  const mounted = mountAdmin(root, { looks: [], fetch, signIn: () => undefined, signOut: async () => undefined });
  return { root, mounted, sent };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
const card = (root: Element) => root.querySelector(".unmatched-card") as HTMLElement;
const checkKey = (root: Element) => [...card(root).querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Check the address")) as HTMLButtonElement;

test("panel: the card sits in the Overview under \"To send back\", reads nothing until \"Check the address\", then lists each payment as text", async () => {
  const { root, mounted, sent } = mount();
  await mounted.ready;
  const el = card(root);
  assert.ok(el && !el.hidden);
  assert.ok((root.querySelector("#n133-panel-overview") as HTMLElement).contains(el), "in the Overview tab");
  assert.equal(root.querySelectorAll('[role="tab"]').length, 5, "no sixth tab");
  assert.match(el.textContent ?? "", /Payments to your address that match no order\. Check each one before you send it back\./);
  assert.ok(!sent.some((c) => c.path.endsWith("/unmatched")), "the normal load asks no node");
  checkKey(root).click();
  await tick();
  assert.deepEqual(sent.filter((c) => c.path.endsWith("/unmatched")), [{ method: "POST", path: "/api/admin/unmatched" }]);
  const rows = el.querySelectorAll(".unmatched-row");
  assert.equal(rows.length, 1);
  const t = rows[0].textContent ?? "";
  assert.match(t, /0\.2 XNO/);
  assert.match(t, new RegExp(`Raw ${RAW_02}`));
  assert.match(t, /From nano_3bbbb…bbbbbb/);
  assert.match(t, /Block AAAAAAAA…AAAAAA/);
  assert.equal(rows[0].getAttribute("data-hash"), HASH);
  assert.match(el.textContent ?? "", /1 payment matches no order\./);
  assert.match(el.textContent ?? "", /Read the last 12 entries of your address, since the first order/);
  assert.match(el.textContent ?? "", /1 payment may still pay an open order/);
  mounted.destroy();
});

test("panel: a read that failed says \"Could not read\" and lists nothing; data is drawn as text, never as HTML", async () => {
  let answer: unknown = { read: false, error: "no Nano node answered" };
  const { root, mounted } = mount({ unmatched: async () => answer });
  await mounted.ready;
  checkKey(root).click();
  await tick();
  assert.match(card(root).textContent ?? "", /Could not read your address\. Nothing is listed\./);
  assert.equal(card(root).querySelectorAll(".unmatched-row").length, 0);
  answer = { ...LISTED, payments: [{ ...LISTED.payments[0], xno: "<img src=x onerror=alert(1)>", hash: "<b>bold</b>" }] };
  checkKey(root).click();
  await tick();
  assert.equal(card(root).querySelectorAll("img, b").length, 0);
  assert.match(card(root).textContent ?? "", /<img src=x onerror=alert\(1\)> XNO/);
  mounted.destroy();
});

test("panel: a game that gives no read has no card", async () => {
  const { root, mounted } = mount({ unmatched: null });
  await mounted.ready;
  assert.ok(card(root).hidden);
  mounted.destroy();
});
