import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createCharacter, WAVE_SECONDS, type Character, type Motion } from "../src/index.js";

const DT = 1 / 60;
const bonesOf = (c: Character) => {
  const b: Record<string, THREE.Bone> = {};
  c.object.traverse((o) => {
    if ((o as THREE.Bone).isBone) b[o.name] = o as THREE.Bone;
  });
  return b;
};
/** Every bone's place and turn, as one list of numbers. */
const pose = (c: Character) => Object.values(bonesOf(c)).flatMap((b) => [...b.position.toArray(), ...b.quaternion.toArray()]);
const apart = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const run = (c: Character, seconds: number, m: Motion) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) c.update(DT, m);
};
/** The most that `read` gives over a stretch of walking, and the least. */
const swing = (c: Character, seconds: number, m: Motion, read: () => number) => {
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    c.update(DT, m);
    hi = Math.max(hi, read());
    lo = Math.min(lo, read());
  }
  return { hi, lo };
};

test("idle, walk, run and jump are four different poses", () => {
  const poses: Record<string, number[]> = {};
  for (const [name, m] of [["idle", {}], ["walk", { speed: 3.75 }], ["run", { speed: 6.5 }], ["jump", { airborne: true, verticalSpeed: 3 }]] as const) {
    const c = createCharacter();
    run(c, 1.2, m);
    poses[name] = pose(c);
    c.dispose();
  }
  const names = Object.keys(poses);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) assert.ok(apart(poses[names[i]], poses[names[j]]) > 0.05, `${names[i]} is not ${names[j]}`);
  }
});

test("idle is the island's idle: arms 0.2 rad out, elbows bent 0.12, hips at rest", () => {
  const c = createCharacter();
  run(c, 0.5, {});
  const b = bonesOf(c);
  assert.ok(Math.abs(b.upperarm_L.rotation.z - 0.2) < 1e-9);
  assert.ok(Math.abs(b.upperarm_R.rotation.z + 0.2) < 1e-9);
  assert.ok(Math.abs(b.forearm_L.rotation.x + 0.12) < 1e-9);
  assert.ok(Math.abs(b.forearm_R.rotation.x + 0.12) < 1e-9);
  assert.ok(Math.abs(b.hips.position.y - 0.72) < 1e-9);
  // it stands without an update too: the first pose is the idle pose
  const fresh = createCharacter();
  assert.ok(apart(pose(fresh), pose(c)) < 1e-9);
  c.dispose();
  fresh.dispose();
});

test("a walk swings the arms against the legs, a run swings them further and bends the elbows more", () => {
  const walk = createCharacter();
  const wb = bonesOf(walk);
  run(walk, 1, { speed: 3.75 });
  const w = swing(walk, 1.5, { speed: 3.75 }, () => wb.upperarm_L.rotation.x);
  // the island's numbers at 3.75 m/s: swing (0.65 + 0.35 * run) with run = (3.75 - 3.4) / 1.6
  const run1 = (3.75 - 3.4) / 1.6;
  assert.ok(Math.abs(w.hi - (0.65 + 0.35 * run1)) < 0.01, `the left arm swings to ${w.hi}`);
  assert.ok(Math.abs(w.lo + (0.65 + 0.35 * run1)) < 0.01);
  assert.ok(Math.abs(wb.forearm_L.rotation.x + (0.12 + 0.2 + 0.7 * run1)) < 1e-9, "elbow bend");
  // the right arm swings the other way, the legs against the arms
  walk.update(DT, { speed: 3.75 });
  assert.ok(Math.abs(wb.upperarm_R.rotation.x + wb.upperarm_L.rotation.x) < 1e-9);
  assert.ok(Math.abs(wb.forearm_L.rotation.x - wb.forearm_R.rotation.x) < 1e-9);
  walk.dispose();

  const fast = createCharacter();
  const fb = bonesOf(fast);
  run(fast, 1, { speed: 6.5 });
  const r = swing(fast, 1.5, { speed: 6.5 }, () => fb.upperarm_L.rotation.x);
  assert.ok(Math.abs(r.hi - 1) < 0.02 && Math.abs(r.lo + 1) < 0.02, `a full run swings the arms 1 rad: ${r.hi} ${r.lo}`);
  assert.ok(Math.abs(fb.forearm_L.rotation.x + 1.02) < 1e-9, "a full run bends the elbow 1.02 rad");
  fast.dispose();
});

test("the hips bob with each step, more in a run (the island's 0.06 and 0.1, times its 0.75 art scale)", () => {
  const walk = createCharacter();
  const wb = bonesOf(walk);
  run(walk, 1, { speed: 3 });
  const w = swing(walk, 1.5, { speed: 3 }, () => wb.hips.position.y);
  assert.ok(Math.abs(w.lo - 0.72) < 4e-3);
  assert.ok(Math.abs(w.hi - (0.72 + 0.06 * 0.75)) < 2e-3, `bob ${w.hi - 0.72}`);
  const fast = createCharacter();
  const fb = bonesOf(fast);
  run(fast, 1, { speed: 6.5 });
  const r = swing(fast, 1.5, { speed: 6.5 }, () => fb.hips.position.y);
  assert.ok(Math.abs(r.hi - (0.72 + 0.1 * 0.75)) < 3e-3, `bob ${r.hi - 0.72}`);
  walk.dispose();
  fast.dispose();
});

