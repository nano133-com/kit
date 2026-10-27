// The six bases (Classic, Round, Critter, Bee, Robot, Pineapple): each builds, moves, frees what it made, and rebuilds when `setLook` gives it another body.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { BASE_IDS, BONES, HEIGHTS, baseRecord, createCharacter, diceRecord, type Character, type LookRecord } from "../src/character/index.js";

const skinned = (c: Character) => {
  const out: THREE.SkinnedMesh[] = [];
  c.object.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
};

type Held = { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>; textures: Set<THREE.Texture>; freed: Set<unknown>; skeletons: Map<THREE.Skeleton, number> };

/** Every geometry, material and texture the character holds now, with what has been freed so far. `listen` again after a rebuild to see the new ones. */
function watch(c: Character, held: Held = { geometries: new Set(), materials: new Set(), textures: new Set(), freed: new Set(), skeletons: new Map() }) {
  const note = (thing: THREE.EventDispatcher<{ dispose: object }>, into: Set<never>) => {
    if (into.has(thing as never)) return;
    into.add(thing as never);
    thing.addEventListener("dispose", () => held.freed.add(thing));
  };
  for (const m of skinned(c)) {
    note(m.geometry as never, held.geometries as never);
    note(m.material as never, held.materials as never);
    const ramp = (m.material as THREE.MeshToonMaterial).gradientMap;
    if (ramp) note(ramp as never, held.textures as never);
    // what a renderer does on its first frame: the skeleton makes its bone texture
    const skeleton = m.skeleton;
    if (skeleton.boneTexture === null) skeleton.computeBoneTexture();
    note(skeleton.boneTexture as never, held.textures as never);
    if (!held.skeletons.has(skeleton)) {
      held.skeletons.set(skeleton, 0);
      const was = skeleton.dispose.bind(skeleton);
      skeleton.dispose = () => {
        held.skeletons.set(skeleton, (held.skeletons.get(skeleton) ?? 0) + 1);
        was();
      };
    }
  }
  return held;
}
const leftOver = (h: Held) => [...h.geometries, ...h.materials, ...h.textures].filter((t) => !h.freed.has(t));

