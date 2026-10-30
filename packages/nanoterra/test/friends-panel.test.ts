// The Friends key and panel in a fake DOM (happy-dom): the nano133 window's contract (v1) and the game's own list against the REAL handler and the
// memory store. Also the admin Game card's friends choice.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import { createFriendsHandler, createMemoryFriends, type PlayerDirectory } from "../src/friends/index.js";
import { readWindowMessage, whereText, windowUrl } from "../src/friends/panel/window.js";
import type { GameState } from "../src/admin/index.js";

const ORIGIN = "https://game.example";
const NANO = "https://nano133.com";
let mountFriends: typeof import("../src/friends/panel/index.js").mountFriends;
let gameCard: typeof import("../src/admin/panel/index.js").gameCard;
let win: Window;

before(async () => {
  win = new Window({ url: ORIGIN });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  ({ mountFriends } = await import("../src/friends/panel/index.js"));
  ({ gameCard } = await import("../src/admin/panel/index.js"));
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await tick();
};
const root = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

// ---- the window's messages, pure ----

test("the window's address and the where text (control characters out, 64 characters at most, null when empty)", () => {
  assert.equal(windowUrl(NANO, "my game/1"), "https://nano133.com/embed/friends?game=my%20game%2F1");
  assert.equal(whereText("  Level\u0000 2\n "), "Level 2");
  assert.equal(Array.from(whereText("é".repeat(100))!).length, 64);
  assert.equal(whereText(" \t\n "), null);
  assert.equal(whereText(42), null);
});

test("a message from the window is read field by field; anything odd is ignored", () => {
  assert.deepEqual(readWindowMessage({ type: "n133-friends:ready", v: 1 }), { type: "n133-friends:ready", v: 1 });
  assert.deepEqual(readWindowMessage({ type: "n133-friends:badge", v: 1, count: 250 }), { type: "n133-friends:badge", v: 1, count: 99 });
  assert.deepEqual(readWindowMessage({ type: "n133-friends:badge", v: 1, count: "x" }), { type: "n133-friends:badge", v: 1, count: 0 });
  assert.deepEqual(readWindowMessage({ type: "n133-friends:join", v: 1, url: "https://nano133.com/nanoterra?room=abcde", name: "Ann\u0000" }), { type: "n133-friends:join", v: 1, url: "https://nano133.com/nanoterra?room=abcde", name: "Ann" });
  for (const bad of [
    null,
    "n133-friends:ready",
    { type: "n133-friends:ready", v: 2 },
    { type: "n133-friends:other", v: 1 },
    { type: "n133-friends:join", v: 1, url: "javascript:alert(1)", name: "x" },
    { type: "n133-friends:join", v: 1, url: "http://game.example/", name: "x" },
    { type: "n133-friends:join", v: 1, url: "https://user:pw@game.example/", name: "x" },
    { type: "n133-friends:join", v: 1, url: "not a url", name: "x" },
  ]) assert.equal(readWindowMessage(bad), null, JSON.stringify(bad));
});

// ---- "off" ----

test('"off" draws nothing, and its handle does nothing', () => {
  const el = root();
  const f = mountFriends(el, { mode: "off", game: "g" });
  assert.equal(el.childElementCount, 0);
  f.open();
  f.setWhere("x");
  f.destroy();
  assert.equal(el.childElementCount, 0);
});

// ---- "nanoterra": the window ----

function nanoterra(over: Partial<Parameters<typeof mountFriends>[1]> = {}) {
  const el = root();
  const f = mountFriends(el, { mode: "nanoterra", game: "echo-island", where: "Lobby", ...over });
  const frame = el.querySelector("iframe") as unknown as HTMLIFrameElement;
  const sent: unknown[] = [];
  const cw = frame.contentWindow as unknown as { postMessage: (m: unknown, o: string) => void };
  cw.postMessage = (m: unknown, o: string) => {
    assert.equal(o, NANO, "every message names nano133's origin as its target");
    sent.push(m);
  };
  const say = (data: unknown, from: { origin?: string; source?: unknown } = {}) =>
    window.dispatchEvent(new win.MessageEvent("message", { data, origin: from.origin ?? NANO, source: (from.source ?? frame.contentWindow) as never }) as unknown as Event);
  return { el, f, frame, sent, say };
}

test("nanoterra: the window is made at once (not lazy), with the agreed address and attributes, and hidden while closed", () => {
  const { el, f, frame } = nanoterra();
  assert.equal(frame.getAttribute("src"), "https://nano133.com/embed/friends?game=echo-island");
  assert.equal(frame.getAttribute("loading"), null, "no lazy loading");
  assert.equal(frame.getAttribute("referrerpolicy"), "origin");
  assert.match(frame.getAttribute("sandbox")!, /allow-scripts/);
  assert.match(frame.getAttribute("sandbox")!, /allow-storage-access-by-user-activation/);
  assert.doesNotMatch(frame.getAttribute("sandbox")!, /allow-top-navigation/, "the window cannot move the game's page");
  const panel = el.querySelector(".n133f-panel") as HTMLElement;
  assert.equal(panel.dataset.open, "false");
  assert.equal(frame.getAttribute("aria-hidden"), "true");
  assert.equal(frame.getAttribute("tabindex"), "-1");
  assert.equal(panel.hidden, false, "never hidden by display: none");
  f.open();
  assert.equal(panel.dataset.open, "true");
  assert.equal(frame.getAttribute("aria-hidden"), null);
  f.close();
  assert.ok(el.querySelector("iframe"), "closing keeps the window");
  f.destroy();
  assert.equal(el.querySelector("iframe"), null, "destroy removes it");
});

test("nanoterra: hello after ready (with the where and the open state), then where, open and closed; nothing is sent before ready", () => {
  const { f, sent, say } = nanoterra();
  f.setWhere("Level 2");
  f.open();
  assert.deepEqual(sent, [], "nothing before the window says ready");
  say({ type: "n133-friends:ready", v: 1 });
  assert.deepEqual(sent.shift(), { type: "n133-friends:hello", v: 1, game: "echo-island", where: "Level 2", open: true });
  f.setWhere("  Boss\u0007 room ");
  assert.deepEqual(sent.shift(), { type: "n133-friends:where", v: 1, where: "Boss room" });
  f.setWhere(null);
  assert.deepEqual(sent.shift(), { type: "n133-friends:where", v: 1, where: null });
  f.close();
  assert.deepEqual(sent.shift(), { type: "n133-friends:closed", v: 1 });
  f.open();
  assert.deepEqual(sent.shift(), { type: "n133-friends:open", v: 1 });
  f.destroy();
});

test("nanoterra: only the window itself, from nano133's origin, is heard", () => {
  const { el, f, say } = nanoterra();
  const badge = el.querySelector(".n133f-badge") as HTMLElement;
  say({ type: "n133-friends:badge", v: 1, count: 3 }, { origin: "https://evil.example" });
  say({ type: "n133-friends:badge", v: 1, count: 3 }, { source: window });
  assert.equal(badge.hidden, true);
  say({ type: "n133-friends:badge", v: 1, count: 3 });
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "3");
  assert.equal(el.querySelector(".n133f-key")!.getAttribute("aria-label"), "Friends, 3 new");
  say({ type: "n133-friends:badge", v: 1, count: 12 });
  assert.equal(badge.textContent, "9+");
  say({ type: "n133-friends:badge", v: 1, count: 0 });
  assert.equal(badge.hidden, true);
  f.open();
  say({ type: "n133-friends:close", v: 1 });
  assert.equal((el.querySelector(".n133f-panel") as HTMLElement).dataset.open, "false");
  f.destroy();
});

