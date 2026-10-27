import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createCharacter } from "../src/character/index.js";
import { defaultLook, LOOK_KEYS, LOOK_PARTS, type Look } from "../src/character/pure.js";

const meshes = (c: ReturnType<typeof createCharacter>) => {
  const out: THREE.SkinnedMesh[] = [];
  c.object.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
};
/** Every attribute of a geometry but the colours, copied. */
const shape = (g: THREE.BufferGeometry) =>
  Object.fromEntries(Object.entries(g.attributes).filter(([k]) => k !== "color").map(([k, a]) => [k, Array.from(a.array as ArrayLike<number>)]));
const hex = (a: THREE.BufferAttribute, i: number) => new THREE.Color(a.getX(i), a.getY(i), a.getZ(i)).getHexString();

const other: Look = { skin: LOOK_PARTS.skin[7], hair: LOOK_PARTS.hair[3], shirt: LOOK_PARTS.shirt[5], pants: LOOK_PARTS.pants[3], shoes: LOOK_PARTS.shoes[3] };

test("setLook with five colours changes colours only: the same vertices, the same bones, the same geometry and materials", () => {
  const c = createCharacter({ look: defaultLook() });
  const [toon, ink] = meshes(c);
  const before = { toon: shape(toon.geometry), ink: shape(ink.geometry), bones: toon.skeleton.bones.slice(), counts: [toon.geometry.attributes.position.count, ink.geometry.attributes.position.count] };
  const geometries = [toon.geometry, ink.geometry];
  const materials = [toon.material, ink.material];
  const colorBefore = Array.from(toon.geometry.attributes.color.array as Float32Array);
  const version = (toon.geometry.attributes.color as THREE.BufferAttribute).version;

  c.setLook(other);

  assert.deepEqual(c.look, other);
  assert.deepEqual(shape(toon.geometry), before.toon, "toon positions, normals, bone indices and weights are the same");
  assert.deepEqual(shape(ink.geometry), before.ink, "the ink hull is the same");
  assert.deepEqual([toon.geometry.attributes.position.count, ink.geometry.attributes.position.count], before.counts, "the vertex count is the same");
  assert.equal(toon.skeleton.bones.length, 28);
  assert.deepEqual(toon.skeleton.bones, before.bones, "the same bones");
  assert.deepEqual([toon.geometry, ink.geometry], geometries, "no new geometry");
  assert.deepEqual([toon.material, ink.material], materials, "no new material");
  assert.ok(Array.from(toon.geometry.attributes.color.array as Float32Array).some((v, i) => v !== colorBefore[i]), "the colours changed");
  assert.ok((toon.geometry.attributes.color as THREE.BufferAttribute).version > version, "the colour attribute is marked for upload");
  assert.equal(ink.geometry.attributes.color, undefined, "the ink has no colours");
  c.dispose();
});

test("each part takes its own colour, and only its own", () => {
  const c = createCharacter({ look: defaultLook() });
  const [toon] = meshes(c);
  const color = toon.geometry.attributes.color as THREE.BufferAttribute;
  const used = (look: Look) => {
    const seen = new Set<string>();
    for (let i = 0; i < color.count; i++) seen.add(hex(color, i));
    return { seen, has: (h: string) => seen.has(new THREE.Color().set(h).getHexString()), look };
  };
  const base = used(defaultLook());
  for (const key of LOOK_KEYS) {
    // Any colour, over the record's: `setColors` (a shop dye is not on the island's lists).
    const next = { ...defaultLook(), [key]: "#010203" };
    c.setColors({ [key]: "#010203" });
    const u = used(next);
    assert.ok(u.has("#010203"), `${key} paints something`);
    assert.ok(!u.has(defaultLook()[key]) || LOOK_KEYS.some((k) => k !== key && defaultLook()[k] === defaultLook()[key]), `${key}'s old colour is gone`);
    for (const k of LOOK_KEYS) if (k !== key) assert.ok(u.has(next[k]), `${k} keeps its colour`);
    for (const fixed of ["#1b1c3d", "#c9473f", "#f4b63e"]) assert.ok(u.has(fixed), `${fixed} stays`);
    c.setColors(null);
  }
  assert.ok(base.has("#1b1c3d"));
  c.dispose();
});

test("setLook and back gives the first colours again, bit for bit", () => {
  const c = createCharacter({ look: defaultLook() });
  const [toon] = meshes(c);
  const first = Array.from(toon.geometry.attributes.color.array as Float32Array);
  c.setLook(other);
  c.setLook(defaultLook());
  assert.deepEqual(Array.from(toon.geometry.attributes.color.array as Float32Array), first);
  // a character made with a look has the colours of a character that was changed to it
  const direct = createCharacter({ look: other });
  c.setLook(other);
  assert.deepEqual(Array.from(meshes(direct)[0].geometry.attributes.color.array as Float32Array), Array.from(toon.geometry.attributes.color.array as Float32Array));
  c.dispose();
  direct.dispose();
});

test("a bad look throws and changes nothing", () => {
  const c = createCharacter({ look: other });
  const [toon] = meshes(c);
  const colours = Array.from(toon.geometry.attributes.color.array as Float32Array);
  for (const bad of [null, {}, { ...other, shirt: "blue" }, { ...other, hair: 12 }, "x"]) {
    assert.throws(() => c.setLook(bad as never), /@nano133\/nanoterra: look/);
    assert.deepEqual(c.look, other);
    assert.deepEqual(Array.from(toon.geometry.attributes.color.array as Float32Array), colours);
  }
  c.dispose();
});

test("the look the character reports is its own copy: a game cannot change it by changing its object", () => {
  const mine = { ...defaultLook() };
  const c = createCharacter({ look: mine });
  mine.shirt = "#000000";
  assert.equal(c.look.shirt, "#2a9df4");
  assert.ok(Object.isFrozen(c.look));
  const next = { ...other };
  c.setLook(next);
  next.shirt = "#000000";
  assert.equal(c.look.shirt, LOOK_PARTS.shirt[5]);
  c.dispose();
});

test("setLook does not touch the pose, and the pose does not touch the colours", () => {
  const c = createCharacter();
  for (let i = 0; i < 30; i++) c.update(1 / 60, { speed: 6.5 });
  const bone = c.object.getObjectByName("upperarm_L") as THREE.Bone;
  const q = bone.quaternion.toArray();
  c.setLook(other);
  assert.deepEqual(bone.quaternion.toArray(), q);
  const [toon] = meshes(c);
  const colours = Array.from(toon.geometry.attributes.color.array as Float32Array);
  for (let i = 0; i < 30; i++) c.update(1 / 60, { speed: 0, airborne: true });
  assert.deepEqual(Array.from(toon.geometry.attributes.color.array as Float32Array), colours);
  c.dispose();
});

test("quality low: the same colours on the same body", () => {
  const high = createCharacter({ look: other, quality: "high" });
  const low = createCharacter({ look: other, quality: "low" });
  assert.deepEqual(Array.from(meshes(low)[0].geometry.attributes.color.array as Float32Array), Array.from(meshes(high)[0].geometry.attributes.color.array as Float32Array));
  assert.deepEqual(shape(meshes(low)[0].geometry), shape(meshes(high)[0].geometry));
  low.setLook(defaultLook());
  assert.deepEqual(low.look, defaultLook());
  high.dispose();
  low.dispose();
});
