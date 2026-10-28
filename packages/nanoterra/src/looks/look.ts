// The look: one thing a player can buy to change how their character looks. The rules are the game starter's (looks.json): a look only
// changes how the character looks, it is never random and it never changes a score, a speed or a rule.

/** The hats that the starter's character can wear. */
export const HATS = ["cap", "beanie", "crown", "tophat"] as const;
export type Hat = (typeof HATS)[number];

export type Look = {
  /** 1 to 40 lowercase letters, digits or dashes: "mint-cap". Never change the id of a look that someone owns. */
  id: string;
  /** What the player reads, 1 to 40 characters. */
  name: string;
  /** The price in US dollars with at most 2 decimals, for example 0.25. 0 means free for everyone. */
  priceUsd: number;
  change: { body: string; hat?: Hat; hatColor?: string };
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
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
/** At most this many slots on a look. */
export const SLOTS_MAX = 8;
/** A slot's name: 1 to 24 lowercase letters, digits or dashes, starting with a letter. */
export const SLOT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;
/** A slot's value that is a word: 1 to 40 lowercase letters, digits or dashes. (The other kind of value is a colour, COLOR_PATTERN.) */
export const SLOT_WORD_PATTERN = /^[a-z0-9-]{1,40}$/;
export const NAME_MAX = 40;
export const PRICE_MAX_USD = 1000;

/** One mistake in a list of looks. `message` says it in plain words, with where it is. */
export type Problem = {
  /** The place of the look in the list, from 1, or null for a mistake of the whole list. */
  look: number | null;
  /** The field: "list", "id", "name", "priceUsd", "change.body", "change.hat", "change.hatColor", "slots", "slots.<name>" or "free". (The change rules also use "slots" for a slot that changed on a look that players own.) */
  field: string;
  message: string;
};

/** Whether a price has no fraction of a cent. `Math.round(x * 100) === x * 100` is wrong for 0.07, 0.29 and 1.1 (floating point). */
export function wholeCents(usd: number): boolean {
  return Math.abs(usd * 100 - Math.round(usd * 100)) < 1e-6;
}

/** Every mistake in a list of looks (looks.json as it was read), in the order of the list. An empty array means the list is good. */
export function lookProblems(raw: unknown): Problem[] {
  const out: Problem[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return [{ look: null, field: "list", message: "looks.json must be a list with at least one look" }];
  const seen = new Set<string>();
  let free = false;
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
    else if (v.priceUsd === 0) free = true;
    if (typeof v.change?.body !== "string" || !COLOR_PATTERN.test(v.change.body)) add("change.body", '"change.body" must be a colour like "#4aa8ff"');
    if (v.change?.hat !== undefined && !(HATS as readonly unknown[]).includes(v.change.hat)) add("change.hat", `"change.hat" must be one of ${HATS.join(", ")}`);
    if (v.change?.hatColor !== undefined && (typeof v.change.hatColor !== "string" || !COLOR_PATTERN.test(v.change.hatColor))) add("change.hatColor", '"change.hatColor" must be a colour like "#1c6e4f"');
    if (v.slots !== undefined) slotProblems(v.slots).forEach((s) => add(s.field, s.message));
  });
  if (!out.length && !free) out.push({ look: null, field: "free", message: "looks.json needs at least one free look (priceUsd 0): every player starts with it" });
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
    else if (!slotValueOk(slots[name])) out.push({ field: `slots.${name}`, message: `"slots.${name}" must be a word (1 to 40 lowercase letters, digits or dashes) or a colour like "#ffcf5a"` });
  }
  return out;
}

/** The slots as a clean copy, or undefined when there are none (an empty `slots` is the same as none). The creator's order of names is kept. */
export function cleanSlots(slots: Slots | undefined): Slots | undefined {
  if (!slots) return undefined;
  const names = Object.keys(slots);
  return names.length ? Object.fromEntries(names.map((n) => [n, slots[n]])) : undefined;
}

/** The looks, or an Error that says the first mistake in plain words. The same words as the starter's `checkLooks`. */
export function checkLooks(raw: unknown): Look[] {
  const first = lookProblems(raw)[0];
  if (first) throw new Error(first.message);
  return (raw as Look[]).map((l) => {
    const slots = cleanSlots(l.slots);
    return { id: l.id, name: l.name, priceUsd: l.priceUsd, change: { body: l.change.body, hat: l.change.hat, hatColor: l.change.hatColor }, ...(slots ? { slots } : {}) };
  });
}

/** "$0.25" */
export const usdText = (usd: number): string => `$${usd.toFixed(2)}`;
