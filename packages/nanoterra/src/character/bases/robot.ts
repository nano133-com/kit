import { addFace } from "../face.js";
import { G, mtx, roundedBox } from "../kit.js";
import { CLASSIC_LIMBS, limbs } from "../limbs.js";
import { torsoWeights } from "../torso.js";
import { SPH } from "./shared.js";
import type { BaseSpec } from "./spec.js";

// Robot: a box head with a screen face and an antenna, a box body with a chest panel, joints and tubes for arms and legs.
export const robot: BaseSpec = {
  head: { c: [0, 1.8, 0], r: [0.42, 0.36, 0.37], flat: 0.388 },
  torsoR: () => 0.4,
  native: { torso: "skin", pelvis: "steelDark", arm: "skin", joint: "steelDark", hand: "steel", leg: "skin", foot: "steelDark" },
  limbs: { ...CLASSIC_LIMBS, radial: 8, shoulder: 0.12, upper: [0.1, 0.1, 0.42], elbow: 0.105, fore: [0.095, 0.095, 0.36], hand: 0.12, thigh: [0.13, 0.13, 0.225], knee: 0.135, shin: [0.125, 0.125, 0.225], foot: 0.16, footScale: [1.1, 0.55, 1.4], armOut: 0 },
  hat: { y: 1.86, s: [1.22, 1.05, 1.18] },
  build(c) {
    const T = c.t.torso;
    c.addBody(roundedBox(0.8 * T, 0.84, 0.6 * T, 2, 0.13), mtx(0, 1.06, 0), c.style.torso, torsoWeights);
    c.addBody(roundedBox(0.7 * T, 0.2, 0.5 * T, 1, 0.06), mtx(0, 0.66, 0), c.style.pelvis, "hips");
    if (c.look.top === "none") {
      // The chest panel: a plate with three lights.
      c.addBody(roundedBox(0.38, 0.26, 0.05, 1, 0.02), mtx(0, 1.16, 0.3 * T), "steelDark", torsoWeights);
      [["glow", -0.1], ["rose", 0], ["gold", 0.1]].forEach(([col, x]) => c.addBody(G.cyl12, mtx(x as number, 1.16, 0.33 * T, Math.PI / 2, 0, 0, 0.035, 0.03, 0.035), col as string, torsoWeights, false));
    }
    c.addHead(roundedBox(0.84, 0.72, 0.74, 2, 0.13), mtx(0, 1.8, 0), "skin");
    c.addHead(roundedBox(0.7, 0.46, 0.05, 1, 0.02), mtx(0, 1.8, 0.365), "screen", false);
    for (const s of [-1, 1]) c.addHead(G.cyl12, mtx(s * 0.45, 1.8, 0, 0, 0, Math.PI / 2, 0.09, 0.1, 0.09), "steel");
    if (!c.fit.hideTopper) {
      c.addHead(G.cyl6, mtx(0, 2.26, 0, 0, 0, 0, 0.022, 0.22, 0.022), "steelDark", false);
      c.addHead(SPH, mtx(0, 2.4, 0, 0, 0, 0, 0.065), "glow", false);
    }
    addFace(c);
    limbs(c, robot.limbs);
  },
};
