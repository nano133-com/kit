import { BASE_IDS, BODIES, BOTTOMS, BROWS, BUILDS, FACES, GLASSES, HAIRS, HAIR_STYLES, HEADS, HEIGHTS, PANTS, PATTERNS, SHIRTS, SHOE_STYLES, TOPS, TRIMS, VISORS, WEARS, shoeColors, type BaseId } from "./lists.js";
import { baseRecord, type LookRecord } from "./record.js";

// What an editor needs on top of the record: change the base and keep what still fits, and a dice that picks every part at random. Pure: the
// closed lists only. A random look is from the free lists (a shop hat or dye is not in the record), so it sells nothing.

const bar = FACES.indexOf("bar");
const none = { top: TOPS.indexOf("none"), bottom: BOTTOMS.indexOf("none"), hair: HAIR_STYLES.indexOf("bald") } as const;

/** The base a record is on, by name. */
export const baseOf = (rec: LookRecord): BaseId => BASE_IDS[rec.base];

/**
 * The same person on another base: the face, the brows, the sizes and the shoes stay; what the new base does not wear (hair, a top, a bottom, glasses,
 * freckles, blush) goes; the body colour and the feet start from the new base's own. A base that is not a person takes the Classic's clothes off.
 */
export function withBase(rec: LookRecord, base: BaseId): LookRecord {
  const wears = WEARS[base];
  const into = baseRecord(base);
  const top = wears.tops.includes(TOPS[rec.top] as never) ? rec.top : wears.tops.length ? TOPS.indexOf("shirt") : none.top;
  const bottom = wears.bottoms.includes(BOTTOMS[rec.bottom] as never) ? rec.bottom : wears.bottoms.length && base === "classic" ? BOTTOMS.indexOf("trousers") : none.bottom;
  // The bar of light is the Round's own face: another base gets a smile.
  const face = rec.face === bar && base !== "round" ? FACES.indexOf("cheerful") : rec.face;
  return {
    ...into,
    face,
    brows: rec.brows,
    blush: wears.blush ? rec.blush : 0,
    freckles: wears.freckles ? rec.freckles : 0,
    glasses: wears.glasses ? rec.glasses : 0,
    hair: rec.hair,
    // Hair stays on a Classic that stays one; a Classic that comes from another base starts with the bowl.
    hairStyle: wears.hair ? (rec.base === into.base ? rec.hairStyle : into.hairStyle) : none.hair,
    top,
    shirt: rec.shirt,
    bottom,
    pants: rec.pants,
    shoes: base === "classic" && rec.shoes === SHOE_STYLES.indexOf("bare") ? into.shoes : rec.shoes,
    pattern: wears.patterns.includes(PATTERNS[rec.pattern]) && (top !== none.top || base === "round") ? rec.pattern : 0,
    trim: rec.trim,
    visor: rec.visor,
    height: rec.height,
    build: rec.build,
    head: rec.head,
  };
}

/** One random record on `base` (any base when none is named), from the layers that base wears. The same generator gives the same record. */
export function diceRecord(rand: () => number, base: BaseId = BASE_IDS[Math.floor(rand() * BASE_IDS.length)]): LookRecord {
  const int = (n: number) => Math.floor(rand() * n);
  const wears = WEARS[base];
  const r = baseRecord(base);
  const topId = wears.tops.length ? wears.tops[int(wears.tops.length)] : "none";
  const top = TOPS.indexOf(topId);
  return {
    ...r,
    skin: int(BODIES[base].length),
    hair: int(HAIRS.length),
    hairStyle: wears.hair ? int(HAIR_STYLES.length) : none.hair,
    face: base === "round" && rand() < 0.5 ? bar : int(FACES.length - 1),
    brows: rand() < 0.4 ? 1 + int(BROWS.length - 1) : 0,
    blush: wears.blush && rand() < 0.3 ? 1 : 0,
    freckles: wears.freckles && rand() < 0.3 ? 1 : 0,
    glasses: wears.glasses && rand() < 0.25 ? 1 + int(GLASSES.length - 1) : 0,
    top,
    shirt: int(SHIRTS.length),
    bottom: wears.bottoms.length ? BOTTOMS.indexOf(wears.bottoms[int(wears.bottoms.length)]) : none.bottom,
    pants: int(PANTS.length),
    shoes: wears.shoes ? int(SHOE_STYLES.length) : SHOE_STYLES.indexOf("bare"),
    shoeColor: int(shoeColors(base).length),
    pattern: (topId !== "none" || base === "round") && rand() < 0.4 ? PATTERNS.indexOf(wears.patterns[1 + int(wears.patterns.length - 1)] ?? "none") : 0,
    trim: int(TRIMS.length),
    visor: int(VISORS.length),
    height: int(HEIGHTS.length),
    build: int(BUILDS.length),
    head: int(HEADS.length),
  };
}