test("the stride follows the speed: the same legs swing faster at a faster speed", () => {
  const cycles = (speed: number) => {
    const c = createCharacter();
    const b = bonesOf(c);
    run(c, 1, { speed });
    let crossings = 0;
    let last = b.upperarm_L.rotation.x;
    for (let i = 0; i < 300; i++) {
      c.update(DT, { speed });
      const x = b.upperarm_L.rotation.x;
      if (last < 0 && x >= 0) crossings++;
      last = x;
    }
    c.dispose();
    return crossings;
  };
  // 1.9 rad of walk phase a second for each 0.75 m/s: 5 s at 3.75 m/s is 9.5 rad a second
  assert.ok(Math.abs(cycles(3.75) - (3.75 / 0.75) * 1.9 * 5 / (2 * Math.PI)) <= 1);
  assert.ok(cycles(6.5) > cycles(3.75));
});

test("a jump puts the arms out and parts the legs, whatever the speed", () => {
  for (const speed of [0, 6.5]) {
    const c = createCharacter();
    const b = bonesOf(c);
    run(c, 1, { speed });
    c.update(DT, { speed, airborne: true, verticalSpeed: 3 });
    assert.ok(Math.abs(b.upperarm_R.rotation.z + 0.95) < 1e-9);
    assert.ok(Math.abs(b.upperarm_L.rotation.z - 0.95) < 1e-9);
    assert.equal(b.upperarm_L.rotation.x, 0);
    assert.ok(Math.abs(b.forearm_L.rotation.x + 0.3) < 1e-9);
    // the right foot forward-up, the left back: the foot turns with the island's marks (0.4 and -0.25 about the hips' lean)
    const lean = new THREE.Euler().setFromQuaternion(b.hips.quaternion).x;
    c.object.updateMatrixWorld(true);
    const foot = (n: string) => new THREE.Euler().setFromQuaternion(b[n].getWorldQuaternion(new THREE.Quaternion())).x;
    assert.ok(Math.abs(foot("foot_R") - (lean + 0.4)) < 1e-6, `foot_R ${foot("foot_R")}`);
    assert.ok(Math.abs(foot("foot_L") - (lean - 0.25)) < 1e-6, `foot_L ${foot("foot_L")}`);
    // and back on the ground at once: the island does not ease the pose
    run(c, 0.5, { speed: 0 });
    assert.ok(Math.abs(b.upperarm_L.rotation.z - 0.2) < 1e-9);
    c.dispose();
  }
});

test("the speed eases: a stop is not a snap, and 0.4 s is enough to settle", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  run(c, 1, { speed: 6.5 });
  c.update(DT, { speed: 0 });
  assert.ok(b.forearm_L.rotation.x < -0.9, "one frame after a stop the elbows are still bent");
  run(c, 0.6, { speed: 0 });
  assert.ok(Math.abs(b.forearm_L.rotation.x + 0.12) < 0.02);
  c.dispose();
});

test("the leaning: the body leans into a run and comes back", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  const lean = () => new THREE.Euler().setFromQuaternion(b.hips.quaternion).x;
  run(c, 1.5, { speed: 6.5 });
  assert.ok(Math.abs(lean() - 0.17) < 0.01, `lean ${lean()}`);
  run(c, 1.5, {});
  assert.ok(Math.abs(lean()) < 0.01);
  c.dispose();
});

test("update takes the game's numbers as they are: a bad number is no motion, a long frame is 0.05 s", () => {
  const a = createCharacter();
  const b = createCharacter();
  for (let i = 0; i < 30; i++) {
    a.update(0.05, { speed: 6.5 });
    b.update(1.5, { speed: 6.5 }); // a frame of 1.5 s counts as 0.05 s
  }
  assert.ok(apart(pose(a), pose(b)) < 1e-12);
  const c = createCharacter();
  const rest = pose(c);
  for (const dt of [0, -1, NaN, Infinity * 0]) c.update(dt, { speed: 6.5 });
  assert.ok(apart(pose(c), rest) < 1e-12, "dt of 0, negative or NaN does nothing");
  c.update(DT, { speed: NaN, airborne: false, verticalSpeed: NaN });
  c.update(DT, { speed: -4 });
  c.update(DT, { speed: Infinity });
  c.update(DT, null as never);
  c.update(DT);
  assert.ok(pose(c).every(Number.isFinite), "no NaN gets into a bone");
  // an enormous speed is the island's cap, 9 m/s: the same as 9
  const d = createCharacter();
  const e = createCharacter();
  run(d, 1, { speed: 9 });
  run(e, 1, { speed: 5000 });
  assert.ok(apart(pose(d), pose(e)) < 1e-12);
  for (const x of [a, b, c, d, e]) x.dispose();
});

