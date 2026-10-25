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
};

export const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const NAME_MAX = 40;
export const PRICE_MAX_USD = 1000;

/** One mistake in a list of looks. `message` says it in plain words, with where it is. */
export type Problem = {
  /** The place of the look in the list, from 1, or null for a mistake of the whole list. */
  look: number | null;
  /** The field: "list", "id", "name", "priceUsd", "change.body", "change.hat", "change.hatColor" or "free". */
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
  });
  if (!out.length && !free) out.push({ look: null, field: "free", message: "looks.json needs at least one free look (priceUsd 0): every player starts with it" });
  return out;
}

/** The looks, or an Error that says the first mistake in plain words. The same words as the starter's `checkLooks`. */
export function checkLooks(raw: unknown): Look[] {
  const first = lookProblems(raw)[0];
  if (first) throw new Error(first.message);
  return (raw as Look[]).map((l) => ({ id: l.id, name: l.name, priceUsd: l.priceUsd, change: { body: l.change.body, hat: l.change.hat, hatColor: l.change.hatColor } }));
}

/** "$0.25" */
export const usdText = (usd: number): string => `$${usd.toFixed(2)}`;
