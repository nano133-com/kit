// The try-on stage's numbers: the camera's framing, the zoom limits, the keyboard steps, the turn. Pure: no Three.js and no DOM, so the
// framing is tested without a GPU (test/tryon-inspect.test.ts). The viewer (./index.ts) draws them.
//
// The scene: the character stands at the origin with its feet at y = 0 and faces +Z; the stage turns it about its upright axis (its yaw).
// The camera stands in front of it at a distance `d` from the point (x, y, 0) it looks at, lifted a little (LIFT) so it looks down a little.
// A view is that point and that distance (`x` is 0, the character's axis, but for an item held off to the side). Everything is in the character's own units (metres for the kit's character).
//
// A try-on frames the tried item WHOLE and as large as the stage allows: the item's real box on this character (the game's `part(look)`, or
// the kit's own hat with the head under it), the stage's real aspect, the camera's field of view, and MARGIN clear on every side. A round item
// about the character's axis (a hat, a crown: `isRound`) is framed as the upright cylinder that holds it, so it stays whole at every turn; any
// other item (a pack, a tool, a scarf's knot) as its box from the side the stage shows it (the front, or the back for a pack).

/** A box in the character's own space, at yaw 0: its least and its greatest corner. */
export type Box = { min: readonly [number, number, number]; max: readonly [number, number, number] };

/** The camera: the point it looks at (`x` across, 0 on the character's axis; `y` up) and its distance from that point. The camera stands in front
 *  of that point (+Z), lifted by LIFT. */
export type View = { x: number; y: number; d: number };

/** What the stage knows of the character now: its whole box, and the camera's vertical field of view (degrees). */
export type Frame = { body: Box; fov: number };

/** The share of the stage's width and of its height kept clear on each side of a framed item. */
export const MARGIN = 0.08;
/** The camera's lift over the point it looks at, as a share of its distance (it looks down a little). */
export const LIFT = 0.08;
/** The closest view shows this share of the character's height (a tiny item is seen with what is round it). */
export const CLOSEST = 0.22;
/** How much farther than the whole character a zoom out may go. */
export const FARTHEST = 1.15;
/** One step of the zoom keys, the wheel's notch, and the keyboard's + and -. */
export const ZOOM_STEP = 1.25;
/** One step of the arrow keys: a sixteenth of a turn (Shift: an eighth). */
export const TURN_STEP = Math.PI / 8;
/** One step of the up and down arrows, as a share of the height in view. */
export const PAN_STEP = 0.25;
/** The idle turn, in radians a second. */
export const IDLE_SPEED = 0.45;
/** The front a little from the character's right, as a shop shows a thing; the back is half a turn from it. */
export const FRONT = -0.4;
export const BACK = FRONT + Math.PI;

const tanOf = (fov: number) => Math.tan(((fov / 2) * Math.PI) / 180);

/** The smallest box that holds both. */
export function union(a: Box, b: Box): Box {
  return { min: [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i])) as unknown as Box["min"], max: [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i])) as unknown as Box["max"] };
}

/** Whether a box has a size and finite corners. */
export const boxOk = (b: Box | null | undefined): b is Box => !!b && [0, 1, 2].every((i) => Number.isFinite(b.min[i]) && Number.isFinite(b.max[i]) && b.max[i] >= b.min[i]);

/** The radius about the upright axis that holds every corner of a box. */
export function radiusOf(b: Box): number {
  let r = 0;
  for (const x of [b.min[0], b.max[0]]) for (const z of [b.min[2], b.max[2]]) r = Math.max(r, Math.hypot(x, z));
  return r;
}

/** The box's eight corners, turned by `yaw` about the upright axis (the stage turns the character the same way). */
export function cornersAt(b: Box, yaw: number): [number, number, number][] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: [number, number, number][] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x * c + z * s, y, -x * s + z * c]);
  return out;
}

