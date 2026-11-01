import type * as THREE from "three";
import type { BoneName } from "./skeleton.js";

// A layer over the pose: one function a character may carry, which its `update` calls each frame after the walk is solved and before the character's
// own bones (a tail, wings, long hair) follow, so they follow the layer's turns too. The emotes (`@nano133/nanoterra/emotes/player`) are such a layer:
// a clip blends over the bones the solver just turned. It is kept beside the character, not on it, so `Character` stays as it is. One layer a character.

/** What the pose did this frame: the step it took (s), its eased speed (m/s), whether it is in the air, and the reduced-motion setting. */
export type PoseFrame = { dt: number; speed: number; airborne: boolean; reducedMotion: boolean };
export type PoseLayer = (bones: Readonly<Record<BoneName, THREE.Bone>>, frame: PoseFrame) => void;

const layers = new WeakMap<object, PoseLayer>();

/** Gives a character its layer (null takes it off). */
export function setPoseLayer(character: object, layer: PoseLayer | null): void {
  if (layer) layers.set(character, layer);
  else layers.delete(character);
}

/** The character's layer, if it has one. */
export const poseLayerOf = (character: object): PoseLayer | undefined => layers.get(character);
