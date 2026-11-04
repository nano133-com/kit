// The play: one thing a player buys and uses ONCE (plays.json, beside looks.json): a round or a level. A player never owns a play: a paid order gives one
// credit, and the game's round start uses it (the shop's `useCredit`). The rule is pay to play only: a play buys one use of the game, and nothing else. It
// never pays out money or a prize, it is never random and it never changes the odds. So `checkPlays` is stricter than `checkLooks`: a field it does not
// know is a mistake (never dropped), the uses are a closed list, and the fields of a prize, a draw or a reward have their own message.
//
// Plays and looks share ONE id space: an order keeps the id of what it sells in one field, so a play's id is never the id of a look.

import { ID_PATTERN, NAME_MAX, PRICE_MAX_USD, priceStepOk, type Problem } from "./look.js";

/** What a play buys: the closed list. A round, or a level. (A life and a continue change the result of a round: they wait for the lawyer's answer.) */
export const PLAY_USES = ["round", "level"] as const;
export type PlayUse = (typeof PLAY_USES)[number];

/** How long a credit waits for its use, by default: 30 days. After that it cannot be used (the creator sends that payment back by hand). */
export const PLAY_WAIT_DAYS = 30;
/** The longest wait a play may set. */
export const PLAY_WAIT_DAYS_MAX = 365;

/** The fields a play may have. Any other field is a mistake. */
export const PLAY_FIELDS: readonly string[] = ["id", "name", "priceUsd", "use", "useWithinDays"];
/** Fields that would make a play more than one use of the game (a prize, a draw, a reward): each one, in any case or form, is refused with its own words. */
export const PLAY_REFUSED_FIELDS: readonly string[] = ["prize", "reward", "odds", "chance", "random", "tickets", "tokens", "cash", "bonus"];
/** The words for a refused field. */
export const PLAY_ONE_USE = "a play buys one use of the game, nothing else";

export type Play = {
  /** 1 to 40 lowercase letters, digits or dashes: "extra-round". Never the id of a look. Never change it after a sale. */
  id: string;
  /** What the player reads, 1 to 40 characters: "Extra round". */
  name: string;
  /** The price in US dollars, above 0, with at most 4 decimals (the looks' rule). A free play is not a play. */
  priceUsd: number;
  /** What it buys: one of PLAY_USES. */
  use: PlayUse;
  /** How many days a credit waits for its use: a whole number from 1 to 365. `checkPlays` fills in PLAY_WAIT_DAYS when it is missing. */
  useWithinDays?: number;
};

const refused = (field: string): boolean => {
  const k = field.toLowerCase();
  return PLAY_REFUSED_FIELDS.some((w) => k.includes(w.replace(/s$/, "")));
};

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The ids of a list of looks (looks.json as it was read, or the checked looks). Anything that is not a look with a text id is left out. */
const lookIds = (looks: unknown): Set<string> => new Set(Array.isArray(looks) ? looks.flatMap((l) => (isPlain(l) && typeof l.id === "string" ? [l.id] : [])) : []);

/**
 * Every mistake in a list of plays (plays.json as it was read), in the order of the list; `looks` is the game's looks, whose ids no play may take. An empty
 * array means the list is good. An empty list is good too: the game sells no play. A problem's `look` field is the place of the play in the list.
 */
export function playProblems(raw: unknown, looks: unknown = []): Problem[] {
  if (!Array.isArray(raw)) return [{ look: null, field: "list", message: "plays.json must be a list of plays" }];
  const out: Problem[] = [];
  const taken = lookIds(looks);
  const seen = new Set<string>();
  raw.forEach((p: unknown, i: number) => {
    const where = `plays.json, play ${i + 1}`;
    const add = (field: string, message: string) => out.push({ look: i + 1, field, message: `${where}: ${message}` });
    if (!isPlain(p)) return add("play", "a play must be an object like { \"id\": \"extra-round\", \"name\": \"Extra round\", \"priceUsd\": 0.05, \"use\": \"round\" }");
    for (const field of Object.keys(p)) {
      if (PLAY_FIELDS.includes(field)) continue;
      if (refused(field)) add(field, `"${field}" is not allowed: ${PLAY_ONE_USE}`);
      else add(field, `"${field}" is not a field of a play (a play has only ${PLAY_FIELDS.join(", ")})`);
    }
    if (typeof p.id !== "string" || !ID_PATTERN.test(p.id)) add("id", '"id" must be 1 to 40 lowercase letters, digits or dashes');
    else if (seen.has(p.id)) add("id", `the id "${p.id}" is used twice`);
    else if (taken.has(p.id)) add("id", `the id "${p.id}" is a look's id too: a play and a look never share an id`);
    else seen.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > NAME_MAX) add("name", '"name" must be 1 to 40 characters');
    if (typeof p.priceUsd !== "number" || !Number.isFinite(p.priceUsd) || p.priceUsd <= 0 || p.priceUsd > PRICE_MAX_USD) add("priceUsd", '"priceUsd" must be a number above 0 and at most 1000 (a free play is not a play)');
    else if (!priceStepOk(p.priceUsd)) add("priceUsd", '"priceUsd" can have at most 4 decimals (0.0001 is the smallest price above 0)');
    if (!(PLAY_USES as readonly unknown[]).includes(p.use)) add("use", `"use" must be one of ${PLAY_USES.join(", ")}`);
    const days = p.useWithinDays;
    if (days !== undefined && (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > PLAY_WAIT_DAYS_MAX)) add("useWithinDays", `"useWithinDays" must be a whole number of days from 1 to ${PLAY_WAIT_DAYS_MAX}`);
  });
  return out;
}

/**
 * The plays, each with its `useWithinDays` filled in, or an Error that says the first mistake in plain words. `looks` is the game's looks (their ids are
 * taken). One snapshot of the data is checked AND copied, as `checkLooks` does.
 */
export function checkPlays(rawInput: unknown, looks: unknown = []): (Play & { useWithinDays: number })[] {
  let raw: unknown = rawInput;
  try {
    raw = rawInput === undefined ? undefined : JSON.parse(JSON.stringify(rawInput));
  } catch {
    throw new Error("plays.json must be plain JSON data");
  }
  const first = playProblems(raw, looks)[0];
  if (first) throw new Error(first.message);
  return (raw as Play[]).map((p) => ({ id: p.id, name: p.name, priceUsd: p.priceUsd, use: p.use, useWithinDays: p.useWithinDays ?? PLAY_WAIT_DAYS }));
}
