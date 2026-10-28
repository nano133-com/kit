import * as THREE from "three";
import type { PaintFn } from "../build.js";
import { addFace } from "../face.js";
import { G, mtx } from "../kit.js";
import { CLASSIC_LIMBS, limbs } from "../limbs.js";
import { torsoWeights } from "../torso.js";
import { ell, oval, SPH, SPH_M, SPH_S, sphereRow, V3 } from "./shared.js";
import type { BaseSpec } from "./spec.js";

// Bee: a round head with antennae, a striped body, thin dark arms and legs, a sting and two pairs of wings that flap (wing_L, wing_R, motion.ts).
const BEE_ROWS = [5, 7, 9];
const beeStripes: PaintFn = (w) => (BEE_ROWS.includes(sphereRow(w.y, 1.02, 0.5, 14)) ? "stripe" : "skin");
export const bee: BaseSpec = {
  head: { c: [0, 1.8, 0], r: [0.44, 0.4, 0.4] },
  torsoR: oval(1.02, 0.5, 0.47),
  native: { torso: beeStripes, pelvis: "skin", arm: "stripe", hand: "stripe", leg: "stripe", foot: "stripe" },
  limbs: { ...CLASSIC_LIMBS, shoulder: 0.09, upper: [0.075, 0.07, 0.42], elbow: 0.075, fore: [0.07, 0.065, 0.36], hand: 0.1, thigh: [0.09, 0.085, 0.225], knee: 0.085, shin: [0.08, 0.075, 0.225], foot: 0.14, footScale: [1, 0.6, 1.3], armOut: 0 },
  hat: { y: 1.83, s: [1.05, 0.95, 0.95] },
  build(c) {
    const T = c.t.torso;
    c.addBody(new THREE.SphereGeometry(1, 16, 14), mtx(0, 1.02, 0, 0, 0, 0, 0.47 * T, 0.5, 0.46 * T), c.style.torso, torsoWeights);
    ell(c, 0, 0.66, 0, 0.36 * T, 0.2, 0.34 * T, c.style.pelvis, "hips", true, SPH_M);
    c.addHead(SPH, mtx(0, 1.8, 0, 0, 0, 0, 0.44, 0.4, 0.4), "skin");
    if (!c.fit.hideTopper)
      for (const s of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([V3(s * 0.14, 2.1, 0.1), V3(s * 0.2, 2.33, 0.2), V3(s * 0.33, 2.5, 0.31)]);
        c.addHead(new THREE.TubeGeometry(curve, 8, 0.022, 5, false), new THREE.Matrix4(), "stripe", false);
        c.addHead(SPH_S, mtx(s * 0.34, 2.52, 0.32, 0, 0, 0, 0.065), "stripe", false);
      }
    addFace(c);
    if (!c.headOnly) {
      c.addBody(G.cone8, mtx(0, 0.72, -0.5, -Math.PI / 2 + 0.25, 0, 0, 0.1, 0.32, 0.1), "stripe", "hips");
      // The wings: a bone at each shoulder blade; a long wing and a short one on it. A back item covers them (`hideWings`): no wing, no bone.
      if (!c.hideWings) {
        for (const [s, name] of [[1, "wing_L"], [-1, "wing_R"]] as const) {
          c.b.bone(name, "chest", [s * 0.12, 1.4, -0.3]);
          c.add(SPH_S, mtx(s * 0.3, 1.78, -0.4, 0.2, 0, s * 1.15, 0.4, 0.04, 0.22), "wing", name);
          c.add(SPH_S, mtx(s * 0.36, 1.52, -0.42, 0.15, 0, s * 0.8, 0.28, 0.035, 0.15), "wing", name);
        }
      }
    }
    limbs(c, bee.limbs);
  },
};
