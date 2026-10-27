import * as THREE from "three";
import { classicTorso } from "./bases/classic.js";
import type { Fit } from "./build.js";
import type { Ctx, HeadSpec } from "./ctx.js";

// Worn items are drawn for the Classic body (the shop's items, app/cosmetics/wear3d). On another base, or with another build, each one is
// moved onto that body as it is built: a part that hugs the torso (a scarf, a top, a pack, a sheath) is pushed out or in by how much wider or
// narrower this body is than the Classic's at that height, round the torso's axis; a cuff follows the base's arm; a buddy keeps clear of the
// shoulder. The height of a vertex never changes, so a part's bones, which are placed by height, stay where they were. On the Classic base with
// the regular build the answer is 0 everywhere, so the item is built number for number as the shop made it.

const CLASSIC_HEAD: HeadSpec = { c: [0, 1.8, 0], r: [0.42, 0.42, 0.42] };

/** The width of a head ellipsoid at a height, the head scaled by `hs` about the neck (the neck is at 1.5). 0 outside it. */
function headRadius(h: HeadSpec, hs: number, y: number): number {
  const cy = 1.5 + (h.c[1] - 1.5) * hs;
  const ry = h.r[1] * hs;
  const t = (y - cy) / ry;
  return Math.abs(t) >= 1 ? 0 : h.r[0] * hs * Math.sqrt(1 - t * t);
}

/** The Classic body's radius at a height: the torso's; at the neck the head's too, when it is wider. */
const classicR = (y: number, neck: boolean) => (neck ? Math.max(classicTorso(y), headRadius(CLASSIC_HEAD, 1, y)) : classicTorso(y));

/** This character's body radius at a height. A base whose head is its body (the Pineapple) is not scaled by the head size. */
function bodyR(c: Ctx, y: number, neck: boolean): number {
  const t = c.torsoR(y);
  if (!neck) return t;
  return Math.max(t, headRadius(c.head, c.head.c[1] < 1.5 ? 1 : c.hs, y));
}

/** How far out (positive) or in this body is from the Classic's at a height, at the neck or on the torso. */
export function bodyDelta(c: Ctx, y: number, neck: boolean): number {
  return THREE.MathUtils.clamp(bodyR(c, y, neck) - classicR(y, neck), -0.24, 0.32);
}

/** The slots of an item that hugs the body. */
export type FitSlot = "neck" | "top" | "back" | "blade";

/** A fit for the shapes of an item worn in `slot`: pushed out or in round the torso's axis, but not near the axis itself (a strap's middle, a knot). */
export function slotFit(c: Ctx, slot: FitSlot): Fit {
  const neck = slot === "neck";
  return (p) => {
    const r = Math.hypot(p.x, p.z);
    if (r < 1e-4) return 1;
    const d = bodyDelta(c, p.y, neck) * THREE.MathUtils.smoothstep(r, 0.1, 0.3);
    if (d === 0) return 1;
    const k = (r + d) / r;
    p.x *= k;
    p.z *= k;
    return k;
  };
}

/** How much further out than the Classic's the base's arms are drawn (the build and the base's own width). */
const armOut = (c: Ctx) => 0.45 * (c.t.torso - 1) + (c.limbs.armOut ?? 0);

/** A fit for a part on a forearm (a cuff): the arm is as far out and as thick as this base's. */
export function armFit(c: Ctx): Fit {
  const out = armOut(c);
  const scale = THREE.MathUtils.clamp((c.limbs.fore[0] * c.t.limb) / 0.115, 0.4, 1.4);
  return (p) => {
    const s = p.x < 0 ? -1 : 1;
    const ax = s * 0.47;
    p.x = ax + (p.x - ax) * scale + s * out;
    p.z *= scale;
    return scale;
  };
}

/** A fit for a buddy that floats at the shoulder: as far out as the base's arms are, so it is clear of a wide body. */
export function buddyFit(c: Ctx): Fit {
  const out = armOut(c);
  return (p) => {
    p.x += (p.x < 0 ? -1 : 1) * out;
    return 1;
  };
}
