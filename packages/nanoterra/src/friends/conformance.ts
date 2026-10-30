// The conformance suite of the friends rules: a game that writes its own store (another database) runs it, and so proves that its store keeps
// every rule the package's adapters keep. The package runs it on the memory store, D1 (on SQLite) and Firestore.
//
//   import { friendsStoreConformance } from "@nano133/nanoterra/friends/conformance";
//   for (const c of friendsStoreConformance(async () => ({ store: myStore(), rows: () => countMyRows() }))) it(c.name, c.run);
//
// Each case gets a NEW, empty store from `make`. The suite names players with ids that it can find in a text (so it can prove that no view holds one)
// and gives the store its own directory.

import { FRIEND_INVITE_MS, FRIEND_LIMIT, FRIEND_LIVE_MS, FRIEND_REQUEST_MS, FriendsError, type FriendRow, type FriendView, type FriendsStore, type PlayerDirectory } from "./types.js";

export type FriendsHarness = {
  store: FriendsStore;
  /** Every row the store keeps (edges, presence, prefs) as one text. `forget` must leave none that holds the player's id. */
  dump(): Promise<string>;
};

export type FriendsConformanceCase = { name: string; run: () => Promise<void> };

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

/** A player id the suite can find in any text. */
const id = (n: string) => `player-id-${n}-7f3e`;
const NAMES: Record<string, string> = {};
const directory: PlayerDirectory = {
  async byName(name) {
    return Object.entries(NAMES).find(([, v]) => v === name)?.[0] ?? null;
  },
  async names(ids) {
    return new Map(ids.filter((i) => NAMES[i]).map((i) => [i, NAMES[i]] as const));
  },
};
for (const n of ["ann", "bob", "cyd", "dee"]) NAMES[id(n)] = n[0].toUpperCase() + n.slice(1);

const ANN = id("ann");
const BOB = id("bob");
const CYD = id("cyd");

async function rejects(p: Promise<unknown>, status: number, what: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    check(e instanceof FriendsError, `${what}: expected a FriendsError, got ${String(e)}`);
    check((e as FriendsError).status === status, `${what}: expected ${status}, got ${(e as FriendsError).status} (${(e as Error).message})`);
    return;
  }
  throw new Error(`${what}: expected a refusal`);
}

