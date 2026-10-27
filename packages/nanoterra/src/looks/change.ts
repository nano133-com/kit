import type { Look, Problem } from "./look.js";

// What a change of the list does, before it goes live. Owned looks are stored by id: a look that someone owns must stay in the file.

/**
 * The mistakes that a new list would make for the players: an id that someone owns (a paid order gave it to them) is gone from the new
 * list. `owned` is every look id that any player owns. The free look is not owned by an order: it is every player's.
 */
export function removalProblems(before: readonly Look[], after: readonly Look[], owned: Iterable<string>): Problem[] {
  const now = new Set(after.map((l) => l.id));
  const own = new Set(owned);
  const out: Problem[] = [];
  for (const l of before) {
    if (now.has(l.id) || !own.has(l.id)) continue;
    out.push({ look: null, field: "id", message: `The look "${l.id}" (${l.name}) is owned by a player and is not in the new list. Keep it in the file; change its price if you do not want to sell it.` });
  }
  return out;
}

export type LookField = "name" | "priceUsd" | "body" | "hat" | "hatColor";

export type LooksDiff = {
  added: Look[];
  removed: Look[];
  /** Looks with the same id and a different name, price, colour or hat. */
  changed: { id: string; before: Look; after: Look; fields: LookField[] }[];
};

/** What differs between two lists, by id. The order of the list is not a change. */
export function diffLooks(before: readonly Look[], after: readonly Look[]): LooksDiff {
  const was = new Map(before.map((l) => [l.id, l]));
  const is = new Map(after.map((l) => [l.id, l]));
  const diff: LooksDiff = { added: after.filter((l) => !was.has(l.id)), removed: before.filter((l) => !is.has(l.id)), changed: [] };
  for (const a of after) {
    const b = was.get(a.id);
    if (!b) continue;
    const fields: LookField[] = [];
    if (a.name !== b.name) fields.push("name");
    if (a.priceUsd !== b.priceUsd) fields.push("priceUsd");
    if (a.change.body.toLowerCase() !== b.change.body.toLowerCase()) fields.push("body");
    if (a.change.hat !== b.change.hat) fields.push("hat");
    if ((a.change.hatColor ?? "").toLowerCase() !== (b.change.hatColor ?? "").toLowerCase()) fields.push("hatColor");
    if (fields.length) diff.changed.push({ id: a.id, before: b, after: a, fields });
  }
  return diff;
}
