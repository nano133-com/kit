import * as THREE from "three";
import type { ExtraBone } from "./build.js";

// Parts that move bring their own bones (build.ts `bone`): a tail, a ponytail and long hair sway on a chain of springs, and wings flap. They
// hang under the avatar's own bones and join the skeleton after the island's 28; the avatar's solver never reads them (art/rig.ts keeps its
// own list), so the walk, the run, the wave and the swim work the same on every base, and these bones follow whatever the body does.

/** The chains: bone names in order, from the root of the part to its tip. A chain's bones sit one under the next. */
export const CHAINS = [
  ["hair1", "hair2", "hair3"],
  ["tail1", "tail2", "tail3"],
] as const;

type Chain = { bones: THREE.Bone[]; rest: THREE.Vector3[]; seg: number[]; s: THREE.Vector3[]; v: THREE.Vector3[]; q: THREE.Quaternion[]; ready: boolean; stiff: number; damp: number; gravity: number };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _r = new THREE.Quaternion();

/** The motion of a character's extra bones: `(dt, t, speed, calm)` once a frame, after the solver has set the avatar's bones. */
export type Mover = (dt: number, t: number, speed: number, calm: boolean) => void;

export function makeMover(bones: ReadonlyMap<string, THREE.Bone>, extras: readonly ExtraBone[], root: THREE.Object3D): Mover | null {
  const names = new Set(extras.map((e) => e.name));
  const chains: Chain[] = [];
  for (const names_ of CHAINS) {
    if (!names_.every((n) => names.has(n))) continue;
    const list = names_.map((n) => bones.get(n)!);
    const at = names_.map((n) => extras.find((e) => e.name === n)!.at);
    const rest = at.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const stiff = names_[0] === "tail1" ? 70 : 120;
    chains.push({
      bones: list,
      rest,
      seg: rest.slice(1).map((p, i) => p.distanceTo(rest[i])),
      s: rest.map((p) => p.clone()),
      v: rest.map(() => new THREE.Vector3()),
      q: rest.map(() => new THREE.Quaternion()),
      ready: false,
      stiff,
      damp: 7,
      gravity: 2.4,
    });
  }
  const wings = (["wing_L", "wing_R"] as const).filter((n) => names.has(n)).map((n) => ({ bone: bones.get(n)!, side: n === "wing_L" ? 1 : -1, base: bones.get(n)!.rotation.z }));
  if (!chains.length && !wings.length) return null;
  return (dt, t, speed, calm) => {
    if (wings.length) {
      const f = 2 * Math.PI * (calm ? 0 : 3 + Math.min(speed, 5) * 1.6);
      for (const w of wings) w.bone.rotation.z = w.base + (calm ? 0 : w.side * (0.1 + 0.4 * Math.sin(t * f)));
    }
    if (!chains.length) return;
    root.updateWorldMatrix(true, true);
    for (const ch of chains) stepChain(ch, dt, calm);
  };
}

/** One chain: the joints are particles in the world, pulled to where the parent's turn would hold them, with a little gravity. */
function stepChain(ch: Chain, dt: number, calm: boolean) {
  const first = ch.bones[0];
  const parent = first.parent!;
  // The parent's world turn, and the chain's first joint in the world.
  parent.getWorldQuaternion(_p);
  first.getWorldPosition(ch.s[0]);
  const n = ch.bones.length;
  const reset = !ch.ready || dt <= 0 || calm;
  let qPrev = _r.copy(_p);
  const qs = ch.q;
  for (let i = 0; i < n - 1; i++) {
    // Where joint i+1 would be if the chain kept its rest bend on the turn above it (the rest: each bone's offset from the one before).
    _a.copy(ch.rest[i + 1]).sub(ch.rest[i]).applyQuaternion(qPrev);
    const want = _b.copy(ch.s[i]).add(_a);
    if (reset) {
      ch.s[i + 1].copy(want);
      ch.v[i + 1].set(0, 0, 0);
    } else {
      const v = ch.v[i + 1];
      v.addScaledVector(_c.copy(want).sub(ch.s[i + 1]), ch.stiff * dt).multiplyScalar(Math.exp(-ch.damp * dt));
      v.y -= ch.gravity * dt;
      ch.s[i + 1].addScaledVector(v, dt);
      // The segment keeps its length.
      ch.s[i + 1].sub(ch.s[i]).setLength(ch.seg[i]).add(ch.s[i]);
    }
    // The bone turns its rest direction onto the way the segment now points.
    const restDir = _a.copy(ch.rest[i + 1]).sub(ch.rest[i]).normalize().applyQuaternion(qPrev);
    const dir = _c.copy(ch.s[i + 1]).sub(ch.s[i]).normalize();
    const turn = _q.setFromUnitVectors(restDir, dir);
    qs[i].copy(turn).multiply(qPrev);
    // The bone's own turn is its parent's inverse times the new world turn.
    const above = i === 0 ? _p : qs[i - 1];
    ch.bones[i].quaternion.copy(_q.copy(above).invert().multiply(qs[i]));
    qPrev = qs[i];
  }
  // The last bone follows the one before it.
  ch.bones[n - 1].quaternion.identity();
  ch.ready = true;
}