export function friendsStoreConformance(make: () => Promise<FriendsHarness>): FriendsConformanceCase[] {
  const cases: FriendsConformanceCase[] = [];
  const add = (name: string, run: (h: FriendsHarness, now: number) => Promise<void>) => cases.push({ name, run: async () => run(await make(), Date.now()) });
  const view = (h: FriendsHarness, who: string, now: number): Promise<FriendView> => h.store.view(who, directory, now);
  const row = async (h: FriendsHarness, who: string, name: string, now: number): Promise<FriendRow | undefined> => (await view(h, who, now)).people.find((r) => r.name === name);
  const friends = async (h: FriendsHarness, x: string, y: string, now: number) => {
    await h.store.request(x, y, now);
    await h.store.request(y, x, now + 1);
  };

  add("a request shows as outgoing to the sender and incoming to the other, with the other's name and no id", async (h, now) => {
    await h.store.request(ANN, BOB, now);
    const a = await row(h, ANN, "Bob", now);
    const b = await row(h, BOB, "Ann", now);
    check(a?.state === "outgoing" && b?.state === "incoming", `states: ${JSON.stringify([a, b])}`);
    check(a!.edge === b!.edge && a!.edge.length >= 8, "the two rows name the same edge");
    check(!a!.online && a!.where === null && a!.invite === null, "a request is not online and has no invite");
  });

  add("a request when the other already asked is an accept: both are friends, on one edge", async (h, now) => {
    await friends(h, ANN, BOB, now);
    const a = (await view(h, ANN, now + 2)).people;
    const b = (await view(h, BOB, now + 2)).people;
    check(a.length === 1 && b.length === 1 && a[0].state === "friend" && b[0].state === "friend", `views: ${JSON.stringify([a, b])}`);
  });

  add("a request twice, or to a friend, changes nothing: one edge for the pair", async (h, now) => {
    await h.store.request(ANN, BOB, now);
    await h.store.request(ANN, BOB, now + 1);
    check((await view(h, ANN, now + 2)).people.length === 1, "one row after two requests");
    await h.store.request(BOB, ANN, now + 3);
    await h.store.request(ANN, BOB, now + 4);
    const v = await view(h, ANN, now + 5);
    check(v.people.length === 1 && v.people[0].state === "friend", `still one friend row: ${JSON.stringify(v)}`);
  });

  add("a player cannot ask themself", async (h, now) => {
    await rejects(h.store.request(ANN, ANN, now), 400, "a request to self");
  });

  add("accept: only the player who was asked can accept; then both are friends", async (h, now) => {
    await h.store.request(ANN, BOB, now);
    const edge = (await row(h, ANN, "Bob", now))!.edge;
    await rejects(h.store.accept(ANN, edge, now + 1), 409, "the sender accepts their own request");
    await h.store.accept(BOB, edge, now + 2);
    check((await row(h, ANN, "Bob", now + 3))?.state === "friend", "Ann sees a friend");
  });

  add("decline takes the request away for both; the sender may also take it back", async (h, now) => {
    await h.store.request(ANN, BOB, now);
    let edge = (await row(h, BOB, "Ann", now))!.edge;
    await h.store.decline(BOB, edge);
    check((await view(h, ANN, now + 1)).people.length === 0 && (await view(h, BOB, now + 1)).people.length === 0, "no rows after a decline");
    await h.store.request(ANN, BOB, now + 2);
    edge = (await row(h, ANN, "Bob", now + 2))!.edge;
    await h.store.decline(ANN, edge);
    check((await view(h, BOB, now + 3)).people.length === 0, "no rows after the sender takes it back");
  });

  add("remove ends a friendship for both", async (h, now) => {
    await friends(h, ANN, BOB, now);
    await h.store.remove(BOB, (await row(h, BOB, "Ann", now + 2))!.edge);
    check((await view(h, ANN, now + 3)).people.length === 0 && (await view(h, BOB, now + 3)).people.length === 0, "no rows after remove");
  });

  add("a block wins: the blocker sees a blocked row, the other sees nothing, and neither can ask again", async (h, now) => {
    await friends(h, ANN, BOB, now);
    await h.store.block(ANN, (await row(h, ANN, "Bob", now + 2))!.edge, now + 3);
    check((await row(h, ANN, "Bob", now + 4))?.state === "blocked", "Ann sees Bob as blocked");
    check((await view(h, BOB, now + 4)).people.length === 0, "Bob does not see Ann at all");
    await rejects(h.store.request(BOB, ANN, now + 5), 409, "a request by the blocked player");
    await rejects(h.store.request(ANN, BOB, now + 5), 409, "a request by the blocker");
  });

  add("the blocked player cannot use the old edge for anything", async (h, now) => {
    await friends(h, ANN, BOB, now);
    const edge = (await row(h, BOB, "Ann", now + 2))!.edge;
    await h.store.block(ANN, edge, now + 3);
    await rejects(h.store.accept(BOB, edge, now + 4), 404, "accept on a blocked edge");
    await rejects(h.store.invite(BOB, edge, "Room 1", now + 4), 404, "invite on a blocked edge");
    await rejects(h.store.remove(BOB, edge), 404, "remove on a blocked edge");
    await rejects(h.store.unblock(BOB, edge, now + 4), 404, "unblock by the one who did not block");
    check((await row(h, ANN, "Bob", now + 5))?.state === "blocked", "the block stands");
  });

  add("unblock leaves no edge (not friends again); only the player who blocked can unblock", async (h, now) => {
    await friends(h, ANN, BOB, now);
    const edge = (await row(h, ANN, "Bob", now + 2))!.edge;
    await h.store.block(ANN, edge, now + 3);
    await h.store.unblock(ANN, edge, now + 4);
    check((await view(h, ANN, now + 5)).people.length === 0 && (await view(h, BOB, now + 5)).people.length === 0, "no edge after unblock");
    // Bob blocks this time: Ann sees nothing, so she cannot unblock his block.
    await friends(h, ANN, BOB, now + 11);
    const e3 = (await row(h, BOB, "Ann", now + 13))!.edge;
    await h.store.block(BOB, e3, now + 14);
    check((await view(h, ANN, now + 15)).people.length === 0, "Ann does not see Bob's block");
    await rejects(h.store.unblock(ANN, e3, now + 16), 404, "Ann cannot unblock Bob's block");
    await h.store.unblock(BOB, e3, now + 17);
    check((await view(h, ANN, now + 18)).people.length === 0 && (await view(h, BOB, now + 18)).people.length === 0, "nothing left after Bob unblocks");
  });

  add(`a full list (${FRIEND_LIMIT} live rows) refuses a new request, both ways`, async (h, now) => {
    for (let i = 0; i < FRIEND_LIMIT; i++) {
      const other = id(`fan${i}`);
      NAMES[other] = `Fan${i}`;
      await h.store.request(other, ANN, now + i);
    }
    await rejects(h.store.request(ANN, BOB, now + FRIEND_LIMIT), 409, "Ann asks with a full list");
    await rejects(h.store.request(CYD, ANN, now + FRIEND_LIMIT), 409, "Cyd asks Ann, whose list is full");
    // An answer to one of the requests is not a new row: it is allowed.
    const edge = (await row(h, ANN, "Fan0", now + FRIEND_LIMIT))!.edge;
    await h.store.accept(ANN, edge, now + FRIEND_LIMIT + 1);
  });

  add("a request nobody answers goes after its time: not shown, not counted, and it may be sent again", async (h, now) => {
    await h.store.request(ANN, BOB, now);
    const later = now + FRIEND_REQUEST_MS + 1;
    check((await view(h, ANN, later)).people.length === 0 && (await view(h, BOB, later)).people.length === 0, "the old request is gone");
    await h.store.request(BOB, ANN, later);
    const v = await view(h, ANN, later + 1);
    check(v.people.length === 1 && v.people[0].state === "incoming", `a new request after the old one went: ${JSON.stringify(v)}`);
  });

  add("an invite works only between friends; the other sees it for its time, the sender does not", async (h, now) => {
    await h.store.request(ANN, BOB, now);
    const edge = (await row(h, ANN, "Bob", now))!.edge;
    await rejects(h.store.invite(ANN, edge, "Room 1", now + 1), 409, "an invite to a request");
    await h.store.accept(BOB, edge, now + 2);
    await h.store.invite(ANN, edge, "Room 1", now + 3);
    const b = await row(h, BOB, "Ann", now + 4);
    check(b?.invite?.where === "Room 1" && b.invite.at === now + 3, `Bob sees the invite: ${JSON.stringify(b)}`);
    check((await row(h, ANN, "Bob", now + 4))?.invite === null, "Ann does not see her own invite");
    check((await row(h, BOB, "Ann", now + 3 + FRIEND_INVITE_MS))?.invite === null, "the invite is gone after its time");
  });

  add("an invite's place is plain text: control characters go and it is cut to 64 characters; an empty one is refused", async (h, now) => {
    await friends(h, ANN, BOB, now);
    const edge = (await row(h, ANN, "Bob", now + 2))!.edge;
    await h.store.invite(ANN, edge, `  Lev\u0000el\n 3 ${"x".repeat(100)}`, now + 3);
    const w = (await row(h, BOB, "Ann", now + 4))!.invite!.where;
    check(!/[\u0000-\u001f]/.test(w) && Array.from(w).length <= 64 && w.startsWith("Level 3"), `the place: ${JSON.stringify(w)}`);
    await rejects(h.store.invite(ANN, edge, " \n\t ", now + 5), 400, "an empty place");
  });

  add("online only within its time, only to friends, and only while the friend shows online", async (h, now) => {
    await h.store.request(ANN, CYD, now);
    await friends(h, ANN, BOB, now);
    await h.store.pulse(BOB, "Room 2", "lease-bob-1", now + 2);
    await h.store.pulse(CYD, "Room 3", "lease-cyd-1", now + 2);
    const b = await row(h, ANN, "Bob", now + 3);
    check(b?.online === true && b.where === "Room 2", `Bob is online: ${JSON.stringify(b)}`);
    const c = await row(h, ANN, "Cyd", now + 3);
    check(c?.online === false && c.where === null, "a player who is only asked is not shown online");
    check((await row(h, ANN, "Bob", now + 2 + FRIEND_LIVE_MS))?.online === false, "a pulse is old after its time");
    await h.store.pulse(BOB, "Room 2", "lease-bob-1", now + 4);
    await h.store.setShowOnline(BOB, false);
    const hidden = await row(h, ANN, "Bob", now + 5);
    check(hidden?.online === false && hidden.where === null, "a friend who hides is not online");
    check((await view(h, BOB, now + 5)).showOnline === false && (await view(h, ANN, now + 5)).showOnline === true, "each player's own choice");
    await h.store.setShowOnline(BOB, true);
    check((await row(h, ANN, "Bob", now + 6))?.online === false, "hiding cleared the old pulse");
  });

  add("presence: a tab that leaves clears only its own pulse, so an old tab cannot clear a new one", async (h, now) => {
    await friends(h, ANN, BOB, now);
    await h.store.pulse(BOB, "Room 1", "lease-old-tab", now + 2);
    await h.store.pulse(BOB, "Room 2", "lease-new-tab", now + 3);
    await h.store.pulse(BOB, null, "lease-old-tab", now + 4);
    check((await row(h, ANN, "Bob", now + 5))?.where === "Room 2", "the new tab's place stands");
    await h.store.pulse(BOB, null, "lease-new-tab", now + 6);
    check((await row(h, ANN, "Bob", now + 7))?.online === false, "the new tab left");
    await rejects(h.store.pulse(BOB, "Room 1", "short", now + 8), 400, "a lease that is too short");
  });

  add("a player cannot use an edge of two other players", async (h, now) => {
    await friends(h, ANN, BOB, now);
    const edge = (await row(h, ANN, "Bob", now + 2))!.edge;
    await rejects(h.store.remove(CYD, edge), 404, "remove");
    await rejects(h.store.block(CYD, edge, now + 3), 404, "block");
    await rejects(h.store.invite(CYD, edge, "Room", now + 3), 404, "invite");
    await rejects(h.store.accept(CYD, "no-such-edge-1", now + 3), 404, "an edge that does not exist");
  });

  add("no view holds a player id", async (h, now) => {
    await friends(h, ANN, BOB, now);
    await h.store.request(CYD, ANN, now + 2);
    await h.store.pulse(BOB, "Room 9", "lease-bob-9", now + 3);
    await h.store.invite(BOB, (await row(h, BOB, "Ann", now + 3))!.edge, "Room 9", now + 4);
    for (const who of [ANN, BOB, CYD]) {
      const text = JSON.stringify(await view(h, who, now + 5));
      check(!/player-id-/.test(text), `a view holds an id: ${text}`);
    }
  });

  add("forget leaves nothing of the player: no edge, no presence, no choice; the others' lists lose them", async (h, now) => {
    await friends(h, ANN, BOB, now);
    await h.store.request(CYD, ANN, now + 2);
    await h.store.pulse(ANN, "Room", "lease-ann-1", now + 3);
    await h.store.setShowOnline(ANN, false);
    await h.store.pulse(BOB, "Room", "lease-bob-1", now + 3);
    const n = await h.store.forget(ANN);
    check(n >= 3, `forget said ${n}`);
    check(!(await h.dump()).includes(ANN), "a row still holds the player's id");
    check((await view(h, BOB, now + 4)).people.length === 0 && (await view(h, CYD, now + 4)).people.length === 0, "the others no longer see the player");
    check((await h.dump()).includes(BOB), "the other players' own rows stay");
  });

  return cases;
}
