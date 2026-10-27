// A copy of the island's torso twist (app/island/art/torso.ts), for the same reason as skeleton.ts.
import * as THREE from "three";
import type { BoneName } from "./skeleton.js";

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * The torso twists: the hips, then the spine, then the chest, by height (a point's y in the avatar's space). The shirt, the
 * belt's band and every cosmetic that rides the body (app/cosmetics/wear3d) use it, so a worn item turns with the shirt
 * under it. A bone or a blend of two ([first, second, the second's weight]).
 */
export const torsoWeights = (q: THREE.Vector3): [BoneName, BoneName, number] =>
  q.y < 0.82 ? ["hips", "spine", smooth(0.74, 0.82, q.y)] : q.y < 1 ? ["spine", "spine", 0] : ["spine", "chest", smooth(1, 1.26, q.y)];
