// The look: one thing a player can buy to change how their character looks. The rules are the game starter's (looks.json): a look only
// changes how the character looks, it is never random and it never changes a score, a speed or a rule.
//
// A look fills one WEAR SLOT. An outfit (no `wear`, or "outfit") is the character's own look: its body colour and its hat (`change`); a player wears one
// outfit. Every other wear slot is the game's own (a tool's skin, a charm, a trail: "shovel", "charm"): an item there has no `change` (the game reads what
// it is from its id or its `slots`), and a player wears one item in each slot, beside the outfit.

/** The hats that the starter's character can wear. */
export const HATS = ["cap", "beanie", "crown", "tophat"] as const;
export type Hat = (typeof HATS)[number];

/** What an outfit changes: the body's colour, and a hat in its colour. */
export type Change = { body: string; hat?: Hat; hatColor?: string };

export type Look = {
  /** 1 to 40 lowercase letters, digits or dashes: "mint-cap". Never change the id of a look that someone owns. */
  id: string;
  /** What the player reads, 1 to 40 characters. */
  name: string;
  /** The price in US dollars with at most 2 decimals, for example 0.25. 0 means free for everyone. */
  priceUsd: number;
  /**
   * The wear slot that the look fills: none (or "outfit") for an outfit, or a slot of the game's own ("shovel", "charm"): 1 to 24 lowercase letters, digits
   * or dashes, starting with a letter. A player wears one look in each slot. Never change the slot of a look that someone owns. `checkLooks` leaves it out
   * for an outfit.
   */
  wear?: string;
  /** What an outfit changes (an outfit must have it; an item of another slot must not: `isOutfit`). */
  change?: Change;
  /**
   * What a game defines for itself: up to 8 slots, each a name and a value, that the game's own code reads ("wings": "ember", "trail": "#ffcf5a"). A name is 1 to 24
   * lowercase letters, digits or dashes, starting with a letter; a value is a word (1 to 40 lowercase letters, digits or dashes) or a colour ("#rrggbb"). Optional: a look
   * without `slots`, or with an empty one, is the same look. Because players own a look by its id, the slots of a look that someone owns must not change.
   */
  slots?: Slots;
};

/** The slots of a look: names and values, words or colours. */
export type Slots = Record<string, string>;

export const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
/** The wear slot of an outfit (the character's own look). A look with no `wear` is an outfit too. */
export const OUTFIT = "outfit";
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
/** At most this many slots on a look. */
export const SLOTS_MAX = 8;
/** A slot's name: 1 to 24 lowercase letters, digits or dashes, starting with a letter. */
export const SLOT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
/** Names that a slot may not have: they mean something to an object (`constructor`, `prototype`). */
export const RESERVED_SLOT_NAMES: readonly string[] = ["constructor", "prototype"];
/** A slot's value that is a word: 1 to 40 lowercase letters, digits or dashes. (The other kind of value is a colour, COLOR_PATTERN.) */
export const SLOT_WORD_PATTERN = /^[a-z0-9-]{1,40}$/;
export const NAME_MAX = 40;
export const PRICE_MAX_USD = 1000;

/** One mistake in a list of looks. `message` says it in plain words, with where it is. */
export type Problem = {
  /** The place of the look in the list, from 1, or null for a mistake of the whole list. */
  look: number | null;
  /**
   * The field: "list", "id", "name", "priceUsd", "wear", "change", "change.body", "change.hat", "change.hatColor", "slots", "slots.<name>" or "free". (The change
   * rules also use "slots" and "wear" for a slot or a wear slot that changed on a look that players own.)
   */
  field: string;
  message: string;
};

/**
 * Whether a price has no fraction of a cent. `Math.round(x * 100) === x * 100` is wrong for 0.07, 0.29 and 1.1 (floating point), and a tolerance is wrong the other way (0.300000001
 * and 1e-9 would pass): a price is whole cents when it is exactly the number that its own two-decimal text names.
 */
export function wholeCents(usd: number): boolean {
  return typeof usd === "number" && Number.isFinite(usd) && Number(usd.toFixed(2)) === usd;
}

