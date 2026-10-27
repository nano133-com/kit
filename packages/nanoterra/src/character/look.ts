import { HAIRS, PANTS, SHIRTS, SHOES, SKINS, TODAY } from "./lists.js";
import { clean, DEFAULT_RECORD, type LegacyLook, type LookRecord } from "./record.js";

// The five colours of a player's look, as every Nanoterra game has read them (and as @nano133/character 0.1.0 took them): skin, hair, shirt,
// trousers and shoes, each "#rrggbb" (sRGB). The record (record.ts) is the whole character; these five are its oldest part, and a ticket,
// a code exchange or an older game still carry them. `LOOK_PARTS` lists the colours that the island offers for each part. A look given to a
// function here may hold any "#rrggbb": a shirt dye from the island's shop is not one of the offered shirt colours.
// This file imports no package: it is part of "@nano133/nanoterra/character/record".

export type Look = LegacyLook;

/** The five parts of a look, in the order that the island lists them. */
export const LOOK_KEYS = ["skin", "hair", "shirt", "pants", "shoes"] as const;
export type LookPart = (typeof LOOK_KEYS)[number];

/** The free colours that a player picks from on the island, for each part. */
export const LOOK_PARTS: { readonly [K in LookPart]: readonly string[] } = {
  skin: SKINS,
  hair: HAIRS,
  shirt: SHIRTS,
  pants: PANTS.slice(0, TODAY.pants),
  shoes: SHOES.slice(0, TODAY.shoes),
};

/** The look that a new player starts with on the island. Each call gives a new object. */
export function defaultLook(): Look {
  return { skin: SKINS[1], hair: HAIRS[1], shirt: SHIRTS[0], pants: PANTS[0], shoes: SHOES[0] };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}...` : v);
  if (v === null) return "null";
  return typeof v;
}

/**
 * What is wrong with `look`, in one plain sentence, or null when it is a good look. Extra keys are ignored; a missing
 * part, a part that is not a string and a string that is not "#rrggbb" are refused.
 */
export function lookProblem(look: unknown): string | null {
  if (typeof look !== "object" || look === null || Array.isArray(look)) {
    return `look must be an object with ${LOOK_KEYS.join(", ")} (each a colour like "#2a9df4"), not ${show(look)}`;
  }
  const o = look as Record<string, unknown>;
  for (const key of LOOK_KEYS) {
    const v = o[key];
    if (v === undefined) return `look.${key} is missing: give a colour like "#2a9df4"`;
    if (typeof v !== "string" || !HEX.test(v)) return `look.${key} must be a colour like "#2a9df4" (a # and six hex digits), not ${show(v)}`;
  }
  return null;
}

/** True when `look` has all five parts and each is "#rrggbb". */
export function isLook(look: unknown): look is Look {
  return lookProblem(look) === null;
}

/** Throws a TypeError that says what is wrong, unless `look` is a good look. */
export function assertLook(look: unknown): asserts look is Look {
  const problem = lookProblem(look);
  if (problem) throw new TypeError(`@nano133/nanoterra: ${problem}`);
}

/**
 * What is wrong with `record`, in one plain sentence, or null when it is a whole record: an object whose every field is a whole number on its list
 * (`v` is 2). Extra keys are ignored. `clean` (record.ts) puts a wrong number back to the default; this says which one was wrong.
 */
export function recordProblem(record: unknown): string | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return `record must be a character record (an object with v: 2), not ${show(record)}`;
  const o = record as Record<string, unknown>;
  if (o.v !== 2) return `record.v must be 2, not ${show(o.v)}`;
  const kept = clean(o as Partial<LookRecord>) as unknown as Record<string, number>;
  for (const key of Object.keys(DEFAULT_RECORD)) {
    if (key === "v") continue;
    if (o[key] !== kept[key]) return `record.${key} must be a whole number on its list, not ${show(o[key])}`;
  }
  return null;
}

/** True when `record` is a whole record (see `recordProblem`). */
export function isRecord(record: unknown): record is LookRecord {
  return recordProblem(record) === null;
}
