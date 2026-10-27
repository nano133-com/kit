import * as THREE from "three";
import type { PaintFn } from "../build.js";
import { addFace } from "../face.js";
import { G, mtx } from "../kit.js";
import { CLASSIC_LIMBS, limbs } from "../limbs.js";
import { torsoWeights } from "../torso.js";
import { oval, sphereRow, V3 } from "./shared.js";
import type { BaseSpec } from "./spec.js";

// Pineapple: one golden oval with a lattice skin and a face, a crown of leaves, and thin green arms and legs.

/** The scales of its skin: bricks two columns wide and one row high, each row shifted by one, alternate in tone. */
const lattice: PaintFn = (w) => {
  const col = Math.floor((((Math.atan2(w.z, -w.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 20);
  const row = sphereRow(w.y, 1.12, 0.92, 16);
  return (Math.floor((col + (row % 2)) / 2) + row) % 2 ? "skinDark" : "skin";
};
/** The body is the torso and the head: it blends from the chest to the head as it goes up. */
const pineWeights = (p: THREE.Vector3): readonly [string, string, number] => {
  if (p.y < 1.26) return torsoWeights(p);
  if (p.y < 1.66) return ["chest", "head", THREE.MathUtils.smoothstep(p.y, 1.3, 1.66)];
  return ["head", "head", 0];
};
export const pineapple: BaseSpec = {
  head: { c: [0, 1.12, 0], r: [0.6, 0.92, 0.56], eye: 1.68 },
  torsoR: oval(1.12, 0.92, 0.6),
  native: { torso: lattice, pelvis: lattice, arm: "leaf", hand: "leaf", leg: "leaf", foot: "leafDark" },
  limbs: { ...CLASSIC_LIMBS, shoulder: 0.08, upper: [0.07, 0.065, 0.42], elbow: 0.07, fore: [0.065, 0.06, 0.36], hand: 0.1, thigh: [0.09, 0.085, 0.225], knee: 0.085, shin: [0.08, 0.075, 0.225], foot: 0.15, footScale: [1, 0.6, 1.3], armOut: 0.2 },
  hat: { y: 1.97, s: [0.92, 0.9, 0.92] },
  build(c) {
    const T = c.t.torso;
    c.add(new THREE.SphereGeometry(1, 20, 16), mtx(0, 1.12, 0, 0, 0, 0, 0.6 * T, 0.92, 0.56 * T), c.style.torso, pineWeights);
    if (!c.fit.hideTopper) {
      const leaves: [number, number, number][] = [[0, 0, 0.72], [0.9, 0.5, 0.58], [-0.9, 0.5, 0.58], [1.9, 0.5, 0.56], [-1.9, 0.5, 0.56], [2.9, 0.5, 0.54]];
      leaves.forEach(([az, el, len], i) => {
        const dir = V3(Math.sin(el) * Math.sin(az), Math.cos(el), Math.sin(el) * Math.cos(az));
        const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
        const at = V3(0, 1.98, 0).addScaledVector(dir, len * 0.5);
        c.add(G.cone8, new THREE.Matrix4().compose(at, q, V3(0.12, len, 0.07)), i % 2 ? "leafDark" : "leaf", "head");
      });
    }
    addFace(c);
    limbs(c, pineapple.limbs);
  },
};
