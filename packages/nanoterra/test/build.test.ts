import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { BONES, createCharacter, defaultLook, HEIGHT, LOOK_KEYS, LOOK_PARTS, RADIUS } from "../src/character/index.js";
import { ISLAND_BONES, ISLAND_GEOMETRY, weighted } from "./island.js";

const meshes = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((x) => {
    if ((x as THREE.Mesh).isMesh) out.push(x as THREE.Mesh);
  });
  return out;
};
const toonOf = (o: THREE.Object3D) => meshes(o).find((m) => m.name === "character-toon") as THREE.SkinnedMesh;
const inkOf = (o: THREE.Object3D) => meshes(o).find((m) => m.name === "character-ink") as THREE.SkinnedMesh | undefined;

test("it builds in Node: no canvas, no document, no window", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof window, "undefined");
  const c = createCharacter({ look: defaultLook(), quality: "high" });
  assert.ok(c.object instanceof THREE.Group);
  assert.equal(c.quality, "high");
  assert.deepEqual(c.look, defaultLook());
  c.dispose();
});

test("the options are optional: no options is the default look at quality high", () => {
  const a = createCharacter();
  const b = createCharacter({});
  assert.deepEqual(a.look, defaultLook());
  assert.equal(a.quality, "high");
  assert.equal(b.quality, "high");
  assert.ok(inkOf(a.object));
  a.dispose();
  b.dispose();
});

test("a bad quality is refused", () => {
  assert.throws(() => createCharacter({ quality: "medium" as never }), /quality must be "high" or "low", not "medium"/);
});

test("draw budget: 2 draws at high, the shadow disc in the body; 1 draw at low", () => {
  const high = createCharacter({ quality: "high" });
  const low = createCharacter({ quality: "low" });
  assert.equal(meshes(high.object).length, 2);
  assert.equal(meshes(low.object).length, 1);
  assert.equal(inkOf(low.object), undefined);
  for (const c of [high, low]) {
    for (const m of meshes(c.object)) assert.ok((m as THREE.SkinnedMesh).isSkinnedMesh, "each draw is a skinned mesh");
  }
  // each draw is one material: the ink is one hull of the same skeleton
  assert.equal(inkOf(high.object)!.skeleton, toonOf(high.object).skeleton);
  high.dispose();
  low.dispose();
});

test("the bone names, their order and their parents are the island's", () => {
  const c = createCharacter();
  const bones = toonOf(c.object).skeleton.bones;
  assert.deepEqual(bones.map((b) => b.name), ISLAND_BONES.map((b) => b[0]));
  assert.deepEqual(bones.map((b) => (b.parent && (b.parent as THREE.Bone).isBone ? b.parent.name : null)), ISLAND_BONES.map((b) => b[1]));
  assert.equal(bones.length, 28);
  c.dispose();
});

test("the toon and ink geometry are the island's (vertex counts and weighted sums)", () => {
  const c = createCharacter({ look: defaultLook() });
  const toon = toonOf(c.object).geometry;
  const hull = inkOf(c.object)!.geometry;
  const G = ISLAND_GEOMETRY;
  // The island's toon geometry holds the body first and the 60 vertices of its shadow disc last: the sums are of the body's.
  assert.equal(toon.attributes.position.count, G.toonVerts + 60, "the body, then the shadow disc");
  assert.equal(hull.attributes.position.count, G.hullVerts, "the disc has no ink");
  const close = (got: number, want: number, name: string) => assert.ok(Math.abs(got - want) <= 1e-6 * Math.abs(want), `${name}: ${got} is not ${want}`);
  const n = G.toonVerts;
  close(weighted(toon.attributes.position.array, n * 3), G.toonPos, "toon position");
  close(weighted(toon.attributes.normal.array, n * 3), G.toonNor, "toon normal");
  close(weighted(toon.attributes.color.array, n * 3), G.toonColor, "toon color");
  close(weighted(toon.attributes.skinIndex.array, n * 4), G.toonIdx, "toon skinIndex");
  close(weighted(toon.attributes.skinWeight.array, n * 4), G.toonW, "toon skinWeight");
  close(weighted(hull.attributes.position.array), G.hullPos, "hull position");
  close(weighted(hull.attributes.normal.array), G.hullNor, "hull normal");
  close(weighted(hull.attributes.skinIndex.array), G.hullIdx, "hull skinIndex");
  close(weighted(hull.attributes.skinWeight.array), G.hullW, "hull skinWeight");
  c.dispose();
});

