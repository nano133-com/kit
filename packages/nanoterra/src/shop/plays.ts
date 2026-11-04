// The plays' rules in the shop: how many credits may wait, the round's ref, and the wait. (The plays themselves, plays.json, are checked in the looks path:
// `checkPlays`.) A credit is used at the START of a round, never at the buy: a round that could not start costs nothing.

import { PLAY_WAIT_DAYS, PLAY_WAIT_DAYS_MAX } from "../looks/play.js";

/** One player can have at most this many unused credits of one play: a new order of that play is refused until one is used. */
export const MAX_READY_PER_PLAY = 5;
/** A round's own id, the `ref` of a use: 1 to 64 letters, digits, ":", "_" or "-". */
export const USE_REF_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
export const DAY_MS = 86_400_000;

/** The days a play order's credit waits: the order's own `useDays` when it is a whole number from 1 to PLAY_WAIT_DAYS_MAX, else PLAY_WAIT_DAYS. */
export const useDaysOf = (o: { useDays?: unknown }): number =>
  typeof o.useDays === "number" && Number.isInteger(o.useDays) && o.useDays >= 1 && o.useDays <= PLAY_WAIT_DAYS_MAX ? o.useDays : PLAY_WAIT_DAYS;

/** The end of a credit granted at `grantedAt` for an order: the last time it can be used. Fixed at the grant, from the order's `useDays`. */
export const creditEnd = (o: { useDays?: unknown }, grantedAt: number): number => grantedAt + useDaysOf(o) * DAY_MS;

/** Throws unless `ref` is a good round id (every store checks it before it writes). */
export function checkRef(ref: unknown): asserts ref is string {
  if (typeof ref !== "string" || !USE_REF_PATTERN.test(ref)) throw new Error("a use's ref must be 1 to 64 letters, digits, \":\", \"_\" or \"-\"");
}
