import type { Native } from "../clothes.js";
import type { Ctx, HeadSpec } from "../ctx.js";
import type { Limbs } from "../limbs.js";

// What a base is: a body on the island's one skeleton. The bases share the joints, so the walk, the run, the wave and the swim play on every
// one; they differ in what is drawn round the joints. A base names its head (for the face, the hair and the hats), its torso's radius (for the
// cloth that stands off it), what it shows without clothes, and its own shapes.

export type BaseSpec = {
  head: HeadSpec;
  /** The torso's radius at a height, at the "regular" build. */
  torsoR: (y: number) => number;
  native: Native;
  limbs: Limbs;
  /** Where a hat sits: the hat frame's centre height (a Classic hat is built for 1.83) and its scale. */
  hat: { y: number; z?: number; s: readonly [number, number, number] };
  build(c: Ctx): void;
};
