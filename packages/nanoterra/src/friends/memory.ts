// A friends store in memory, for tests (and for a game's first try). Nothing is kept after the process ends. It uses the same rules as the real
// adapters (./rules.ts), so it is the reference for what a store does.

import { buildRows, checkPulse, friendsOf, hasPlayer, liveEdge, pairOf, planAccept, planBlock, planDecline, planInvite, planPulse, planRemove, planRequest, planUnblock, shownOthers, type EdgeRec, type Plan, type PresenceRec } from "./rules.js";
import type { FriendView, FriendsStore, PlayerDirectory } from "./types.js";

export type MemoryFriends = FriendsStore & {
  /** The rows as an adapter would keep them. */
  readonly edges: Map<string, EdgeRec>;
  readonly presence: Map<string, PresenceRec>;
  readonly prefs: Map<string, boolean>;
};

export function createMemoryFriends(): MemoryFriends {
  const edges = new Map<string, EdgeRec>();
  const presence = new Map<string, PresenceRec>();
  const prefs = new Map<string, boolean>();
  const of = (player: string) => [...edges.values()].filter((r) => hasPlayer(r, player));
  const byPair = (x: string, y: string) => {
    const [a, b] = pairOf(x, y);
    return [...edges.values()].find((r) => r.a === a && r.b === b) ?? null;
  };
  const live = (player: string, now: number) => of(player).filter((r) => liveEdge(r, now)).length;
  const apply = (plan: Plan) => {
    if ("put" in plan) edges.set(plan.put.edge, plan.put);
    else if ("drop" in plan) edges.delete(plan.drop.edge);
  };

  return {
    edges,
    presence,
    prefs,
    async view(player: string, directory: PlayerDirectory, now: number): Promise<FriendView> {
      const recs = of(player);
      const names = await directory.names(shownOthers(player, recs, now));
      const friends = friendsOf(player, recs, now);
      const pres = new Map(friends.flatMap((f) => (presence.has(f) ? [[f, presence.get(f)!] as const] : [])));
      const shows = new Map(friends.map((f) => [f, prefs.get(f) !== false] as const));
      return { showOnline: prefs.get(player) !== false, people: buildRows(player, recs, now, names, pres, shows) };
    },
    async request(player, other, now) {
      apply(await planRequest(player, other, byPair(player, other), now, async () => ({ mine: live(player, now), theirs: live(other, now) })));
    },
    async accept(player, edge, now) {
      apply(planAccept(player, edges.get(edge) ?? null, now));
    },
    async decline(player, edge) {
      apply(planDecline(player, edges.get(edge) ?? null, Date.now()));
    },
    async remove(player, edge) {
      apply(planRemove(player, edges.get(edge) ?? null, Date.now()));
    },
    async block(player, edge, now) {
      apply(planBlock(player, edges.get(edge) ?? null, now));
    },
    async unblock(player, edge, now) {
      apply(planUnblock(player, edges.get(edge) ?? null, now));
    },
    async invite(player, edge, where, now) {
      apply(planInvite(player, edges.get(edge) ?? null, where, now));
    },
    async pulse(player, where, lease, now) {
      const p = checkPulse(where, lease);
      const plan = planPulse(player, p.where, p.lease, presence.get(player) ?? null, now);
      if ("put" in plan) presence.set(player, plan.put);
      else if ("drop" in plan) presence.delete(player);
    },
    async setShowOnline(player, on) {
      prefs.set(player, Boolean(on));
      if (!on) presence.delete(player);
    },
    async forget(player) {
      let n = 0;
      for (const r of of(player)) {
        edges.delete(r.edge);
        n++;
      }
      if (presence.delete(player)) n++;
      if (prefs.delete(player)) n++;
      return n;
    },
  };
}
