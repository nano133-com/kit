import * as THREE from "three";
import { SKIN_NATIVE } from "../clothes.js";
import { addFace } from "../face.js";
import { addHair } from "../hair.js";
import { G, mtx } from "../kit.js";
import { CLASSIC_LIMBS, limbs } from "../limbs.js";
import { torsoWeights } from "../torso.js";
import type { BaseSpec } from "./spec.js";

export const classicTorso = (y: number) => 0.4 + Math.min(1, Math.max(0, (1.45 - y) / 0.78)) * 0.07;

/** The blue guy we have today. With the default look this makes the live avatar's vertices, in the same order. */
export const classic: BaseSpec = {
  head: { c: [0, 1.8, 0], r: [0.42, 0.42, 0.42] },
  torsoR: classicTorso,
  native: SKIN_NATIVE,
  limbs: CLASSIC_LIMBS,
  hat: { y: 1.83, s: [1, 1, 1] },
  build(c) {
    const T = c.t.torso;
    c.addBody(new THREE.CylinderGeometry(0.4 * T, 0.47 * T, 0.78, 14, 6), mtx(0, 1.06, 0), c.style.torso, torsoWeights);
    c.addBody(new THREE.CylinderGeometry(0.48 * T, 0.48 * T, 0.14, 14), mtx(0, 0.7, 0), c.style.pelvis, "hips");
    c.addBody(new THREE.CylinderGeometry(0.43 * T, 0.4 * T, 0.16, 14), mtx(0, 0.6, 0), c.style.pelvis, "hips");
    c.addHead(new THREE.SphereGeometry(0.42, 16, 12), mtx(0, 1.8, 0), "skin");
    addHair(c);
    addFace(c);
    if (!c.hidesBadge && c.look.top !== "jacket" && c.look.top !== "none") c.addBody(G.cyl12, mtx(0, 1.12, T === 1 ? 0.45 : c.torsoR(1.12) + 0.02, Math.PI / 2, 0, 0, 0.13, 0.04, 0.13), "badge", "chest", false);
    limbs(c, CLASSIC_LIMBS);
  },
};
