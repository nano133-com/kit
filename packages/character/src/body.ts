import * as THREE from "three";
import { LOOK_KEYS } from "./look.js";
import { boneIndex, type BoneName } from "./skeleton.js";
import { addWorn } from "./worn.js";

// The character's geometry (app/island/art/Avatar.tsx, buildBody, of nano133.com): a body with a shirt and a belt, a head
// with hair, eyes and a mouth, arms with hands, legs with shoes. Every piece is skinned to the island's skeleton
// (./skeleton) and goes into ONE toon geometry (its colours in the vertices) and ONE ink hull (smooth normals).
// Built in the island's units: about 2.3 tall, facing +Z, the feet at y = 0. Its +X side is its left.

/** What a vertex is painted with: the five parts of the look, then the three colours that never change. */
export const PARTS = [...LOOK_KEYS, "eye", "mouth", "badge"] as const;
export type Part = (typeof PARTS)[number];
/** The colours that no look changes: the eyes, the mouth, the gold badge on the chest. */
export const FIXED: Record<"eye" | "mouth" | "badge", string> = { eye: "#1b1c3d", mouth: "#c9473f", badge: "#f4b63e" };
/** The shadow's colour (the shadow is a mesh of its own: ./shadow). */
export const SHADOW_COLOR = "#3d3653";

/** A part's bones: one, or a blend of two by the vertex's place ([first, second, the second's weight]). */
export type Weights = BoneName | ((p: THREE.Vector3) => [BoneName, BoneName, number]);

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * The torso twists: the hips, then the spine, then the chest, by height (a point's y in the avatar's space). The shirt
 * and the band under the belt use it. A bone or a blend of two ([first, second, the second's weight]).
 */
export const torsoWeights = (q: THREE.Vector3): [BoneName, BoneName, number] =>
  q.y < 0.82 ? ["hips", "spine", smooth(0.74, 0.82, q.y)] : q.y < 1 ? ["spine", "spine", 0] : ["spine", "chest", smooth(1, 1.26, q.y)];

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
/** A matrix from a place, a turn (radians, in the order Y, X, Z) and a scale (one number scales all three). */
export function mtx(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

/** The arrays that the pieces fill. The worn items' code (./worn) appends to them after the body's own pieces. */
export type Buffers = {
  /** The toon geometry: positions, normals, the part of each vertex, bone indices and weights (four of each). */
  p: number[];
  n: number[];
  part: number[];
  si: number[];
  sw: number[];
  /** The ink hull: the same, with smooth normals and no part. */
  ip: number[];
  inn: number[];
  isi: number[];
  isw: number[];
};

/** Puts a piece (a geometry, moved by `m`) into the buffers: painted `part`, bound to `w`, with or without an ink outline. */
export type AddPiece = (geo: THREE.BufferGeometry, m: THREE.Matrix4, part: Part, w: Weights, ink?: boolean) => void;

export type BuiltBody = {
  /** The toon geometry (colours are filled by `paint`). */
  body: THREE.BufferGeometry;
  /** The ink hull's geometry, or null when the ink is left out. */
  hull: THREE.BufferGeometry | null;
  /** For each toon vertex, the index of its part in `PARTS`. */
  parts: Uint8Array;
};

/** The geometry. `ink` false leaves out the hull (quality "low"). */
export function buildBody(ink: boolean): BuiltBody {
  const b: Buffers = { p: [], n: [], part: [], si: [], sw: [], ip: [], inn: [], isi: [], isw: [] };
  const add: AddPiece = (geo, m, part, w, outline = true) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const partIndex = PARTS.indexOf(part);
    _m3.getNormalMatrix(m);
    // The ink's smooth normals: the sum of the normals at each place.
    const sums = new Map<string, THREE.Vector3>();
    const keys: string[] = [];
    if (ink && outline) {
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        const k = `${Math.round(_v.x * 500)},${Math.round(_v.y * 500)},${Math.round(_v.z * 500)}`;
        keys.push(k);
        const s = sums.get(k) ?? new THREE.Vector3();
        s.add(_n.fromBufferAttribute(nor, i));
        sums.set(k, s);
      }
    }
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const [b0, b1, k] = typeof w === "string" ? [w, w, 0] : w(_v);
      const bones = [boneIndex(b0), boneIndex(b1), 0, 0];
      b.p.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
      b.n.push(_n.x, _n.y, _n.z);
      b.part.push(partIndex);
      b.si.push(...bones);
      b.sw.push(1 - k, k, 0, 0);
      if (!ink || !outline) continue;
      b.ip.push(_v.x, _v.y, _v.z);
      _n.copy(sums.get(keys[i])!).applyMatrix3(_m3).normalize();
      b.inn.push(_n.x, _n.y, _n.z);
      b.isi.push(...bones);
      b.isw.push(1 - k, k, 0, 0);
    }
  };

  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const disc = new THREE.CylinderGeometry(1, 1, 1, 12);

  // The torso twists: the hips, then the spine, then the chest, by height. The belt and a pelvis band (it closes the
  // gap under the belt) ride the hips.
  add(new THREE.CylinderGeometry(0.4, 0.47, 0.78, 14, 6), mtx(0, 1.06, 0), "shirt", torsoWeights);
  add(new THREE.CylinderGeometry(0.48, 0.48, 0.14, 14), mtx(0, 0.7, 0), "pants", "hips");
  add(new THREE.CylinderGeometry(0.43, 0.4, 0.16, 14), mtx(0, 0.6, 0), "pants", "hips");
  // The head, hair, eyes and mouth; a small gold Ӿ badge on the chest.
  add(new THREE.SphereGeometry(0.42, 16, 12), mtx(0, 1.8, 0), "skin", "head");
  add(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), mtx(0, 1.83, -0.03, -0.12), "hair", "head");
  // The back of the head: the hair goes down to the neck (a camera behind sees it). The back half only (z < 0).
  add(new THREE.SphereGeometry(0.44, 16, 10, Math.PI, Math.PI, 0, Math.PI * 0.86), mtx(0, 1.8, -0.02), "hair", "head");
  for (const x of [-0.15, 0.15]) add(sphere, mtx(x, 1.8, 0.385, 0, 0, 0, 0.065, 0.1, 0.04), "eye", "head", false);
  add(sphere, mtx(0, 1.68, 0.4, 0, 0, 0, 0.09, 0.035, 0.03), "mouth", "head", false);
  add(disc, mtx(0, 1.12, 0.45, Math.PI / 2, 0, 0, 0.13, 0.04, 0.13), "badge", "chest", false);
  // The arms (a shoulder ball, the upper arm, an elbow ball, the forearm, the hand) and the legs (the thigh, a knee ball,
  // the shin, the shoe). +X is the avatar's left.
  for (const [s, side] of [[1, "L"], [-1, "R"]] as const) {
    const x = s * 0.47;
    add(new THREE.SphereGeometry(0.13, 12, 8), mtx(x, 1.32, 0), "shirt", `upperarm_${side}`);
    add(new THREE.CylinderGeometry(0.12, 0.115, 0.42, 10), mtx(x, 1.11, 0), "shirt", `upperarm_${side}`);
    add(new THREE.SphereGeometry(0.118, 10, 8), mtx(x, 0.9, 0), "shirt", `forearm_${side}`);
    add(new THREE.CylinderGeometry(0.115, 0.1, 0.36, 10), mtx(x, 0.71, 0), "shirt", `forearm_${side}`);
    add(new THREE.SphereGeometry(0.135, 10, 8), mtx(x, 0.48, 0), "skin", `hand_${side}`);
    const lx = s * 0.19;
    add(new THREE.CylinderGeometry(0.16, 0.152, 0.225, 10), mtx(lx, 0.4475, 0), "pants", `thigh_${side}`);
    add(new THREE.SphereGeometry(0.152, 10, 8), mtx(lx, 0.335, 0), "pants", `shin_${side}`);
    add(new THREE.CylinderGeometry(0.15, 0.14, 0.225, 10), mtx(lx, 0.2225, 0), "pants", `shin_${side}`);
    add(new THREE.SphereGeometry(0.18, 10, 8), mtx(lx, 0.1, 0.06, 0, 0, 0, 1, 0.6, 1.35), "shoes", `foot_${side}`);
  }

  // The worn items' pieces come here, after the body's own (./worn).
  addWorn(add, b);
  sphere.dispose();
  disc.dispose();

  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
  body.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
  body.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(b.p.length), 3));
  body.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(b.si, 4));
  body.setAttribute("skinWeight", new THREE.Float32BufferAttribute(b.sw, 4));
  body.computeBoundingSphere();
  let hull: THREE.BufferGeometry | null = null;
  if (ink) {
    hull = new THREE.BufferGeometry();
    hull.setAttribute("position", new THREE.Float32BufferAttribute(b.ip, 3));
    hull.setAttribute("normal", new THREE.Float32BufferAttribute(b.inn, 3));
    hull.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(b.isi, 4));
    hull.setAttribute("skinWeight", new THREE.Float32BufferAttribute(b.isw, 4));
    hull.computeBoundingSphere();
  }
  return { body, hull, parts: Uint8Array.from(b.part) };
}

