// The friends store for a game on Cloudflare D1. The tables are in ./d1.sql (the package ships it: "@nano133/nanoterra/friends/d1.sql"); add it to
// the game's migrations. It reads and writes ONLY friend_edges, friend_presence and friend_prefs.
//
//   import { createD1Friends } from "@nano133/nanoterra/friends/d1";
//   const friends = createD1Friends(env.DB);
//
// D1 has no transaction that reads and then writes, so each write is ONE statement that holds its own check: a change of an edge says which `rev`
// it read (a row that changed in between is not written, and the player is asked to try again), and a new edge is written only while both players
// have room (the count is in the same statement) and the pair has no row yet (UNIQUE (a, b)).

import type { D1Like } from "../../admin/adapters/d1.js";
import { buildRows, checkPulse, pairOf, planAccept, planBlock, planDecline, planInvite, planRemove, planRequest, planUnblock, shownOthers, type EdgeRec, type Plan, type PresenceRec } from "../rules.js";
import { FRIEND_LIMIT, FRIEND_REQUEST_MS, FriendsError, type FriendView, type FriendsStore, type PlayerDirectory } from "../types.js";

export type { D1Like, D1StatementLike } from "../../admin/adapters/d1.js";

type Row = { edge: string; a: string; b: string; from_player: string; state: string; blocked_by: string; at: number; invite_from: string | null; invite_where: string | null; invite_at: number | null; rev: number };

const COLS = "edge, a, b, from_player, state, blocked_by, at, invite_from, invite_where, invite_at, rev";

function recOf(r: Row): EdgeRec {
  let blockedBy: string[] = [];
  try {
    const v: unknown = JSON.parse(r.blocked_by);
    if (Array.isArray(v)) blockedBy = v.filter((x): x is string => typeof x === "string");
  } catch {
    blockedBy = [];
  }
  const state = r.state === "friend" || r.state === "blocked" ? r.state : "pending";
  const invite = typeof r.invite_from === "string" && typeof r.invite_where === "string" && typeof r.invite_at === "number" ? { from: r.invite_from, where: r.invite_where, at: Number(r.invite_at) } : null;
  return { edge: r.edge, a: r.a, b: r.b, from: r.from_player, state, blockedBy, at: Number(r.at), invite, rev: Number(r.rev) };
}

const CHANGED = "That changed just now. Try again.";

