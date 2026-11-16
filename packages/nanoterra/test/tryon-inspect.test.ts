// The try-on stage's numbers (src/shop/viewer/inspect.ts), with no GPU: each framing is checked through a real three.js camera placed as the
// viewer places it, so "whole" means what the stage draws. Boxes of several sizes and places, stage aspects 0.5, 1, 1.5 and 2.5, twelve turns.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  BACK,
  CLOSEST,
  FRONT,
  LIFT,
  MARGIN,
  PAN_STEP,
  TURN_STEP,
  ZOOM_STEP,
  clampView,
  cornersAt,
  ease,
  isRound,
  keyStep,
  limits,
  listWords,
  panBy,
  pinchFactor,
  ringPoints,
  sameView,
  screenOf,
  sideOf,
  tryOnView,
  turnDiff,
  turnsByItself,
  wheelFactor,
  wholeView,
  yawFor,
  zoomBy,
  type Box,
  type Frame,
  type View,
} from "../src/shop/viewer/inspect.js";

const FOV = 30;
/** The kit's character's whole box (about the Classic's, the shadow disc included). */
const BODY: Box = { min: [-0.62, -0.01, -0.62], max: [0.62, 2.3, 0.62] };
const frame: Frame = { body: BODY, fov: FOV };
const ASPECTS = [0.5, 1, 1.5, 2.5];

/** Items as a game's `part` gives them: hats, a wide brim, a tall hat, a scarf, a pack, a tool in the hand, a tiny charm, a long cape. */
const ITEMS: Record<string, Box> = {
  cap: { min: [-0.48, 1.72, -0.48], max: [0.48, 2.05, 0.75] },
  "wide brim": { min: [-0.85, 1.85, -0.85], max: [0.85, 2.1, 0.85] },
  "top hat": { min: [-0.36, 1.9, -0.36], max: [0.36, 2.75, 0.36] },
  scarf: { min: [-0.42, 1.25, -0.3], max: [0.42, 1.55, 0.42] },
  pack: { min: [-0.36, 0.85, -0.78], max: [0.36, 1.55, -0.3] },
  shovel: { min: [-0.75, 0.3, -0.1], max: [-0.55, 1.4, 1.1] },
  charm: { min: [0.3, 0.95, 0.25], max: [0.36, 1.01, 0.31] },
  cape: { min: [-0.6, 0.2, -0.75], max: [0.6, 1.6, -0.2] },
};

function cameraFor(v: View, aspect: number) {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.01, 100);
  cam.position.set(v.x, v.y + LIFT * v.d, v.d);
  cam.lookAt(v.x, v.y, 0);
  cam.updateMatrixWorld(true);
  return cam;
}
const corners = (b: Box) => [b.min[0], b.max[0]].flatMap((x) => [b.min[1], b.max[1]].flatMap((y) => [b.min[2], b.max[2]].map((z) => new THREE.Vector3(x, y, z))));
/** The box's corners, turned by `yaw` about the upright axis (the stage turns the character), on the screen of this view: x and y from -1 to 1. */
function projected(b: Box, yaw: number, v: View, aspect: number) {
  const cam = cameraFor(v, aspect);
  const up = new THREE.Vector3(0, 1, 0);
  return corners(b).map((p) => p.applyAxisAngle(up, yaw).project(cam));
}

