// A copy of the island's own skeleton (app/island/art/skeleton.ts), here so this folder imports three and nothing else. The dev page's check
// compares the two bone lists. When the character kit goes live, the island's file re-exports this one: one source.
import * as THREE from "three";

// The island's humanoid skeleton: one bone tree for any skin with
// these bone names (the Banano monkey's names, plus the clavicles, a grip, the saya, the weapon, the headband's two
// tails and the shadow). In the concept's units (2.2 tall), the avatar facing +Z: its RIGHT side is −X (anatomical
// names: hand_R is the avatar's right hand). Every rest turn is zero but the saya's and the weapon's, so the arms and
// legs hang straight down. The skin is bound at scale 1 and the parent scales the whole: a skeleton bound under a
// scaled group turns each bone about a point scaled with it (the old avatar's arms slid off its shoulders in a wave
// or a hop). The arms are long enough for two hands on a hilt in front of the round body: the shoulders 0.47 out,
// each arm 0.42 + 0.42 (every island avatar).

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

/** A bone's index in the skeleton (a vertex's `skinIndex`). */
export const boneIndex = (name: BoneName) => BONES.findIndex((b) => b[0] === name);

/** A frame from its X axis and a hint for −Y (the katana's: X toward the tip, −Y the edge). */
export function frameXY(x: THREE.Vector3, edge: THREE.Vector3, out = new THREE.Quaternion()) {
  const X = x.clone().normalize();
  const Y = edge.clone().multiplyScalar(-1);
  Y.addScaledVector(X, -Y.dot(X)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

/** The saya's axis at rest (the hips' space): back and down from its mouth (the koiguchi) at the left hip. */
export const SAYA_AXIS = new THREE.Vector3(0.12, -0.3, -0.95).normalize();
/** The two bones with a rest turn: the saya (its axis, its edge side up) and the weapon (the katana held up). */
const REST_TURN: Partial<Record<BoneName, () => THREE.Quaternion>> = {
  saya: () => frameXY(SAYA_AXIS, new THREE.Vector3(0, 1, 0)),
  weapon: () => frameXY(new THREE.Vector3(0, 0.4, 1), new THREE.Vector3(0, -1, 0.4)),
};

/** New bones, each under its parent at its rest place: the list (the skeleton's order) and each by name. */
export function makeBones() {
  const byName = {} as Record<BoneName, THREE.Bone>;
  const list = BONES.map(([name, parent, x, y, z]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    const p = parent ? BONES[boneIndex(parent)] : null;
    bone.position.set(x - (p?.[2] ?? 0), y - (p?.[3] ?? 0), z - (p?.[4] ?? 0));
    const turn = REST_TURN[name];
    if (turn) bone.quaternion.copy(turn());
    if (parent) byName[parent].add(bone);
    byName[name] = bone;
    return bone;
  });
  return { list, byName };
}
