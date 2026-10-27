import { addFace } from "../face.js";
import { mtx } from "../kit.js";
import { CLASSIC_LIMBS, limbs } from "../limbs.js";
import { torsoWeights } from "../torso.js";
import { ell, oval, SPH, SPH_M, SPH_S, V3 } from "./shared.js";
import type { BaseSpec } from "./spec.js";

// Critter: a round head with ears and a muzzle, a pear body, paws and a bushy tail on spring bones (tail1 to tail3, motion.ts).
export const critter: BaseSpec = {
  head: { c: [0, 1.78, 0], r: [0.46, 0.42, 0.42], mouthLift: 0.07 },
  torsoR: oval(1.03, 0.5, 0.5),
  native: { torso: "skin", pelvis: "skin", arm: "skin", hand: "fur2", leg: "skin", foot: "fur2" },
  limbs: { ...CLASSIC_LIMBS, shoulder: 0.12, upper: [0.11, 0.1, 0.42], elbow: 0.105, fore: [0.1, 0.09, 0.36], hand: 0.13, thigh: [0.15, 0.14, 0.225], knee: 0.14, shin: [0.135, 0.125, 0.225], foot: 0.17, footScale: [1, 0.62, 1.3], armOut: 0.02 },
  hat: { y: 1.81, s: [1.08, 1, 1] },
  build(c) {
    const T = c.t.torso;
    ell(c, 0, 1.03, 0, 0.5 * T, 0.5, 0.45 * T, c.style.torso, torsoWeights);
    // The pale belly: an oval laid on the front of the bare body.
    if (c.look.top === "none") ell(c, 0, 0.94, 0.3 * T, 0.31 * T, 0.38, 0.2 * T, "fur2", torsoWeights, true, SPH_M);
    ell(c, 0, 0.66, 0, 0.37 * T, 0.2, 0.34 * T, c.style.pelvis, "hips", true, SPH_M);
    c.addHead(SPH, mtx(0, 1.78, 0, 0, 0, 0, 0.46, 0.42, 0.42), "skin");
    // The muzzle and its nose.
    c.addHead(SPH_M, mtx(0, 1.7, 0.34, 0, 0, 0, 0.2, 0.14, 0.16), "fur2");
    c.addHead(SPH_S, mtx(0, 1.745, 0.485, 0, 0, 0, 0.06, 0.045, 0.04), "skinDark", false);
    if (!c.fit.hideTopper)
      for (const s of [-1, 1]) {
        c.addHead(SPH_M, mtx(s * 0.32, 2.06, -0.04, 0, 0, -s * 0.35, 0.16, 0.17, 0.09), "skin");
        c.addHead(SPH_S, mtx(s * 0.325, 2.065, 0.0, 0, 0, -s * 0.35, 0.1, 0.11, 0.05), "skinWarm", false);
      }
    addFace(c);
    if (!c.headOnly && !c.hideTail) {
      // The tail: three bones back and up from the hips; each carries a puff of fur, the last with a pale tip.
      const p = [V3(0, 0.8, -0.42), V3(0, 0.92, -0.62), V3(0, 1.08, -0.77)];
      c.b.bone("tail1", "hips", p[0].toArray());
      c.b.bone("tail2", "tail1", p[1].toArray());
      c.b.bone("tail3", "tail2", p[2].toArray());
      c.add(SPH_M, mtx(p[0].x, p[0].y, p[0].z, 0, 0, 0, 0.1, 0.1, 0.13), "skin", "tail1");
      c.add(SPH_M, mtx(p[1].x, p[1].y, p[1].z, 0, 0, 0, 0.13, 0.13, 0.15), "skin", "tail2");
      c.add(SPH_M, mtx(p[2].x, p[2].y + 0.02, p[2].z - 0.02, 0, 0, 0, 0.15, 0.17, 0.15), "skin", "tail3");
      c.add(SPH_M, mtx(p[2].x, p[2].y + 0.12, p[2].z - 0.04, 0, 0, 0, 0.1, 0.09, 0.1), "fur2", "tail3");
    }
    limbs(c, critter.limbs);
  },
};
