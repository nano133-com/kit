import * as THREE from "three";
import { Builder, makePalette, paintGeometry, type Paint, type Weights } from "./build.js";
import type { BaseSpec } from "./bases/spec.js";
import { clothesExtras, styleOf } from "./clothes.js";
import { NO_FIT, type Ctx, type HairFit, type HatPart, type WornPart } from "./ctx.js";
import { mtx } from "./kit.js";
import type { CharColors, CharLook } from "./record.js";

// One character's geometry: the base, then the hair, the face, the clothes, the shadow, a hat. The result is the two geometries of the
// avatar's ONE skinned toon draw and ONE skinned ink draw, the paints to colour them, and the bones its moving parts add (after the island's 28).

/** The build's factors: the torso's width and the limbs' thickness. "regular" is 1, so a regular body is today's, number for number. */
export const BUILD_FACTORS = { slim: { torso: 0.88, limb: 0.88 }, regular: { torso: 1, limb: 1 }, round: { torso: 1.16, limb: 1.1 } } as const;

/** The head's size, as a matrix about the head bone (the neck at 1.5): null when the size is 1. */
export function headMatrix(hs: number) {
  if (hs === 1) return null;
  return new THREE.Matrix4().makeTranslation(0, 1.5, 0).multiply(new THREE.Matrix4().makeScale(hs, hs, hs)).multiply(new THREE.Matrix4().makeTranslation(0, -1.5, 0));
}

export type MakeOptions = {
  /** Only the head and what sits on it (a picture of faces or hats). */
  headOnly?: boolean;
  /** A worn head item: it brings its fit of the hair and adds its shapes. */
  hat?: HatPart | null;
  /** Worn things (a hat, a scarf, a pack, a top, a buddy, a blade): each adds its shapes and bones after the body, in this order. */
  worn?: readonly WornPart[];
};

/** Everything worn: the hat, then the others. */
const wornOf = (opts: MakeOptions): readonly WornPart[] => (opts.hat ? [opts.hat, ...(opts.worn ?? [])] : (opts.worn ?? []));

export function makeContext(spec: BaseSpec, look: CharLook, b: Builder, opts: MakeOptions = {}): Ctx {
  const t = BUILD_FACTORS[look.build];
  const HS = headMatrix(look.head);
  const hm = (m: THREE.Matrix4) => (HS ? HS.clone().multiply(m) : m);
  const headOnly = !!opts.headOnly;
  const worn = wornOf(opts);
  const add = (geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint, w: Weights, ink = true) => b.add(geo, m, paint, w, ink, typeof paint === "function");
  return {
    b,
    look,
    style: styleOf(look, spec.native),
    t,
    hs: look.head,
    hm,
    fit: worn.find((w) => w.fit)?.fit ?? NO_FIT,
    hidesBadge: worn.some((w) => w.hidesBadge),
    hideTail: worn.some((w) => w.hideTail),
    limbs: spec.limbs,
    headOnly,
    add,
    addBody: (geo, m, paint, w, ink = true) => {
      if (!headOnly) add(geo, m, paint, w, ink);
    },
    addHead: (geo, m, paint, ink = true) => add(geo, hm(m), paint, "head", ink),
    head: spec.head,
    torsoR: (y) => spec.torsoR(y) * t.torso,
  };
}

/** Builds a character on a base. (`index.ts` picks the base by the look's own; a host that wants one base calls this with it.) */
export function buildWith(spec: BaseSpec, look: CharLook, opts: MakeOptions = {}) {
  const b = new Builder();
  const c = makeContext(spec, look, b, opts);
  spec.build(c);
  if (!c.headOnly) {
    clothesExtras(c);
    // The shadow: a flat dark disc on its own bone, which stays on the floor under a hop.
    c.addBody(new THREE.CircleGeometry(0.62, 20), mtx(0, 0.02, 0, -Math.PI / 2), "shadow", "shadow", false);
  }
  for (const w of wornOf(opts)) w.add?.(c);
  return { ...b.finish(), toonTris: b.p.length / 9, inkTris: b.ip.length / 9, look };
}
export type Made = ReturnType<typeof buildWith>;

/** Paints (or paints again) the character's colours: a colour change needs no new geometry. */
export function paintCharacter(made: Made, colors: CharColors = made.look.colors) {
  paintGeometry(made.body, made.paints, makePalette(colors));
}

export type { HairFit };
