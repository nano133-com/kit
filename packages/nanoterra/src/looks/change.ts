import { COLOR_PATTERN, cleanSlots, wearOf, type Look, type Problem, type Slots } from "./look.js";

/** Whether two looks have the same slots: the same names with the same values, in any order. No slots and empty slots are the same; a colour is the same in upper and lower case. */
export function sameSlots(a: Slots | undefined, b: Slots | undefined): boolean {
  const x = cleanSlots(a) ?? {};
  const y = cleanSlots(b) ?? {};
  const names = Object.keys(x);
  if (names.length !== Object.keys(y).length) return false;
  const norm = (v: string) => (COLOR_PATTERN.test(v) ? v.toLowerCase() : v);
  return names.every((n) => Object.prototype.hasOwnProperty.call(y, n) && norm(x[n]) === norm(y[n]));
}

// What a change of the list does, before it goes live. Owned looks are stored by id: a look that someone owns must stay in the file.

/**
 * The mistakes that a new list would make for the players: an id that someone owns (a paid order gave it to them) is gone from the new
 * list, its wear slot changed (a shovel that a player owns must stay a shovel), or its slots changed (the game reads the slots of the id that a player
 * owns, so a new slot changes what they own: add a new look instead). `owned` is every look id that any player owns. The free look is not owned by an
 * order: it is every player's, and its slots may change. A change of a price, a name, a body colour or a hat on an owned look is allowed.
 */
export function removalProblems(before: readonly Look[], after: readonly Look[], owned: Iterable<string>): Problem[] {
  const now = new Set(after.map((l) => l.id));
  const own = new Set(owned);
  const out: Problem[] = [];
  const next = new Map(after.map((l, i) => [l.id, { look: l, place: i + 1 }]));
  for (const l of before) {
    if (!own.has(l.id)) continue;
    const kept = next.get(l.id);
    if (!kept) {
      out.push({ look: null, field: "id", message: `The look "${l.id}" (${l.name}) is owned by a player and is not in the new list. Keep it in the file; change its price if you do not want to sell it.` });
    } else if (wearOf(l) !== wearOf(kept.look)) {
      out.push({ look: kept.place, field: "wear", message: `The look "${l.id}" (${l.name}) is worn in the "${wearOf(l)}" slot, and a player owns it. Keep it in that slot, or add a new look for the "${wearOf(kept.look)}" slot.` });
    } else if (!sameSlots(l.slots, kept.look.slots)) {
      out.push({ look: kept.place, field: "slots", message: `The slots of the look "${l.id}" (${l.name}) changed, and a player owns it. Keep its slots as they were, or add a new look with the new slots.` });
    }
  }
  return out;
}

export type LookField = "name" | "priceUsd" | "wear" | "body" | "hat" | "hatColor" | "slots";

export type LooksDiff = {
  added: Look[];
  removed: Look[];
  /** Looks with the same id and a different name, price, wear slot, colour, hat or slots. */
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
    if (wearOf(a) !== wearOf(b)) fields.push("wear");
    if ((a.change?.body ?? "").toLowerCase() !== (b.change?.body ?? "").toLowerCase()) fields.push("body");
    if (a.change?.hat !== b.change?.hat) fields.push("hat");
    if ((a.change?.hatColor ?? "").toLowerCase() !== (b.change?.hatColor ?? "").toLowerCase()) fields.push("hatColor");
    if (!sameSlots(a.slots, b.slots)) fields.push("slots");
    if (fields.length) diff.changed.push({ id: a.id, before: b, after: a, fields });
  }
  return diff;
}
