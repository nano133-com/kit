import * as THREE from "three";
import type { PaintFn } from "../build.js";
import type { Ctx } from "../ctx.js";
import { addFace } from "../face.js";
import { mtx } from "../kit.js";
import { CLASSIC_LIMBS, limbs } from "../limbs.js";
import { torsoWeights } from "../torso.js";
import { resolvePaint } from "./shared.js";
import type { BaseSpec } from "./spec.js";

// Round: the room blob's idea (a pill body with a round head, a glowing visor and two plain feet; app/arcade/room/avatar.tsx), with arms.
// The blob's twelve body colours, visor colours and feet colours, its three heights, three widths and six patterns are this base's record
// fields (record.ts fromBlob): a player who picked the blob maps to Round with nothing lost.

const BODY = { y: 0.91, r: 0.46, half: 0.14 };
const ROUND_TORSO = (y: number) => {
  const d = Math.abs(y - BODY.y) - BODY.half;
  return d <= 0 ? BODY.r : BODY.r * Math.sqrt(Math.max(0.05, 1 - (d / BODY.r) ** 2));
};
/** The pill as a lathe with a ring every 0.05, so a pattern's bands follow the rings. */
const STEP = 0.05;
const Y0 = BODY.y - BODY.half - BODY.r;
function pill() {
  const pts: THREE.Vector2[] = [];
  const n = Math.round((2 * (BODY.half + BODY.r)) / STEP);
  for (let i = 0; i <= n; i++) pts.push(new THREE.Vector2(i === 0 || i === n ? 0 : ROUND_TORSO(Y0 + i * STEP), Y0 + i * STEP));
  return new THREE.LatheGeometry(pts, 20);
}

/** The room's six patterns on the body, in the body's own shade (the blob multiplies its colour by 0.42 there). */
function pattern(c: Ctx): PaintFn | null {
  const p = c.look.pattern;
  if (p === "none") return null;
  const row = (y: number) => Math.floor((y - Y0) / STEP);
  const col = (x: number, z: number) => Math.floor((((Math.atan2(x, z) / (Math.PI * 2)) % 1) + 1) % 1 * 20);
  // Dots: one column wide and two rows high, in rows of three, every other row shifted by half the gap.
  const dot = (w: THREE.Vector3) => {
    const r = row(w.y);
    return (Math.floor(r / 3) % 2 === 0 ? col(w.x, w.z) % 4 === 0 : col(w.x, w.z) % 4 === 2) && r % 3 !== 2;
  };
  const on: Record<string, (w: THREE.Vector3) => boolean> = {
    stripes: (w) => row(w.y) % 6 < 3,
    dots: (w) => dot(w),
    stars: (w) => dot(w),
    half: (w) => w.x > 0,
    band: (w) => row(w.y) >= 11 && row(w.y) < 16,
    checks: (w) => (col(w.x, w.z) + row(w.y)) % 2 === 0,
  };
  return (w) => (on[p](w) ? "bodyShade" : "skin");
}

export const round: BaseSpec = {
  head: { c: [0, 1.78, 0], r: [0.4, 0.4, 0.4], lift: 0.045, eye: 1.8 },
  torsoR: ROUND_TORSO,
  native: { torso: "skin", pelvis: "skin", arm: "skin", hand: "skin", leg: "skin", foot: "shoes" },
  limbs: { ...CLASSIC_LIMBS, shoulder: 0.11, upper: [0.1, 0.095, 0.42], elbow: 0.1, fore: [0.095, 0.088, 0.36], hand: 0.12, thigh: [0.12, 0.11, 0.225], knee: 0.115, shin: [0.115, 0.105, 0.225], foot: 0.19, footScale: [1, 0.6, 1.4], armOut: 0.06, footBox: [0.27, 0.16, 0.4] },
  hat: { y: 1.81, s: [0.96, 0.96, 0.96] },
  build(c) {
    const T = c.t.torso;
    const bare = pattern(c);
    const split = c.style.pelvis === c.style.torso ? c.style.torso : ((w, l) => resolvePaint(w.y < 0.66 ? c.style.pelvis : c.style.torso, w, l)) as PaintFn;
    c.addBody(pill(), mtx(0, 0, 0, 0, 0, 0, T, 1, T), c.look.top === "none" && bare ? bare : split, torsoWeights);
    c.addHead(new THREE.SphereGeometry(0.4, 20, 14), mtx(0, 1.78, 0), "skin");
    // The visor: a dark shell a little off the head, over the face, when the face has eyes and a mouth; the bar needs none.
    if (c.look.face !== "bar") c.addHead(new THREE.SphereGeometry(0.43, 20, 10, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.62, 1.02), mtx(0, 1.78, 0), "screen");
    addFace(c);
    limbs(c, round.limbs);
  },
};
