// The kit's try-on viewer (src/shop/viewer/index.ts) in Node: the kit's character as a try-on body (its four hats, the box it frames), the framing
// of that real box through a three.js camera, and the contract's "no WebGL" path (mount throws: the sheet keeps its still picture).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as THREE from "three";
import { HATS, type Look } from "../src/looks/look.js";
import { loadKitBody, mount, tryOnViewer } from "../src/shop/viewer/index.js";
import { LIFT, MARGIN, sideOf, tryOnView, type Box } from "../src/shop/viewer/inspect.js";
import { kitBody } from "../src/shop/viewer/kit.js";

const outfit = (hat: (typeof HATS)[number] | null, price = 0.25): Look => ({ id: `o-${hat ?? "none"}`, name: "O", priceUsd: price, change: { body: "#e0453b", ...(hat ? { hat, hatColor: "#222222" } : {}) } });
const boxOf = (b: THREE.Box3, r?: number): Box => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], ...(r ? { r } : {}) });
/** What the stage measures of an object: its vertices' box (hidden meshes too) and their radius about the upright axis. */
function measured(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let r = 0;
  const v = new THREE.Vector3();
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    const pos = m.isMesh ? m.geometry.getAttribute("position") : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      box.expandByPoint(v);
      r = Math.max(r, Math.hypot(v.x, v.z));
    }
  });
  return { box, r };
}

test("the kit's character: each hat of looks.json is on the head, and `part` frames the hat with the head under it", () => {
  const body = kitBody();
  body.object.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(body.object, true);
  for (const hat of HATS) {
    body.dress(outfit(hat));
    const object = body.part!(outfit(hat)) as THREE.Object3D;
    assert.ok(object?.isObject3D, hat);
    const part = measured(object).box;
    const hatMesh = body.object.getObjectByName(`hat-${hat}`)!;
    assert.ok(hatMesh, `${hat} is on the character`);
    body.object.updateMatrixWorld(true);
    const hatBox = new THREE.Box3().setFromObject(hatMesh, true);
    assert.ok(part.containsBox(hatBox), `${hat}: the framed box holds the hat`);
    assert.ok(hatBox.min.y > whole.max.y * 0.6, `${hat} sits high on the character (${hatBox.min.y.toFixed(2)})`);
    assert.ok(part.min.y < hatBox.min.y, `${hat}: the head under the hat is framed too`);
    assert.equal(sideOf(boxOf(part)), "front", hat);
  }
  // one hat at a time: the last one only
  assert.equal(HATS.filter((h) => body.object.getObjectByName(`hat-${h}`)).length, 1);
  // a look with no hat, or an item of a game's own slot: the whole character (no part)
  body.dress(outfit(null));
  assert.equal(body.part!(outfit(null)), null);
  assert.equal(HATS.filter((h) => body.object.getObjectByName(`hat-${h}`)).length, 0);
  assert.equal(body.part!({ id: "spade", name: "Spade", priceUsd: 0.1, wear: "spade" }), null);
  body.update!(0.016);
  body.dispose();
});

test("the kit's character with a hat, framed by the stage: every vertex of the hat inside the margin, on every aspect, at every turn", () => {
  const body = kitBody();
  const lim = 1 - 2 * MARGIN + 1e-6;
  for (const hat of HATS) {
    body.dress(outfit(hat));
    body.object.updateMatrixWorld(true);
    const whole = boxOf(new THREE.Box3().setFromObject(body.object, true));
    const m = measured(body.part!(outfit(hat)) as THREE.Object3D);
    const part = boxOf(m.box, m.r);
    // the hat's real vertices (a box's corner, turned, can lie outside the round thing it holds)
    const hatPoints: THREE.Vector3[] = [];
    body.object.getObjectByName(`hat-${hat}`)!.traverse((x) => {
      const mesh = x as THREE.Mesh;
      const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : null;
      if (pos) for (let i = 0; i < pos.count; i++) hatPoints.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    });
    assert.ok(hatPoints.length > 50);
    for (const aspect of [0.5, 1, 1.5, 2.5]) {
      const v = tryOnView(part, { body: whole, fov: 30 }, aspect);
      const cam = new THREE.PerspectiveCamera(30, aspect, 0.01, 100);
      cam.position.set(v.x, v.y + LIFT * v.d, v.d);
      cam.lookAt(v.x, v.y, 0);
      cam.updateMatrixWorld(true);
      for (let k = 0; k < 12; k++) {
        const turn = new THREE.Matrix4().makeRotationY((k * Math.PI) / 6);
        for (const q of hatPoints) {
          const p = q.clone().applyMatrix4(turn).project(cam);
          assert.ok(Math.abs(p.x) <= lim && Math.abs(p.y) <= lim, `${hat}, aspect ${aspect}, turn ${k}: (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
        }
      }
    }
  }
  body.dispose();
});

test("the contract with no WebGL (Node, or a device without it): mount fails, so the sheet keeps the look's still picture", async () => {
  const ctx = { calm: () => true, onTap: () => {}, words: { zoomIn: "a", zoomOut: "b", whole: "c", turn: "d" } };
  const box = { append() {}, clientWidth: 300, clientHeight: 300 } as unknown as HTMLElement;
  await assert.rejects(async () => mount(box, ctx));
  let made = 0;
  const v = tryOnViewer({ body: () => (made++, kitBody()) });
  assert.equal(typeof v.mount, "function");
  await assert.rejects(async () => v.mount(box, ctx));
  assert.equal(made, 0, "no body is made when the renderer cannot start");
  assert.equal(await loadKitBody(), kitBody);
});

// The parts of the stage that need a GPU (Node has none): their rules, read from the source. A browser check proves them (the demo page).
test("the stage's rules that need a GPU: dispose frees the context, a plain wheel scrolls the list, a key at a limit keeps the focus", () => {
  const code = readFileSync(new URL("../src/shop/viewer/index.ts", import.meta.url), "utf8");
  const dispose = code.slice(code.indexOf("    dispose() {"));
  for (const call of ["cancelAnimationFrame(raf)", "observer?.disconnect()", "body.dispose()", "renderer.dispose()", "renderer.forceContextLoss()", "canvas.remove()"]) assert.ok(dispose.includes(call), `dispose: ${call}`);
  // in the list that scrolls (touch-action pan-y) a plain wheel scrolls it; a trackpad's pinch (ctrl) zooms
  assert.match(code, /const wheel = \(e: WheelEvent\) => \{[^}]*if \(!e\.ctrlKey && !ownsVertical\(\)\) return;/);
  // a key at a limit says so with aria-disabled: a disabled key would drop the focus to the page, where a game's walk keys act
  assert.doesNotMatch(code, /\.disabled\s*=|toggleAttribute\("disabled"|setAttribute\("disabled"/);
  // R5: the stage's keys stand whole in the stage, clear of Up close, or all hide together (out of the Tab order), checked at each size change;
  // the focus on a key that hides goes to the stage, never to the page
  const fit = code.slice(code.indexOf("function fitKeys()"), code.indexOf("// ---- the size ----"));
  for (const part of ["q.bottom <= s.bottom + 1", "q.right <= s.right + 1", "keys.contains(document.activeElement)) box.focus(", 'keys.style.display = "none"']) assert.ok(fit.includes(part), `fitKeys: ${part}`);
  assert.match(code, /function resize\(\) \{\s*fitKeys\(\);/);
});
