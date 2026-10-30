// The rules of the friends list, as pure functions: every adapter (memory, D1, Firestore) reads its rows, asks these what to write, and writes it
// in one step. So the rules live in one place, and the conformance suite (./conformance.ts) proves that an adapter keeps them.
//
// One pair of players has at most one edge. An edge is a request ("pending", from one of them), a friendship, or a block (by one or both).
// - A block hides the pair from the player who is blocked, both ways, and wins over a friendship or a request. The player who blocked sees a
//   "blocked" row, so that they can unblock it.
// - A request that nobody answered goes after FRIEND_REQUEST_MS: it is not shown and does not count.
// - Every live edge counts toward FRIEND_LIMIT for both players.

import { FRIEND_INVITE_MS, FRIEND_LIMIT, FRIEND_LIVE_MS, FRIEND_REQUEST_MS, FRIEND_WHERE_MAX, FriendsError, type FriendRow, type FriendState } from "./types.js";

/** An edge as an adapter keeps it. `a` and `b` are the two players' ids, `a < b`. `rev` grows with each write (an adapter may use it to refuse a write on a row that changed). */
export type EdgeRec = {
  edge: string;
  a: string;
  b: string;
  from: string;
  state: "pending" | "friend" | "blocked";
  blockedBy: string[];
  at: number;
  invite: { from: string; where: string; at: number } | null;
  rev: number;
};

/** What an adapter does after a rule: write this edge (new or changed), delete it, or nothing. */
export type Plan = { put: EdgeRec } | { drop: EdgeRec } | { none: true };

/** A presence row: where a player is, which tab said so, and when. */
export type PresenceRec = { player: string; where: string; lease: string; at: number };

/** The two ids of a pair in the order an adapter keeps them. */
export const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
export const otherOf = (rec: EdgeRec, me: string): string => (rec.a === me ? rec.b : rec.a);
export const hasPlayer = (rec: EdgeRec, me: string): boolean => rec.a === me || rec.b === me;

/** A request that nobody answered in time is gone; anything else is live. */
export const liveEdge = (rec: EdgeRec, now: number): boolean => rec.state !== "pending" || now - rec.at < FRIEND_REQUEST_MS;

/** A new opaque edge id: random, never made from a player id. */
export function newEdgeId(): string {
  return globalThis.crypto.randomUUID();
}

/** An edge id as the browser may send one: letters, digits, "-" and "_", 8 to 64. Anything else is refused before a store is asked. */
export const EDGE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** A tab's lease, as for an edge. */
export const LEASE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The game's `where` text as a store keeps it: control characters removed, spaces at the ends trimmed, cut to FRIEND_WHERE_MAX characters
 * (whole characters, not halves of one). Null when nothing is left, or when it is not text.
 */
