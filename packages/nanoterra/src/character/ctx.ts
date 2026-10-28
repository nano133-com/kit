import * as THREE from "three";
import type { Builder, Paint, Weights } from "./build.js";
import type { Limbs } from "./limbs.js";
import type { CharLook } from "./record.js";
import type { SocketName } from "./sockets.js";

// What a part gets to build with: the builder, the look, the size factors and the paint of each body segment (clothes.ts).

/** A head as an ellipsoid (its middle and its radii in the avatar's space, at rest). A face, a hair and a hat sit on it. `flat`: a flat screen face at this z. */
export type HeadSpec = {
  c: readonly [number, number, number];
  r: readonly [number, number, number];
  flat?: number;
  /** Every face shape stands this far off the surface (a visor or a screen over the head). */
  lift?: number;
  /** The mouth stands this much further out (a muzzle). */
  mouthLift?: number;
  /** The eyes' height, when it is not the head's middle (a body that is the head). */
  eye?: number;
};

/** The paint of each body segment: what the clothes make of the base's own skin or fur. */
export type Style = {
  torso: Paint;
  pelvis: Paint;
  shoulder: Paint;
  upper: Paint;
  elbow: Paint;
  fore: Paint;
  hand: Paint;
  thigh: Paint;
  knee: Paint;
  shin: Paint;
  foot: Paint;
  /** Rows of an arm's cylinders (a sleeve that ends part way, or stripes, need more than one). */
  rows: number;
};

/** What a worn head item does to the hair under it (hats.ts). */
export type HairFit = {
  /** Hair above the head (spikes, buns, curls, a high tail) is under the hat. */
  hideTop: boolean;
  /** The hair's scalp cap is under the hat. */
  hideCap: boolean;
  /** Hair that hangs (a tail, long hair) starts no higher than this (the hat's lower edge). */
  hangFrom: number;
  /** Hair that hangs is moved back by this much (a headband's knot and tails sit at the back). */
  pushBack: number;
  /** A base's own head-top (ears, antennae, a crown of leaves) is under the hat. */
  hideTopper: boolean;
};

/** A head item the host builds (the shop's hats): the hair's fit, and its shapes and bones added to the build after the body. */
export type HatPart = { fit: HairFit; add(c: Ctx): void };

/**
 * WHAT THE BUILDER NEEDS OF A WORN THING. The package draws the body only; the host brings the rest, through this one small interface. On nano133.com the
 * island's adapter (the shop's hats, scarves, packs, tops, buddies and blades, each fitted to every base) builds these; a game may bring its own.
 * `add` puts the thing's shapes and bones into the build after the body, in order, through the same context as the body's (`c.add`, `c.addHead`,
 * `c.b.bone`). A head item also says what it does to the hair (`fit`); the first that does decides. `hidesBadge`: the chest badge would poke through it.
 * `hideTail`: a back item (a cape, a pack, a plush) or a pinafore covers a base's tail.
 *
 * A thing with its own model (a .glb, say) names a `socket` ("head", "hand" or "back", sockets.ts) and gives its `object`: `createCharacter`
 * hangs the object on that socket (its own draws: 1 or 2 more for each thing) and still reads `fit`, `hidesBadge` and `hideTail`. The game
 * owns the object: the character never frees it. `add` is then optional (a thing can have both: merged shapes and a model).
 */
export type WornAdapter = {
  fit?: HairFit;
  hidesBadge?: boolean;
  hideTail?: boolean;
  add?(c: Ctx): void;
  socket?: SocketName;
  object?: THREE.Object3D;
};
/** A worn thing, by its older name (the same type as `WornAdapter`). */
export type WornPart = WornAdapter;

export const NO_FIT: HairFit = { hideTop: false, hideCap: false, hangFrom: Infinity, pushBack: 0, hideTopper: false };

export type Ctx = {
  b: Builder;
  look: CharLook;
  style: Style;
  /** Build factors: the torso's width and the limbs' thickness (1 at "regular"). */
  t: { torso: number; limb: number };
  /** The head's size, and a head part's matrix with it (the matrix itself when the size is 1). */
  hs: number;
  hm: (m: THREE.Matrix4) => THREE.Matrix4;
  fit: HairFit;
  /** A worn item hides the chest badge. */
  hidesBadge: boolean;
  /** A worn back item covers the base's tail (a Critter's). */
  hideTail: boolean;
  /** The base's arms and legs (a worn cuff follows the arm). */
  limbs: Limbs;
  /** Only the head and what sits on it (the pictures of faces and hats). */
  headOnly: boolean;
  /** One shape: a function paint colours each face by its middle. */
  add: (geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint, w: Weights, ink?: boolean) => void;
  /** The same, left out when only the head is built. */
  addBody: (geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint, w: Weights, ink?: boolean) => void;
  /** A head part: placed with the head's size, on the head bone. */
  addHead: (geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint, ink?: boolean) => void;
  head: HeadSpec;
  /** The torso's radius at a height (with the build's width): what a collar, a pocket or a strap follows. */
  torsoR: (y: number) => number;
};
