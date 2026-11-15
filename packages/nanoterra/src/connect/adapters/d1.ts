// The "works once" store on Cloudflare D1: the game starter's own, on its `hits` table (the shop's `d1Limit`: one row a key and window). A pending
// cookie's id counts in the 10-minute window of its own deadline, under the key "nanoterra-pending|<id>", exactly as the starter counted it, so a game
// that moves onto this part keeps its rows and its cron (which deletes old windows). A new game adds the shop's d1.sql (it makes `hits`).
//
//   import { createD1Once } from "@nano133/nanoterra/connect/d1";
//   once: createD1Once(env.DB)

import { d1Limit, type D1CounterLike } from "../../shop/adapters/d1-limit.js";
import { ONCE_WINDOW_MS, type ConnectOnce } from "../core.js";

export type { D1CounterLike } from "../../shop/adapters/d1-limit.js";

export function createD1Once(db: D1CounterLike, tables: { hits?: string } = {}): ConnectOnce {
  return (id, until) => d1Limit(db, `nanoterra-pending|${id}`, 1, ONCE_WINDOW_MS, until, tables);
}
