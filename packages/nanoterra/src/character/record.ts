import { BASE_IDS, BODIES, BOTTOMS, BROWS, BUILDS, FACES, FEET, GLASSES, HAIRS, HAIR_STYLES, HEADS, HEIGHTS, PANTS, PATTERNS, SHIRTS, SHOES, SHOE_STYLES, SKINS, TODAY, TOPS, TRIMS, VISORS, shoeColors, type BaseId, type BottomId, type BrowId, type BuildId, type FaceId, type GlassesId, type HairStyle, type PatternId, type ShoeId, type TopId } from "./lists.js";

// A character's look, as data. The RECORD is what travels and what is stored: whole numbers only, each an index into a closed list
// (lists.ts), so a hostile client can send nothing that is not on a list. `resolve` turns it into what the builder draws (`CharLook`:
// names and colour strings taken from the lists, never from the record). It packs into two numbers of 30 bits for the wire (`packRecord`),
// and today's five colours map in and out (`fromLegacy`, `toLegacy`), so every look already saved keeps working. The record is versioned
// (`v`): a new version only adds fields, and a reader of v 2 that sees a field it does not know ignores it.

export type LookRecord = {
  v: 2;
  /** BASE_IDS. */
  base: number;
  /** An index into the base's own body colours (BODIES[base]): today's skin for Classic, the blob's twelve for Round. */
  skin: number;
  /** HAIRS. */
  hair: number;
  /** HAIR_STYLES. */
  hairStyle: number;
  /** FACES. */
  face: number;
  /** BROWS. */
  brows: number;
  blush: number;
  freckles: number;
  /** GLASSES. */
  glasses: number;
  /** TOPS. */
  top: number;
  /** SHIRTS. */
  shirt: number;
  /** BOTTOMS. */
  bottom: number;
  /** PANTS. */
  pants: number;
  /** SHOE_STYLES. */
  shoes: number;
  /** The shoe colour (SHOES), or the feet of a Round body (FEET). */
  shoeColor: number;
  /** PATTERNS: on the top, or on a Round body. */
  pattern: number;
  /** TRIMS: the pattern's second colour. */
  trim: number;
  /** VISORS: the glow of a visor or a screen (Round, Robot). */
  visor: number;
  /** HEIGHTS (the 3rd is 1). Visual only. */
  height: number;
  /** BUILDS. */
  build: number;
  /** HEADS (the 3rd is 1). */
  head: number;
};

type Key = Exclude<keyof LookRecord, "v">;
/** Each field's size: how many values it has (the bits are the smallest that hold them). The first list packs into A, the second into B. */
const A: readonly (readonly [Key, number])[] = [["base", BASE_IDS.length], ["skin", 16], ["hair", 8], ["hairStyle", HAIR_STYLES.length], ["face", FACES.length], ["brows", BROWS.length], ["blush", 2], ["freckles", 2], ["glasses", GLASSES.length], ["top", TOPS.length], ["shirt", 8]];
const B: readonly (readonly [Key, number])[] = [["bottom", BOTTOMS.length], ["pants", 8], ["shoes", SHOE_STYLES.length], ["shoeColor", 16], ["pattern", PATTERNS.length], ["trim", 8], ["visor", VISORS.length], ["height", HEIGHTS.length], ["build", BUILDS.length], ["head", HEADS.length]];
const bitsOf = (n: number) => Math.max(1, Math.ceil(Math.log2(n)));
/** The width in bits of A and of B. Each must stay within 30, so a whole number packs with plain bit operations. */
export const PACK_BITS = [A, B].map((f) => f.reduce((s, [, n]) => s + bitsOf(n), 0)) as [number, number];

/** Today's avatar, with nothing new on: the Classic base, the bowl, the plain face, the long-sleeve shirt, trousers, sneakers, size 1. */
export const DEFAULT_RECORD: LookRecord = { v: 2, base: 0, skin: 1, hair: 1, hairStyle: 0, face: 0, brows: 0, blush: 0, freckles: 0, glasses: 0, top: 0, shirt: 0, bottom: 0, pants: 0, shoes: 0, shoeColor: 0, pattern: 0, trim: 0, visor: 6, height: 3, build: 1, head: 2 };

