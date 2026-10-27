import { hsl } from "./color.js";

// The closed lists of the character kit. A look is a record of small whole numbers, each an index into one of these lists (record.ts):
// no free text, no URL and no colour string ever comes from a player, so there is nothing to moderate. Every list may grow at its end (an
// old record keeps its meaning); none may be reordered or cut. This folder imports three and nothing else.

export const BASE_IDS = ["classic", "round", "critter", "bee", "robot", "pineapple"] as const;
export type BaseId = (typeof BASE_IDS)[number];
export const HAIR_STYLES = ["bowl", "short", "spikes", "ponytail", "long", "buns", "curls", "bald"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
/** A face: the eyes and the mouth together. `bar` is the room blob's visor: one glowing bar. */
export const FACES = ["classic", "cheerful", "happy", "sleepy", "wink", "starry", "calm", "bar"] as const;
export type FaceId = (typeof FACES)[number];
export const BROWS = ["none", "straight", "arched", "angry"] as const;
export type BrowId = (typeof BROWS)[number];
export const GLASSES = ["none", "round", "square", "shades"] as const;
export type GlassesId = (typeof GLASSES)[number];
/** Today's long-sleeve shirt is first, so a record of zeros dresses today's avatar. `none` is the base's own body. */
export const TOPS = ["shirt", "tee", "hoodie", "jacket", "tank", "none"] as const;
export type TopId = (typeof TOPS)[number];
export const BOTTOMS = ["trousers", "shorts", "skirt", "overalls", "none"] as const;
export type BottomId = (typeof BOTTOMS)[number];
export const SHOE_STYLES = ["sneakers", "boots", "sandals", "bare"] as const;
export type ShoeId = (typeof SHOE_STYLES)[number];
/** The first six are the room blob's patterns (None, Stripes, Dots, Half, Band, Checks) in their order, but for stars, which is 3 here. */
export const PATTERNS = ["none", "stripes", "dots", "stars", "half", "band", "checks"] as const;
export type PatternId = (typeof PATTERNS)[number];
export const BUILDS = ["slim", "regular", "round"] as const;
export type BuildId = (typeof BUILDS)[number];
/** Size is visual only. Heights: the room's three (0, 3 and 6) and the steps between. */
export const HEIGHTS = [0.86, 0.91, 0.96, 1, 1.06, 1.11, 1.16] as const;
export const HEADS = [0.9, 0.95, 1, 1.075, 1.15] as const;

// The five colours of today's look (app/island/looks.ts), in their order: the first entries of the longer lists below.
export const SKINS = ["#f6d7bd", "#f2c29b", "#e0ac85", "#c98b5e", "#a96f48", "#8d5a3b", "#6e4329", "#4e2f1d"] as const;
export const HAIRS = ["#1f1410", "#3a2a1e", "#6b4226", "#9c3b2a", "#e9b44c", "#f2e3c2", "#8e5cf0", "#2fbfb0"] as const;
export const SHIRTS = ["#2a9df4", "#5bc65a", "#ff7a59", "#8e5cf0", "#ffd93b", "#2fbfb0", "#e5384b", "#f4f1ea"] as const;
/** Today's four, then four more. */
export const PANTS = ["#1e2a4a", "#3a2a4e", "#2b3550", "#6b5a44", "#e5384b", "#2a9df4", "#ffd93b", "#f4f1ea"] as const;
/** Today's four, then four more. */
export const SHOES = ["#ffffff", "#1b1c3d", "#ffd93b", "#2a9df4", "#6b4226", "#e5384b", "#5bc65a", "#9fb2c2"] as const;
export const TRIMS = ["#f4f1ea", "#1b1c3d", "#ffd93b", "#e5384b", "#2a9df4", "#ff7a59", "#5bc65a", "#8e5cf0"] as const;
/** How many of each list today's look has: the first entries are today's. */
export const TODAY = { skin: 8, hair: 8, shirt: 8, pants: 4, shoes: 4 } as const;

// The room blob's swatches (app/arcade/room/blobLook.ts): twelve hues for the body, twelve for the visor, twelve for the feet.
const hue = (i: number) => (i + 0.5) / 12;
export const BLOB_BODIES = Array.from({ length: 12 }, (_, i) => hsl(hue(i), 0.75, 0.6));
/** The visor's glow: index 6 is the cyan the room's visor always had. */
export const VISORS = Array.from({ length: 12 }, (_, i) => (i === 6 ? "#5eefff" : hsl(hue(i), 0.75, 0.68)));
/** The feet: index 9 is the near-black the room's feet always had. */
export const FEET = Array.from({ length: 12 }, (_, i) => (i === 9 ? "#1a1726" : hsl(hue(i), 0.45, 0.28)));

/** The body colours of each base (the `skin` field: an index into the base's own list). */
export const BODIES: Record<BaseId, readonly string[]> = {
  classic: SKINS,
  round: BLOB_BODIES,
  critter: ["#d9a066", "#e07a3a", "#9aa3b0", "#f4f1ea", "#5a4636", "#c98b5e", "#f0c27a", "#8a5a2b"],
  bee: ["#ffcc2e", "#ffa53a", "#fff1a8", "#f4f1ea", "#9be37f", "#ff9bb0", "#9fd8ff", "#c9b3ff"],
  robot: ["#9fb2c2", "#e5384b", "#5bc65a", "#ffd93b", "#f4f1ea", "#2a9df4", "#8e5cf0", "#ff7a59"],
  pineapple: ["#f4b63e", "#ffd93b", "#e9a02f", "#9be37f", "#ff9bb0", "#f2e3c2", "#c9b3ff", "#2fbfb0"],
};
/** The colour of the shoes (or the feet of a Round body): the `shoeColor` field. */
export const shoeColors = (base: BaseId): readonly string[] => (base === "round" ? FEET : SHOES);

/** The layers each base wears. A Pineapple has its own crown; a Bee its own stripes; a visor or a screen takes no glasses, freckles or blush. A pattern that is a decal (dots, stars) needs a round torso. */
export type Wears = { hair: boolean; tops: readonly TopId[]; bottoms: readonly BottomId[]; shoes: boolean; glasses: boolean; freckles: boolean; blush: boolean; patterns: readonly PatternId[] };
const ALL_TOPS = ["shirt", "tee", "hoodie", "jacket", "tank"] as const;
const ALL_BOTTOMS = ["trousers", "shorts", "skirt", "overalls"] as const;
export const WEARS: Record<BaseId, Wears> = {
  classic: { hair: true, tops: ALL_TOPS, bottoms: ALL_BOTTOMS, shoes: true, glasses: true, freckles: true, blush: true, patterns: PATTERNS },
  round: { hair: false, tops: ALL_TOPS, bottoms: ALL_BOTTOMS, shoes: true, glasses: false, freckles: false, blush: false, patterns: PATTERNS },
  critter: { hair: false, tops: ALL_TOPS, bottoms: ALL_BOTTOMS, shoes: true, glasses: true, freckles: false, blush: true, patterns: PATTERNS },
  bee: { hair: false, tops: [], bottoms: [], shoes: true, glasses: true, freckles: false, blush: true, patterns: ["none"] },
  robot: { hair: false, tops: ["shirt", "tee", "tank"], bottoms: ALL_BOTTOMS, shoes: true, glasses: false, freckles: false, blush: false, patterns: ["none", "stripes", "half", "band", "checks"] },
  pineapple: { hair: false, tops: [], bottoms: [], shoes: true, glasses: true, freckles: false, blush: true, patterns: ["none"] },
};
