import * as THREE from "three";
import type { Paint, PaintFn } from "../build.js";
import type { Ctx } from "../ctx.js";
import { G, mtx } from "../kit.js";

// Small helpers the bases share.

export const SPH = G.ball;
/** Smaller balls for small parts (192 and 96 triangles; the big ball is 384). */
export const SPH_M = G.sph;
export const SPH_S = G.ball6;
export const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const resolvePaint = (p: Paint, w: THREE.Vector3, l: THREE.Vector3) => (typeof p === "function" ? p(w, l) : p);

/** The torso's paint above a height and the pelvis's below it, for a body that is one shape (the bottoms' paint stops at the hips). */
export const split = (c: Ctx, y: number): Paint => (c.style.pelvis === c.style.torso ? c.style.torso : (((w, l) => resolvePaint(w.y < y ? c.style.pelvis : c.style.torso, w, l)) as PaintFn));

/** An ellipsoid body part: the unit ball scaled. */
export const ell = (c: Ctx, x: number, y: number, z: number, rx: number, ry: number, rz: number, paint: Paint, w: Parameters<Ctx["addBody"]>[3], ink = true, geo: THREE.BufferGeometry = SPH) => c.addBody(geo, mtx(x, y, z, 0, 0, 0, rx, ry, rz), paint, w, ink);

/** The radius of an ellipse's slice at a height: the torso's radius for a body that is an ellipsoid (middle y, half height ry, radius rx). */
export const oval = (y: number, ry: number, rx: number) => (h: number) => rx * Math.sqrt(Math.max(0.05, 1 - ((h - y) / ry) ** 2));

/** Which row of a sphere shape (SphereGeometry with `rows` height segments, scaled to a middle and a half height) a face is in: bands that follow the rows are straight. */
export const sphereRow = (y: number, cy: number, ry: number, rows: number) => Math.floor(Math.acos(THREE.MathUtils.clamp((y - cy) / ry, -1, 1)) / (Math.PI / rows));