test("a try-on frames the item whole with the margin on stages of aspect 0.5, 1, 1.5 and 2.5: a hat at every turn, another item from its side", () => {
  const lim = 1 - 2 * MARGIN + 1e-6;
  let cases = 0;
  for (const aspect of ASPECTS) {
    for (const [name, box] of Object.entries(ITEMS)) {
      const side = sideOf(box) === "back" ? BACK : FRONT;
      const v = tryOnView(box, frame, aspect);
      for (let k = 0; k < 12; k++) {
        // a round item at twelve turns; another item at its side (and at 3 turns round it: the same side, a whole turn later)
        const yaw = isRound(box) ? (k * Math.PI) / 6 : side + Math.floor(k / 4) * 2 * Math.PI;
        for (const p of projected(box, yaw, v, aspect)) {
          assert.ok(Math.abs(p.x) <= lim && Math.abs(p.y) <= lim, `${name} at aspect ${aspect}, turn ${k}: a corner at (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
          assert.ok(p.z < 1, `${name}: a corner is behind the camera`);
        }
        cases++;
      }
    }
  }
  assert.equal(cases, 4 * Object.keys(ITEMS).length * 12);
});

test("a try-on fills the stage: the item's cylinder touches the margin across or up (it is as large as the stage allows)", () => {
  const lim = 1 - 2 * MARGIN;
  for (const aspect of ASPECTS) {
    for (const [name, box] of Object.entries(ITEMS)) {
      const v = tryOnView(box, frame, aspect);
      const near = limits(frame, aspect).near;
      if (v.d <= near + 1e-9) continue; // a tiny item: the closest view (next test)
      const yaw = sideOf(box) === "back" ? BACK : FRONT;
      const s = (isRound(box) ? ringPoints(box) : cornersAt(box, yaw)).map((p) => screenOf(p, v, aspect, FOV));
      const fill = Math.max(...s.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y))));
      assert.ok(fill >= lim * 0.995, `${name} at aspect ${aspect}: fills ${fill.toFixed(3)} of ${lim}`);
      // And a box's corners at the side shown fill a set share of the stage: at least 60% across or up.
      const front = projected(box, yaw, v, aspect);
      const span = Math.max((Math.max(...front.map((p) => p.x)) - Math.min(...front.map((p) => p.x))) / 2, (Math.max(...front.map((p) => p.y)) - Math.min(...front.map((p) => p.y))) / 2);
      assert.ok(span >= 0.6 * lim, `${name} at aspect ${aspect}: the box spans ${span.toFixed(3)}`);
    }
  }
});

test("the screen numbers of the pure module are three.js's own projection", () => {
  for (const aspect of ASPECTS) {
    const v: View = { x: 0.2, y: 1.3, d: 4.2 };
    const cam = cameraFor(v, aspect);
    for (const p of [[0.3, 1.9, 0.2], [-0.5, 0.2, -0.4], [0.1, 2.4, 0.6]] as [number, number, number][]) {
      const want = new THREE.Vector3(...p).project(cam);
      const got = screenOf(p, v, aspect, FOV);
      assert.ok(Math.abs(got.x - want.x) < 1e-9 && Math.abs(got.y - want.y) < 1e-9, `${p} at ${aspect}`);
    }
  }
});

test("a tiny item gets the closest view (the charm with what is round it), still whole", () => {
  for (const aspect of ASPECTS) {
    const v = tryOnView(ITEMS.charm, frame, aspect);
    assert.equal(v.d, limits(frame, aspect).near);
    for (const p of projected(ITEMS.charm, FRONT, v, aspect)) assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
  }
  // the closest view shows CLOSEST of the character's height
  const near = limits(frame, 1).near;
  assert.ok(Math.abs(2 * near * Math.tan((FOV / 2) * (Math.PI / 180)) - CLOSEST * 2.31) < 1e-9);
});

test("no box (a colour), or a box that is not good: the whole character, whole at every turn", () => {
  for (const aspect of ASPECTS) {
    const w = wholeView(frame, aspect);
    assert.ok(sameView(tryOnView(null, frame, aspect), w));
    assert.ok(sameView(tryOnView({ min: [0, NaN, 0], max: [1, 1, 1] }, frame, aspect), w));
    assert.ok(Math.abs(w.x) < 1e-6, "the whole character is on its axis");
    assert.ok(sameView(tryOnView({ min: [0, 2, 0], max: [1, 1, 1] }, frame, aspect), w));
    for (let k = 0; k < 12; k++) for (const p of projected(BODY, (k * Math.PI) / 6, w, aspect)) assert.ok(Math.abs(p.x) <= 1 - 2 * MARGIN + 1e-6 && Math.abs(p.y) <= 1 - 2 * MARGIN + 1e-6);
  }
});

test("a narrower stage puts the camera farther for the same item (the stage fits again on a resize)", () => {
  for (const name of Object.keys(ITEMS)) {
    const ds = ASPECTS.map((a) => tryOnView(ITEMS[name], frame, a).d);
    for (let i = 1; i < ds.length; i++) assert.ok(ds[i] <= ds[i - 1] * (1 + 1e-5), `${name}: ${ds.join(", ")}`);
  }
});

test("the hats are round (framed at every turn); a pack, a cape, a tool, a scarf's knot and a charm are not", () => {
  for (const n of ["cap", "wide brim", "top hat"]) assert.ok(isRound(ITEMS[n]), n);
  for (const n of ["pack", "cape", "shovel", "charm"]) assert.ok(!isRound(ITEMS[n]), n);
  // cornersAt turns as three.js turns an object by rotation.y
  const o = new THREE.Object3D();
  o.rotation.y = 0.7;
  o.updateMatrixWorld(true);
  const want = corners(ITEMS.pack).map((p) => p.applyMatrix4(o.matrixWorld));
  cornersAt(ITEMS.pack, 0.7).forEach((p, i) => assert.ok(new THREE.Vector3(...p).distanceTo(want[i]) < 1e-12));
});

test("a pack and a cape are shown from the back; a hat, a scarf and a tool from the front; the shortest way round", () => {
  assert.equal(sideOf(ITEMS.pack), "back");
  assert.equal(sideOf(ITEMS.cape), "back");
  for (const n of ["cap", "wide brim", "top hat", "scarf", "shovel", "charm"]) assert.equal(sideOf(ITEMS[n]), "front", n);
  assert.equal(sideOf(null), "front");
  assert.ok(Math.abs(turnDiff(yawFor("back", 0.1), BACK)) < 1e-12);
  assert.ok(Math.abs(yawFor("back", FRONT) - FRONT) <= Math.PI + 1e-12);
  // from many turns round, the shortest way: never more than half a turn
  for (const now of [-20, -3, 0, 2, 7, 40]) for (const side of ["front", "back"] as const) assert.ok(Math.abs(yawFor(side, now) - now) <= Math.PI + 1e-9);
});

test("the zoom stays inside its limits: never closer than the closest view, never farther than a little past the whole character", () => {
  for (const aspect of ASPECTS) {
    const l = limits(frame, aspect);
    let v = wholeView(frame, aspect);
    for (let i = 0; i < 40; i++) v = zoomBy(v, ZOOM_STEP, frame, aspect);
    assert.equal(v.d, l.near);
    for (let i = 0; i < 40; i++) v = zoomBy(v, 1 / ZOOM_STEP, frame, aspect);
    assert.equal(v.d, l.far);
    assert.ok(l.far > wholeView(frame, aspect).d);
    // a pan stays on the character
    for (let i = 0; i < 40; i++) v = panBy(v, PAN_STEP, frame, aspect);
    assert.equal(v.y, l.hi);
    for (let i = 0; i < 40; i++) v = panBy(v, -PAN_STEP, frame, aspect);
    assert.equal(v.y, l.lo);
    assert.deepEqual(zoomBy(v, 0, frame, aspect), clampView(v, frame, aspect));
    assert.deepEqual(zoomBy(v, NaN, frame, aspect), clampView(v, frame, aspect));
  }
});

test("the keyboard: the arrows turn and move, + and - zoom, Home and 0 the whole character; Enter is the sheet's", () => {
  assert.deepEqual(keyStep("ArrowLeft"), { turn: -TURN_STEP });
  assert.deepEqual(keyStep("ArrowRight"), { turn: TURN_STEP });
  assert.deepEqual(keyStep("ArrowRight", true), { turn: 2 * TURN_STEP });
  assert.deepEqual(keyStep("ArrowUp"), { pan: PAN_STEP });
  assert.deepEqual(keyStep("ArrowDown"), { pan: -PAN_STEP });
  for (const k of ["+", "=", "Add"]) assert.deepEqual(keyStep(k), { zoom: ZOOM_STEP });
  for (const k of ["-", "_", "Subtract"]) assert.deepEqual(keyStep(k), { zoom: 1 / ZOOM_STEP });
  for (const k of ["Home", "0"]) assert.deepEqual(keyStep(k), { whole: true });
  for (const k of ["Enter", " ", "Escape", "Tab", "w", "a"]) assert.equal(keyStep(k), null, k);
  assert.equal(TURN_STEP * 16, Math.PI * 2, "sixteen steps make a whole turn");
});

test("the wheel and the pinch: up and apart are closer, one notch is one step, at most three", () => {
  assert.ok(Math.abs(wheelFactor(-100) - ZOOM_STEP) < 1e-12);
  assert.ok(Math.abs(wheelFactor(100) - 1 / ZOOM_STEP) < 1e-12);
  assert.ok(Math.abs(wheelFactor(-3, 1) - Math.pow(ZOOM_STEP, 0.99)) < 1e-12, "lines");
  assert.ok(Math.abs(wheelFactor(-10_000) - Math.pow(ZOOM_STEP, 3)) < 1e-12);
  assert.equal(wheelFactor(NaN), 1);
  assert.equal(pinchFactor(100, 150), 1.5);
  assert.equal(pinchFactor(0, 150), 1);
  assert.equal(pinchFactor(100, -1), 1);
});

test("the idle turn: only before the first touch, only at the whole character, never with reduced motion; reduced motion cuts", () => {
  assert.equal(turnsByItself(false, false, true), true);
  assert.equal(turnsByItself(true, false, true), false);
  assert.equal(turnsByItself(false, true, true), false);
  assert.equal(turnsByItself(false, false, false), false);
  assert.equal(ease(0, 5, 0.016, 9, true), 5);
  const step = ease(0, 5, 0.016, 9, false);
  assert.ok(step > 0 && step < 5);
  assert.equal(ease(0, 5, -1, 9, false), 0);
});

test("the words: a list in plain English", () => {
  assert.equal(listWords([]), "");
  assert.equal(listWords(["a cap"]), "a cap");
  assert.equal(listWords(["a", "b"]), "a and b");
  assert.equal(listWords(["a", "b", "c"]), "a, b and c");
});