const pack = (r: LookRecord, fields: typeof A) => {
  let n = 0;
  for (const [k, count] of fields) n = (n << bitsOf(count)) | r[k];
  return n;
};
/** A record as two whole numbers (each 0 to 2^30 − 1), for the wire. */
export const packRecord = (r: LookRecord): [number, number] => [pack(r, A), pack(r, B)];

/** Two numbers back to a record: null when anything is not a whole number in range, or any field is off its list. */
export function unpackRecord(a: unknown, b: unknown): LookRecord | null {
  if (!Number.isInteger(a) || !Number.isInteger(b) || (a as number) < 0 || (b as number) < 0 || (a as number) >= 2 ** PACK_BITS[0] || (b as number) >= 2 ** PACK_BITS[1]) return null;
  const out = { ...DEFAULT_RECORD } as Record<string, number>;
  for (const [fields, n] of [[A, a as number], [B, b as number]] as const) {
    let v = n;
    for (const [k, count] of [...fields].reverse()) {
      const bits = bitsOf(count);
      const x = v & ((1 << bits) - 1);
      if (x >= count) return null;
      out[k] = x;
      v >>>= bits;
    }
  }
  const rec = out as unknown as LookRecord;
  const c = clean(rec) as unknown as Record<string, number>;
  return Object.keys(out).every((k) => k === "v" || c[k] === out[k]) ? rec : null;
}

/** A record read with each field kept on its list (a wrong number becomes the default's): what the builder draws from. */
export function clean(r: Partial<LookRecord> | null | undefined): LookRecord {
  const out = { ...DEFAULT_RECORD } as Record<string, number>;
  if (r && typeof r === "object") for (const [k, count] of [...A, ...B]) {
    const x = (r as Record<string, unknown>)[k];
    if (typeof x === "number" && Number.isInteger(x) && x >= 0 && x < count) out[k] = x;
  }
  // The body's list and the shoe list are longer than some bases' own.
  const base = BASE_IDS[out.base];
  if (out.skin >= BODIES[base].length) out.skin = DEFAULT_RECORD.skin;
  if (out.shoeColor >= shoeColors(base).length) out.shoeColor = 0;
  return out as unknown as LookRecord;
}

// ---------------------------------------------------------------------------------------------------------------
// What the builder draws
// ---------------------------------------------------------------------------------------------------------------

export type CharColors = { skin: string; hair: string; shirt: string; pants: string; shoes: string; trim: string; glow: string };

/** A look, resolved from a record: names and colours from the closed lists. */
export type CharLook = {
  base: BaseId;
  hair: HairStyle;
  face: FaceId;
  brows: BrowId;
  blush: boolean;
  freckles: boolean;
  glasses: GlassesId;
  top: TopId;
  bottom: BottomId;
  shoes: ShoeId;
  pattern: PatternId;
  height: number;
  build: BuildId;
  head: number;
  colors: CharColors;
};

export function resolve(rec: Partial<LookRecord>): CharLook {
  const r = clean(rec);
  const base = BASE_IDS[r.base];
  return {
    base,
    hair: HAIR_STYLES[r.hairStyle],
    face: FACES[r.face],
    brows: BROWS[r.brows],
    blush: !!r.blush,
    freckles: !!r.freckles,
    glasses: GLASSES[r.glasses],
    top: TOPS[r.top],
    bottom: BOTTOMS[r.bottom],
    shoes: SHOE_STYLES[r.shoes],
    pattern: PATTERNS[r.pattern],
    height: HEIGHTS[r.height],
    build: BUILDS[r.build],
    head: HEADS[r.head],
    colors: { skin: BODIES[base][r.skin], hair: HAIRS[r.hair], shirt: SHIRTS[r.shirt], pants: PANTS[r.pants], shoes: shoeColors(base)[r.shoeColor], trim: TRIMS[r.trim], glow: VISORS[r.visor] },
  };
}

/** A base as it comes: Classic is today's avatar; the others have their own body, face, feet and no hair, top or bottom. */
export function baseRecord(base: BaseId): LookRecord {
  if (base === "classic") return { ...DEFAULT_RECORD };
  return { ...DEFAULT_RECORD, base: BASE_IDS.indexOf(base), skin: 0, hairStyle: HAIR_STYLES.indexOf("bald"), face: base === "round" ? FACES.indexOf("bar") : 0, top: TOPS.indexOf("none"), bottom: BOTTOMS.indexOf("none"), shoes: SHOE_STYLES.indexOf("bare"), shoeColor: base === "round" ? 9 : 0, shirt: base === "robot" ? SHIRTS.indexOf("#e5384b") : 0 };
}

