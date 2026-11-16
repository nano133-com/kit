// The kit's character as a try-on body (`@nano133/nanoterra/shop/viewer` with no `body`): the player's record, an outfit's body colour on the shirt,
// and the four hats of looks.json on the head socket. A chunk of its own (./index.ts loads it with import()), as it holds the character's builder.

import * as THREE from "three";
import { createCharacter, type Character } from "../../character/create.js";
import type { LookRecord } from "../../character/record.js";
import { makeRamp } from "../../character/toon.js";
import { isOutfit, type Hat, type Look } from "../../looks/look.js";
import type { TryOnBody } from "./index.js";

/** A hat of looks.json (`change.hat`), made round the middle of the Classic's head (the head socket's frame): up is +Y, the face is +Z. */
function hatOf(hat: Hat, colour: string, ramp: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = `hat-${hat}`;
  const mat = new THREE.MeshToonMaterial({ color: colour, gradientMap: ramp });
  const band = new THREE.MeshToonMaterial({ color: "#ffffff", gradientMap: ramp });
  const put = (geo: THREE.BufferGeometry, y: number, z = 0, m: THREE.Material = mat) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(0, y, z);
    group.add(mesh);
    return mesh;
  };
  if (hat === "cap") {
    put(new THREE.SphereGeometry(0.47, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.12).scale.set(1, 0.72, 1);
    put(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20), 0.14, 0.38).scale.set(1.1, 1, 0.85);
  } else if (hat === "beanie") {
    put(new THREE.SphereGeometry(0.48, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0.08);
    put(new THREE.TorusGeometry(0.45, 0.07, 8, 28), 0.12).rotation.x = Math.PI / 2;
    put(new THREE.SphereGeometry(0.12, 12, 8), 0.58, 0, band);
  } else if (hat === "crown") {
    put(new THREE.CylinderGeometry(0.33, 0.31, 0.22, 14), 0.48);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      put(new THREE.ConeGeometry(0.07, 0.2, 6), 0.68).position.set(Math.sin(a) * 0.29, 0.68, Math.cos(a) * 0.29);
    }
  } else {
    put(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 28), 0.34);
    put(new THREE.CylinderGeometry(0.32, 0.34, 0.58, 22), 0.64);
    put(new THREE.CylinderGeometry(0.345, 0.345, 0.09, 22), 0.42, 0, band);
  }
  return group;
}

function freeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
  });
}

/**
 * The kit's character as a try-on body: the player's record, an outfit's body colour on the shirt (a free outfit leaves the record's colours, as
 * the game starter does), and its hat on the head socket. An item of a game's own wear slot has no shape here (the game draws it: give `body`).
 */
export function kitBody(record?: LookRecord | null): TryOnBody<Look> {
  const c: Character = createCharacter({ record: record ?? undefined });
  const ramp = makeRamp();
  const head = c.socket("head");
  let hat: THREE.Group | null = null;
  return {
    object: c.object,
    dress(look) {
      if (!isOutfit(look)) return;
      c.setColors(look.priceUsd > 0 ? { shirt: look.change.body } : null);
      if (hat) {
        head.remove(hat);
        freeTree(hat);
        hat = null;
      }
      if (look.change.hat) head.add((hat = hatOf(look.change.hat, look.change.hatColor ?? "#333333", ramp)));
    },
    part(look) {
      if (!isOutfit(look) || !hat) return null;
      // The hat with the head under it: the head is about the hat frame's unit round the socket's origin.
      c.object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(hat, true);
      const corner = new THREE.Vector3();
      for (const x of [-0.5, 0.5]) for (const y of [-0.55, 0.2]) for (const z of [-0.5, 0.55]) box.expandByPoint(head.localToWorld(corner.set(x, y, z)));
      return box;
    },
    update: (dt) => c.update(dt),
    dispose() {
      if (hat) freeTree(hat);
      ramp.dispose();
      c.dispose();
    },
  };
}