export function cleanWhere(where: unknown): string | null {
  if (typeof where !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const plain = where.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim();
  const cut = Array.from(plain).slice(0, FRIEND_WHERE_MAX).join("").trim();
  return cut ? cut : null;
}

/** The state of an edge for one of its players, or null when they must not see it (a block by the other, an old request). */
export function stateFor(rec: EdgeRec, me: string, now: number): FriendState | null {
  if (!hasPlayer(rec, me) || !liveEdge(rec, now)) return null;
  if (rec.state === "blocked") return rec.blockedBy.includes(me) ? "blocked" : null;
  if (rec.state === "friend") return "friend";
  return rec.from === me ? "outgoing" : "incoming";
}

const NOT_HERE = "This player is not on your list any more.";

/** The edge that `me` named, or a refusal: an edge of other players, or one they must not see, reads as gone (it says nothing about why). */
function mine(rec: EdgeRec | null, me: string, now: number): EdgeRec {
  if (!rec || stateFor(rec, me, now) === null) throw new FriendsError(404, NOT_HERE);
  return rec;
}

/**
 * A request from `me` to `other`. `rec` is the pair's edge (or null); `counts` are the live edges of each, which the adapter reads only when a new
 * edge would be made (it passes a function).
 */
export async function planRequest(me: string, other: string, rec: EdgeRec | null, now: number, counts: () => Promise<{ mine: number; theirs: number }>): Promise<Plan> {
  if (me === other) throw new FriendsError(400, "You cannot add yourself.");
  const live = rec && liveEdge(rec, now) ? rec : null;
  if (live?.state === "blocked") throw new FriendsError(409, "This player is not available.");
  if (live?.state === "friend") return { none: true };
  if (live?.state === "pending") {
    if (live.from === me) return { none: true };
    // The other player already asked: this is an accept.
    return { put: { ...live, from: me, state: "friend", at: now, invite: null, rev: live.rev + 1 } };
  }
  const c = await counts();
  if (c.mine >= FRIEND_LIMIT) throw new FriendsError(409, "Your friends list is full. Remove someone first.");
  if (c.theirs >= FRIEND_LIMIT) throw new FriendsError(409, "That player's friends list is full.");
  const [a, b] = pairOf(me, other);
  // An old request of the same pair is replaced (same row), so the pair still has one edge.
  return { put: { edge: rec?.edge ?? newEdgeId(), a, b, from: me, state: "pending", blockedBy: [], at: now, invite: null, rev: (rec?.rev ?? 0) + 1 } };
}

export function planAccept(me: string, rec: EdgeRec | null, now: number): Plan {
  const r = mine(rec, me, now);
  const s = stateFor(r, me, now);
  if (s === "friend") return { none: true };
  if (s !== "incoming") throw new FriendsError(409, s === "outgoing" ? "Wait for the other player to accept." : "This request is no longer open.");
  return { put: { ...r, from: me, state: "friend", at: now, invite: null, rev: r.rev + 1 } };
}

/** Declines a request to `me`, or takes back a request of `me`'s. */
export function planDecline(me: string, rec: EdgeRec | null, now: number): Plan {
  const r = mine(rec, me, now);
  const s = stateFor(r, me, now);
  if (s !== "incoming" && s !== "outgoing") throw new FriendsError(409, "This is not a request.");
  return { drop: r };
}

/** Ends a friendship (or a request, either way). A block is ended by unblock, not by remove. */
export function planRemove(me: string, rec: EdgeRec | null, now: number): Plan {
  const r = mine(rec, me, now);
  if (stateFor(r, me, now) === "blocked") throw new FriendsError(409, "Unblock this player first.");
  return { drop: r };
}

export function planBlock(me: string, rec: EdgeRec | null, now: number): Plan {
  const r = mine(rec, me, now);
  if (r.blockedBy.includes(me)) return { none: true };
  const blockedBy = r.state === "blocked" ? [...r.blockedBy, me] : [me];
  return { put: { ...r, from: me, state: "blocked", blockedBy, at: now, invite: null, rev: r.rev + 1 } };
}

/** Takes `me`'s block away. With no block left the pair has no edge (they are not friends again: either may ask). */
export function planUnblock(me: string, rec: EdgeRec | null, now: number): Plan {
  const r = mine(rec, me, now);
  if (!r.blockedBy.includes(me)) throw new FriendsError(409, "This player is not blocked.");
  const left = r.blockedBy.filter((p) => p !== me);
  if (!left.length) return { drop: r };
  return { put: { ...r, blockedBy: left, at: now, rev: r.rev + 1 } };
}

export function planInvite(me: string, rec: EdgeRec | null, where: unknown, now: number): Plan {
  const r = mine(rec, me, now);
  if (stateFor(r, me, now) !== "friend") throw new FriendsError(409, "You can invite only a friend.");
  const place = cleanWhere(where);
  if (!place) throw new FriendsError(400, "Say where to meet.");
  return { put: { ...r, invite: { from: me, where: place, at: now }, rev: r.rev + 1 } };
}

/** The lease and the place of a pulse, checked. `where` null means the tab is leaving (it clears the row only when the lease is the same). */
export function checkPulse(where: unknown, lease: unknown): { where: string | null; lease: string } {
  if (typeof lease !== "string" || !LEASE_PATTERN.test(lease)) throw new FriendsError(400, "A pulse needs a lease of 8 to 64 letters or digits.");
  if (where === null) return { where: null, lease };
  const place = cleanWhere(where);
  if (!place) throw new FriendsError(400, "Say where you are, or send null to leave.");
  return { where: place, lease };
}

/** What a pulse does to the presence row `was`: the new row, a deletion, or nothing (an old tab that leaves after a newer one came). */
export function planPulse(player: string, where: string | null, lease: string, was: PresenceRec | null, now: number): { put: PresenceRec } | { drop: true } | { none: true } {
  if (where !== null) return { put: { player, where, lease, at: now } };
  if (was && was.lease === lease) return { drop: true };
  return { none: true };
}

/** A presence row that still counts. */
export const presenceLive = (p: PresenceRec | null | undefined, now: number): p is PresenceRec => Boolean(p) && now - p!.at < FRIEND_LIVE_MS && now - p!.at >= -FRIEND_LIVE_MS;

/** The order of the list: requests to answer first, then friends who are online, friends, requests sent, blocks; each by name. */
const RANK: Record<FriendState, number> = { incoming: 0, friend: 1, outgoing: 3, blocked: 4 };

/**
 * The browser's view of `me`'s edges. `presence` and `showOnline` are of the OTHER players (only friends' are read). `names` comes from the game's
 * directory; a player it does not know reads "A player". No player id goes into a row.
 */
export function buildRows(me: string, recs: EdgeRec[], now: number, names: Map<string, string>, presence: Map<string, PresenceRec>, showOnline: Map<string, boolean>): FriendRow[] {
  const rows: (FriendRow & { rank: number })[] = [];
  for (const rec of recs) {
    const state = stateFor(rec, me, now);
    if (!state) continue;
    const other = otherOf(rec, me);
    const p = state === "friend" && showOnline.get(other) !== false ? presence.get(other) : undefined;
    const online = presenceLive(p, now);
    const invite = state === "friend" && rec.invite && rec.invite.from !== me && now - rec.invite.at < FRIEND_INVITE_MS && now - rec.invite.at >= -FRIEND_INVITE_MS ? { where: rec.invite.where, at: rec.invite.at } : null;
    const name = names.get(other);
    rows.push({ edge: rec.edge, name: typeof name === "string" && name ? name : "A player", state, online, where: online ? p!.where : null, invite, rank: state === "friend" && online ? 0.5 : RANK[state] });
  }
  rows.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name) || (x.edge < y.edge ? -1 : 1));
  return rows.map(({ rank: _rank, ...row }) => row);
}

/** The other players whose names a view needs: every edge `me` can see. */
export function shownOthers(me: string, recs: EdgeRec[], now: number): string[] {
  return [...new Set(recs.filter((r) => stateFor(r, me, now) !== null).map((r) => otherOf(r, me)))];
}

/** The friends of `me` (their presence is read for the view). */
export function friendsOf(me: string, recs: EdgeRec[], now: number): string[] {
  return recs.filter((r) => stateFor(r, me, now) === "friend").map((r) => otherOf(r, me));
}
