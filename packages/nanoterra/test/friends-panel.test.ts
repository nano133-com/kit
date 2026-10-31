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

const W = { source: "nanoterra-friends", v: 1 } as const;

test("the window's address (with v=1) and the where text (control characters out, 64 characters at most, null when empty)", () => {
  assert.equal(windowUrl(NANO, "my game/1"), "https://nano133.com/embed/friends?game=my%20game%2F1&v=1");
  assert.equal(whereText("  Level\u0000 2\n "), "Level 2");
  assert.equal(Array.from(whereText("é".repeat(100))!).length, 64);
  assert.equal(whereText(" \t\n "), null);
  assert.equal(whereText(42), null);
});

test("a message from the window is read field by field; another source, another v or a bad field is ignored", () => {
  assert.deepEqual(readWindowMessage({ ...W, type: "ready" }), { ...W, type: "ready" });
  assert.deepEqual(readWindowMessage({ ...W, type: "signin" }), { ...W, type: "signin" });
  assert.deepEqual(readWindowMessage({ ...W, type: "size", height: 412.4 }), { ...W, type: "size", height: 413 });
  assert.deepEqual(readWindowMessage({ ...W, type: "badge", online: 250, requests: 2 }), { ...W, type: "badge", online: 99, requests: 2 });
  assert.deepEqual(readWindowMessage({ ...W, type: "join", url: "https://nano133.com/nanoterra?room=abcde" }), { ...W, type: "join", url: "https://nano133.com/nanoterra?room=abcde" });
  for (const bad of [
    null,
    "ready",
    { type: "ready", v: 1 },
    { source: "other", v: 1, type: "ready" },
    { ...W, v: 2, type: "ready" },
    { ...W, type: "hello" },
    { ...W, type: "close" },
    { ...W, type: "size", height: -1 },
    { ...W, type: "size", height: "big" },
    { ...W, type: "badge", online: 1 },
    { ...W, type: "badge", online: 1, requests: -2 },
    { ...W, type: "badge", online: "1", requests: 0 },
    { ...W, type: "join", url: "javascript:alert(1)" },
    { ...W, type: "join", url: "http://game.example/" },
    { ...W, type: "join", url: "https://user:pw@game.example/" },
    { ...W, type: "join", url: "not a url" },
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
  assert.equal(frame.getAttribute("src"), "https://nano133.com/embed/friends?game=echo-island&v=1");
  assert.equal(frame.getAttribute("title"), "Friends");
  assert.equal(frame.getAttribute("loading"), null, "no lazy loading");
  assert.equal(frame.getAttribute("referrerpolicy"), "origin");
  assert.equal(frame.getAttribute("allow"), "storage-access");
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation");
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

test("nanoterra: right after ready the kit sends where, then open or closed; then where on each setWhere, and open and closed; nothing before ready", () => {
  const { f, sent, say } = nanoterra();
  f.setWhere("Level 2");
  f.open();
  assert.deepEqual(sent, [], "nothing before the window says ready");
  say({ ...W, type: "ready" });
  assert.deepEqual(sent.splice(0), [{ ...W, type: "where", where: "Level 2" }, { ...W, type: "open" }]);
  f.setWhere("  Boss\u0007 room ");
  assert.deepEqual(sent.shift(), { ...W, type: "where", where: "Boss room" });
  f.setWhere(null);
  assert.deepEqual(sent.shift(), { ...W, type: "where", where: null });
  f.close();
  assert.deepEqual(sent.shift(), { ...W, type: "closed" });
  f.open();
  assert.deepEqual(sent.shift(), { ...W, type: "open" });
  assert.equal(sent.length, 0);
  f.destroy();
  const closed = nanoterra({ where: null });
  closed.say({ ...W, type: "ready" });
  assert.deepEqual(closed.sent, [{ ...W, type: "where", where: null }, { ...W, type: "closed" }]);
  closed.f.destroy();
});

test("nanoterra: only the window itself, from nano133's origin, is heard; the badge shows requests first, else the friends online", () => {
  const { el, f, say } = nanoterra();
  const badge = el.querySelector(".n133f-badge") as HTMLElement;
  const key = el.querySelector(".n133f-key")!;
  say({ ...W, type: "badge", online: 0, requests: 3 }, { origin: "https://evil.example" });
  say({ ...W, type: "badge", online: 0, requests: 3 }, { source: window });
  assert.equal(badge.hidden, true);
  say({ ...W, type: "badge", online: 4, requests: 3 });
  assert.deepEqual([badge.hidden, badge.textContent, badge.classList.contains("is-online")], [false, "3", false]);
  assert.equal(key.getAttribute("aria-label"), "Friends, 3 requests, 4 online");
  say({ ...W, type: "badge", online: 12, requests: 0 });
  assert.deepEqual([badge.hidden, badge.textContent, badge.classList.contains("is-online")], [false, "9+", true]);
  assert.equal(key.getAttribute("aria-label"), "Friends, 12 online");
  say({ ...W, type: "badge", online: 0, requests: 1 });
  assert.equal(key.getAttribute("aria-label"), "Friends, 1 request");
  say({ ...W, type: "badge", online: 0, requests: 0 });
  assert.equal(badge.hidden, true);
  assert.equal(key.getAttribute("aria-label"), "Friends");
  f.destroy();
});

test("nanoterra: size sets the frame's height, at most the panel's room; signin keeps the panel as it is", () => {
  const { el, f, frame, say } = nanoterra();
  say({ ...W, type: "size", height: 420 });
  assert.equal(frame.style.height, "420px");
  f.open();
  say({ ...W, type: "signin" });
  assert.equal((el.querySelector(".n133f-panel") as HTMLElement).dataset.open, "true", "the panel stays open");
  f.destroy();
});

test("nanoterra: a join asks the player first (the window sends no name), then calls onJoin with the https address", async () => {
  const joins: string[] = [];
  let answer = false;
  const questions: string[] = [];
  const { f, say } = nanoterra({ onJoin: (url) => joins.push(url), confirm: (q) => (questions.push(q), answer) });
  say({ ...W, type: "join", url: "https://nano133.com/nanoterra?room=abcde" });
  await settle();
  assert.deepEqual(joins, []);
  assert.deepEqual(questions, ["Leave this game to join your friend?"]);
  answer = true;
  say({ ...W, type: "join", url: "https://nano133.com/nanoterra?room=abcde" });
  say({ ...W, type: "join", url: "javascript:alert(1)" });
  await settle();
  assert.deepEqual(joins, ["https://nano133.com/nanoterra?room=abcde"]);
  f.destroy();
});

test("nanoterra: with no confirm option the join is asked in the panel, never with a browser dialog; Cancel and Escape say no", async () => {
  const dialog = win.confirm;
  win.confirm = () => assert.fail("a browser dialog");
  try {
    const joins: string[] = [];
    const { el, f, say } = nanoterra({ onJoin: (url) => joins.push(url) });
    const box = el.querySelector(".n133f-ask") as HTMLElement;
    const keys = () => [...box.querySelectorAll("button")] as HTMLButtonElement[];
    assert.equal(box.hidden, true);
    say({ ...W, type: "join", url: "https://nano133.com/nanoterra?room=abcde" });
    assert.equal(box.hidden, false);
    assert.equal((el.querySelector(".n133f-panel") as HTMLElement).dataset.open, "true", "the question opens the panel");
    assert.match(box.textContent!, /Leave this game to join your friend\?/);
    assert.deepEqual(keys().map((b) => b.textContent), ["Join", "Cancel"]);
    keys()[1].click();
    await settle();
    assert.equal(box.hidden, true);
    say({ ...W, type: "join", url: "https://nano133.com/nanoterra?room=abcde" });
    document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event);
    await settle();
    assert.equal(box.hidden, true);
    assert.equal((el.querySelector(".n133f-panel") as HTMLElement).dataset.open, "true", "Escape answers the question, the panel stays open");
    assert.deepEqual(joins, []);
    say({ ...W, type: "join", url: "https://nano133.com/nanoterra?room=fghij" });
    keys()[0].click();
    await settle();
    assert.deepEqual(joins, ["https://nano133.com/nanoterra?room=fghij"]);
    f.destroy();
  } finally {
    win.confirm = dialog;
  }
});

test("nanoterra: Escape closes the panel; destroy stops listening", () => {
  const { el, f, say } = nanoterra();
  f.open();
  document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event);
  assert.equal((el.querySelector(".n133f-panel") as HTMLElement).dataset.open, "false");
  f.destroy();
  say({ ...W, type: "badge", online: 5, requests: 0 });
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

test("own: with no onJoin there is no Invite key (an invite would lead nowhere)", async () => {
  const store = createMemoryFriends();
  const now = Date.now();
  await store.request("uid-bob", "uid-ann", now);
  await store.request("uid-ann", "uid-bob", now + 1);
  const { el, f } = own(store, "uid-ann", { where: "Room 4" });
  await settle();
  assert.deepEqual([...el.querySelectorAll(".n133f-row button")].map((b) => b.textContent), ["Remove", "Block"]);
  f.destroy();
});

test("own: with no confirm option Remove and Block ask in the panel; Cancel keeps the friend, Remove removes them, never a browser dialog", async () => {
  const dialog = win.confirm;
  win.confirm = () => assert.fail("a browser dialog");
  try {
    const store = createMemoryFriends();
    const now = Date.now();
    await store.request("uid-bob", "uid-ann", now);
    await store.request("uid-ann", "uid-bob", now + 1);
    const { el, f } = own(store, "uid-ann", { confirm: undefined });
    await settle();
    const box = el.querySelector(".n133f-ask") as HTMLElement;
    const rowKey = (w: string) => [...el.querySelectorAll(".n133f-row button")].find((b) => b.textContent === w) as HTMLButtonElement;
    const askKeys = () => [...box.querySelectorAll("button")] as HTMLButtonElement[];
    rowKey("Block").click();
    assert.equal(box.hidden, false);
    assert.match(box.textContent!, /Block Bob\?/);
    assert.deepEqual(askKeys().map((b) => b.textContent), ["Block", "Cancel"]);
    askKeys()[1].click();
    await settle();
    assert.match(el.textContent!, /Friends \(1\)/, "Cancel keeps the friend");
    rowKey("Remove").click();
    assert.match(box.textContent!, /Remove Bob from your friends\?/);
    askKeys()[0].click();
    await settle();
    assert.equal(box.hidden, true);
    assert.match(el.textContent!, /No friends yet/);
    f.destroy();
  } finally {
    win.confirm = dialog;
  }
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
