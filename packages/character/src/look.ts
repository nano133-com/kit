// The look: five colours, as on Nano Island (app/island/looks.ts of nano133.com). A colour is "#rrggbb" (sRGB).
// `LOOK_PARTS` lists the colours that the island offers for each part. A look may hold any "#rrggbb": a shirt dye
// from the island's shop is not one of the five shirt colours.

export type Look = { skin: string; hair: string; shirt: string; pants: string; shoes: string };

/** The five parts of a look, in the order that the island lists them. */
export const LOOK_KEYS = ["skin", "hair", "shirt", "pants", "shoes"] as const;
export type LookPart = (typeof LOOK_KEYS)[number];

const SKINS = ["#f6d7bd", "#f2c29b", "#e0ac85", "#c98b5e", "#a96f48", "#8d5a3b", "#6e4329", "#4e2f1d"] as const;
const HAIRS = ["#1f1410", "#3a2a1e", "#6b4226", "#9c3b2a", "#e9b44c", "#f2e3c2", "#8e5cf0", "#2fbfb0"] as const;
const SHIRTS = ["#2a9df4", "#5bc65a", "#ff7a59", "#8e5cf0", "#ffd93b", "#2fbfb0", "#e5384b", "#f4f1ea"] as const;
const PANTS = ["#1e2a4a", "#3a2a4e", "#2b3550", "#6b5a44"] as const;
const SHOES = ["#ffffff", "#1b1c3d", "#ffd93b", "#2a9df4"] as const;

/** The free colours that a player picks from on the island, for each part. */
export const LOOK_PARTS = { skin: SKINS, hair: HAIRS, shirt: SHIRTS, pants: PANTS, shoes: SHOES } as const;

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
  if (problem) throw new TypeError(`@nano133/character: ${problem}`);
}
