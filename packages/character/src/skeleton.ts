import * as THREE from "three";

// The island's humanoid skeleton (app/island/art/skeleton.ts of nano133.com): one bone tree with these names, in
// the island's units (the avatar is about 2.3 tall), facing +Z. Its RIGHT side is -X (anatomical names: hand_R is
// the avatar's right hand). Every rest turn is zero, so the arms and the legs hang straight down. The skin is bound
// at scale 1: each bone turns about its own joint.
//
// The names are the island's, all of them, so a skin or a worn item made for the island's skeleton binds here. The
// saya, weapon, grip and band bones (the katana and the headband of the island's dojo look) are in the tree but carry no
// vertices in this package, and the saya and the weapon keep no rest turn.

/** Each bone: its name, its parent (before it in the list), and its rest place in the avatar's space. */
export const BONES = [
  ["root", null, 0, 0, 0],
  ["hips", "root", 0, 0.72, 0],
  ["spine", "hips", 0, 0.86, 0],
  ["chest", "spine", 0, 1.12, 0],
  ["neck", "chest", 0, 1.42, 0],
  ["head", "neck", 0, 1.5, 0],
  ["clavicle_L", "chest", 0.1, 1.33, 0],
  ["upperarm_L", "clavicle_L", 0.47, 1.32, 0],
  ["forearm_L", "upperarm_L", 0.47, 0.9, 0],
  ["hand_L", "forearm_L", 0.47, 0.48, 0],
  ["clavicle_R", "chest", -0.1, 1.33, 0],
  ["upperarm_R", "clavicle_R", -0.47, 1.32, 0],
  ["forearm_R", "upperarm_R", -0.47, 0.9, 0],
  ["hand_R", "forearm_R", -0.47, 0.48, 0],
  ["grip_R", "hand_R", -0.47, 0.48, 0],
  ["thigh_L", "hips", 0.19, 0.56, 0],
  ["shin_L", "thigh_L", 0.19, 0.335, 0],
  ["foot_L", "shin_L", 0.19, 0.11, 0],
  ["thigh_R", "hips", -0.19, 0.56, 0],
  ["shin_R", "thigh_R", -0.19, 0.335, 0],
  ["foot_R", "shin_R", -0.19, 0.11, 0],
  ["saya", "hips", 0.32, 0.8, 0.38],
  ["weapon", "root", 0, 1.0, 0.6],
  ["band_L1", "head", 0.06, 1.93, -0.45],
  ["band_L2", "band_L1", 0.1, 1.74, -0.53],
  ["band_R1", "head", -0.06, 1.93, -0.45],
  ["band_R2", "band_R1", -0.1, 1.74, -0.53],
  ["shadow", "root", 0, 0, 0],
] as const;
export type BoneName = (typeof BONES)[number][0];

/** The bone names, in the skeleton's order. */
export const BONE_NAMES: readonly BoneName[] = BONES.map((b) => b[0]);

const INDEX = new Map<BoneName, number>(BONES.map((b, i) => [b[0], i]));

/** A bone's index in the skeleton (a vertex's `skinIndex`). */
export const boneIndex = (name: BoneName): number => INDEX.get(name)!;

/** New bones, each under its parent at its rest place: the list (the skeleton's order) and each by name. */
export function makeBones() {
  const byName = {} as Record<BoneName, THREE.Bone>;
  const list = BONES.map(([name, parent, x, y, z]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    const p = parent ? BONES[boneIndex(parent)] : null;
    bone.position.set(x - (p?.[2] ?? 0), y - (p?.[3] ?? 0), z - (p?.[4] ?? 0));
    if (parent) byName[parent].add(bone);
    byName[name] = bone;
    return bone;
  });
  return { list, byName };
}
