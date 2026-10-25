import * as THREE from "three";
import { BONES, boneIndex } from "./skeleton.js";

// The solver of the island's skeleton (app/island/art/rig.ts of nano133.com), reduced to what the walk, the run, the
// jump and the idle need. A pose does not turn the bones one by one: it moves a few HANDLES in the avatar's space (the
// hips, the chest, the two feet), and each frame the solver turns them into bone turns. The spine takes half the chest's
// turn, and two-bone IK puts both ankles on their marks. The arms are not solved: the pose gives each arm bone its own
// turn. The IK reads each bone's REST direction, so any skin with the island's bone names works.
//
// Left out on purpose: the katana's grip and its two-handed IK, the saya, the eyes' focus, the headband's springs.

/** What a pose moves: the island's handles, as plain places and turns. */
export type Handle = { position: THREE.Vector3; quaternion: THREE.Quaternion };
export type Handles = { hips: Handle; chest: Handle; footL: Handle; footR: Handle };

export function makeHandles(): Handles {
  const h = (): Handle => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
  return { hips: h(), chest: h(), footL: h(), footR: h() };
}

const I = boneIndex;
const REST = BONES.map(([, , x, y, z]) => new THREE.Vector3(x, y, z));
const ID = new THREE.Quaternion();
/** A leg's knee folds the shin back: the rest bend's normal is +X. */
const LEG_BEND = new THREE.Vector3(1, 0, 0);

// Scratch values (one solver runs at a time: a frame's work never awaits).
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const v6 = new THREE.Vector3();
const v7 = new THREE.Vector3();
const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();

/** The turn that takes the frame (a direction, a normal) onto another: a bone's rest onto its pose. */
function align(from: THREE.Vector3, fromN: THREE.Vector3, to: THREE.Vector3, toN: THREE.Vector3, out: THREE.Quaternion) {
  m1.makeBasis(from, fromN, v6.crossVectors(from, fromN));
  m2.makeBasis(to, toN, v7.crossVectors(to, toN));
  return out.setFromRotationMatrix(m2.multiply(m1.transpose()));
}

/** Each bone's place and turn in the avatar's space, worked out down the tree as it goes (no matrixWorld). */
export class Solver {
  private readonly P = BONES.map(() => new THREE.Vector3());
  private readonly Q = BONES.map(() => new THREE.Quaternion());
  /** Each bone's rest turn in the avatar's space: the product of the rest turns up the tree. */
  private readonly Q0: THREE.Quaternion[];
  private readonly parent = BONES.map(([, p]) => (p ? I(p) : -1));

  constructor(private readonly bones: THREE.Bone[]) {
    this.Q0 = bones.map((_, i) => {
      const q = new THREE.Quaternion();
      for (let j = i; j >= 0; j = this.parent[j]) q.premultiply(bones[j].quaternion);
      return q;
    });
  }

  /** Sets bone i's turn in the avatar's space (its own turn is its parent's inverse times it) and works out its place. */
  private setQ(i: number, q: THREE.Quaternion) {
    const p = this.parent[i];
    const bone = this.bones[i];
    if (p < 0) bone.quaternion.copy(q);
    else bone.quaternion.copy(q3.copy(this.Q[p]).invert().multiply(q));
    this.Q[i].copy(q);
    if (p >= 0) this.P[i].copy(bone.position).applyQuaternion(this.Q[p]).add(this.P[p]);
    else this.P[i].copy(bone.position);
  }
  /** Bone i keeps its rest turn on its parent. */
  private follow(i: number) {
    const p = this.parent[i];
    this.setQ(i, q1.copy(this.Q[p]).multiply(q2.copy(this.Q0[p]).invert()).multiply(this.Q0[i]));
  }
  /** Bone i keeps the turn the caller gave it (the free arms): only its place and turn are worked out. */
  private keep(i: number) {
    const p = this.parent[i];
    this.Q[i].copy(this.Q[p]).multiply(this.bones[i].quaternion);
    this.P[i].copy(this.bones[i].position).applyQuaternion(this.Q[p]).add(this.P[p]);
  }