/** A record from names and colours, for a picture or a test (a name or colour not on its list throws: a record holds nothing else). */
export function recordOf(o: Partial<{ base: BaseId; skin: string; hair: string; hairStyle: HairStyle; face: FaceId; brows: BrowId; blush: boolean; freckles: boolean; glasses: GlassesId; top: TopId; shirt: string; bottom: BottomId; pants: string; shoes: ShoeId; shoeColor: string; pattern: PatternId; trim: string; visor: string; height: number; build: BuildId; head: number }>): LookRecord {
  const at = <T,>(list: readonly T[], v: T, what: string) => {
    const i = list.indexOf(v);
    if (i < 0) throw new Error(`character: ${String(v)} is not in the ${what} list`);
    return i;
  };
  const r = baseRecord(o.base ?? "classic");
  const base = BASE_IDS[r.base];
  if (o.skin !== undefined) r.skin = at(BODIES[base], o.skin, `${base} body colour`);
  if (o.hair !== undefined) r.hair = at(HAIRS, o.hair, "hair colour");
  if (o.hairStyle !== undefined) r.hairStyle = at(HAIR_STYLES, o.hairStyle, "hair style");
  if (o.face !== undefined) r.face = at(FACES, o.face, "face");
  if (o.brows !== undefined) r.brows = at(BROWS, o.brows, "brows");
  if (o.blush !== undefined) r.blush = o.blush ? 1 : 0;
  if (o.freckles !== undefined) r.freckles = o.freckles ? 1 : 0;
  if (o.glasses !== undefined) r.glasses = at(GLASSES, o.glasses, "glasses");
  if (o.top !== undefined) r.top = at(TOPS, o.top, "top");
  if (o.shirt !== undefined) r.shirt = at(SHIRTS, o.shirt, "shirt colour");
  if (o.bottom !== undefined) r.bottom = at(BOTTOMS, o.bottom, "bottom");
  if (o.pants !== undefined) r.pants = at(PANTS, o.pants, "pants colour");
  if (o.shoes !== undefined) r.shoes = at(SHOE_STYLES, o.shoes, "shoes");
  if (o.shoeColor !== undefined) r.shoeColor = at(shoeColors(base), o.shoeColor, "shoe colour");
  if (o.pattern !== undefined) r.pattern = at(PATTERNS, o.pattern, "pattern");
  if (o.trim !== undefined) r.trim = at(TRIMS, o.trim, "trim colour");
  if (o.visor !== undefined) r.visor = at(VISORS, o.visor, "visor colour");
  if (o.height !== undefined) r.height = at(HEIGHTS, o.height, "height");
  if (o.build !== undefined) r.build = at(BUILDS, o.build, "build");
  if (o.head !== undefined) r.head = at(HEADS, o.head, "head size");
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// Today's five colours
// ---------------------------------------------------------------------------------------------------------------

/** Today's look (app/island/looks.ts): five colours, each one of the offered. */
export type LegacyLook = { skin: string; hair: string; shirt: string; pants: string; shoes: string };

/** A record with today's five colours put in it (an older client changed its colours, or an account kept five): every other part stays. The skin only on a Classic (the other bases have their own body colours), the shoes not on a Round (its feet are the room's). */
export function withLegacy(rec: LookRecord, l: LegacyLook): LookRecord {
  const r = clean(rec);
  const f = fromLegacy(l);
  return { ...r, skin: BASE_IDS[r.base] === "classic" ? f.skin : r.skin, hair: f.hair, shirt: f.shirt, pants: f.pants, shoeColor: BASE_IDS[r.base] === "round" ? r.shoeColor : f.shoeColor };
}

/** A look saved before the record: the Classic base with today's five colours. The new fields are the defaults; a colour not offered is the part's first, as packLook does. */
export function fromLegacy(l: LegacyLook): LookRecord {
  const i = (list: readonly string[], v: string, n: number) => Math.max(0, list.slice(0, n).indexOf(v));
  return { ...DEFAULT_RECORD, skin: i(SKINS, l.skin, TODAY.skin), hair: i(HAIRS, l.hair, TODAY.hair), shirt: i(SHIRTS, l.shirt, TODAY.shirt), pants: i(PANTS, l.pants, TODAY.pants), shoeColor: i(SHOES, l.shoes, TODAY.shoes) };
}

const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const nearest = (list: readonly string[], to: string) => {
  const t = rgb(to);
  let best = 0;
  let bd = Infinity;
  list.forEach((c, i) => {
    const d = rgb(c).reduce((s, x, k) => s + (x - t[k]) ** 2, 0);
    if (d < bd) [best, bd] = [i, d];
  });
  return best;
};

/** The five colours of today's look for a record: what an older client, or a creator game that reads the five colours, is given. Always from today's lists. */
export function toLegacy(rec: LookRecord): LegacyLook {
  const r = clean(rec);
  const base = BASE_IDS[r.base];
  const skin = base === "classic" ? r.skin : nearest(SKINS, BODIES[base][r.skin]);
  const shoe = base === "round" ? nearest(SHOES.slice(0, TODAY.shoes), FEET[r.shoeColor]) : r.shoeColor < TODAY.shoes ? r.shoeColor : nearest(SHOES.slice(0, TODAY.shoes), SHOES[r.shoeColor]);
  return { skin: SKINS[skin], hair: HAIRS[r.hair], shirt: SHIRTS[r.shirt], pants: PANTS[r.pants < TODAY.pants ? r.pants : nearest(PANTS.slice(0, TODAY.pants), PANTS[r.pants])], shoes: SHOES[shoe] };
}

/** Today's wire number for a look (app/island/net.ts packLook: skin 3 bits, hair 3, shirt 3, pants 2, shoes 2; 0 to 8191), for a client from before the record. */
export function packLegacy(l: LegacyLook): number {
  const idx = (list: readonly string[], v: string, n: number) => Math.max(0, list.slice(0, n).indexOf(v));
  let n = 0;
  n = (n << 3) | idx(SKINS, l.skin, 8);
  n = (n << 3) | idx(HAIRS, l.hair, 8);
  n = (n << 3) | idx(SHIRTS, l.shirt, 8);
  n = (n << 2) | idx(PANTS, l.pants, 4);
  n = (n << 2) | idx(SHOES, l.shoes, 4);
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// The room blob
// ---------------------------------------------------------------------------------------------------------------

/** The room blob's look (app/arcade/room/blobLook.ts): the body hue's swatch (0 to 11), then the packed fields. */
export type BlobPick = { body: number; visor: number; feet: number; height: 0 | 1 | 2; width: 0 | 1 | 2; pattern: 0 | 1 | 2 | 3 | 4 | 5 };
/** The room's three heights are the record's heights 0, 3 and 6. The room's six patterns are the record's 0, 1, 2, 4, 5 and 6. */
const BLOB_HEIGHT = [0, 3, 6] as const;
const BLOB_PATTERN = [0, 1, 2, 4, 5, 6] as const;

/** A blob as a Round record: the body, the visor and the feet colours are the room's own twelve, the width is the build, the face is the visor bar. */
export function fromBlob(b: BlobPick): LookRecord {
  return { ...baseRecord("round"), skin: b.body, shoeColor: b.feet, visor: b.visor, height: BLOB_HEIGHT[b.height], build: b.width, pattern: BLOB_PATTERN[b.pattern] };
}

/** A Round record back to the blob's fields (what a room that has only the blob draws), or null when the record is not a Round with the room's own heights and patterns. */
export function toBlob(r: LookRecord): BlobPick | null {
  const h = BLOB_HEIGHT.indexOf(r.height as 0 | 3 | 6);
  const p = BLOB_PATTERN.indexOf(r.pattern as 0 | 1 | 2 | 4 | 5 | 6);
  if (r.base !== 1 || r.skin > 11 || r.shoeColor > 11 || r.visor > 11 || h < 0 || p < 0) return null;
  return { body: r.skin, visor: r.visor, feet: r.shoeColor, height: h as 0 | 1 | 2, width: r.build as 0 | 1 | 2, pattern: p as BlobPick["pattern"] };
}