const _c = new THREE.Color();

/**
 * Fills the toon geometry's colours from a look: the five parts from `look`, the eyes, the mouth and the badge from
 * `FIXED`. It changes no shape. The colours are in the working colour space (three.js turns the "#rrggbb" of sRGB).
 */
export function paint(body: THREE.BufferGeometry, parts: Uint8Array, look: Record<(typeof LOOK_KEYS)[number], string>) {
  const palette = PARTS.map((name) => {
    const c = new THREE.Color().set(name in FIXED ? FIXED[name as keyof typeof FIXED] : look[name as keyof typeof look]);
    return [c.r, c.g, c.b] as const;
  });
  const attr = body.getAttribute("color") as THREE.BufferAttribute;
  for (let i = 0; i < parts.length; i++) {
    const [r, g, bl] = palette[parts[i]];
    attr.setXYZ(i, r, g, bl);
  }
  attr.needsUpdate = true;
}

/** The shadow: a flat dark disc (radius 0.62) a little over the ground, its colour in the vertices. */
export function buildShadow() {
  const g = new THREE.CircleGeometry(0.62, 20);
  g.applyMatrix4(mtx(0, 0.02, 0, -Math.PI / 2));
  const c = _c.set(SHADOW_COLOR);
  const n = g.attributes.position.count;
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  g.computeBoundingSphere();
  return g;
}