test("the wave lifts the left arm for 1.8 s, then it is over", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  run(c, 0.3, {});
  assert.ok(Math.abs(b.upperarm_L.rotation.z - 0.2) < 1e-9);
  c.wave();
  c.update(DT, {});
  assert.ok(b.upperarm_L.rotation.z > 2.2 && b.upperarm_L.rotation.z < 2.9, `arm up: ${b.upperarm_L.rotation.z}`);
  assert.equal(b.forearm_L.rotation.x, 0);
  assert.ok(Math.abs(b.upperarm_R.rotation.z + 0.2) < 1e-9, "the right arm does not wave");
  const seen: number[] = [];
  for (let i = 0; i < Math.round(WAVE_SECONDS / DT) - 5; i++) {
    c.update(DT, {});
    seen.push(b.upperarm_L.rotation.z);
  }
  assert.ok(Math.max(...seen) - Math.min(...seen) > 0.3, "the hand waves");
  assert.equal(WAVE_SECONDS, 1.8);
  run(c, 0.3, {});
  assert.ok(Math.abs(b.upperarm_L.rotation.z - 0.2) < 1e-9, "the wave ended");
  c.dispose();
});

test("reduced motion: no swing, no bob, a still wave", () => {
  const c = createCharacter({ reducedMotion: true });
  const b = bonesOf(c);
  assert.equal(c.reducedMotion, true);
  run(c, 1, { speed: 6.5 });
  assert.equal(b.upperarm_L.rotation.x, 0);
  assert.equal(b.hips.position.y, 0.72);
  assert.ok(Math.abs(b.forearm_L.rotation.x + 1.02) < 1e-9, "the pose still shows the pace (elbows bent), not a swing");
  c.wave();
  c.update(DT, {});
  const a = b.upperarm_L.rotation.z;
  c.update(DT, {});
  assert.equal(b.upperarm_L.rotation.z, a);
  assert.equal(a, 2.55);
  c.reducedMotion = false;
  run(c, 0.4, { speed: 6.5 });
  assert.ok(Math.abs(b.upperarm_L.rotation.x) > 0 || Math.abs(b.hips.position.y - 0.72) > 0);
  c.dispose();
});

test("the shadow shrinks in a jump (to 0.55) and is whole on the ground", () => {
  const c = createCharacter();
  c.update(DT, {});
  assert.equal(c.shadow.scale.x, 1);
  // 3 m/s up for 1/6 s is 0.5 m: 1 - 0.5 * 0.6
  for (let i = 0; i < 10; i++) c.update(DT, { airborne: true, verticalSpeed: 3 });
  assert.ok(Math.abs(c.shadow.scale.x - (1 - 0.5 * 0.6)) < 0.01, `shadow ${c.shadow.scale.x}`);
  for (let i = 0; i < 120; i++) c.update(DT, { airborne: true, verticalSpeed: 3 });
  assert.equal(c.shadow.scale.x, 0.55);
  assert.equal(c.shadow.scale.y, 0.55);
  c.update(DT, { airborne: false });
  assert.equal(c.shadow.scale.x, 1);
  // a fall off a ledge (down) does not shrink the shadow below its size
  for (let i = 0; i < 30; i++) c.update(DT, { airborne: true, verticalSpeed: -8 });
  assert.equal(c.shadow.scale.x, 1);
  c.dispose();
});

test("update keeps the shadow under the character: its x and z, its own y, the object's size", () => {
  const c = createCharacter();
  c.object.position.set(3, 1.5, -4);
  c.shadow.position.y = 0.25;
  c.update(DT, {});
  assert.deepEqual(c.shadow.position.toArray(), [3, 0.25, -4], "x and z follow the object; y is the game's");
  assert.equal(c.shadow.scale.x, 1);
  c.object.scale.setScalar(0.5);
  c.update(DT, {});
  assert.equal(c.shadow.scale.x, 0.5, "a smaller character has a smaller shadow");
  for (let i = 0; i < 120; i++) c.update(DT, { airborne: true, verticalSpeed: 3 });
  assert.equal(c.shadow.scale.x, 0.55 * 0.5);
  c.object.position.set(-1, 0, 2);
  c.update(0, {});
  assert.deepEqual([c.shadow.position.x, c.shadow.position.z], [-1, 2], "even a frame of no time moves the shadow");
  c.dispose();
});

test("the solver keeps every bone's world place on the skeleton: the feet reach their marks", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  run(c, 1, { speed: 3.75 });
  c.object.updateMatrixWorld(true);
  const ankle = new THREE.Vector3();
  for (const side of ["L", "R"]) {
    b[`foot_${side}`].getWorldPosition(ankle);
    // the ankle stays near the floor and inside the leg's length from the hip (0.56 - 0.11 plus a little)
    assert.ok(ankle.y > -0.1 && ankle.y < 0.9, `ankle ${side} at ${ankle.y}`);
    const hip = new THREE.Vector3();
    b[`thigh_${side}`].getWorldPosition(hip);
    assert.ok(hip.distanceTo(ankle) < 0.5 + 0.6, "the leg is not stretched");
  }
  c.dispose();
});