  /**
   * Two-bone IK: bones a (upper) and b (lower) reach the end bone c to `target`, the middle joint bending toward
   * `pole`. From the bones' rest directions, so any rest pose works.
   */
  private twoBone(a: number, b: number, c: number, target: THREE.Vector3, pole: THREE.Vector3, restBend: THREE.Vector3) {
    const la = REST[b].distanceTo(REST[a]);
    const lb = REST[c].distanceTo(REST[b]);
    const S = this.P[a];
    const d = v1.copy(target).sub(S);
    const dist = d.length();
    const reach = Math.min(Math.max(dist, Math.abs(la - lb) + 1e-3), (la + lb) * 0.9995);
    d.normalize();
    const p = v2.copy(pole).addScaledVector(d, -pole.dot(d));
    if (p.lengthSq() < 1e-8) p.set(0, -1, 0).addScaledVector(d, d.y);
    p.normalize();
    const cosA = (la * la + reach * reach - lb * lb) / (2 * la * reach);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // The knee E and the end T; each bone turns its rest (direction, bend normal) onto the new one.
    const E = v3.copy(S).addScaledVector(d, la * cosA).addScaledVector(p, la * sinA);
    const dirB = v4.copy(S).addScaledVector(d, reach).sub(E).normalize();
    const dirA = E.sub(S).normalize();
    const nrm = v5.crossVectors(dirA, dirB);
    if (nrm.lengthSq() < 1e-8) nrm.crossVectors(dirA, p).negate();
    nrm.normalize();
    for (const [i, j, dir] of [[a, b, dirA], [b, c, dirB]] as const) {
      const rest = v1.copy(REST[j]).sub(REST[i]).normalize();
      const restN = v2.copy(restBend).addScaledVector(rest, -restBend.dot(rest)).normalize();
      this.setQ(i, align(rest, restN, dir, nrm, q1).multiply(this.Q0[i]));
    }
  }

  /** One frame: reads the handles and turns every bone. The arm bones keep the turns the caller gave them. */
  solve(h: Handles) {
    const B = this.bones;
    const bone = I;
    // The root, the hips (their offset and turn), the spine and the chest (the chest's turn shared out), the neck.
    this.setQ(bone("root"), ID);
    B[bone("hips")].position.copy(REST[bone("hips")]).add(h.hips.position);
    this.setQ(bone("hips"), q1.copy(h.hips.quaternion).multiply(this.Q0[bone("hips")]));
    q2.identity().slerp(h.chest.quaternion, 0.5);
    this.setQ(bone("spine"), q1.copy(this.Q[bone("hips")]).multiply(q2).multiply(this.Q0[bone("spine")]));
    this.setQ(bone("chest"), q1.copy(this.Q[bone("hips")]).multiply(h.chest.quaternion).multiply(this.Q0[bone("chest")]));
    this.follow(bone("neck"));
    this.follow(bone("head"));

    // The saya and the weapon bones carry no vertices here. They stay where the island leaves a katana in its saya.
    this.follow(bone("saya"));
    this.setQ(bone("weapon"), this.Q[bone("saya")]);
    B[bone("weapon")].position.copy(this.P[bone("saya")]);
    this.P[bone("weapon")].copy(this.P[bone("saya")]);

    for (const s of ["L", "R"] as const) {
      this.follow(bone(`clavicle_${s}`));
      for (const b of [`upperarm_${s}`, `forearm_${s}`, `hand_${s}`] as const) this.keep(bone(b));
    }
    this.follow(bone("grip_R"));

    // The legs: the thigh and the shin reach the ankle, the knee bends over the toes, the foot turns with its handle.
    for (const [side, f] of [["L", h.footL], ["R", h.footR]] as const) {
      this.follow(bone(`thigh_${side}`));
      const pole = v7.set(0, 0, 1).applyQuaternion(f.quaternion).add(v1.set(side === "L" ? 0.15 : -0.15, 0, 0));
      this.twoBone(bone(`thigh_${side}`), bone(`shin_${side}`), bone(`foot_${side}`), f.position, pole.clone(), LEG_BEND);
      this.setQ(bone(`foot_${side}`), q1.copy(f.quaternion).multiply(this.Q0[bone(`foot_${side}`)]));
    }
    // The shadow bone (the island's shadow is on it; here the shadow is a mesh of its own) stays on the ground under the hips.
    B[bone("shadow")].position.set(this.P[bone("hips")].x, 0, this.P[bone("hips")].z);
    this.setQ(bone("shadow"), ID);

    // The headband's bones hold their rest turn (no springs here).
    for (const s of ["L", "R"] as const) {
      this.follow(bone(`band_${s}1`));
      this.follow(bone(`band_${s}2`));
    }
  }
}