test("every vertex is bound to bones that exist, with weights that add up to 1", () => {
  const c = createCharacter();
  for (const geo of [toonOf(c.object).geometry, inkOf(c.object)!.geometry]) {
    const si = geo.attributes.skinIndex.array;
    const sw = geo.attributes.skinWeight.array;
    for (let i = 0; i < si.length; i += 4) {
      assert.ok(si[i] < 28 && si[i + 1] < 28);
      assert.ok(Math.abs(sw[i] + sw[i + 1] + sw[i + 2] + sw[i + 3] - 1) < 1e-6);
    }
  }
  c.dispose();
});

test("it faces +Z with its feet on y = 0", () => {
  const c = createCharacter();
  const geo = toonOf(c.object).geometry;
  const pos = geo.attributes.position;
  // The eyes, the mouth and the badge are on the +Z side; the shape sits on y = 0.
  const color = geo.attributes.color;
  const fixed = (hex: string) => {
    const k = new THREE.Color().set(hex);
    return (i: number) => Math.abs(color.getX(i) - k.r) + Math.abs(color.getY(i) - k.g) + Math.abs(color.getZ(i) - k.b) < 1e-6;
  };
  for (const [hex, minZ] of [["#1b1c3d", 0.3], ["#c9473f", 0.3], ["#f4b63e", 0.4]] as const) {
    const is = fixed(hex);
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (!is(i)) continue;
      n++;
      assert.ok(pos.getZ(i) > minZ, `${hex} at z ${pos.getZ(i)}`);
    }
    assert.ok(n > 0, `${hex} has vertices`);
  }
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  assert.ok(box.min.y > -0.02 && box.min.y < 0.0, `the soles dip ${box.min.y} m under the ground`);
  c.dispose();
});

test("HEIGHT and RADIUS are what the model measures", () => {
  const c = createCharacter();
  const geo = toonOf(c.object).geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const names = toonOf(c.object).skeleton.bones.map((b) => b.name);
  const isArm = (i: number) => /^(upperarm|forearm|hand)_/.test(names[si.getX(i)]);
  const isShadow = (i: number) => names[si.getX(i)] === "shadow";
  let top = -Infinity;
  let bottom = Infinity;
  let trunk = 0;
  let reach = 0;
  for (let i = 0; i < pos.count; i++) {
    if (isShadow(i)) continue;
    top = Math.max(top, pos.getY(i));
    bottom = Math.min(bottom, pos.getY(i));
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (isArm(i)) reach = Math.max(reach, r);
    else trunk = Math.max(trunk, r);
  }
  assert.ok(Math.abs(top - bottom - HEIGHT) < 0.01, `the model is ${top - bottom} m tall, HEIGHT is ${HEIGHT}`);
  assert.ok(Math.abs(trunk - RADIUS) < 0.01, `the trunk is ${trunk} m from the middle, RADIUS is ${RADIUS}`);
  assert.ok(reach > RADIUS && reach < 0.62, `the hands hang ${reach} m from the middle`);
  // The same with three.js's own box, of the object after a frame at idle (the shadow disc, 0.62 m from the middle, is in it)
  c.update(1 / 60);
  c.object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c.object, true);
  assert.ok(Math.abs(box.max.y - box.min.y - HEIGHT) < 0.02, `the object's box is ${box.max.y - box.min.y} m tall`);
  assert.ok(Math.max(box.max.z, -box.min.z) < 0.62 + 0.02, "the depth is within the shadow disc");
  // At rest the hands hang 0.6 m from the middle; the idle pose turns each arm 0.2 rad out, to about 0.77 m.
  assert.ok(Math.max(box.max.x, -box.min.x) < 0.8, "the width is within the idle arms' reach");
  c.dispose();
});