/** Every mistake in a list of looks (looks.json as it was read), in the order of the list. An empty array means the list is good. */
export function lookProblems(raw: unknown): Problem[] {
  const out: Problem[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return [{ look: null, field: "list", message: "looks.json must be a list with at least one look" }];
  const seen = new Set<string>();
  let freeOutfit = false;
  raw.forEach((l: unknown, i: number) => {
    const where = `looks.json, look ${i + 1}`;
    const v = (l ?? {}) as Record<string, any>;
    const add = (field: string, message: string) => out.push({ look: i + 1, field, message: `${where}: ${message}` });
    if (typeof v.id !== "string" || !ID_PATTERN.test(v.id)) add("id", '"id" must be 1 to 40 lowercase letters, digits or dashes');
    else if (seen.has(v.id)) add("id", `the id "${v.id}" is used twice`);
    else seen.add(v.id);
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > NAME_MAX) add("name", '"name" must be 1 to 40 characters');
    if (typeof v.priceUsd !== "number" || !Number.isFinite(v.priceUsd) || v.priceUsd < 0 || v.priceUsd > PRICE_MAX_USD) add("priceUsd", '"priceUsd" must be a number from 0 to 1000');
    else if (!wholeCents(v.priceUsd)) add("priceUsd", '"priceUsd" can have at most 2 decimals (cents)');
    const wearOk = v.wear === undefined || (typeof v.wear === "string" && SLOT_NAME_PATTERN.test(v.wear) && !RESERVED_SLOT_NAMES.includes(v.wear));
    if (!wearOk) add("wear", `"wear" must be "${OUTFIT}" or the name of a wear slot: 1 to 24 lowercase letters, digits or dashes, starting with a letter ("shovel")`);
    const outfit = v.wear === undefined || v.wear === OUTFIT;
    if (outfit) {
      if (typeof v.change?.body !== "string" || !COLOR_PATTERN.test(v.change.body)) add("change.body", '"change.body" must be a colour like "#4aa8ff"');
      if (v.change?.hat !== undefined && !(HATS as readonly unknown[]).includes(v.change.hat)) add("change.hat", `"change.hat" must be one of ${HATS.join(", ")}`);
      if (v.change?.hatColor !== undefined && (typeof v.change.hatColor !== "string" || !COLOR_PATTERN.test(v.change.hatColor))) add("change.hatColor", '"change.hatColor" must be a colour like "#1c6e4f"');
      if (v.priceUsd === 0) freeOutfit = true;
    } else if (wearOk && v.change !== undefined) add("change", `"change" is only for an outfit: a look worn in the "${v.wear}" slot does not change the body (remove "change")`);
    if (v.slots !== undefined) slotProblems(v.slots).forEach((s) => add(s.field, s.message));
  });
  // the starter's words for a list of outfits only; a list with items says that an item does not count
  const items = raw.some((l: unknown) => {
    const w = (l as { wear?: unknown } | null)?.wear;
    return w !== undefined && w !== OUTFIT;
  });
  if (!out.length && !freeOutfit)
    out.push({ look: null, field: "free", message: items ? 'looks.json needs at least one free outfit (priceUsd 0, and no "wear"): every player starts with it' : "looks.json needs at least one free look (priceUsd 0): every player starts with it" });
  return out;
}

/** Whether `v` is a plain object (not null, not a list, not a class instance). */
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Whether a slot's value is good: a word or a colour. */
export const slotValueOk = (v: unknown): v is string => typeof v === "string" && (SLOT_WORD_PATTERN.test(v) || COLOR_PATTERN.test(v));

/** The mistakes in one look's `slots` (the look's own message is added by the caller): the field is "slots" or "slots.<name>". */
function slotProblems(slots: unknown): { field: string; message: string }[] {
  if (!isPlain(slots)) return [{ field: "slots", message: '"slots" must be an object of names and values, like { "wings": "ember" }' }];
  const names = Object.keys(slots);
  const out: { field: string; message: string }[] = [];
  if (names.length > SLOTS_MAX) out.push({ field: "slots", message: `"slots" can have at most ${SLOTS_MAX} slots (this one has ${names.length})` });
  for (const name of names) {
    if (!SLOT_NAME_PATTERN.test(name)) out.push({ field: `slots.${name}`, message: `the slot name "${name}" must be 1 to 24 lowercase letters, digits or dashes, starting with a letter` });
    else if (RESERVED_SLOT_NAMES.includes(name)) out.push({ field: `slots.${name}`, message: `the slot name "${name}" is reserved: choose another` });
    else if (!slotValueOk(slots[name])) out.push({ field: `slots.${name}`, message: `"slots.${name}" must be a word (1 to 40 lowercase letters, digits or dashes) or a colour like "#ffcf5a"` });
  }
  return out;
}

/**
 * The slots as a clean copy, or undefined when there are none (an empty `slots` is the same as none). The creator's order of names is kept. A COLOUR is written in lower case
 * ("#ffcf5a"), so the game always reads one text for one colour: a change of only the case of a colour is then no change at all, for the game as for the check.
 */
export function cleanSlots(slots: Slots | undefined): Slots | undefined {
  if (!slots) return undefined;
  const names = Object.keys(slots);
  return names.length ? Object.fromEntries(names.map((n) => [n, typeof slots[n] === "string" && COLOR_PATTERN.test(slots[n]) ? slots[n].toLowerCase() : slots[n]])) : undefined;
}

/** The looks, or an Error that says the first mistake in plain words. The same words as the starter's `checkLooks`. */
export function checkLooks(rawInput: unknown): Look[] {
  // One snapshot of the data is checked AND copied: a getter or a changing value cannot be good for the check and something else for the copy. (JSON cannot hold one.)
  let raw: unknown = rawInput;
  try {
    raw = rawInput === undefined ? undefined : JSON.parse(JSON.stringify(rawInput));
  } catch {
    throw new Error("looks.json must be plain JSON data");
  }
  const first = lookProblems(raw)[0];
  if (first) throw new Error(first.message);
  return (raw as Look[]).map((l) => {
    const slots = cleanSlots(l.slots);
    const wear = wearOf(l);
    const change = isOutfit(l) ? { change: { body: l.change.body, hat: l.change.hat, hatColor: l.change.hatColor } } : {};
    return { id: l.id, name: l.name, priceUsd: l.priceUsd, ...(wear === OUTFIT ? {} : { wear }), ...change, ...(slots ? { slots } : {}) };
  });
}

/** "$0.25" */
export const usdText = (usd: number): string => `$${usd.toFixed(2)}`;

/** The wear slot that a look fills: OUTFIT for an outfit (no `wear`), or the game's own slot. */
export const wearOf = (l: Pick<Look, "wear">): string => l.wear ?? OUTFIT;

/** Whether a look is an outfit (the character's own look, with its `change`), not an item of another wear slot. */
export const isOutfit = (l: Look): l is Look & { change: Change } => wearOf(l) === OUTFIT && l.change !== undefined;
