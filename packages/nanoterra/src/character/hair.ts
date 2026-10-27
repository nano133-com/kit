import * as THREE from "three";
import { G, mtx } from "./kit.js";
import type { Ctx } from "./ctx.js";
import type { HairStyle } from "./lists.js";

// Hair for the Classic base (the other bases have a head-top of their own: ears, antennae, an antenna, a crown of leaves, and wear no hair). Each style
// is a few shapes on the head bone, built in layers a hat can hide (ctx.ts HairFit): the cap (the scalp), the top (spikes, buns, curls above the
// head) and the hang (a tail and long hair, on bones of their own that sway; motion.ts). All sit on a head of radius 0.42 at y 1.8 (the head's own
// size scales them). `bowl` is today's avatar, shape for shape.

/** The chain bones of hair that hangs: from the head, down and back. Each is [name, x, y, z] at rest (the avatar's space). */
export const TAIL_BONES = ["hair1", "hair2", "hair3"] as const;

const sph = (r: number, w = 16, h = 8, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);

/** The cap: today's bowl (a hemisphere tipped back and a back half down to the neck). */
function bowl(c: Ctx) {
  if (!c.fit.hideCap) c.addHead(sph(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), mtx(0, 1.83, -0.03, -0.12), "hair");
  // The back of the head: the hair goes down to the neck (the camera behind sees it). The back half only (z < 0).
  c.addHead(sph(0.44, 16, 10, Math.PI, Math.PI, 0, Math.PI * 0.86), mtx(0, 1.8, -0.02), "hair");
}

/** A close cap with a short fringe and short sides (no hang). */
function short(c: Ctx) {
  if (!c.fit.hideCap) c.addHead(sph(0.44, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), mtx(0, 1.82, -0.02), "hair");
  // A fringe over the forehead (above the eyebrows), and the sides and back down past the ears.
  c.addHead(sph(0.435, 14, 6, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.3, Math.PI * 0.11), mtx(0, 1.81, 0.005), "hair");
  c.addHead(sph(0.43, 16, 8, Math.PI, Math.PI, 0, Math.PI * 0.62), mtx(0, 1.8, -0.015), "hair");
}

/** A cap and a ring of cones that point out and up. */
function spikes(c: Ctx) {
  if (!c.fit.hideCap) c.addHead(sph(0.44, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), mtx(0, 1.82, -0.02, -0.1), "hair");
  c.addHead(sph(0.43, 14, 8, Math.PI, Math.PI, 0, Math.PI * 0.62), mtx(0, 1.8, -0.015), "hair");
  if (c.fit.hideTop) return;
  const base = new THREE.Vector3(0, 1.83, -0.03);
  const ring = [
    [0, 0.0, 0.28],
    [0.9, 0.5, 0.3],
    [-0.9, 0.5, 0.3],
    [1.8, 0.55, 0.28],
    [-1.8, 0.55, 0.28],
    [2.7, 0.5, 0.27],
    [-2.7, 0.5, 0.27],
    [3.14, 0.6, 0.3],
    [0.45, 1.0, 0.36],
    [-0.45, 1.0, 0.36],
    [1.4, 0.95, 0.36],
    [-1.4, 0.95, 0.36],
    [2.4, 0.9, 0.34],
    [-2.4, 0.9, 0.34],
  ] as const;
  for (const [az, el, len] of ring) {
    // A direction at azimuth `az` (from +Z toward +X) and `el` from straight up (0 is up).
    const phi = el * 0.9;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.sin(az), Math.cos(phi), Math.sin(phi) * Math.cos(az));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const at = base.clone().addScaledVector(dir, 0.42 + len * 0.3);
    c.addHead(G.cone8, new THREE.Matrix4().compose(at, q, new THREE.Vector3(0.1, len, 0.1)), "hair");
  }
}

/** The tail starts at the back of the head and hangs on the hair bones. */
function chain(c: Ctx, from: readonly [number, number, number], step: readonly [number, number, number]) {
  const pts = TAIL_BONES.map((_, i) => [from[0] + step[0] * i, from[1] + step[1] * i, from[2] + step[2] * i] as const);
  TAIL_BONES.forEach((name, i) => c.b.bone(name, i === 0 ? "head" : TAIL_BONES[i - 1], pts[i]));
  return pts;
}

