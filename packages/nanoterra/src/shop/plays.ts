// The plays' rules in the shop: how many credits may wait, the round's ref, and the wait. (The plays themselves, plays.json, are checked in the looks path:
// `checkPlays`.) A credit is used at the START of a round, never at the buy: a round that could not start costs nothing.

import { PLAY_WAIT_DAYS, type Play } from "../looks/play.js";

/** One player can have at most this many unused credits of one play: a new order of that play is refused until one is used. */
export const MAX_READY_PER_PLAY = 5;
/** A round's own id, the `ref` of a use: 1 to 64 letters, digits, ":", "_" or "-". */
export const USE_REF_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
export const DAY_MS = 86_400_000;

/** The oldest grant time a credit of this play may have to be used at `now`: its wait (`useWithinDays`, default 30 days) back from now. */
export const creditWindow = (play: Pick<Play, "useWithinDays">, now: number): number => now - (play.useWithinDays ?? PLAY_WAIT_DAYS) * DAY_MS;

/** Throws unless `ref` is a good round id (every store checks it before it writes). */
export function checkRef(ref: unknown): asserts ref is string {
  if (typeof ref !== "string" || !USE_REF_PATTERN.test(ref)) throw new Error("a use's ref must be 1 to 64 letters, digits, \":\", \"_\" or \"-\"");
}
