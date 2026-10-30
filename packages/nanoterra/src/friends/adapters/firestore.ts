// The friends store for a game on Firestore (the Admin SDK). The package has no Firebase dependency: the adapter uses the small interface below,
// which the Admin SDK's `Firestore` fits. It reads and writes ONLY its three collections.
//
//   import { createFirestoreFriends } from "@nano133/nanoterra/friends/firestore";
//   const friends = createFirestoreFriends(getFirestore());
//
// The data model (the three collection names can be changed):
//   friend_edges/{pair}       { edge, a, b, players: [a, b], from, state, blockedBy, at, invite: { from, where, at } | null, rev }
//   friend_presence/{player}  { player, where, lease, at }
//   friend_prefs/{player}     { player, showOnline }
// `{pair}` and `{player}` are SHA-256 hex digests (of "a\u0000b" and of the player's id), so any id makes a valid document id, and a pair has one
// document: two requests at the same moment meet on it in their transactions. `edge` is a random id; the browser sees only that.
// Indexes: the single-field indexes Firestore makes by itself are enough (`players` array-contains, `edge` ==).

import { buildRows, checkPulse, friendsOf, hasPlayer, liveEdge, pairOf, planAccept, planBlock, planDecline, planInvite, planPulse, planRemove, planRequest, planUnblock, shownOthers, type EdgeRec, type Plan, type PresenceRec } from "../rules.js";
import { FriendsError, type FriendView, type FriendsStore, type PlayerDirectory } from "../types.js";