/** Whether an item sits round the character's upright axis (a hat): its middle is near the axis, for its size. */
export const isRound = (b: Box) => Math.hypot((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2) <= 0.25 * radiusOf(b);

/** The points that hold a box at every turn: two 16-sided rings, just outside the upright cylinder round the axis that holds the box. */
export function ringPoints(b: Box): [number, number, number][] {
  const r = radiusOf(b) / Math.cos(Math.PI / 16);
  const out: [number, number, number][] = [];
  for (const y of [b.min[1], b.max[1]]) for (let k = 0; k < 16; k++) out.push([r * Math.cos((k * Math.PI) / 8), y, r * Math.sin((k * Math.PI) / 8)]);
  return out;
}

/** Where a point lands on the stage for a view: from -1 to 1 across and up (1 is the stage's edge), and its depth in front of the camera. */
export function screenOf(p: readonly [number, number, number], v: View, aspect: number, fov: number): { x: number; y: number; depth: number } {
  const tan = tanOf(fov);
  // The camera at (x, y + LIFT d, d) looks at (x, y, 0): its forward is (0, -LIFT, -1) and its up is (0, 1, -LIFT), both over |(1, LIFT)|.
  const n = Math.hypot(1, LIFT);
  const ry = p[1] - v.y - LIFT * v.d;
  const rz = p[2] - v.d;
  const depth = (-LIFT * ry - rz) / n;
  const up = (ry - LIFT * rz) / n;
  return { x: (p[0] - v.x) / (depth * tan * aspect), y: up / (depth * tan), depth };
}

/** The camera that holds these points with `margin` clear on each side, as close as it can be, the points in the middle across and up. */
export function fitPoints(pts: readonly (readonly [number, number, number])[], aspect: number, fov: number, margin = MARGIN): View {
  const a = Math.max(0.1, aspect);
  const lim = 1 - 2 * margin;
  let y = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
  let x = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
  const fits = (d: number) =>
    pts.every((p) => {
      const s = screenOf(p, { x, y, d }, a, fov);
      return s.depth > 1e-3 && Math.abs(s.x) <= lim && Math.abs(s.y) <= lim;
    });
  // A farther camera only makes the points smaller: the least distance that fits is found by halving.
  const least = () => {
    let far = 1;
    while (!fits(far) && far < 1e5) far *= 2;
    let near = 0;
    for (let i = 0; i < 50; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    return far;
  };
  let d = least();
  // A near edge lands farther out than a far one (and, seen from a little above, lower): move the look point until the points sit in the middle,
  // and fit again.
  for (let pass = 0; pass < 8; pass++) {
    const s = pts.map((p) => screenOf(p, { x, y, d }, a, fov));
    const midY = (Math.min(...s.map((q) => q.y)) + Math.max(...s.map((q) => q.y))) / 2;
    const midX = (Math.min(...s.map((q) => q.x)) + Math.max(...s.map((q) => q.x))) / 2;
    if (Math.abs(midY) < 1e-4 && Math.abs(midX) < 1e-4) break;
    const depth = (s.reduce((sum, q) => sum + q.depth, 0) / s.length) * tanOf(fov);
    y += midY * depth;
    x += midX * depth * a;
    d = least();
  }
  return { x, y, d };
}

/** The view of the whole character (at every turn). */
export const wholeView = (f: Frame, aspect: number): View => fitPoints(ringPoints(f.body), aspect, f.fov);

/** The nearest and the farthest distance a zoom may reach, and the lowest and highest point it may look at. */
export function limits(f: Frame, aspect: number): { near: number; far: number; lo: number; hi: number } {
  const whole = wholeView(f, aspect);
  const height = f.body.max[1] - f.body.min[1];
  const near = (height * CLOSEST) / 2 / tanOf(f.fov);
  return { near: Math.min(near, whole.d), far: whole.d * FARTHEST, lo: f.body.min[1], hi: f.body.max[1] };
}

/** A view kept inside the limits: its distance between the nearest and the farthest, and the point it looks at on the character. */
export function clampView(v: View, f: Frame, aspect: number): View {
  const l = limits(f, aspect);
  const d = Math.min(l.far, Math.max(l.near, v.d));
  const y = Math.min(l.hi, Math.max(l.lo, v.y));
  const x = Math.min(f.body.max[0], Math.max(f.body.min[0], v.x));
  return { x, y, d };
}

/** The view zoomed by a factor (more than 1 is closer). */
export const zoomBy = (v: View, factor: number, f: Frame, aspect: number): View => clampView(factor > 0 && Number.isFinite(factor) ? { x: v.x, y: v.y, d: v.d / factor } : v, f, aspect);

/** The view moved up (positive) or down by a share of the height in view. */
export const panBy = (v: View, share: number, f: Frame, aspect: number): View => clampView({ x: v.x, y: v.y + share * 2 * v.d * tanOf(f.fov), d: v.d }, f, aspect);

/**
 * A try-on's view, seen from `yaw` (default: the side `sideOf` shows): the item's box whole with MARGIN clear (a round item at every turn), as close as the stage's shape allows, and never closer than the
 * closest view (a tiny thing is seen with what is round it). A box that is not good: the whole character. It is not held to the zoom's far
 * limit: a wide brim may be wider than the whole character's view. The player's next zoom or pan comes back inside the limits.
 */
export function tryOnView(item: Box | null, f: Frame, aspect: number, yaw = item && sideOf(item) === "back" ? BACK : FRONT): View {
  if (!boxOk(item)) return wholeView(f, aspect);
  const v = fitPoints(isRound(item) ? ringPoints(item) : cornersAt(item, yaw), aspect, f.fov);
  return { x: v.x, y: v.y, d: Math.max(v.d, limits(f, aspect).near) };
}

/** The side a try-on shows: the back when the item sits behind the character's middle (a pack, a cape), else the front. */
export const sideOf = (item: Box | null): "front" | "back" => (boxOk(item) && (item.min[2] + item.max[2]) / 2 < -0.05 * Math.max(1e-6, item.max[1] - item.min[1] + radiusOf(item)) ? "back" : "front");

/** The shortest signed turn from `a` to `b` (radians). */
export const turnDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** The yaw that shows a side, from the yaw now (the shortest way round). */
export const yawFor = (side: "front" | "back", now: number) => now + turnDiff(now, side === "back" ? BACK : FRONT);

/** Two views are the same (to a ten-thousandth of the distance). */
export const sameView = (a: View, b: View) => Math.abs(a.x - b.x) <= 1e-4 * b.d && Math.abs(a.y - b.y) <= 1e-4 * b.d && Math.abs(a.d - b.d) <= 1e-4 * b.d;

/** Does the stage turn by itself? Only until the player first touches it, only at the whole character, and never with reduced motion. */
export const turnsByItself = (touched: boolean, calm: boolean, whole: boolean) => !touched && !calm && whole;

/** The wheel's turn as a zoom factor: one notch (100 px of deltaY) is one zoom step, at most three; up (negative) is closer. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  if (!Number.isFinite(px)) return 1;
  return Math.pow(ZOOM_STEP, Math.max(-3, Math.min(3, -px / 100)));
}

/** A pinch as a zoom factor: two fingers that were `from` apart are now `to` apart (apart is closer). */
export const pinchFactor = (from: number, to: number) => (from > 0 && to > 0 ? to / from : 1);

/** What a key does on the focused stage. The arrows turn and move up or down, + and - zoom, Home and 0 show the whole character. */
export type KeyStep = { turn: number } | { zoom: number } | { pan: number } | { whole: true } | null;

export function keyStep(key: string, shift = false): KeyStep {
  const turn = shift ? TURN_STEP * 2 : TURN_STEP;
  if (key === "ArrowLeft") return { turn: -turn };
  if (key === "ArrowRight") return { turn };
  if (key === "ArrowUp") return { pan: PAN_STEP };
  if (key === "ArrowDown") return { pan: -PAN_STEP };
  if (key === "+" || key === "=" || key === "Add") return { zoom: ZOOM_STEP };
  if (key === "-" || key === "_" || key === "Subtract") return { zoom: 1 / ZOOM_STEP };
  if (key === "Home" || key === "0") return { whole: true };
  return null;
}

/** One frame's step toward a value, without going past it: `rate` is how fast (per second); a calm stage (reduced motion) cuts at once. */
export const ease = (from: number, to: number, dt: number, rate: number, calm: boolean) => (calm ? to : from + (to - from) * (1 - Math.exp(-Math.max(0, dt) * rate)));

/** "a", "a and b", "a, b and c". */
export function listWords(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
