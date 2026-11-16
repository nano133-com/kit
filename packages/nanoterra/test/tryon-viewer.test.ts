// The kit's try-on viewer (src/shop/viewer/index.ts) in Node: the kit's character as a try-on body (its four hats, the box it frames), the framing
// of that real box through a three.js camera, and the contract's "no WebGL" path (mount throws: the sheet keeps its still picture).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { HATS, type Look } from "../src/looks/look.js";
import { LIFT, MARGIN, loadKitBody, mount, sideOf, tryOnView, tryOnViewer, type Box } from "../src/shop/viewer/index.js";
import { kitBody } from "../src/shop/viewer/kit.js";

const outfit = (hat: (typeof HATS)[number] | null, price = 0.25): Look => ({ id: `o-${hat ?? "none"}`, name: "O", priceUsd: price, change: { body: "#e0453b", ...(hat ? { hat, hatColor: "#222222" } : {}) } });
const boxOf = (b: THREE.Box3): Box => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });

test("the kit's character: each hat of looks.json is on the head, and `part` frames the hat with the head under it", () => {
  const body = kitBody();
  body.object.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(body.object, true);
  for (const hat of HATS) {
    body.dress(outfit(hat));
    const part = body.part!(outfit(hat)) as THREE.Box3;
    assert.ok(part instanceof THREE.Box3, hat);
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

test("the kit's character with a hat, framed by the stage: the hat whole with the margin, on every aspect, at every turn", () => {
  const body = kitBody();
  const lim = 1 - 2 * MARGIN + 1e-6;
  for (const hat of HATS) {
    body.dress(outfit(hat));
    body.object.updateMatrixWorld(true);
    const whole = boxOf(new THREE.Box3().setFromObject(body.object, true));
    const part = boxOf(body.part!(outfit(hat)) as THREE.Box3);
    const hatBox = new THREE.Box3().setFromObject(body.object.getObjectByName(`hat-${hat}`)!, true);
    for (const aspect of [0.5, 1, 1.5, 2.5]) {
      const v = tryOnView(part, { body: whole, fov: 30 }, aspect);
      const cam = new THREE.PerspectiveCamera(30, aspect, 0.01, 100);
      cam.position.set(v.x, v.y + LIFT * v.d, v.d);
      cam.lookAt(v.x, v.y, 0);
      cam.updateMatrixWorld(true);
      for (let k = 0; k < 12; k++) {
        const turn = new THREE.Matrix4().makeRotationY((k * Math.PI) / 6);
        for (const x of [hatBox.min.x, hatBox.max.x]) for (const y of [hatBox.min.y, hatBox.max.y]) for (const z of [hatBox.min.z, hatBox.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(turn).project(cam);
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
