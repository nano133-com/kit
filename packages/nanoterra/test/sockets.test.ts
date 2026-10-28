// The three sockets (head, hand, back): each sits on its bone at its base's frame, follows the bone in a pose, and stays (with what hangs on it)
// on the new bones after a rebuild. A model on a socket adds no geometry to the body; `setWorn` takes it off again.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { BASE_IDS, BASE_SPECS, BUILDS, DEFAULT_RECORD, HEADS, SOCKETS, baseRecord, createCharacter, socketFrame, type Character } from "../src/character/index.js";

const skinned = (c: Character) => {
  const out: THREE.SkinnedMesh[] = [];
  c.object.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
};
const bones = (c: Character) => new Set(skinned(c)[0].skeleton.bones);
const world = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
};
const BONE_OF = { head: "head", hand: "grip_R", back: "chest" } as const;

test("each socket hangs on its bone of the live skeleton, for every base", () => {
  for (const base of BASE_IDS) {
    const c = createCharacter({ record: baseRecord(base) });
    for (const n of SOCKETS) {
      const s = c.socket(n);
      assert.equal(s.parent?.name, BONE_OF[n], `${base} ${n}`);
      assert.ok(bones(c).has(s.parent as THREE.Bone), `${base} ${n}: the bone is in the skeleton that draws`);
    }
    c.dispose();
  }
});

test("a socket is the same object after a rebuild, on the NEW bone, with what hangs on it", () => {
  const c = createCharacter({ record: DEFAULT_RECORD });
  const item = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  c.setWorn([{ socket: "hand", object: item }]);
  const hand = c.socket("hand");
  const oldBone = hand.parent;
  for (const base of BASE_IDS.slice(1)) {
    c.setLook(baseRecord(base));
    assert.equal(c.socket("hand"), hand, "the same socket");
    assert.notEqual(hand.parent, oldBone, `${base}: a new bone`);
    assert.ok(bones(c).has(hand.parent as THREE.Bone), `${base}: on a bone of the skeleton that draws`);
    assert.equal(item.parent, hand, `${base}: the item still hangs on it`);
    const f = socketFrame(BASE_SPECS[base], { build: "regular", head: 1 }, "hand");
    assert.ok(hand.position.distanceTo(f.position) < 1e-9, `${base}: at the new base's frame`);
  }
  c.dispose();
});

test("the hand socket follows the hand in a wave and a walk", () => {
  const c = createCharacter({ record: DEFAULT_RECORD });
  const at0 = world(c.socket("hand"));
  for (let i = 0; i < 20; i++) c.update(0.05, { speed: 4 });
  const walking = world(c.socket("hand"));
  assert.ok(walking.distanceTo(at0) > 0.05, "the walk swings the hand");
  const grip = c.object.getObjectByName("grip_R")!;
  const f = socketFrame(BASE_SPECS.classic, { build: "regular", head: 1 }, "hand");
  assert.ok(world(c.socket("hand")).distanceTo(f.position.clone().applyMatrix4(grip.matrixWorld)) < 1e-6, "it is where the bone puts it");
  c.dispose();
});

test("the hand socket is in the middle of the drawn hand; the head socket scales with the head; the back is behind the torso", () => {
  for (const base of BASE_IDS) {
    for (const build of BUILDS) {
      const spec = BASE_SPECS[base];
      const f = socketFrame(spec, { build, head: 1 }, "hand");
      // The bone is at -0.47; the hand is drawn at -(0.47 + 0.45 (torso - 1) + armOut).
      const torso = { slim: 0.88, regular: 1, round: 1.16 }[build];
      assert.ok(Math.abs(-0.47 + f.position.x - -(0.47 + 0.45 * (torso - 1) + (spec.limbs.armOut ?? 0))) < 1e-9, `${base} ${build}`);
      const back = socketFrame(spec, { build, head: 1 }, "back");
      assert.ok(back.position.z < -0.2, `${base} ${build}: the back socket is behind`);
    }
    const small = socketFrame(BASE_SPECS[base], { build: "regular", head: HEADS[0] }, "head");
    const big = socketFrame(BASE_SPECS[base], { build: "regular", head: HEADS[4] }, "head");
    assert.ok(big.scale.x > small.scale.x && big.position.y > small.position.y, `${base}: a bigger head lifts and widens the head socket`);
  }
});

test("a model on a socket builds no geometry; setWorn takes it off; a merged thing rebuilds", () => {
  const c = createCharacter({ record: DEFAULT_RECORD });
  const [toon] = skinned(c);
  const geo = toon.geometry;
  const hat = new THREE.Group();
  const shovel = new THREE.Group();
  c.setWorn([{ socket: "head", object: hat }, { socket: "hand", object: shovel }]);
  assert.equal(skinned(c)[0].geometry, geo, "no new geometry for models on sockets");
  assert.equal(hat.parent, c.socket("head"));
  assert.equal(shovel.parent, c.socket("hand"));
  c.setWorn([{ socket: "hand", object: shovel }]);
  assert.equal(hat.parent, null, "the hat came off");
  assert.equal(shovel.parent, c.socket("hand"), "the shovel stays");
  let added = 0;
  c.setWorn([{ socket: "hand", object: shovel, add: () => void added++ }]);
  assert.equal(added, 1, "the merged part was built");
  assert.notEqual(skinned(c)[0].geometry, geo, "a merged thing builds new geometry");
  assert.equal(shovel.parent, c.socket("hand"));
  c.dispose();
  assert.equal(c.socket("hand").parent, null, "dispose takes the sockets off the dead bones");
});

test("bad sockets and bad worn lists throw and change nothing", () => {
  const c = createCharacter();
  assert.throws(() => c.socket("tail" as never), /no socket "tail"/);
  assert.throws(() => c.setWorn([{ socket: "tail" as never, object: new THREE.Group() }]), /socket must be one of/);
  assert.throws(() => c.setWorn([{ socket: "hand" }]), /both a socket and an object/);
  assert.throws(() => c.setWorn([{ socket: "hand", object: {} as never }]), /THREE.Object3D/);
  assert.throws(() => createCharacter({ worn: "x" as never }), /worn must be a list/);
  c.dispose();
});
