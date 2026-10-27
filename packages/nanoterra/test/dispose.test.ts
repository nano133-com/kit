import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createCharacter } from "../src/character/index.js";

type Counts = { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>; textures: Set<THREE.Texture>; skeletons: number; events: number };

/** Watches every geometry, material and texture that the character holds, and its skeleton, and counts each dispose. */
function watch(c: ReturnType<typeof createCharacter>) {
  const disposed: Counts = { geometries: new Set(), materials: new Set(), textures: new Set(), skeletons: 0, events: 0 };
  const held: Counts = { geometries: new Set(), materials: new Set(), textures: new Set(), skeletons: 0, events: 0 };
  const listen = (thing: THREE.EventDispatcher<{ dispose: object }>, into: Set<never>, from: Set<never>) => {
    from.add(thing as never);
    thing.addEventListener("dispose", () => {
      disposed.events++;
      into.add(thing as never);
    });
  };
  const objects: THREE.Object3D[] = [c.object];
  for (const root of objects) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!held.geometries.has(m.geometry)) listen(m.geometry as never, disposed.geometries as never, held.geometries as never);
      const mat = m.material as THREE.MeshToonMaterial;
      if (!held.materials.has(mat)) listen(mat as never, disposed.materials as never, held.materials as never);
      if (mat.gradientMap && !held.textures.has(mat.gradientMap)) listen(mat.gradientMap as never, disposed.textures as never, held.textures as never);
      const skel = (m as THREE.SkinnedMesh).skeleton;
      if (skel) {
        // what a renderer does on its first frame
        if (skel.boneTexture === null) {
          skel.computeBoneTexture();
          listen(skel.boneTexture as never, disposed.textures as never, held.textures as never);
          const was = skel.dispose.bind(skel);
          skel.dispose = () => {
            disposed.skeletons++;
            was();
          };
        }
      }
    });
  }
  return { disposed, held };
}

test("dispose frees what the character made: 2 geometries, 2 materials, the ramp, the bone texture, the skeleton", () => {
  const c = createCharacter();
  const { disposed, held } = watch(c);
  assert.equal(held.geometries.size, 2, "toon and ink: the shadow disc is part of the toon body");
  assert.equal(held.materials.size, 2);
  assert.equal(held.textures.size, 2, "the ramp and the bone texture");
  assert.equal(disposed.events, 0);
  c.dispose();
  assert.equal(disposed.geometries.size, 2);
  assert.equal(disposed.materials.size, 2);
  assert.equal(disposed.textures.size, 2);
  assert.equal(disposed.skeletons, 1, "the skeleton is shared by the two meshes and freed once");
  assert.deepEqual([...held.geometries].filter((g) => !disposed.geometries.has(g)), []);
  assert.deepEqual([...held.materials].filter((m) => !disposed.materials.has(m)), []);
  assert.deepEqual([...held.textures].filter((t) => !disposed.textures.has(t)), []);
  // every dispose is one event: nothing is freed twice
  assert.equal(disposed.events, 2 + 2 + 2);
});

test("quality low frees what it made: 1 geometry, 1 material, the ramp, the bone texture", () => {
  const c = createCharacter({ quality: "low" });
  const { disposed, held } = watch(c);
  assert.equal(held.geometries.size, 1, "the toon body, with its shadow disc");
  assert.equal(held.materials.size, 1);
  c.dispose();
  assert.equal(disposed.geometries.size, 1);
  assert.equal(disposed.materials.size, 1);
  assert.equal(disposed.textures.size, 2);
  assert.equal(disposed.skeletons, 1);
});

test("dispose twice frees once; the calls after it do nothing", () => {
  const c = createCharacter();
  const { disposed } = watch(c);
  c.dispose();
  const events = disposed.events;
  c.dispose();
  assert.equal(disposed.events, events);
  const pose = c.object.getObjectByName("upperarm_L") as THREE.Bone;
  const q = pose.quaternion.toArray();
  c.update(1 / 60, { speed: 6.5 });
  c.wave();
  c.setLook({ skin: "#000000", hair: "#000000", shirt: "#000000", pants: "#000000", shoes: "#000000" });
  c.setLook({ ...c.record, base: 2 });
  c.setColors({ shirt: "#000000" });
  assert.deepEqual(pose.quaternion.toArray(), q);
  assert.equal(c.look.skin, "#f2c29b");
  assert.equal(c.record.base, 0, "setLook after dispose changes nothing");
});

test("dispose takes the character out of the scene", () => {
  const scene = new THREE.Scene();
  const c = createCharacter();
  scene.add(c.object);
  assert.equal(scene.children.length, 1);
  c.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(c.object.parent, null);
});

test("disposing one character leaves another whole: nothing is shared", () => {
  const a = createCharacter();
  const b = createCharacter();
  const { disposed: forA } = watch(a);
  const { disposed: forB } = watch(b);
  a.dispose();
  assert.equal(forB.events, 0, "b freed nothing");
  assert.equal(forA.events, 6);
  b.update(1 / 60, { speed: 3 });
  b.dispose();
  assert.equal(forB.events, 6);
});

test("a hundred characters made and disposed leave no growth behind", () => {
  const live = new Set<unknown>();
  const track = (c: ReturnType<typeof createCharacter>) => {
    c.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        live.add(m.geometry);
        live.add(m.material);
        const ramp = (m.material as THREE.MeshToonMaterial).gradientMap;
        if (ramp) live.add(ramp);
      }
    });
  };
  for (let i = 0; i < 100; i++) {
    const c = createCharacter();
    track(c);
    c.dispose();
  }
  // 2 geometries, 2 materials and 1 ramp each: none is reused by a later character
  assert.equal(live.size, 100 * 5);
});
