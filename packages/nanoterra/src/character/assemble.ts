import * as THREE from "three";
import type { Made } from "./make.js";
import { makeMover, type Mover } from "./motion.js";
import { BONES, makeBones } from "./skeleton.js";

// A character's skinned meshes on the island's skeleton. The host brings the two materials (a toon material with vertex colours, and the
// ink's hull material) and its own solver for the 28 bones; this puts the bones together (the 28, then the character's own), binds ONE skinned
// toon mesh and ONE skinned ink mesh to them, and makes the function that turns the character's own bones.

/** The avatar's bound for the frustum test, in the avatar's own space (its feet at the origin): 3 m round a point 1 m up. */
const CULL_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);

export function assemble(made: Made, mats: { toon: THREE.Material; ink: THREE.Material }) {
  const { list, byName } = makeBones();
  // The character's own bones: each under its parent (an avatar bone, or an earlier extra one), at its rest place.
  const named = new Map<string, THREE.Bone>(list.map((b) => [b.name, b]));
  const placeOf = new Map<string, readonly number[]>(BONES.map((b) => [b[0] as string, [b[2], b[3], b[4]]]));
  const extraBones = made.extra.map((e) => {
    const bone = new THREE.Bone();
    bone.name = e.name;
    const at = placeOf.get(e.parent)!;
    bone.position.set(e.at[0] - at[0], e.at[1] - at[1], e.at[2] - at[2]);
    // Where it rests, for a part that moves about its place (a buddy that floats, a pack's strap): the island's wear bones keep this too.
    bone.userData.rest = bone.position.clone();
    named.get(e.parent)!.add(bone);
    named.set(e.name, bone);
    placeOf.set(e.name, e.at);
    return bone;
  });
  const mesh = new THREE.SkinnedMesh(made.body, mats.toon);
  const hullMesh = new THREE.SkinnedMesh(made.hull, mats.ink);
  mesh.add(byName.root);
  const group = new THREE.Group();
  group.add(mesh, hullMesh);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(extraBones.length ? [...list, ...extraBones] : list);
  mesh.bind(skeleton);
  hullMesh.bind(skeleton);
  // It moves every frame, so three's own bound (the bind pose) is stale: a fixed sphere holds every pose.
  mesh.boundingSphere = hullMesh.boundingSphere = CULL_SPHERE;
  const mover: Mover | null = makeMover(named, made.extra, group);
  return { group, mesh, hullMesh, skeleton, list, bones: byName, named, mover };
}
export type Assembled = ReturnType<typeof assemble>;
