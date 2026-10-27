import * as THREE from "three";
import { mtx } from "./kit.js";
import { addFoot } from "./clothes.js";
import type { Ctx } from "./ctx.js";

// The arms and the legs, the same on every base but for their sizes and a few shapes. The joints are the skeleton's (art/skeleton.ts: the
// shoulders 0.47 out at 1.32, the elbows at 0.9, the hands at 0.48; the hips 0.19 out, the knees at 0.335, the ankles at 0.11), so a part
// drawn here follows any animation of the island's rig. The default numbers are art/Avatar.tsx's, in its order, so the Classic base's
// vertices are the same as the live avatar's.

export type Limbs = {
  /** Radii: the shoulder ball; the upper arm [top, bottom, length]; the elbow ball; the forearm [top, bottom, length]. */
  shoulder: number;
  upper: readonly [number, number, number];
  elbow: number;
  fore: readonly [number, number, number];
  /** The hand: a sphere's radius, and its scale; or a custom shape. */
  hand: number;
  handScale?: readonly [number, number, number];
  handShape?: (x: number, side: "L" | "R", c: Ctx) => void;
  /** The leg: the thigh [top, bottom, length], the knee ball, the shin [top, bottom, length]. */
  thigh: readonly [number, number, number];
  knee: number;
  shin: readonly [number, number, number];
  /** The foot: a sphere's radius and its scale and place; or a custom shape. */
  foot: number;
  footScale: readonly [number, number, number];
  footAt: readonly [number, number];
  footShape?: (lx: number, side: "L" | "R", c: Ctx) => void;
  /** Radial segments of the arm and leg cylinders. */
  radial?: number;
  /** The arms drawn this much further out than their joints (a body wider than the shoulders). */
  armOut?: number;
  /** The feet are rounded boxes of this size (width, height, length), not balls. */
  footBox?: readonly [number, number, number];
};

export const CLASSIC_LIMBS: Limbs = {
  shoulder: 0.13,
  upper: [0.12, 0.115, 0.42],
  elbow: 0.118,
  fore: [0.115, 0.1, 0.36],
  hand: 0.135,
  thigh: [0.16, 0.152, 0.225],
  knee: 0.152,
  shin: [0.15, 0.14, 0.225],
  foot: 0.18,
  footScale: [1, 0.6, 1.35],
  footAt: [0.1, 0.06],
};

/** Each side's arm then its leg, left (+X) first, as the live avatar's loop. */
export function limbs(c: Ctx, L: Limbs) {
  const k = c.t.limb;
  const st = c.style;
  const rad = L.radial ?? 10;
  const armX = 0.47 + 0.45 * (c.t.torso - 1) + (L.armOut ?? 0);
  for (const [s, side] of [[1, "L"], [-1, "R"]] as const) {
    const x = s * armX;
    const rows = st.rows;
    c.addBody(new THREE.SphereGeometry(L.shoulder * k, 12, 8), mtx(x, 1.32, 0), st.shoulder, `upperarm_${side}`);
    c.addBody(new THREE.CylinderGeometry(L.upper[0] * k, L.upper[1] * k, L.upper[2], rad, rows), mtx(x, 1.11, 0), st.upper, `upperarm_${side}`);
    c.addBody(new THREE.SphereGeometry(L.elbow * k, 10, 8), mtx(x, 0.9, 0), st.elbow, `forearm_${side}`);
    c.addBody(new THREE.CylinderGeometry(L.fore[0] * k, L.fore[1] * k, L.fore[2], rad, rows), mtx(x, 0.71, 0), st.fore, `forearm_${side}`);
    if (L.handShape) L.handShape(x, side, c);
    else {
      const hs = L.handScale;
      c.addBody(new THREE.SphereGeometry(L.hand * k, 10, 8), hs ? mtx(x, 0.48, 0, 0, 0, 0, hs[0], hs[1], hs[2]) : mtx(x, 0.48, 0), st.hand, `hand_${side}`);
    }
    const lx = s * 0.19;
    c.addBody(new THREE.CylinderGeometry(L.thigh[0] * k, L.thigh[1] * k, L.thigh[2], rad), mtx(lx, 0.4475, 0), st.thigh, `thigh_${side}`);
    c.addBody(new THREE.SphereGeometry(L.knee * k, 10, 8), mtx(lx, 0.335, 0), st.knee, `shin_${side}`);
    c.addBody(new THREE.CylinderGeometry(L.shin[0] * k, L.shin[1] * k, L.shin[2], rad), mtx(lx, 0.2225, 0), st.shin, `shin_${side}`);
    if (L.footShape) L.footShape(lx, side, c);
    else addFoot(c, L, lx, side);
  }
}

