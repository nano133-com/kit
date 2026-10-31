// The friends handler: the routes, the sign-in, the origin checks, the limit, the body and what an answer may hold (never a player id).
import assert from "node:assert/strict";
import test from "node:test";
import { FRIENDS_LIMITS, createFriendsHandler, createMemoryFriends, type FriendView, type PlayerDirectory } from "../src/friends/index.js";

const ORIGIN = "https://game.example";
const IDS: Record<string, string> = { "uid-ann-0001": "Ann", "uid-bob-0002": "Bob", "uid-cyd-0003": "Cyd" };
const directory: PlayerDirectory = {
  byName: async (name) => Object.entries(IDS).find(([, v]) => v.toLowerCase() === name.toLowerCase())?.[0] ?? null,
  names: async (ids) => new Map(ids.filter((i) => IDS[i]).map((i) => [i, IDS[i]] as const)),
};

function make(over: Partial<Parameters<typeof createFriendsHandler>[0]> = {}) {
  const store = createMemoryFriends();
  let who: string | null = "uid-ann-0001";
  const handler = createFriendsHandler({ store, directory, player: async () => who, limit: () => true, ...over });
  const as = (id: string | null) => (who = id);
  const call = async (method: string, body?: unknown, headers: Record<string, string> = { Origin: ORIGIN }, path = "/friends") =>
    handler.handle(new Request(`${ORIGIN}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
  return { store, handler, as, call };
}

test("a path that is not the base is not the handler's", async () => {
  const { call } = make();
  assert.equal(await call("GET", undefined, {}, "/friends/x"), null);
  assert.equal(await call("GET", undefined, {}, "/other"), null);
  assert.throws(() => createFriendsHandler({ store: createMemoryFriends(), directory, player: async () => null, base: "friends" }), /base/);
});

test("a visitor who is not signed in gets 401; a fault in the game's sign-in gets 503 and tells onError", async () => {
  const { as, call } = make();
  as(null);
  assert.equal((await call("GET"))!.status, 401);
  const seen: unknown[] = [];
  const broken = make({ player: async () => { throw new Error("SECRET-db"); }, onError: (e) => seen.push(e) });
  const res = (await broken.call("GET"))!;
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /SECRET/);
  assert.equal(seen.length, 1);
});

test("a POST must come from the game's own page; a GET must not come from another page", async () => {
  const { call } = make();
  assert.equal((await call("POST", { op: "visibility", showOnline: false }, { Origin: "https://evil.example" }))!.status, 403);
  assert.equal((await call("POST", { op: "visibility", showOnline: false }, {}))!.status, 403, "no Origin and no Sec-Fetch-Site");
  assert.equal((await call("POST", { op: "visibility", showOnline: false }, { "Sec-Fetch-Site": "same-origin" }))!.status, 200);
  assert.equal((await call("GET", undefined, { Origin: "https://evil.example" }))!.status, 403);
  assert.equal((await call("GET", undefined, { "Sec-Fetch-Site": "cross-site" }))!.status, 403);
  assert.equal((await call("GET", undefined, {}))!.status, 200, "a plain read with no headers is fine");
  assert.equal((await call("PUT", {}))!.status, 405);
});

test("the whole flow: request by name, accept, invite, pulse, visibility, block, unblock; no answer holds an id", async () => {
  const { as, call } = make();
  const texts: string[] = [];
  const json = async (r: Response | null) => {
    const t = await r!.text();
    texts.push(t);
    return JSON.parse(t);
  };
  let v: FriendView = await json(await call("POST", { op: "request", name: "bob" }));
  assert.deepEqual(v.people.map((p) => [p.name, p.state]), [["Bob", "outgoing"]]);
  as("uid-bob-0002");
  v = await json(await call("GET"));
  const edge = v.people[0].edge;
  v = await json(await call("POST", { op: "accept", edge }));
  assert.equal(v.people[0].state, "friend");
  assert.deepEqual(await json(await call("POST", { op: "pulse", where: "Level 2", lease: "lease-bob-1" })), { ok: true });
  as("uid-ann-0001");
  v = await json(await call("GET"));
  assert.deepEqual([v.people[0].online, v.people[0].where], [true, "Level 2"]);
  v = await json(await call("POST", { op: "invite", edge, where: "Level 3" }));
  as("uid-bob-0002");
  v = await json(await call("GET"));
  assert.equal(v.people[0].invite?.where, "Level 3");
  v = await json(await call("POST", { op: "visibility", showOnline: false }));
  assert.equal(v.showOnline, false);
  v = await json(await call("POST", { op: "block", edge }));
  assert.equal(v.people[0].state, "blocked");
  as("uid-ann-0001");
  v = await json(await call("GET"));
  assert.equal(v.people.length, 0);
  assert.equal((await call("POST", { op: "request", name: "Bob" }))!.status, 409);
  as("uid-bob-0002");
  v = await json(await call("POST", { op: "unblock", edge }));
  assert.equal(v.people.length, 0);
  for (const t of texts) assert.doesNotMatch(t, /uid-/, t);
});

test("a whole nano_ address (65 characters) reaches the directory as a name", async () => {
  const address = "nano_1" + "3".repeat(59);
  assert.equal(address.length, 65);
  const seen: string[] = [];
  const { call } = make({ directory: { byName: async (name) => (seen.push(name), null), names: async () => new Map() } });
  assert.equal((await call("POST", { op: "request", name: address }))!.status, 404);
  assert.deepEqual(seen, [address]);
});

test("bad bodies are refused with words, and change nothing", async () => {
  const { call, store } = make();
  const cases: [unknown, number][] = [
    ["not json", 400],
    ["[]", 400],
    [{ op: "explode" }, 400],
    [{ op: "request" }, 400],
    [{ op: "request", name: "x".repeat(FRIENDS_LIMITS.nameMax + 1) }, 400],
    [{ op: "request", name: "Nobody" }, 404],
    [{ op: "request", name: "Ann" }, 400],
    [{ op: "accept", edge: "../../etc" }, 400],
    [{ op: "accept", edge: "no-such-edge" }, 404],
    [{ op: "visibility", showOnline: "yes" }, 400],
    [{ op: "pulse", where: "Room", lease: "x" }, 400],
    [{ op: "invite", edge: "abcdefgh12", where: "Room" }, 404],
  ];
  for (const [body, status] of cases) {
    const res = (await call("POST", body))!;
    assert.equal(res.status, status, JSON.stringify(body));
    const out = await res.json();
    assert.equal(typeof out.error, "string");
  }
  const big = (await call("POST", JSON.stringify({ op: "request", name: "Bob", pad: "x".repeat(FRIENDS_LIMITS.bodyMax) })))!;
  assert.equal(big.status, 413);
  assert.equal(store.edges.size, 0);
});

test("each player has 30 calls a minute (the default limiter), and one player's calls do not count for another", async () => {
  let t = 1_900_000_000_000;
  const { as, call } = make({ limit: undefined, now: () => t, base: "/friends-limit-test" });
  const at = (path = "/friends-limit-test") => call("GET", undefined, {}, path);
  for (let i = 0; i < FRIENDS_LIMITS.calls.limit; i++) assert.equal((await at())!.status, 200);
  assert.equal((await at())!.status, 429);
  as("uid-cyd-0003");
  assert.equal((await at())!.status, 200);
  as("uid-ann-0001");
  t += FRIENDS_LIMITS.calls.windowMs;
  assert.equal((await at())!.status, 200);
});

test("a fault in the store is a plain 500 that does not show the fault", async () => {
  const seen: unknown[] = [];
  const store = { ...createMemoryFriends(), view: async () => { throw new Error("SECRET-store"); } };
  const { call } = make({ store, onError: (e) => seen.push(e) });
  const res = (await call("GET"))!;
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /SECRET/);
  assert.equal(seen.length, 1);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
