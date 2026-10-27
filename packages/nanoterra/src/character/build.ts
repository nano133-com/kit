import * as THREE from "three";
import { BONES } from "./skeleton.js";
import type { CharColors } from "./record.js";

// The character kit's builder: many shapes into the arrays of ONE skinned toon geometry and ONE skinned ink hull, as the island
// avatar's own `buildBody` does (art/Avatar.tsx; `add` here repeats its steps, so a part built the same way gives the same vertices).
// A shape has a place (a matrix), a colour (a palette key, a number, or a function of the place) and one bone, or two bones blended
// by the vertex's place. A part that moves brings its own bones (`bone`): they join the skeleton after the avatar's 28.

/** A bone, or a blend of two by the vertex's place: [first, second, the second's weight]. Names are the skeleton's or an extra bone's. */
export type Weights = string | ((p: THREE.Vector3) => readonly [string, string, number]);
/** A colour for each vertex, or for each face (its middle) when `face`: a palette key or a hex number. */
export type PaintFn = (world: THREE.Vector3, local: THREE.Vector3) => number | string;
/** A palette key ("skin", "shirt"), a hex number, "vc" (the shape's own vertex colours) or a function. */
export type Paint = string | number | PaintFn;

/**
 * Fits a part to a body that is not the Classic's (fit.ts): it moves the vertex `p` (placed, in the avatar's space) in place and answers the factor
 * its x and z were scaled by (1 for none), which the normals follow. The height is never changed, so a part's bones (by height) stay as they were.
 */
export type Fit = (p: THREE.Vector3) => number;

/** A bone a part adds: where it rests (the avatar's space) and the bone it hangs under. */
export type ExtraBone = { name: string; parent: string; at: readonly [number, number, number] };

type Rec = { paint: Paint; from: number; count: number; face: boolean; local: Float32Array | null; world: Float32Array | null; vc: Float32Array | null };

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class Builder {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly ip: number[] = [];
  readonly inn: number[] = [];
  readonly isi: number[] = [];
  readonly isw: number[] = [];
  readonly extra: ExtraBone[] = [];
  private readonly recs: Rec[] = [];
  private readonly index = new Map<string, number>(BONES.map((b, i) => [b[0] as string, i]));

  /** A bone of this character's own. A name that is already a bone is left as it is. */
  bone(name: string, parent: string, at: readonly [number, number, number]) {
    if (this.index.has(name)) return;
    this.index.set(name, BONES.length + this.extra.length);
    this.extra.push({ name, parent, at });
  }

  /** The skeleton's index of a bone by name (the 28 first, then the extra ones in the order they were added). */
  boneAt(name: string) {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`character: no bone "${name}"`);
    return i;
  }

  /** Vertices so far (toon). */
  get count() {
    return this.p.length / 3;
  }

  /**
   * One shape: `geo` placed by `m`. The ink's smooth normals are the sum of the normals at each place of this shape. `face`: the
   * colour comes from each triangle's middle (crisp bands), not from each vertex. `fit`: moves each placed vertex onto this character's body (a worn item).
   */
  add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint, w: Weights, ink = true, face = false, fit?: Fit) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const vc = paint === "vc" ? (g.attributes.color as THREE.BufferAttribute | undefined) : undefined;
    if (paint === "vc" && !vc) throw new Error("character: a part paints with vertex colours but has none");
    _m3.getNormalMatrix(m);
    const sums = new Map<string, THREE.Vector3>();
    const keys: string[] = [];
    if (ink) {
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i);
        const k = `${Math.round(_v.x * 500)},${Math.round(_v.y * 500)},${Math.round(_v.z * 500)}`;
        keys.push(k);
        const s = sums.get(k) ?? new THREE.Vector3();
        s.add(_n.fromBufferAttribute(nor, i));
        sums.set(k, s);
      }
    }
    const fn = typeof paint === "function";
    const rec: Rec = { paint, from: this.count, count: pos.count, face, local: fn ? new Float32Array(pos.count * 3) : null, world: fn ? new Float32Array(pos.count * 3) : null, vc: vc ? new Float32Array(pos.count * 3) : null };
    const fixed = typeof w === "string" ? this.boneAt(w) : -1;
    for (let i = 0; i < pos.count; i++) {
      const local = _v.fromBufferAttribute(pos, i);
      if (rec.local) local.toArray(rec.local, i * 3);
      const placed = new THREE.Vector3().copy(local).applyMatrix4(m);
      const fk = fit ? fit(placed) : 1;
      if (rec.world) placed.toArray(rec.world, i * 3);
      let b0 = fixed;
      let b1 = fixed;
      let k = 0;
      if (typeof w !== "string") {
        const r = w(placed);
        b0 = this.boneAt(r[0]);
        b1 = this.boneAt(r[1]);
        k = r[2];
      }
      this.p.push(placed.x, placed.y, placed.z);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_m3);
      if (fk !== 1) _n.set(_n.x / fk, _n.y, _n.z / fk);
      _n.normalize();
      this.n.push(_n.x, _n.y, _n.z);
      if (vc) {
        rec.vc![i * 3] = vc.getX(i);
        rec.vc![i * 3 + 1] = vc.getY(i);
        rec.vc![i * 3 + 2] = vc.getZ(i);
      }
      this.si.push(b0, b1, 0, 0);
      this.sw.push(1 - k, k, 0, 0);
      if (!ink) continue;
      this.ip.push(placed.x, placed.y, placed.z);
      _n.copy(sums.get(keys[i])!).applyMatrix3(_m3);
      if (fk !== 1) _n.set(_n.x / fk, _n.y, _n.z / fk);
      _n.normalize();
      this.inn.push(_n.x, _n.y, _n.z);
      this.isi.push(b0, b1, 0, 0);
      this.isw.push(1 - k, k, 0, 0);
    }
    this.recs.push(rec);
  };

  /** The two geometries, the colours still to paint. */
  finish() {
    const body = new THREE.BufferGeometry();
    body.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    body.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    body.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(this.p.length), 3));
    body.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.si, 4));
    body.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.sw, 4));
    const hull = new THREE.BufferGeometry();
    hull.setAttribute("position", new THREE.Float32BufferAttribute(this.ip, 3));
    hull.setAttribute("normal", new THREE.Float32BufferAttribute(this.inn, 3));
    hull.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.isi, 4));
    hull.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.isw, 4));
    body.computeBoundingSphere();
    hull.computeBoundingSphere();
    return { body, hull, paints: this.recs, extra: this.extra };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------------------------

