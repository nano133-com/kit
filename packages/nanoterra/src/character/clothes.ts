import * as THREE from "three";
import { G, mtx, roundedBox } from "./kit.js";
import { torsoWeights } from "./torso.js";
import type { Paint, PaintFn } from "./build.js";
import type { Ctx, Style } from "./ctx.js";
import type { Limbs } from "./limbs.js";
import type { CharLook } from "./record.js";

// Clothes. A top, a bottom and a pair of shoes mostly PAINT the base's own body parts (the torso, the sleeves, the legs), so one set of
// clothes fits every base that wears them; a few shapes join the body where a cloth stands off it (a hood, a skirt, a bib, a boot's shaft).
// A pattern (stripes, dots, stars) goes on the top. The default (the long-sleeve shirt, trousers, sneakers) is today's avatar, number for number.

/** What each segment shows when no cloth covers it (a base's skin, fur, stripes or panel). */
export type Native = { torso: Paint; pelvis: Paint; arm: Paint; hand: Paint; leg: Paint; foot: Paint; /** The shoulders', elbows' and knees' balls, when they are not the arm's and leg's own. */ joint?: Paint };
export const SKIN_NATIVE: Native = { torso: "skin", pelvis: "skin", arm: "skin", hand: "skin", leg: "skin", foot: "skin" };

/** The torso's rows (a CylinderGeometry of 6 rows from y 0.67 to 1.45): stripes run along them. */
const ROW = 0.13;
const ROW0 = 0.67;

export function hasSleeves(top: CharLook["top"]) {
  return top === "shirt" || top === "hoodie" || top === "jacket";
}

export function styleOf(look: CharLook, nat: Native): Style {
  const { top, bottom, shoes } = look;
  const sleeves = hasSleeves(top);
  // The patterns of a top: stripes, half (one side in the second colour), band (a wide band across), checks. Dots and stars are shapes laid on it (`decals`).
  const pat = top === "none" ? "none" : look.pattern;
  const stripes = pat === "stripes";
  const band = (y0: number, h: number): PaintFn => (w) => (Math.floor((w.y - y0) / h) % 2 ? "trim" : "shirt");
  const row = (y: number) => Math.floor((y - ROW0) / ROW);
  const col = (x: number, z: number) => Math.floor((((Math.atan2(x, z) / (Math.PI * 2)) % 1) + 1) % 1 * 14);
  const half: PaintFn = (w) => (w.x > 0 ? "trim" : "shirt");
  const torsoPat: PaintFn | null = stripes ? (w) => (row(w.y) % 2 ? "trim" : "shirt") : pat === "half" ? half : pat === "band" ? (w) => (row(w.y) === 2 || row(w.y) === 3 ? "trim" : "shirt") : pat === "checks" ? (w) => ((col(w.x, w.z) + row(w.y)) % 2 ? "trim" : "shirt") : null;
  const armUpper: PaintFn | null = stripes ? band(0.9, 0.105) : pat === "half" ? half : null;
  const armFore: PaintFn | null = stripes ? band(0.53, 0.09) : pat === "half" ? half : null;
  let torso: Paint = nat.torso;
  let shoulder: Paint = nat.joint ?? nat.arm;
  let upper: Paint = nat.arm;
  let elbow: Paint = nat.joint ?? nat.arm;
  let fore: Paint = nat.arm;
  let rows = 1;
  if (top !== "none") {
    torso = torsoPat ?? "shirt";
    if (sleeves) {
      shoulder = elbow = "shirt";
      upper = armUpper ?? "shirt";
      fore = armFore ?? "shirt";
      rows = stripes ? 4 : 1;
    } else if (top === "tee") {
      shoulder = "shirt";
      // The sleeve ends half way down the upper arm: the rows above it are the shirt, those below it the arm.
      rows = stripes ? 4 : 2;
      const bare = typeof nat.arm === "string" ? nat.arm : "skin";
      upper = (w, l) => (w.y > 1.11 ? (armUpper ? armUpper(w, l) : "shirt") : bare);
    } else if (top === "tank") {
      const bare = typeof nat.torso === "string" ? nat.torso : "skin";
      torso = (w, l) => (w.y > 1.32 && !(Math.abs(w.x) > 0.17 && Math.abs(w.x) < 0.31) ? bare : torsoPat ? torsoPat(w, l) : "shirt");
    }
  }
  const legs = bottom === "trousers" || bottom === "overalls";
  return {
    torso,
    pelvis: bottom === "none" ? nat.pelvis : "pants",
    shoulder,
    upper,
    elbow,
    fore,
    hand: nat.hand,
    thigh: bottom === "none" || bottom === "skirt" ? nat.leg : "pants",
    knee: legs ? "pants" : nat.joint ?? nat.leg,
    shin: legs ? "pants" : nat.leg,
    foot: shoes === "sneakers" || shoes === "boots" ? "shoes" : nat.foot,
    rows,
  };
}

/** A cloth that stands off the torso follows its radius. */
const onTorso = (c: Ctx, y: number, out = 0.012) => c.torsoR(y) + out;

