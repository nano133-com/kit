import * as THREE from "three";
import { makeHandles, Solver, type Handle } from "./solver.js";
import { BONES, boneIndex, type BoneName } from "./skeleton.js";

// The island's walk, run, jump and idle (app/island/art/Avatar.tsx, the useFrame of nano133.com), driven by the game's own
// numbers instead of a place that the avatar reads each frame. The walk is the lower layer: the hips' bob and lean and the
// two ankles' marks (the legs' IK); the arms swing free; in the air the arms go out and the legs part. The numbers are the
// island's. The island reads a speed from the avatar's movement; here the game gives it.

/** The longest step `update` takes (s): a slow frame does not read as a fast walk. */
export const MAX_DT = 0.05;
/** How long a wave lasts, in seconds. */
export const WAVE_SECONDS = 1.8;
/** The island's art scale (app/island/ground.ts): the stride and the bob were tuned under a group scaled by it. */
const U = 0.75;
/** The fastest speed that the pose reads (m/s); the island caps it too. */
const MAX_SPEED = 9;

/** What the game says each frame. Every field may be left out. */
export type Motion = {
  /** The speed over the ground, in metres a second. The island walks at 3.75 and runs at 6.5. */
  speed?: number;
  /** True while the character is off the ground (a jump or a fall). */
  airborne?: boolean;
  /** The vertical speed, in metres a second, up is positive. It sets the size of the shadow in a jump. */
  verticalSpeed?: number;
};

export type PoseState = {
  /** The walk's phase (radians). */
  walk: number;
  /** The body's lean into the walk (radians), eased. */
  lean: number;
  /** The speed that the pose uses (m/s), eased towards the game's. */
  speed: number;
  /** An estimate of the height above the take-off place (m): the integral of the vertical speed while airborne. */
  up: number;
  /** Seconds since the wave started (Infinity: no wave). */
  waveAge: number;
  /** Whether the last update was airborne. */
  air: boolean;
};

const REST = (name: BoneName) => {
  const [, , x, y, z] = BONES[boneIndex(name)];
  return new THREE.Vector3(x, y, z);
};
const HIPS = REST("hips");
/** Each side's hip joint (from the hips) and ankle (from the hip joint), at rest. */
const LEG = {
  L: { hip: REST("thigh_L").sub(HIPS), ankle: REST("foot_L").sub(REST("thigh_L")) },
  R: { hip: REST("thigh_R").sub(HIPS), ankle: REST("foot_R").sub(REST("thigh_R")) },
};
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();

const turn = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** The walk's mark for one ankle: the leg swung `swing` about the hip (straight), under the hips as the handles place them. */
function ankleMark(foot: Handle, side: "L" | "R", swing: number, hips: Handle) {
  _q.setFromAxisAngle(X_AXIS, swing);
  foot.quaternion.copy(hips.quaternion).multiply(_q);
  foot.position.copy(LEG[side].ankle).applyQuaternion(_q).add(LEG[side].hip).applyQuaternion(hips.quaternion).add(HIPS).add(hips.position);
}

const finite = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * The pose of one character: its state, its handles and its solver. `scale()`: how many metres one unit of the character's own space is (the
 * height of its record and the object's scale), for the shadow, which lies on the ground under a jump.
 */
export function makePose(list: THREE.Bone[], b: Record<BoneName, THREE.Bone>, scale: () => number = () => 1) {
  const h = makeHandles();
  const solver = new Solver(list);
  const state: PoseState = { walk: 0, lean: 0, speed: 0, up: 0, waveAge: Infinity, air: false };

  /** Writes the pose for the state as it is, then solves it. `dt` is 0 for the first pose at rest. */
  function apply(dt: number, calm: boolean) {
    const air = state.air;
    const speed = state.speed;
    const moving = speed > 0.25;
    state.walk += dt * (speed / U) * 1.9;
    const amt = Math.min(1, speed / 3);
    const run = Math.min(1, Math.max(0, (speed - 3.4) / 1.6));
    const sw = moving && !calm ? Math.sin(state.walk) : 0;
    state.lean = turn(state.lean, moving ? (0.07 + 0.1 * run) * amt : 0, Math.min(1, dt * 10));
    // (The bob is as it showed while the skeleton was bound under a group scaled by U.)
    h.hips.position.set(0, moving && !calm ? Math.abs(Math.sin(state.walk)) * (0.06 + 0.04 * run) * amt * U : 0, 0);
    h.hips.quaternion.setFromAxisAngle(X_AXIS, state.lean);
    h.chest.quaternion.identity();
    ankleMark(h.footR, "R", air ? 0.4 : sw * (0.7 + 0.25 * run) * amt, h.hips);
    ankleMark(h.footL, "L", air ? -0.25 : -sw * (0.7 + 0.25 * run) * amt, h.hips);
    // The arms swing free: against the legs, out a little from the round body, a little bent at the elbow (more in a
    // run); out in a jump.
    const arm = (0.65 + 0.35 * run) * amt;
    const bend = air ? 0.3 : 0.12 + 0.2 * amt + 0.7 * run;
    b.upperarm_R.rotation.set(air ? 0 : -sw * arm, 0, air ? -0.95 : -0.2);
    b.upperarm_L.rotation.set(air ? 0 : sw * arm, 0, air ? 0.95 : 0.2);
    b.forearm_R.rotation.set(-bend, 0, 0);
    b.forearm_L.rotation.set(-bend, 0, 0);
    b.hand_R.rotation.set(0, 0, 0);
    b.hand_L.rotation.set(0, 0, 0);
    if (state.waveAge < WAVE_SECONDS) {
      b.upperarm_L.rotation.set(0, 0, 2.55 + (calm ? 0 : Math.sin(state.waveAge * 10) * 0.32));
      b.forearm_L.rotation.set(0, 0, 0);
    }
    solver.solve(h, -state.up / scale());
    // The blob shadow shrinks as the body rises (the island's rule), to a little over half.
    b.shadow.scale.setScalar(Math.max(0.55, 1 - state.up * 0.6));
  }

  return {
    state,
    handles: h,
    /** The first pose, at rest (idle), before any update. */
    rest(calm: boolean) {
      apply(0, calm);
    },
    /** One step of `dt` seconds (already capped) with the game's numbers. */
    step(dt: number, motion: Motion, calm: boolean) {
      const target = Math.min(Math.max(0, finite(motion.speed)), MAX_SPEED);
      state.speed += (target - state.speed) * Math.min(1, dt * 12);
      state.air = !!motion.airborne;
      state.up = state.air ? Math.max(0, state.up + finite(motion.verticalSpeed) * dt) : 0;
      state.waveAge += dt;
      apply(dt, calm);
    },
    wave() {
      state.waveAge = 0;
    },
  };
}