export type FriendsDocSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
export interface FriendsDocRef {
  get(): Promise<FriendsDocSnap>;
}
export type FriendsQuerySnap = { docs: { id: string; ref: FriendsDocRef; data(): Record<string, unknown> }[] };
export interface FriendsQuery {
  where(field: string, op: "==" | "array-contains", value: unknown): FriendsQuery;
  limit(n: number): FriendsQuery;
  get(): Promise<FriendsQuerySnap>;
}
export interface FriendsCollection extends FriendsQuery {
  doc(id: string): FriendsDocRef;
}
/** A transaction: every read before the first write, as Firestore asks. */
export interface FriendsTransaction {
  get(ref: FriendsDocRef): Promise<FriendsDocSnap>;
  get(query: FriendsQuery): Promise<FriendsQuerySnap>;
  set(ref: FriendsDocRef, data: Record<string, unknown>): unknown;
  delete(ref: FriendsDocRef): unknown;
}
export interface FriendsBatch {
  set(ref: FriendsDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  delete(ref: FriendsDocRef): unknown;
  commit(): Promise<unknown>;
}
export interface FirestoreFriendsLike {
  collection(name: string): FriendsCollection;
  runTransaction<T>(fn: (tx: FriendsTransaction) => Promise<T>): Promise<T>;
  batch(): FriendsBatch;
}

/** How many edges of one player a read takes at most: the limit, the blocks by others and old requests fit under it. */
export const FIRESTORE_FRIENDS_SCAN = 1000;

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function recOf(d: Record<string, unknown>): EdgeRec {
  const inv = d.invite as Record<string, unknown> | null | undefined;
  const state = d.state === "friend" || d.state === "blocked" ? d.state : "pending";
  return {
    edge: text(d.edge),
    a: text(d.a),
    b: text(d.b),
    from: text(d.from),
    state,
    blockedBy: Array.isArray(d.blockedBy) ? d.blockedBy.filter((x): x is string => typeof x === "string") : [],
    at: num(d.at),
    invite: inv && typeof inv.from === "string" && typeof inv.where === "string" && typeof inv.at === "number" ? { from: inv.from, where: inv.where, at: inv.at } : null,
    rev: num(d.rev),
  };
}

const dataOf = (r: EdgeRec): Record<string, unknown> => ({ edge: r.edge, a: r.a, b: r.b, players: [r.a, r.b], from: r.from, state: r.state, blockedBy: r.blockedBy, at: r.at, invite: r.invite, rev: r.rev });

export function createFirestoreFriends(db: FirestoreFriendsLike, collections: { edges?: string; presence?: string; prefs?: string } = {}): FriendsStore {
  const edges = () => db.collection(collections.edges ?? "friend_edges");
  const presenceCol = () => db.collection(collections.presence ?? "friend_presence");
  const prefsCol = () => db.collection(collections.prefs ?? "friend_prefs");
  const pairRef = async (x: string, y: string) => {
    const [a, b] = pairOf(x, y);
    return edges().doc(await sha256(`${a}\u0000${b}`));
  };
  const playerRef = async (col: FriendsCollection, player: string) => col.doc(await sha256(player));
  const ofPlayer = (player: string) => edges().where("players", "array-contains", player).limit(FIRESTORE_FRIENDS_SCAN);

  /** Writes a plan in the transaction, on the pair's document. */
  async function write(tx: FriendsTransaction, plan: Plan) {
    if ("none" in plan) return;
    const rec = "put" in plan ? plan.put : plan.drop;
    const ref = await pairRef(rec.a, rec.b);
    if ("put" in plan) tx.set(ref, dataOf(plan.put));
    else tx.delete(ref);
  }

  /** An operation on an edge the browser named: the edge is found, then read again in the transaction on its pair's document. */
  async function onEdge(player: string, edge: string, plan: (rec: EdgeRec | null) => Plan) {
    const found = await edges().where("edge", "==", edge).limit(2).get();
    const first = found.docs.map((d) => recOf(d.data())).find((r) => hasPlayer(r, player));
    if (!first) {
      plan(null);
      return;
    }
    const ref = await pairRef(first.a, first.b);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = snap.exists ? recOf(snap.data() ?? {}) : null;
      // The pair's document holds another edge now (it was removed and asked again): the old edge is gone.
      await write(tx, plan(now && now.edge === edge ? now : null));
    });
  }

  const liveOf = (snap: FriendsQuerySnap, now: number) => snap.docs.map((d) => recOf(d.data())).filter((r) => liveEdge(r, now)).length;

  return {
    async view(player: string, directory: PlayerDirectory, now: number): Promise<FriendView> {
      const recs = (await ofPlayer(player).get()).docs.map((d) => recOf(d.data())).filter((r) => hasPlayer(r, player));
      const friends = friendsOf(player, recs, now);
      const [mePref, pres, prefs, names] = await Promise.all([
        (await playerRef(prefsCol(), player)).get(),
        Promise.all(friends.map(async (f) => (await playerRef(presenceCol(), f)).get())),
        Promise.all(friends.map(async (f) => (await playerRef(prefsCol(), f)).get())),
        directory.names(shownOthers(player, recs, now)),
      ]);
      const presence = new Map<string, PresenceRec>();
      pres.forEach((s, i) => {
        const d = s.exists ? s.data() : undefined;
        if (d && d.player === friends[i]) presence.set(friends[i], { player: friends[i], where: text(d.where), lease: text(d.lease), at: num(d.at) });
      });
      const shows = new Map<string, boolean>();
      prefs.forEach((s, i) => {
        const d = s.exists ? s.data() : undefined;
        if (d && d.player === friends[i] && d.showOnline === false) shows.set(friends[i], false);
      });
      const mine = mePref.exists ? mePref.data() : undefined;
      return { showOnline: mine?.showOnline !== false, people: buildRows(player, recs, now, names, presence, shows) };
    },

    async request(player, other, now) {
      if (player === other) throw new FriendsError(400, "You cannot add yourself.");
      const ref = await pairRef(player, other);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const rec = snap.exists ? recOf(snap.data() ?? {}) : null;
        // The counts are read in the transaction too (every read before the first write).
        const plan = await planRequest(player, other, rec, now, async () => {
          const [mine, theirs] = await Promise.all([tx.get(ofPlayer(player)), tx.get(ofPlayer(other))]);
          return { mine: liveOf(mine, now), theirs: liveOf(theirs, now) };
        });
        await write(tx, plan);
      });
    },
    accept: (player, edge, now) => onEdge(player, edge, (r) => planAccept(player, r, now)),
    decline: (player, edge) => onEdge(player, edge, (r) => planDecline(player, r, Date.now())),
    remove: (player, edge) => onEdge(player, edge, (r) => planRemove(player, r, Date.now())),
    block: (player, edge, now) => onEdge(player, edge, (r) => planBlock(player, r, now)),
    unblock: (player, edge, now) => onEdge(player, edge, (r) => planUnblock(player, r, now)),
    invite: (player, edge, where, now) => onEdge(player, edge, (r) => planInvite(player, r, where, now)),

    async pulse(player, where, lease, now) {
      const p = checkPulse(where, lease);
      const ref = await playerRef(presenceCol(), player);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : undefined;
        const was = d ? { player, where: text(d.where), lease: text(d.lease), at: num(d.at) } : null;
        const plan = planPulse(player, p.where, p.lease, was, now);
        if ("put" in plan) tx.set(ref, { player, where: plan.put.where, lease: plan.put.lease, at: plan.put.at });
        else if ("drop" in plan) tx.delete(ref);
      });
    },

    async setShowOnline(player, on) {
      const batch = db.batch();
      batch.set(await playerRef(prefsCol(), player), { player, showOnline: Boolean(on) });
      if (!on) batch.delete(await playerRef(presenceCol(), player));
      await batch.commit();
    },

    async forget(player) {
      const docs = (await ofPlayer(player).get()).docs.filter((d) => hasPlayer(recOf(d.data()), player));
      const [pres, pref] = await Promise.all([(await playerRef(presenceCol(), player)).get(), (await playerRef(prefsCol(), player)).get()]);
      const refs = docs.map((d) => d.ref);
      if (pres.exists) refs.push(await playerRef(presenceCol(), player));
      if (pref.exists) refs.push(await playerRef(prefsCol(), player));
      // A batch holds at most 500 writes.
      for (let i = 0; i < refs.length; i += 400) {
        const batch = db.batch();
        for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
        await batch.commit();
      }
      return refs.length;
    },
  };
}