for (const base of BASE_IDS) {
  test(`${base}: it builds, every number is finite, every vertex is bound to a bone that exists`, () => {
    const c = createCharacter({ record: baseRecord(base) });
    assert.equal(BASE_IDS[c.record.base], base);
    const [toon, ink] = skinned(c);
    assert.ok(toon && ink, "two draws");
    const bones = toon.skeleton.bones;
    assert.ok(bones.length >= BONES.length, "the island's 28 bones, then the body's own");
    assert.deepEqual(bones.slice(0, BONES.length).map((b) => b.name), BONES.map((b) => b[0]), "the island's bone order");
    assert.equal(new Set(bones.map((b) => b.name)).size, bones.length, "no bone name twice");
    for (const mesh of [toon, ink]) {
      const g = mesh.geometry;
      for (const name of ["position", "normal", "skinIndex", "skinWeight"]) {
        const a = g.getAttribute(name).array as ArrayLike<number>;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) assert.fail(`${base} ${name}[${i}] is ${a[i]}`);
      }
      const si = g.getAttribute("skinIndex").array;
      const sw = g.getAttribute("skinWeight").array;
      for (let i = 0; i < si.length; i += 4) {
        assert.ok(si[i] < bones.length && si[i + 1] < bones.length, `${base}: bone ${si[i]} of ${bones.length}`);
        assert.ok(Math.abs(sw[i] + sw[i + 1] + sw[i + 2] + sw[i + 3] - 1) < 1e-6, `${base}: weights add up to 1`);
      }
    }
    assert.ok(toon.geometry.getAttribute("position").count > 1000, "a body, not nothing");
    c.dispose();
  });

  test(`${base}: it walks, runs, jumps and waves without a bad number, and its own bones move`, () => {
    const c = createCharacter({ record: baseRecord(base) });
    for (const m of [{ speed: 3.75 }, { speed: 6.5 }, { airborne: true, verticalSpeed: 4 }, {}]) {
      for (let i = 0; i < 60; i++) {
        if (i === 10) c.wave();
        c.update(1 / 60, m);
      }
    }
    c.object.updateMatrixWorld(true);
    const [toon] = skinned(c);
    for (const b of toon.skeleton.bones) {
      for (const v of [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]) assert.ok(Number.isFinite(v), `${base}: ${b.name}`);
    }
    // A body with a tail, wings or long hair has bones of its own: they follow the walk.
    const own = toon.skeleton.bones.slice(BONES.length);
    if (own.length) {
      c.update(1 / 60, { speed: 6.5 });
      assert.ok(own.some((b) => b.quaternion.angleTo(new THREE.Quaternion()) > 1e-4), `${base}: its own bones turn`);
    }
    c.dispose();
  });

  test(`${base}: dispose frees every geometry, material and texture it made, and the skeleton once`, () => {
    const c = createCharacter({ record: baseRecord(base) });
    const held = watch(c);
    assert.equal(held.geometries.size, 2, "the toon body and the ink hull");
    assert.equal(held.materials.size, 2);
    assert.equal(held.textures.size, 2, "the ramp and the bone texture");
    assert.deepEqual(leftOver(held), [...held.geometries, ...held.materials, ...held.textures], "nothing is freed yet");
    c.dispose();
    assert.deepEqual(leftOver(held), []);
    assert.deepEqual([...held.skeletons.values()], [1]);
  });

  test(`${base}: setLook to another body frees the old geometry and builds the new; the same body only repaints`, () => {
    const other = BASE_IDS[(BASE_IDS.indexOf(base) + 1) % BASE_IDS.length];
    const c = createCharacter({ record: baseRecord(base) });
    const held = watch(c);
    const [oldToon, oldInk] = skinned(c);
    const toonGeometry = oldToon.geometry;
    // colours only: no new geometry
    c.setLook({ ...c.record, skin: 2, hair: 4, shirt: 5, pants: 1, shoeColor: 3, trim: 2, visor: 3 });
    assert.ok(skinned(c)[0].geometry === toonGeometry, "the same geometry");
    assert.deepEqual(leftOver(held).filter((t) => t instanceof THREE.BufferGeometry).length, 2);
    assert.equal(held.freed.size, 0, "nothing was freed by a repaint");
    // height only: a scale, no new geometry
    c.setLook({ ...c.record, height: 6 });
    assert.ok(skinned(c)[0].geometry === toonGeometry, "the same geometry");
    assert.equal(c.object.children[0].scale.x, HEIGHTS[6]);
    // another body: the old geometry and skeleton go, new ones are there
    c.update(1 / 60, { speed: 3.75 });
    c.setLook(baseRecord(other));
    assert.equal(BASE_IDS[c.record.base], other);
    assert.ok(held.freed.has(toonGeometry) && held.freed.has(oldInk.geometry), "the old geometry is freed");
    assert.equal(held.skeletons.get(oldToon.skeleton), 1, "the old skeleton is freed once");
    assert.equal(c.object.children.length, 1, "one body in the object");
    const [toon, ink] = skinned(c);
    assert.ok(toon.geometry !== toonGeometry, "new geometry");
    assert.ok(toon && ink && toon.skeleton !== oldToon.skeleton);
    // it looks like a character made on that body from the start
    const fresh = createCharacter({ record: baseRecord(other) });
    assert.equal(toon.geometry.getAttribute("position").count, skinned(fresh)[0].geometry.getAttribute("position").count);
    assert.equal(toon.skeleton.bones.length, skinned(fresh)[0].skeleton.bones.length);
    fresh.dispose();
    // the new body is still alive after the rebuild: it moves
    c.update(1 / 60, { speed: 6.5 });
    watch(c, held);
    c.dispose();
    assert.deepEqual(leftOver(held), [], "everything that was ever made is freed");
    assert.equal([...held.skeletons.values()].every((n) => n === 1), true);
  });
}

test("a hundred random records on every base build, and a thousand rebuilds leave nothing behind", () => {
  const live = new Set<THREE.BufferGeometry>();
  const freed = new Set<THREE.BufferGeometry>();
  const c = createCharacter();
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const track = () => {
    for (const m of skinned(c)) {
      if (!live.has(m.geometry)) {
        live.add(m.geometry);
        m.geometry.addEventListener("dispose", () => freed.add(m.geometry));
      }
    }
  };
  track();
  for (let i = 0; i < 100; i++) {
    const rec: LookRecord = diceRecord(rand, BASE_IDS[i % BASE_IDS.length]);
    c.setLook(rec);
    assert.deepEqual({ ...c.record }, rec);
    c.update(1 / 60, { speed: 3 });
    track();
  }
  assert.ok(live.size >= 100, "most rebuilds made new geometry");
  // every geometry but the ones in the character now has been freed
  const now = new Set(skinned(c).map((m) => m.geometry));
  for (const g of live) assert.equal(freed.has(g), !now.has(g));
  c.dispose();
  assert.equal(freed.size, live.size);
});