test("nanoterra: a join asks the player first, then calls onJoin with the https address", () => {
  const joins: string[] = [];
  let answer = false;
  const questions: string[] = [];
  const { f, say } = nanoterra({ onJoin: (url) => joins.push(url), confirm: (q) => (questions.push(q), answer) });
  say({ type: "n133-friends:join", v: 1, url: "https://nano133.com/nanoterra?room=abcde", name: "Ann" });
  assert.deepEqual(joins, []);
  assert.deepEqual(questions, ["Leave this game to join Ann?"]);
  answer = true;
  say({ type: "n133-friends:join", v: 1, url: "https://nano133.com/nanoterra?room=abcde", name: "Ann" });
  say({ type: "n133-friends:join", v: 1, url: "javascript:alert(1)", name: "Ann" });
  assert.deepEqual(joins, ["https://nano133.com/nanoterra?room=abcde"]);
  f.destroy();
});

test("nanoterra: Escape closes the panel; destroy stops listening", () => {
  const { el, f, say } = nanoterra();
  f.open();
  document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event);
  assert.equal((el.querySelector(".n133f-panel") as HTMLElement).dataset.open, "false");
  f.destroy();
  say({ type: "n133-friends:badge", v: 1, count: 5 });
});

// ---- "own": the game's own list, against the real handler ----

const IDS: Record<string, string> = { "uid-ann": "Ann", "uid-bob": "Bob" };
const directory: PlayerDirectory = {
  byName: async (n) => Object.entries(IDS).find(([, v]) => v === n)?.[0] ?? null,
  names: async (ids) => new Map(ids.filter((i) => IDS[i]).map((i) => [i, IDS[i]] as const)),
};

function own(store = createMemoryFriends(), who = "uid-ann", over: Partial<Parameters<typeof mountFriends>[1]> = {}) {
  const handler = createFriendsHandler({ store, directory, player: async () => who, limit: () => true });
  const calls: { method: string; body: unknown }[] = [];
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), ORIGIN);
    calls.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET") === "POST") headers.set("Origin", ORIGIN);
    return (await handler.handle(new Request(url, { method: init?.method ?? "GET", headers, body: init?.body as string | undefined }))) ?? new Response("{}", { status: 404 });
  }) as typeof fetch;
  const el = root();
  const f = mountFriends(el, { mode: "own", game: "g", fetch: send, confirm: () => true, ...over });
  return { el, f, calls, store };
}