/** Shapes that join the body for the top and the bottom (after the arms and legs). */
export function clothesExtras(c: Ctx) {
  const { top, bottom, pattern } = c.look;
  const tw = torsoWeights;
  const T = c.t.torso;
  if (top === "tee") c.add(new THREE.TorusGeometry(c.torsoR(1.44) * 0.78, 0.034, 5, 16), mtx(0, 1.445, 0, Math.PI / 2, 0, 0, 1, 1, 0.9), "shirtDark", tw);
  if (top === "hoodie") {
    c.add(G.sph, mtx(0, 1.46, -onTorso(c, 1.46, 0.05), 0, 0, 0, 0.22, 0.17, 0.15), "shirt", tw);
    c.add(new THREE.TorusGeometry(c.torsoR(1.44) * 0.8, 0.055, 5, 16), mtx(0, 1.44, 0, Math.PI / 2, 0, 0, 1, 1, 0.95), "shirtDark", tw);
    c.add(G.box, mtx(0, 0.88, onTorso(c, 0.88, 0.0), 0, 0, 0, 0.36 * T, 0.17, 0.06), "shirtDark", tw);
    for (const s of [-1, 1]) {
      c.add(G.cyl6, mtx(s * 0.08, 1.31, onTorso(c, 1.31, 0.03), 0, 0, 0, 0.016, 0.24, 0.016), "trim", tw, false);
      c.add(SPH6, mtx(s * 0.08, 1.185, onTorso(c, 1.2, 0.04), 0, 0, 0, 0.03), "trim", tw, false);
    }
  }
  if (top === "jacket") {
    c.add(G.box, mtx(0, 1.05, onTorso(c, 1.05, 0.016), 0, 0, 0, 0.034, 0.76, 0.03), "trim", tw, false);
    c.add(new THREE.TorusGeometry(c.torsoR(1.44) * 0.8, 0.06, 5, 16), mtx(0, 1.44, 0, Math.PI / 2, 0, 0, 1, 1, 1.0), "shirtDark", tw);
    c.add(new THREE.CylinderGeometry(c.torsoR(0.68) + 0.02, c.torsoR(0.64) + 0.02, 0.075, 14), mtx(0, 0.67, 0), "shirtDark", tw);
    for (const s of [-1, 1]) {
      c.add(G.box, mtx(s * 0.2 * T, 0.84, onTorso(c, 0.84, 0.0), 0, s * 0.05, 0, 0.13, 0.03, 0.04), "shirtDark", tw, false);
      c.add(new THREE.CylinderGeometry(0.108 * c.t.limb, 0.108 * c.t.limb, 0.06, 10), mtx(s * (0.47 + 0.45 * (T - 1)), 0.57, 0), "shirtDark", `forearm_${s > 0 ? "L" : "R"}`);
    }
  }
  if (bottom === "shorts")
    for (const [s, side] of [[1, "L"], [-1, "R"]] as const) c.addBody(new THREE.TorusGeometry(0.158 * c.t.limb, 0.024, 4, 12), mtx(s * 0.19, 0.34, 0, Math.PI / 2), "pantsDark", `thigh_${side}`);
  if (bottom === "skirt") skirt(c);
  if (bottom === "overalls") overalls(c);
  if ((pattern === "dots" || pattern === "stars") && top !== "none") decals(c);
}

/** A flared skirt that moves with the legs: its rows blend from the hips to the thigh on its side. */
function skirt(c: Ctx) {
  const T = c.t.torso;
  const top = 0.74;
  const h = 0.4;
  const g = new THREE.CylinderGeometry(0.52 * T, 0.76 * T, h, 18, 4, true);
  const w = (p: THREE.Vector3): [string, string, number] => {
    const k = THREE.MathUtils.smoothstep(top - p.y, 0.08, h) * THREE.MathUtils.smoothstep(Math.abs(p.x), 0.04, 0.32) * 0.85;
    return ["hips", p.x >= 0 ? "thigh_L" : "thigh_R", k];
  };
  c.add(g, mtx(0, top - h / 2, 0), "pants", w);
  c.add(new THREE.TorusGeometry(0.76 * T, 0.03, 4, 18), mtx(0, top - h, 0, Math.PI / 2), "pantsDark", w);
  c.add(new THREE.CylinderGeometry(0.5 * T, 0.5 * T, 0.05, 18), mtx(0, top - 0.015, 0), "pantsDark", "hips");
}