/** The colours that no look changes (as art/Avatar.tsx FIXED, and the bases' own). */
const FIXED: Record<string, string> = {
  eye: "#1b1c3d",
  mouth: "#c9473f",
  badge: "#f4b63e",
  shadow: "#3d3653",
  white: "#ffffff",
  ink: "#1b1c3d",
  stripe: "#2b2140",
  wing: "#dff3ff",
  screen: "#16213d",
  leaf: "#5bc65a",
  leafDark: "#2b8a40",
  steel: "#c9d3dc",
  steelDark: "#6f8296",
  rose: "#ff8a9a",
  lens: "#243a5e",
  shade: "#1b1c3d",
  gold: "#f4b63e",
  goldDeep: "#c98a1a",
  rubber: "#2b2350",
  cream: "#fff1d6",
};

export type Palette = ReadonlyMap<string, THREE.Color>;

const mix = (a: string, b: string, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);

/** Every colour a part can name, from the look's six colours. */
export function makePalette(c: CharColors): Palette {
  const m = new Map<string, THREE.Color>();
  for (const [k, v] of Object.entries(FIXED)) m.set(k, new THREE.Color().set(v));
  for (const k of ["skin", "hair", "shirt", "pants", "shoes", "trim"] as const) m.set(k, new THREE.Color().set(c[k]));
  m.set("glow", new THREE.Color().set(c.glow));
  m.set("glowSoft", mix(c.glow, "#ffffff", 0.55));
  m.set("bodyShade", mix(c.skin, "#000000", 0.58));
  m.set("fur2", mix(c.skin, "#ffffff", 0.55));
  m.set("skinDark", mix(c.skin, "#3a2a1e", 0.42));
  m.set("skinWarm", mix(c.skin, "#ff7a8a", 0.3));
  m.set("hairDark", mix(c.hair, "#000000", 0.3));
  m.set("shirtDark", mix(c.shirt, "#000000", 0.3));
  m.set("pantsDark", mix(c.pants, "#000000", 0.35));
  m.set("shoesDark", mix(c.shoes, "#000000", 0.35));
  m.set("soleLight", mix(c.shoes, "#ffffff", 0.7));
  return m;
}

const _c = new THREE.Color();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _lc = new THREE.Vector3();

/** Fills the geometry's colour attribute from each shape's paint. */
export function paintGeometry(geo: THREE.BufferGeometry, recs: readonly Rec[], pal: Palette) {
  const attr = geo.getAttribute("color") as THREE.BufferAttribute;
  const named = (key: string) => {
    const c = pal.get(key);
    if (!c) throw new Error(`character: no colour "${key}"`);
    return c;
  };
  for (const r of recs) {
    if (r.vc) {
      for (let i = 0; i < r.count; i++) attr.setXYZ(r.from + i, r.vc[i * 3], r.vc[i * 3 + 1], r.vc[i * 3 + 2]);
    } else if (typeof r.paint === "function") {
      const fn = r.paint;
      const world = r.world!;
      const local = r.local!;
      const pick = (v: number | string) => (typeof v === "string" ? named(v) : _c.set(v));
      if (!r.face) {
        for (let i = 0; i < r.count; i++) {
          const c = pick(fn(_w.fromArray(world, i * 3), _l.fromArray(local, i * 3)));
          attr.setXYZ(r.from + i, c.r, c.g, c.b);
        }
      } else {
        for (let i = 0; i < r.count; i += 3) {
          _w.set(0, 0, 0);
          _lc.set(0, 0, 0);
          for (let k = 0; k < 3; k++) {
            _w.add(_l.fromArray(world, (i + k) * 3));
            _lc.add(_l.fromArray(local, (i + k) * 3));
          }
          const c = pick(fn(_w.multiplyScalar(1 / 3), _lc.multiplyScalar(1 / 3)));
          for (let k = 0; k < 3; k++) attr.setXYZ(r.from + i + k, c.r, c.g, c.b);
        }
      }
    } else {
      const c = typeof r.paint === "string" ? named(r.paint) : _c.set(r.paint);
      for (let i = 0; i < r.count; i++) attr.setXYZ(r.from + i, c.r, c.g, c.b);
    }
  }
  attr.needsUpdate = true;
}
