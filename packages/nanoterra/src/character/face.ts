import * as THREE from "three";
import { G, mtx, roundedBox } from "./kit.js";
import type { Ctx, HeadSpec } from "./ctx.js";
import type { BrowId, FaceId, GlassesId } from "./lists.js";

// Faces: a set of eyes and a mouth, then brows, blush, freckles and glasses. Each shape sits on the head's surface (`onHead`: the head is an
// ellipsoid, ctx.ts HeadSpec; a robot's screen is flat). The Classic face on the Classic head is today's, number for number.

const _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

/** A point on the front of the head at (x, y), lifted off the surface by `lift`, and the way the surface faces. */
export function onHead(h: HeadSpec, x: number, y: number, lift = 0) {
  lift += h.lift ?? 0;
  if (h.flat !== undefined) return { at: new THREE.Vector3(x, y, h.flat + lift), n: new THREE.Vector3(0, 0, 1) };
  const [cx, cy, cz] = h.c;
  const [rx, ry, rz] = h.r;
  const u = (x - cx) / rx;
  const v = (y - cy) / ry;
  const w = Math.sqrt(Math.max(0.02, 1 - u * u - v * v));
  const z = cz + rz * w;
  const n = new THREE.Vector3(u / rx, v / ry, w / rz).normalize();
  return { at: new THREE.Vector3(x, y, z).addScaledVector(n, lift), n };
}

/** A matrix that lays a shape on the surface at (x, y): turned to face outward, then scaled (sx, sy, sz) in its own frame, with a roll. */
export function onFace(h: HeadSpec, x: number, y: number, lift: number, sx: number, sy = sx, sz = sx, roll = 0) {
  const { at, n } = onHead(h, x, y, lift);
  _q.setFromUnitVectors(_z, n);
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_z, roll));
  return new THREE.Matrix4().compose(at, _q.clone(), new THREE.Vector3(sx, sy, sz));
}

const arc = (r: number, tube: number, a = Math.PI) => new THREE.TorusGeometry(r, tube, 4, 12, a);
const halfDisc = (r: number) => new THREE.CircleGeometry(r, 10, 0, Math.PI);
const star = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
})();

/** The colour of what a face draws: dark shapes on skin, bright light on a screen. */
function inks(c: Ctx) {
  const screen = c.head.flat !== undefined || c.look.base === "round";
  return screen ? { eye: "glow", dark: "glow", mouth: "glow", white: "glowSoft", brow: "glow" } : { eye: "eye", dark: "ink", mouth: "mouth", white: "white", brow: "hairDark" };
}

type EyeSet = (c: Ctx, y: number, ink: ReturnType<typeof inks>) => void;
type MouthSet = (c: Ctx, y: number, ink: ReturnType<typeof inks>) => void;

const EX = 0.15;

const eyes: Record<FaceId, EyeSet> = {
  classic: (c, y, k) => {
    const flat = c.head.flat !== undefined;
    for (const x of [-EX, EX]) c.addHead(G.sph, flat || c.look.base !== "classic" ? onFace(c.head, x, y, 0.0, 0.065, 0.1, 0.04) : mtx(x, 1.8, 0.385, 0, 0, 0, 0.065, 0.1, 0.04), k.eye, false);
  },
  cheerful: (c, y, k) => {
    for (const x of [-EX, EX]) {
      c.addHead(G.ball6, onFace(c.head, x, y, 0.004, 0.1, 0.115, 0.03), k.white, false);
      c.addHead(G.ball6, onFace(c.head, x, y - 0.005, 0.02, 0.066, 0.085, 0.03), k.eye, false);
      c.addHead(G.ball6, onFace(c.head, x + 0.025, y + 0.035, 0.036, 0.026, 0.03, 0.02), "white", false);
    }
  },
  happy: (c, y, k) => {
    for (const x of [-EX, EX]) c.addHead(arc(0.07, 0.018), onFace(c.head, x, y - 0.03, 0.01, 1, 1, 1), k.dark, false);
  },
  sleepy: (c, y, k) => {
    for (const x of [-EX, EX]) {
      c.addHead(G.ball6, onFace(c.head, x, y - 0.02, 0.004, 0.085, 0.018, 0.03), k.dark, false);
      c.addHead(G.ball6, onFace(c.head, x, y + 0.008, 0.008, 0.07, 0.016, 0.026, x > 0 ? -0.08 : 0.08), k.dark, false);
    }
  },
  wink: (c, y, k) => {
    c.addHead(G.ball6, onFace(c.head, -EX, y, 0.0, 0.065, 0.1, 0.04), k.eye, false);
    c.addHead(arc(0.065, 0.018), onFace(c.head, EX, y - 0.03, 0.01, 1, 1, 1), k.dark, false);
  },
  starry: (c, y, k) => {
    for (const x of [-EX, EX]) c.addHead(star, onFace(c.head, x, y, 0.014, 0.12, 0.12, 1), c.look.base === "classic" || k.eye === "eye" ? "gold" : k.eye, false);
  },
  calm: (c, y, k) => {
    for (const x of [-EX, EX]) c.addHead(G.ball6, onFace(c.head, x, y, 0.0, 0.05, 0.05, 0.03), k.eye, false);
  },
  // The room blob's visor: one bar of light (dark on a base with no visor), standing just off the head.
  bar: (c, y, k) => {
    c.addHead(roundedBox(0.34, 0.1, 0.07, 2, 0.035), onFace(c.head, 0, y, 0.02 - (c.head.lift ?? 0), 1, 1, 1), k.eye, false);
  },
};