/** The bib and the two straps of overalls. */
function overalls(c: Ctx) {
  const tw = torsoWeights;
  const T = c.t.torso;
  c.add(G.box, mtx(0, 1.17, onTorso(c, 1.17, 0.012), 0, 0, 0, 0.42 * T, 0.4, 0.045), "pants", tw);
  const zf = (y: number, x: number) => Math.sqrt(Math.max(0.01, c.torsoR(y) ** 2 - x * x)) + 0.03;
  for (const s of [-1, 1]) {
    const pts = [new THREE.Vector3(s * 0.17 * T, 1.3, zf(1.3, 0.17 * T)), new THREE.Vector3(s * 0.2 * T, 1.45, zf(1.45, 0.2 * T) * 0.5), new THREE.Vector3(s * 0.2 * T, 1.47, 0), new THREE.Vector3(s * 0.2 * T, 1.4, -zf(1.4, 0.2 * T)), new THREE.Vector3(s * 0.17 * T, 1.22, -zf(1.22, 0.17 * T))];
    c.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.03, 5, false), new THREE.Matrix4(), "pants", tw);
    c.add(SPH6, mtx(s * 0.17 * T, 1.3, zf(1.3, 0.17 * T) + 0.02, 0, 0, 0, 0.034), "gold", tw, false);
  }
}

/** Dots and stars: flat marks laid on the shirt (the torso, and the outside of each sleeve). */
function decals(c: Ctx) {
  const star = c.look.pattern === "stars";
  const geo = star ? STAR : DISC;
  const sz = star ? 0.078 : 0.048;
  const tw = torsoWeights;
  const rows: [number, number, number][] = [[1.33, 8, 0], [1.13, 8, 0.5], [0.93, 8, 0]];
  for (const [y, n, off] of rows)
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      c.add(geo, mtx(Math.sin(a) * onTorso(c, y, 0.012), y, Math.cos(a) * onTorso(c, y, 0.012), 0, a, 0, sz), "trim", tw, false);
    }
  if (!hasSleeves(c.look.top) && c.look.top !== "tee") return;
  const armX = 0.47 + 0.45 * (c.t.torso - 1);
  for (const [s, side] of [[1, "L"], [-1, "R"]] as const)
    for (const y of c.look.top === "tee" ? [1.2] : [1.2, 0.98])
      c.add(geo, mtx(s * (armX + 0.125 * c.t.limb), y, 0, 0, s * (Math.PI / 2), 0, sz * 0.9), "trim", `upperarm_${side}`, false);
}

const SPH6 = new THREE.SphereGeometry(1, 8, 6);
const DISC = new THREE.CircleGeometry(1, 8);
const STAR = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
})();

/** The foot and what is on it. `sneakers` is today's shoe. */
export function addFoot(c: Ctx, L: Limbs, lx: number, side: "L" | "R") {
  const bone = `foot_${side}` as const;
  const shin = `shin_${side}` as const;
  const [fy, fz] = L.footAt;
  const shoes = c.look.shoes;
  if (L.footBox && (shoes === "sneakers" || shoes === "bare")) {
    // A plain foot, a box with round edges (the room blob's).
    const [bw, bh, bl] = L.footBox;
    c.addBody(roundedBox(bw, bh, bl, 2, 0.06), mtx(lx, bh / 2 - 0.005, fz + 0.02), c.style.foot, bone);
    return;
  }
  if (shoes === "sneakers") {
    c.addBody(new THREE.SphereGeometry(L.foot, 10, 8), mtx(lx, fy, fz, 0, 0, 0, L.footScale[0], L.footScale[1], L.footScale[2]), c.style.foot, bone);
    return;
  }
  if (shoes === "bare") {
    c.addBody(new THREE.SphereGeometry(L.foot * 0.88, 10, 8), mtx(lx, fy - 0.01, fz, 0, 0, 0, L.footScale[0], L.footScale[1] * 0.95, L.footScale[2]), c.style.foot, bone);
    return;
  }
  if (shoes === "boots") {
    c.addBody(new THREE.SphereGeometry(L.foot * 1.04, 10, 8), mtx(lx, fy + 0.005, fz, 0, 0, 0, L.footScale[0], L.footScale[1] * 1.08, L.footScale[2]), "shoes", bone);
    c.addBody(new THREE.CylinderGeometry(0.168 * c.t.limb, 0.172 * c.t.limb, 0.27, 10), mtx(lx, 0.205, 0), "shoes", shin);
    c.addBody(new THREE.TorusGeometry(0.172 * c.t.limb, 0.026, 4, 10), mtx(lx, 0.338, 0, Math.PI / 2), "shoesDark", shin);
    c.addBody(new THREE.CylinderGeometry(0.19, 0.19, 0.035, 10), mtx(lx, 0.022, fz * 0.8, 0, 0, 0, 1, 1, 1.32), "shoesDark", bone);
    return;
  }
  // Sandals: a bare foot on a flat sole with a strap over the instep.
  c.addBody(new THREE.SphereGeometry(L.foot * 0.86, 10, 8), mtx(lx, fy + 0.025, fz, 0, 0, 0, L.footScale[0], L.footScale[1] * 0.9, L.footScale[2]), c.style.foot, bone);
  c.addBody(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 10), mtx(lx, 0.025, fz * 0.9, 0, 0, 0, 1, 1, 1.4), "shoes", bone);
  c.addBody(new THREE.TorusGeometry(0.135, 0.02, 4, 10), mtx(lx, 0.1, fz * 0.9, 0, 0, 0, 1, 0.7, 1), "shoes", bone);
}