test("the look paints the five parts; the eyes, the mouth, the badge and the shadow never change", () => {
  const look = { skin: LOOK_PARTS.skin[5], hair: LOOK_PARTS.hair[6], shirt: LOOK_PARTS.shirt[2], pants: LOOK_PARTS.pants[2], shoes: LOOK_PARTS.shoes[1] };
  // The shirt colour is painted over by `colors` (a colour that is not on the island's lists), the other four are the look's.
  const c = createCharacter({ look, colors: { shirt: "#ff00aa" } });
  look.shirt = "#ff00aa";
  const color = toonOf(c.object).geometry.attributes.color;
  const colours = new Set<string>();
  for (let i = 0; i < color.count; i++) colours.add(new THREE.Color(color.getX(i), color.getY(i), color.getZ(i)).getHexString());
  const want = [...LOOK_KEYS.map((k) => look[k]), "#1b1c3d", "#c9473f", "#f4b63e", "#3d3653"].map((h) => new THREE.Color().set(h).getHexString());
  assert.deepEqual([...colours].sort(), [...new Set(want)].sort());
  c.dispose();
});

test("the ink is the island's: a back-face hull, 2.6 px, #1d1530, and it follows the viewport", () => {
  const c = createCharacter();
  const ink = inkOf(c.object)!;
  const mat = ink.material as THREE.ShaderMaterial;
  assert.equal(mat.side, THREE.BackSide);
  assert.equal(mat.uniforms.width.value, 2.6);
  assert.equal(mat.uniforms.color.value.getHexString(), new THREE.Color("#1d1530").getHexString());
  // The hull reads the renderer's viewport before each draw (a fake renderer stands in).
  const fake = { getViewport: (v: THREE.Vector4) => v.set(0, 0, 640, 360) } as unknown as THREE.WebGLRenderer;
  ink.onBeforeRender(fake, new THREE.Scene(), new THREE.PerspectiveCamera(), ink.geometry, mat, null as never);
  assert.deepEqual(mat.uniforms.res.value.toArray(), [640, 360]);
  c.dispose();
});

test("the toon is the island's: three flat tones, vertex colours, white base", () => {
  const c = createCharacter();
  const mat = toonOf(c.object).material as THREE.MeshToonMaterial;
  assert.equal(mat.type, "MeshToonMaterial");
  assert.equal(mat.vertexColors, true);
  assert.equal(mat.color.getHexString(), "ffffff");
  const ramp = mat.gradientMap as THREE.DataTexture;
  assert.deepEqual(Array.from(ramp.image.data as Uint8Array), [96, 96, 96, 255, 182, 182, 182, 255, 255, 255, 255, 255]);
  assert.equal(ramp.magFilter, THREE.NearestFilter);
  assert.equal(ramp.minFilter, THREE.NearestFilter);
  assert.equal(ramp.image.width, 3);
  c.dispose();
});

test("the shadow: a flat disc of radius 0.62 just over the ground, on the shadow bone, in the island's shadow colour", () => {
  const c = createCharacter();
  const geo = toonOf(c.object).geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const shadowBone = BONES.findIndex((b) => b[0] === "shadow");
  let n = 0;
  let rmax = 0;
  const k = new THREE.Color().set("#3d3653");
  for (let i = 0; i < pos.count; i++) {
    if (si.getX(i) !== shadowBone) continue;
    n++;
    assert.ok(Math.abs(pos.getY(i) - 0.02) < 1e-6);
    rmax = Math.max(rmax, Math.hypot(pos.getX(i), pos.getZ(i)));
    assert.ok(Math.abs(geo.attributes.color.getX(i) - k.r) < 1e-6);
  }
  assert.equal(n, 60, "one disc");
  assert.ok(Math.abs(rmax - 0.62) < 1e-6);
  c.dispose();
});

test("two characters do not share state", () => {
  const a = createCharacter({ look: defaultLook() });
  const b = createCharacter({ look: { ...defaultLook(), shirt: "#e5384b" } });
  assert.notEqual(toonOf(a.object).geometry, toonOf(b.object).geometry);
  assert.notEqual(toonOf(a.object).material, toonOf(b.object).material);
  a.update(0.016, { speed: 6.5 });
  const rot = (o: THREE.Object3D) => (o.getObjectByName("upperarm_L") as THREE.Bone).rotation.x;
  assert.notEqual(rot(a.object), 0);
  assert.equal(rot(b.object), 0);
  a.dispose();
  b.dispose();
});