export function createD1Friends(db: D1Like): FriendsStore {
  const changes = (res: unknown): number => Number((res as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
  const byEdge = async (edge: string) => {
    const r = await db.prepare(`SELECT ${COLS} FROM friend_edges WHERE edge = ?`).bind(edge).first<Row>();
    return r ? recOf(r) : null;
  };
  const byPair = async (x: string, y: string) => {
    const [a, b] = pairOf(x, y);
    const r = await db.prepare(`SELECT ${COLS} FROM friend_edges WHERE a = ? AND b = ?`).bind(a, b).first<Row>();
    return r ? recOf(r) : null;
  };
  /** Live edges of a player, as SQL (?1 the player, ?2 the oldest request time that still counts). */
  const LIVE_COUNT = "(SELECT COUNT(*) FROM friend_edges WHERE (a = ?1 OR b = ?1) AND (state != 'pending' OR at > ?2))";
  const liveCount = async (player: string, now: number) => Number((await db.prepare(`SELECT ${LIVE_COUNT} AS n`).bind(player, now - FRIEND_REQUEST_MS).first<{ n: number }>())?.n ?? 0);

  async function apply(plan: Plan, prev: EdgeRec | null, now: number): Promise<void> {
    if ("none" in plan) return;
    if ("drop" in plan) {
      if (changes(await db.prepare("DELETE FROM friend_edges WHERE edge = ? AND rev = ?").bind(plan.drop.edge, plan.drop.rev).run()) !== 1) throw new FriendsError(409, CHANGED);
      return;
    }
    const r = plan.put;
    const inv = r.invite;
    if (prev && prev.edge === r.edge) {
      const res = await db
        .prepare("UPDATE friend_edges SET from_player = ?, state = ?, blocked_by = ?, at = ?, invite_from = ?, invite_where = ?, invite_at = ?, rev = ? WHERE edge = ? AND rev = ?")
        .bind(r.from, r.state, JSON.stringify(r.blockedBy), r.at, inv?.from ?? null, inv?.where ?? null, inv?.at ?? null, r.rev, r.edge, prev.rev)
        .run();
      if (changes(res) !== 1) throw new FriendsError(409, CHANGED);
      return;
    }
    // A new edge: only while both players have room, in the same statement (the pair's UNIQUE (a, b) refuses a second row).
    const cut = now - FRIEND_REQUEST_MS;
    const other = r.from === r.a ? r.b : r.a;
    const sql =
      `INSERT INTO friend_edges (${COLS}) SELECT ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, NULL, ?10 ` +
      `WHERE (SELECT COUNT(*) FROM friend_edges WHERE (a = ?1 OR b = ?1) AND (state != 'pending' OR at > ?11)) < ?12 ` +
      `AND (SELECT COUNT(*) FROM friend_edges WHERE (a = ?2 OR b = ?2) AND (state != 'pending' OR at > ?11)) < ?12 ` +
      `ON CONFLICT (a, b) DO NOTHING`;
    const res = await db.prepare(sql).bind(r.from, other, r.edge, r.a, r.b, r.from, r.state, JSON.stringify(r.blockedBy), r.at, r.rev, cut, FRIEND_LIMIT).run();
    if (changes(res) !== 1) throw new FriendsError(409, CHANGED);
  }

  async function onEdge(_player: string, edge: string, plan: (rec: EdgeRec | null) => Plan, now: number) {
    const rec = await byEdge(edge);
    await apply(plan(rec), rec, now);
  }

  return {
    async view(player: string, directory: PlayerDirectory, now: number): Promise<FriendView> {
      const recs = (await db.prepare(`SELECT ${COLS} FROM friend_edges WHERE a = ?1 OR b = ?1`).bind(player).all<Row>()).results.map(recOf);
      // The presence and the choice of the player's friends, in one statement each (a friend's id is the other side of a friend edge).
      const OTHER = "CASE WHEN e.a = ?1 THEN e.b ELSE e.a END";
      const pres = (
        await db
          .prepare(`SELECT p.player, p.place, p.lease, p.at FROM friend_edges e JOIN friend_presence p ON p.player = ${OTHER} WHERE (e.a = ?1 OR e.b = ?1) AND e.state = 'friend'`)
          .bind(player)
          .all<{ player: string; place: string; lease: string; at: number }>()
      ).results;
      const hidden = (
        await db.prepare(`SELECT f.player FROM friend_edges e JOIN friend_prefs f ON f.player = ${OTHER} WHERE (e.a = ?1 OR e.b = ?1) AND e.state = 'friend' AND f.show_online = 0`).bind(player).all<{ player: string }>()
      ).results;
      const me = await db.prepare("SELECT show_online FROM friend_prefs WHERE player = ?").bind(player).first<{ show_online: number }>();
      const names = await directory.names(shownOthers(player, recs, now));
      const presence = new Map<string, PresenceRec>(pres.map((p) => [p.player, { player: p.player, where: p.place, lease: p.lease, at: Number(p.at) }]));
      const shows = new Map<string, boolean>(hidden.map((x) => [x.player, false]));
      return { showOnline: !me || Number(me.show_online) !== 0, people: buildRows(player, recs, now, names, presence, shows) };
    },

    async request(player, other, now) {
      const rec = await byPair(player, other);
      const plan = await planRequest(player, other, rec, now, async () => ({ mine: await liveCount(player, now), theirs: await liveCount(other, now) }));
      // A request that went stale is still the pair's row: it is changed in place (its count is the one just read).
      await apply(plan, rec, now);
    },
    accept: (player, edge, now) => onEdge(player, edge, (r) => planAccept(player, r, now), now),
    decline: (player, edge) => onEdge(player, edge, (r) => planDecline(player, r, Date.now()), Date.now()),
    remove: (player, edge) => onEdge(player, edge, (r) => planRemove(player, r, Date.now()), Date.now()),
    block: (player, edge, now) => onEdge(player, edge, (r) => planBlock(player, r, now), now),
    unblock: (player, edge, now) => onEdge(player, edge, (r) => planUnblock(player, r, now), now),
    invite: (player, edge, where, now) => onEdge(player, edge, (r) => planInvite(player, r, where, now), now),

    async pulse(player, where, lease, now) {
      const p = checkPulse(where, lease);
      if (p.where !== null) {
        await db
          .prepare("INSERT INTO friend_presence (player, place, lease, at) VALUES (?, ?, ?, ?) ON CONFLICT (player) DO UPDATE SET place = excluded.place, lease = excluded.lease, at = excluded.at")
          .bind(player, p.where, p.lease, now)
          .run();
        return;
      }
      // Leaving: only the tab that holds the row may clear it (planPulse's rule, in the statement).
      await db.prepare("DELETE FROM friend_presence WHERE player = ? AND lease = ?").bind(player, p.lease).run();
    },

    async setShowOnline(player, on) {
      const stmts = [db.prepare("INSERT INTO friend_prefs (player, show_online) VALUES (?, ?) ON CONFLICT (player) DO UPDATE SET show_online = excluded.show_online").bind(player, on ? 1 : 0)];
      if (!on) stmts.push(db.prepare("DELETE FROM friend_presence WHERE player = ?").bind(player));
      await db.batch(stmts);
    },

    async forget(player) {
      const done = await db.batch([
        db.prepare("DELETE FROM friend_edges WHERE a = ?1 OR b = ?1").bind(player),
        db.prepare("DELETE FROM friend_presence WHERE player = ?").bind(player),
        db.prepare("DELETE FROM friend_prefs WHERE player = ?").bind(player),
      ]);
      return done.reduce<number>((n, r) => n + changes(r), 0);
    },
  };
}