test("own: the view is read at once, a pulse goes out with the where and a lease, and add by name asks the player", async () => {
  const { el, f, calls, store } = own(undefined, "uid-ann", { where: "Lobby" });
  await settle();
  assert.equal(calls[0].method, "GET");
  const pulse = calls.find((c) => (c.body as { op?: string })?.op === "pulse")!.body as { where: string; lease: string };
  assert.equal(pulse.where, "Lobby");
  assert.match(pulse.lease, /^[0-9a-f]{32}$/);
  assert.match(el.textContent!, /No friends yet/);
  (el.querySelector(".n133f-input") as HTMLInputElement).value = "Bob";
  el.querySelector("form")!.dispatchEvent(new win.Event("submit", { cancelable: true }) as unknown as Event);
  await settle();
  assert.match(el.textContent!, /Asked Bob\./);
  assert.match(el.textContent!, /Sent \(1\)/);
  assert.equal(store.edges.size, 1);
  f.destroy();
  await settle();
  const leave = calls.at(-1)!.body as { op: string; where: null };
  assert.deepEqual([leave.op, leave.where], ["pulse", null], "destroy sends the leave pulse");
});

test("own: a request shows under Requests with Accept, the badge counts it, and Accept makes a friend with Invite, Remove and Block", async () => {
  const store = createMemoryFriends();
  await store.request("uid-bob", "uid-ann", Date.now());
  const { el, f } = own(store, "uid-ann", { where: "Room 4", onJoin: () => {} });
  await settle();
  assert.equal((el.querySelector(".n133f-badge") as HTMLElement).textContent, "1");
  assert.match(el.textContent!, /Requests \(1\)/);
  const accept = [...el.querySelectorAll("button")].find((b) => b.textContent === "Accept")!;
  accept.click();
  await settle();
  assert.match(el.textContent!, /Bob is your friend now\./);
  const words = [...el.querySelectorAll(".n133f-row button")].map((b) => b.textContent);
  assert.deepEqual(words, ["Invite", "Remove", "Block"]);
  assert.equal((el.querySelector(".n133f-badge") as HTMLElement).hidden, true);
  f.destroy();
});

test("own: a friend's invite shows, and Join calls onJoin with its where", async () => {
  const store = createMemoryFriends();
  const now = Date.now();
  await store.request("uid-bob", "uid-ann", now);
  await store.request("uid-ann", "uid-bob", now + 1);
  const edge = (await store.view("uid-bob", directory, now + 2)).people[0].edge;
  await store.invite("uid-bob", edge, "Room 7", now + 3);
  const joins: string[] = [];
  const { el, f } = own(store, "uid-ann", { onJoin: (w) => joins.push(w) });
  await settle();
  assert.match(el.textContent!, /Invites you: Room 7/);
  [...el.querySelectorAll("button")].find((b) => b.textContent === "Join")!.click();
  assert.deepEqual(joins, ["Room 7"]);
  f.destroy();
});

test("own: the show-online choice is saved", async () => {
  const { el, f, store } = own();
  await settle();
  const box = el.querySelector(".n133f-check") as HTMLInputElement;
  assert.equal(box.checked, true);
  box.checked = false;
  box.dispatchEvent(new win.Event("change") as unknown as Event);
  await settle();
  assert.equal(store.prefs.get("uid-ann"), false);
  f.destroy();
});

// ---- the admin Game card's friends choice ----

test("the Game card has a three-way friends choice: a radio group, saved at once, with its sentence", async () => {
  let state: GameState = { character: "nanoterra", signin: "exchange", friends: "nanoterra", fromAdmin: { character: false, signin: false, friends: false } };
  const posts: unknown[] = [];
  const api = {
    get: async <T>() => state as T,
    post: async <T>(_path: string, body?: unknown) => {
      posts.push(body);
      state = { ...state, ...(body as object), fromAdmin: { ...state.fromAdmin, friends: true } };
      return state as T;
    },
  };
  const card = gameCard(api, state);
  document.body.append(card);
  const group = card.querySelector('[role="radiogroup"]')!;
  const keys = [...group.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
  assert.deepEqual(keys.map((k) => k.textContent), ["Nanoterra", "The game's own", "Off"]);
  assert.deepEqual(keys.map((k) => k.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.deepEqual(keys.map((k) => k.tabIndex), [0, -1, -1]);
  assert.match(card.textContent!, /Friends list/);
  assert.match(card.textContent!, /Three choices about your game/);
  keys[1].click();
  await settle();
  assert.deepEqual(posts, [{ friends: "own" }]);
  assert.deepEqual(keys.map((k) => k.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.match(card.querySelector("#switch-friends-note")!.textContent!, /^The game's own:/);
  keys[1].dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight" }) as unknown as Event);
  await settle();
  assert.deepEqual(posts.at(-1), { friends: "off" });
  assert.equal(keys[2].getAttribute("aria-checked"), "true");
  card.remove();
});