/** A tail down from the back of the head (a spring chain), a tie, and a close cap. */
function ponytail(c: Ctx) {
  if (!c.fit.hideCap) c.addHead(sph(0.44, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mtx(0, 1.82, -0.02, -0.1), "hair");
  c.addHead(sph(0.435, 14, 8, Math.PI, Math.PI, 0, Math.PI * 0.55), mtx(0, 1.8, -0.015), "hair");
  const up = c.fit.hangFrom < 1.95;
  const y = Math.min(c.fit.hangFrom, 2.0) - (up ? 0.0 : 0.02);
  const z = -0.42 - c.fit.pushBack;
  const p = chain(c, [0, y, z], [0, -0.16, -0.1]);
  const at = (i: number) => new THREE.Vector3(...p[i]);
  const ball = (i: number, r: number, sy = 1.3) => c.add(sph(r, 10, 8), mtx(at(i).x, at(i).y - 0.04, at(i).z - 0.02, 0, 0, 0, 1, sy, 1), "hair", TAIL_BONES[i]);
  // The tie, then three tapering locks along the chain, the last ending in a point.
  c.add(new THREE.TorusGeometry(0.085, 0.028, 5, 12), mtx(p[0][0], p[0][1], p[0][2], 0.5, 0, 0), "trim", "head");
  ball(0, 0.15);
  ball(1, 0.13, 1.5);
  c.add(G.cone8, mtx(at(2).x, at(2).y - 0.12, at(2).z - 0.03, Math.PI, 0, 0, 0.1, 0.34, 0.1), "hair", TAIL_BONES[2]);
}

/** Long hair: a cap, side locks past the cheeks and a long soft fall down the back on the hair bones. */
function long(c: Ctx) {
  if (!c.fit.hideCap) c.addHead(sph(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), mtx(0, 1.83, -0.03, -0.12), "hair");
  c.addHead(sph(0.44, 16, 10, Math.PI, Math.PI, 0, Math.PI * 0.86), mtx(0, 1.8, -0.02), "hair");
  const top = Math.min(c.fit.hangFrom, 1.82);
  const z = -0.24 - c.fit.pushBack;
  chain(c, [0, top, z], [0, -0.3, -0.04]);
  // The fall: one soft slab (an ellipsoid, closed on every side), its rows blended along the three bones.
  const len = 0.9;
  const w = (p: THREE.Vector3): [string, string, number] => {
    const v = THREE.MathUtils.clamp((top - p.y) / len, 0, 0.999) * 2;
    const i = Math.min(1, Math.floor(v));
    return [TAIL_BONES[i], TAIL_BONES[i + 1], v - i];
  };
  c.add(G.ball, mtx(0, top - 0.5, z, 0, 0, 0, 0.34, 0.62, 0.17), "hair", w);
  // A lock in front of each ear.
  for (const s of [-1, 1]) c.addHead(sph(0.1, 8, 6), mtx(s * 0.4, 1.66, 0.06, 0, 0, 0, 0.7, 2.2, 0.8), "hair");
}

/** A cap with a bun at each side of the top. */
function buns(c: Ctx) {
  if (!c.fit.hideCap) c.addHead(sph(0.44, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mtx(0, 1.82, -0.02, -0.1), "hair");
  c.addHead(sph(0.435, 14, 8, Math.PI, Math.PI, 0, Math.PI * 0.6), mtx(0, 1.8, -0.015), "hair");
  if (c.fit.hideTop) return;
  for (const s of [-1, 1]) {
    c.addHead(sph(0.19, 12, 8), mtx(s * 0.3, 2.12, -0.05), "hair");
    c.addHead(new THREE.TorusGeometry(0.15, 0.03, 5, 12), mtx(s * 0.3, 2.12, -0.05, Math.PI / 2, 0, 0.3, 1, 1, 1), "trim", false);
  }
}

/** Little curls all over the head and a ring of them down the back. */
function curls(c: Ctx) {
  const at = (az: number, el: number, r = 0.44) => new THREE.Vector3(Math.sin(el) * Math.sin(az), Math.cos(el), Math.sin(el) * Math.cos(az)).multiplyScalar(r).add(new THREE.Vector3(0, 1.82, -0.03));
  if (!c.fit.hideCap) c.addHead(sph(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), mtx(0, 1.83, -0.03, -0.12), "hair");
  // The low ring (ears and back), below the hat's edge: seven curls, none in front of the face.
  const ring = 9;
  for (let i = 0; i < ring; i++) {
    const az = (i / ring) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(az), Math.cos(az))) < 0.7) continue;
    const p = at(az, Math.PI * 0.5, 0.45);
    c.addHead(G.ball6, mtx(p.x, 1.78, p.z, 0, 0, 0, 0.15, 0.17, 0.15), "hair");
  }
  if (c.fit.hideTop) return;
  c.addHead(G.ball6, mtx(0, 2.27, -0.04, 0, 0, 0, 0.17), "hair");
  for (const [el, n, r] of [[Math.PI * 0.3, 6, 0.16], [Math.PI * 0.16, 3, 0.17]] as const)
    for (let i = 0; i < n; i++) {
      const p = at((i / n) * Math.PI * 2 + el, el, 0.47);
      c.addHead(G.ball6, mtx(p.x, p.y, p.z, 0, 0, 0, r), "hair");
    }
}

const STYLES: Record<HairStyle, (c: Ctx) => void> = { bowl, short, spikes, ponytail, long, buns, curls, bald: () => {} };

export function addHair(c: Ctx) {
  STYLES[c.look.hair](c);
}