const mouths: Record<FaceId, MouthSet> = {
  classic: (c, y, k) => {
    const flat = c.head.flat !== undefined;
    c.addHead(G.sph, flat || c.look.base !== "classic" ? onFace(c.head, 0, y, 0.0, 0.09, 0.035, 0.03) : mtx(0, 1.68, 0.4, 0, 0, 0, 0.09, 0.035, 0.03), k.mouth, false);
  },
  cheerful: (c, y, k) => {
    c.addHead(arc(0.11, 0.02), onFace(c.head, 0, y + 0.07, 0.01, 1, 1, 1, Math.PI), k.dark, false);
  },
  happy: (c, y, k) => {
    c.addHead(halfDisc(0.12), onFace(c.head, 0, y + 0.07, 0.008, 1, 1, 1, Math.PI), k.dark, false);
    if (k.mouth === "mouth") c.addHead(G.ball6, onFace(c.head, 0, y - 0.035, 0.016, 0.06, 0.03, 0.02), "mouth", false);
  },
  sleepy: (c, y, k) => {
    c.addHead(G.ball6, onFace(c.head, 0, y, 0.004, 0.035, 0.045, 0.03), k.mouth, false);
  },
  wink: (c, y, k) => {
    for (const x of [-0.055, 0.055]) c.addHead(arc(0.055, 0.016), onFace(c.head, x, y + 0.045, 0.01, 1, 1, 1, Math.PI), k.dark, false);
  },
  starry: (c, y, k) => {
    c.addHead(halfDisc(0.15), onFace(c.head, 0, y + 0.08, 0.008, 1, 1, 1, Math.PI), k.dark, false);
    if (k.mouth === "mouth") c.addHead(G.ball6, onFace(c.head, 0, y - 0.045, 0.016, 0.075, 0.035, 0.02), "mouth", false);
  },
  calm: (c, y, k) => {
    c.addHead(G.ball6, onFace(c.head, 0, y, 0.004, 0.06, 0.014, 0.025), k.dark, false);
  },
  bar: () => {},
};

function brows(c: Ctx, id: BrowId, y: number, k: ReturnType<typeof inks>) {
  if (id === "none") return;
  const by = y + 0.14;
  for (const s of [-1, 1]) {
    const x = s * EX;
    if (id === "straight") c.addHead(G.box, onFace(c.head, x, by, 0.008, 0.115, 0.024, 0.026), k.brow, false);
    else if (id === "arched") c.addHead(arc(0.075, 0.017), onFace(c.head, x, by - 0.045, 0.01, 1, 1, 1), k.brow, false);
    else c.addHead(G.box, onFace(c.head, x, by, 0.008, 0.115, 0.026, 0.026, s * 0.38), k.brow, false);
  }
}

/** The face's height on the head: the eyes' y, and the mouth's. */
export function faceLines(h: HeadSpec) {
  const cy = h.eye ?? h.c[1];
  return { eye: h.flat !== undefined ? cy + 0.04 : cy, mouth: h.flat !== undefined ? cy - 0.15 : cy - 0.12 };
}

export function addFace(c: Ctx) {
  const k = inks(c);
  const lines = faceLines(c.head);
  eyes[c.look.face](c, lines.eye, k);
  mouths[c.look.face]({ ...c, head: { ...c.head, mouthLift: undefined, lift: (c.head.lift ?? 0) + (c.head.mouthLift ?? 0) } }, lines.mouth, k);
  brows(c, c.look.brows, lines.eye, k);
  if (c.look.blush) for (const s of [-1, 1]) c.addHead(G.ball6, onFace(c.head, s * 0.27, lines.eye - 0.09, 0.0, 0.075, 0.048, 0.02), "rose", false);
  if (c.look.freckles) {
    const spots: [number, number][] = [[-0.2, -0.07], [-0.14, -0.1], [-0.27, -0.1], [-0.08, -0.055], [0.2, -0.07], [0.14, -0.1], [0.27, -0.1], [0.08, -0.055]];
    for (const [x, dy] of spots) c.addHead(G.ball6, onFace(c.head, x, lines.eye + dy, 0.0, 0.02, 0.02, 0.012), "skinDark", false);
  }
  glasses(c, c.look.glasses, lines.eye);
}

function glasses(c: Ctx, id: GlassesId, y: number) {
  if (id === "none" || c.head.flat !== undefined) return;
  const lift = 0.05;
  for (const s of [-1, 1]) {
    const x = s * EX;
    if (id === "round") c.addHead(new THREE.TorusGeometry(0.115, 0.017, 4, 14), onFace(c.head, x, y, lift, 1, 1, 1), "ink", false);
    else if (id === "square") {
      const f = onFace(c.head, x, y, lift, 1, 1, 1);
      const bars: [number, number, number, number][] = [[0, 0.1, 0.23, 0.032], [0, -0.1, 0.23, 0.032], [-0.115, 0, 0.032, 0.2], [0.115, 0, 0.032, 0.2]];
      for (const [bx, by, bw, bh] of bars) c.addHead(G.box, f.clone().multiply(mtx(bx, by, 0, 0, 0, 0, bw, bh, 0.03)), "ink", false);
    } else c.addHead(G.ball6, onFace(c.head, x, y, lift, 0.13, 0.095, 0.035), "shade", false);
  }
  c.addHead(G.box, onFace(c.head, 0, y + 0.015, lift, 0.07, 0.022, 0.026), "ink", false);
  // The arms of the glasses reach back along the head to the ears.
  for (const s of [-1, 1]) {
    const a = onHead(c.head, s * (EX + 0.115), y, lift).at;
    const b = new THREE.Vector3(s * 0.4, y + 0.01, 0.0);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const d = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    c.addHead(G.box, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(0.022, d.length(), 0.022)), "ink", false);
  }
}
