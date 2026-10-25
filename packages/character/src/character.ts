import * as THREE from "three";
import { buildBody, buildShadow, paint } from "./body.js";
import { assertLook, defaultLook, LOOK_KEYS, type Look } from "./look.js";
import { makePose, MAX_DT, type Motion } from "./pose.js";
import { makeBones } from "./skeleton.js";
import { followCanvas, inkMaterial, makeRamp, toonMaterial } from "./toon.js";

/** "high": the toon body and the ink outline (2 draws). "low": the toon body only (1 draw), for slow phones. */
export type Quality = "high" | "low";

export type CharacterOptions = {
  /** The player's colours. Left out: `defaultLook()`. A look that is not good makes `createCharacter` throw. */
  look?: Look;
  /** Left out: "high". */
  quality?: Quality;
  /** Starts with the walk's swing and bob off, as the island does for a player who asks for less motion. */
  reducedMotion?: boolean;
};

export interface Character {
  /**
   * The character: a THREE.Group with its feet at y = 0, facing +Z, `HEIGHT` metres tall. Add it to your scene and move
   * and turn it with `position` and `rotation.y`. It holds the skinned meshes: 2 draws at quality "high", 1 at "low".
   */
  readonly object: THREE.Group;
  /**
   * The toon blob shadow: a flat dark disc, radius 0.62 m, a mesh of its own (1 more draw). It is NOT a child of `object`:
   * add it to the same parent (the scene). `update` keeps it at the character's x and z, scales it with `object.scale` and
   * shrinks it in a jump. Its y is yours: it is 0 (a flat floor at y = 0), or set `shadow.position.y` to the ground each frame.
   */
  readonly shadow: THREE.Mesh;
  /** The look now (a frozen copy). */
  readonly look: Readonly<Look>;
  readonly quality: Quality;
  /** True: no swing of the legs and arms, no bob, a still wave. Change it when the player's setting changes. */
  reducedMotion: boolean;
  /**
   * One frame: idle, walk, run and jump from the game's own numbers. `dt` is in SECONDS (a frame longer than 0.05 s counts
   * as 0.05 s). Call it once a frame, before you render.
   */
  update(dt: number, motion?: Motion): void;
  /** Waves the left arm for 1.8 s (the island's wave). */
  wave(): void;
  /** Changes the colours. It rebuilds no geometry. A look that is not good throws and changes nothing. */
  setLook(look: Look): void;
  /**
   * Frees the geometries, materials and textures that the character made, and takes `object` and `shadow` out of their
   * parents. Later calls to the other methods do nothing.
   */
  dispose(): void;
}

const own = (look: Look): Readonly<Look> => Object.freeze(Object.fromEntries(LOOK_KEYS.map((k) => [k, look[k]])) as Look);

/** Makes a character. See the README. */
export function createCharacter(options: CharacterOptions = {}): Character {
  const opts = options ?? {};
  const quality = opts.quality ?? "high";
  if (quality !== "high" && quality !== "low") {
    throw new TypeError(`@nano133/character: quality must be "high" or "low", not ${JSON.stringify(quality)}`);
  }
  const first = opts.look === undefined ? defaultLook() : opts.look;
  assertLook(first);
  let look = own(first);

  const ramp = makeRamp();
  const toon = toonMaterial(ramp);
  const built = buildBody(quality === "high");
  paint(built.body, built.parts, look);

  // The skeleton hangs under the toon mesh. It is bound at scale 1 (./skeleton): each bone turns about its own joint.
  const { list, byName } = makeBones();
  const mesh = new THREE.SkinnedMesh(built.body, toon);
  mesh.name = "character-toon";
  mesh.add(byName.root);
  const object = new THREE.Group();
  object.name = "nano133-character";
  object.add(mesh);
  let ink: THREE.ShaderMaterial | null = null;
  let hullMesh: THREE.SkinnedMesh | null = null;
  if (built.hull) {
    ink = inkMaterial();
    hullMesh = new THREE.SkinnedMesh(built.hull, ink);
    hullMesh.name = "character-ink";
    followCanvas(hullMesh, ink);
    object.add(hullMesh);
  }
  object.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton);
  hullMesh?.bind(skeleton);
  // It moves every frame: no culling by a stale bound.
  mesh.frustumCulled = false;
  if (hullMesh) hullMesh.frustumCulled = false;

  const shadowGeometry = buildShadow();
  const shadow = new THREE.Mesh(shadowGeometry, toon);
  shadow.name = "character-shadow";

  const pose = makePose(list, byName);
  let reducedMotion = !!opts.reducedMotion;
  pose.rest(reducedMotion);
  let disposed = false;

  return {
    object,
    shadow,
    get look() {
      return look;
    },
    quality,
    get reducedMotion() {
      return reducedMotion;
    },
    set reducedMotion(v: boolean) {
      reducedMotion = !!v;
    },
    update(dt, motion = {}) {
      if (disposed) return;
      const step = Math.min(dt, MAX_DT);
      if (step > 0) pose.step(step, motion ?? {}, reducedMotion);
      // The shadow lies under the character (same x and z; its y is the game's ground) and shrinks as the body rises (the
      // island's rule), to a little over half. It follows the object's size too.
      shadow.position.x = object.position.x;
      shadow.position.z = object.position.z;
      shadow.scale.setScalar(Math.max(0.55, 1 - pose.state.up * 0.6) * object.scale.x);
    },
    wave() {
      if (!disposed) pose.wave();
    },
    setLook(next) {
      if (disposed) return;
      assertLook(next);
      look = own(next);
      paint(built.body, built.parts, look);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      shadow.removeFromParent();
      built.body.dispose();
      built.hull?.dispose();
      shadowGeometry.dispose();
      toon.dispose();
      ink?.dispose();
      ramp.dispose();
      skeleton.dispose();
    },
  };
}
