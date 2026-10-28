import * as THREE from "three";
import { assemble, type Assembled } from "./assemble.js";
import { BASE_SPECS } from "./bases/index.js";
import { HEIGHTS } from "./lists.js";
import { assertLook, recordProblem, type Look } from "./look.js";
import { buildWith, paintCharacter, type Made } from "./make.js";
import { makePose, MAX_DT, type Motion } from "./pose.js";
import { clean, DEFAULT_RECORD, resolve, toLegacy, withLegacy, type CharColors, type LookRecord } from "./record.js";
import type { BoneName } from "./skeleton.js";
import type { WornAdapter } from "./ctx.js";
import { isSocketName, placeSocket, SOCKETS, type SocketName } from "./sockets.js";
import { followCanvas, inkMaterial, makeRamp, toonMaterial } from "./toon.js";

// createCharacter: the character as ONE object for a plain Three.js game. It builds the player's record (record.ts) with the kit (make.ts), binds it
// to the island's skeleton (assemble.ts), gives it the toon material and the ink line (toon.ts) and plays the island's idle, walk, run, jump and wave
// on it (pose.ts, solver.ts) from the numbers the game gives each frame. A worn item is the host's (ctx.ts `WornAdapter`): its shapes merge into the
// body, or its own model hangs on one of the three sockets (sockets.ts), which stay on the new bones after a rebuild.
// The blob shadow is a part of the body (a disc on the skeleton's shadow bone): it lies on the ground under the character in a jump and shrinks.

/** The character's height in metres at the record's normal size: from the soles to the top of the hair (the Classic base). Another base, hair or size is not this tall: measure it with a Box3. */
export const HEIGHT = 2.29;
/** The radius of the Classic's trunk in metres at the record's normal size: the collider's radius. The hands hang to 0.6 m from the middle. */
export const RADIUS = 0.49;

/** "high": the toon body and the ink outline (2 draws). "low": the toon body only (1 draw), for slow phones. */
export type Quality = "high" | "low";

export type CharacterOptions = {
  /** The player's character: `ticket.record` of a sign-in, or `character.record` of the code exchange. Left out: the five colours of `look`, else the island's first look. A record that is not whole makes `createCharacter` throw. */
  record?: LookRecord;
  /** The player's five colours, for a player whose ticket has no record (`ticket.look`): the Classic body in these colours. Read only when `record` is left out. A look that is not good makes `createCharacter` throw. */
  look?: Look;
  /** Colours painted over the record's (any "#rrggbb"): a shop dye on the shirt, say. They stay until `setColors` changes them. */
  colors?: Partial<CharColors>;
  /** Left out: "high". */
  quality?: Quality;
  /** Starts with the walk's swing and bob off, as the island does for a player who asks for less motion. */
  reducedMotion?: boolean;
  /** Worn things (ctx.ts `WornAdapter`): shapes merged into the body, or a model on a socket. Change them with `setWorn`. */
  worn?: readonly WornAdapter[];
};

export interface Character {
  /**
   * The character: a THREE.Group with its feet at y = 0, facing +Z, about `HEIGHT` metres tall at the normal size. Add it to your scene and move and
   * turn it with `position` and `rotation.y`. It holds the skinned meshes: 2 draws at quality "high", 1 at "low". The shadow disc is in them.
   */
  readonly object: THREE.Group;
  /** The record now (a frozen copy). */
  readonly record: Readonly<LookRecord>;
  /** The record's five colours (the older view, `toLegacy`): the colours of the island's own lists. */
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
  /**
   * Changes the character. A record: a new base, hair or clothes build new geometry (the old is freed); only colours and size change the same geometry.
   * Five colours: they go into the record that is there (its base, face and clothes stay). Something that is not good throws and changes nothing.
   * Colours given by `colors` or `setColors` stay on top.
   */
  setLook(next: LookRecord | Look): void;
  /** Paints these colours over the record's, or none (`null`): the record's own come back. It builds no geometry. */
  setColors(colors: Partial<CharColors> | null): void;
  /**
   * An attach point: "head" (at the base's hat frame, scaled with the head), "hand" (in the right hand, on grip_R) or "back" (on the chest,
   * behind). Add your own object to it and it follows the bone. It is the same object for the character's whole life: a new base, hair or
   * clothes (a rebuild) moves it, with what hangs on it, to the new bones and to the new base's frame. An unknown name throws.
   */
  socket(name: SocketName): THREE.Object3D;
  /**
   * Changes the worn things. Shapes that merge (`add`) and the hair's fit build new geometry; a thing that only hangs a model on a socket
   * builds none. The objects of the things that are no longer worn come off their socket (the game frees them: the character never does).
   */
  setWorn(worn: readonly WornAdapter[]): void;
  /**
   * Frees the geometries, materials and textures that the character made, and takes `object` out of its parent. Later calls to the other methods do
   * nothing.
   */
  dispose(): void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ["skin", "hair", "shirt", "pants", "shoes", "trim", "glow"] as const;

function checkColors(colors: unknown): Partial<CharColors> {
  if (typeof colors !== "object" || colors === null || Array.isArray(colors)) throw new TypeError("@nano133/nanoterra: colors must be an object like { shirt: \"#c8461a\" }");
  const out: Partial<CharColors> = {};
  for (const [k, v] of Object.entries(colors)) {
    if (v === undefined) continue;
    if (!(COLOR_KEYS as readonly string[]).includes(k)) throw new TypeError(`@nano133/nanoterra: colors.${k} is not a colour of the character (${COLOR_KEYS.join(", ")})`);
    if (typeof v !== "string" || !HEX.test(v)) throw new TypeError(`@nano133/nanoterra: colors.${k} must be a colour like "#2a9df4", not ${JSON.stringify(v)}`);
    out[k as keyof CharColors] = v;
  }
  return out;
}

/** A worn thing that changes the body's geometry: its own shapes, or what it does to the hair, the badge or the tail. */
const merges = (w: WornAdapter) => !!(w.add || w.fit || w.hidesBadge || w.hideTail);

function checkWorn(worn: unknown): readonly WornAdapter[] {
  if (!Array.isArray(worn)) throw new TypeError("@nano133/nanoterra: worn must be a list of worn things");
  worn.forEach((w: unknown, i) => {
    const v = w as WornAdapter | null;
    if (typeof v !== "object" || v === null) throw new TypeError(`@nano133/nanoterra: worn[${i}] is not an object`);
    if (v.add !== undefined && typeof v.add !== "function") throw new TypeError(`@nano133/nanoterra: worn[${i}].add must be a function`);
    if (v.socket !== undefined && !isSocketName(v.socket)) throw new TypeError(`@nano133/nanoterra: worn[${i}].socket must be one of ${SOCKETS.join(", ")}, not ${JSON.stringify(v.socket)}`);
    if ((v.object === undefined) !== (v.socket === undefined)) throw new TypeError(`@nano133/nanoterra: worn[${i}] needs both a socket and an object, or neither`);
    if (v.object !== undefined && !(v.object as THREE.Object3D)?.isObject3D) throw new TypeError(`@nano133/nanoterra: worn[${i}].object must be a THREE.Object3D`);
  });
  return [...worn];
}

const frozen = (rec: LookRecord): Readonly<LookRecord> => Object.freeze({ ...clean(rec) });

/** A record from a record or five colours; `from`: the record the five colours go into. Throws a TypeError that says what is wrong. */
function recordOf(next: unknown, from: LookRecord | null): LookRecord {
  if (typeof next === "object" && next !== null && (next as { v?: unknown }).v !== undefined) {
    const problem = recordProblem(next);
    if (problem) throw new TypeError(`@nano133/nanoterra: ${problem}`);
    return { ...clean(next as LookRecord) };
  }
  assertLook(next);
  return withLegacy(from ?? DEFAULT_RECORD, next);
}

/** What a rebuild needs to know: the record without its colours and its size. Colours repaint; size is a scale. */
const shapeOf = (r: LookRecord) => JSON.stringify({ ...r, skin: 0, hair: 0, shirt: 0, pants: 0, shoeColor: 0, trim: 0, visor: 0, height: 0 });

/** Makes a character. See the README. */
export function createCharacter(options: CharacterOptions = {}): Character {
  const opts = options ?? {};
  const quality = opts.quality ?? "high";
  if (quality !== "high" && quality !== "low") {
    throw new TypeError(`@nano133/nanoterra: quality must be "high" or "low", not ${JSON.stringify(quality)}`);
  }
  let record: LookRecord = opts.record !== undefined ? recordOf(opts.record, null) : opts.look !== undefined ? recordOf(opts.look, null) : { ...DEFAULT_RECORD };
  let over: Partial<CharColors> | null = opts.colors === undefined ? null : checkColors(opts.colors);
  let worn: readonly WornAdapter[] = checkWorn(opts.worn ?? []);
  /** The three sockets: made once, moved to the new bones on every rebuild. */
  const sockets = Object.fromEntries(
    SOCKETS.map((n) => {
      const g = new THREE.Group();
      g.name = `socket-${n}`;
      return [n, g];
    }),
  ) as Record<SocketName, THREE.Group>;

  const ramp = makeRamp();
  const toon = toonMaterial(ramp);
  const ink = quality === "high" ? inkMaterial() : null;
  const object = new THREE.Group();
  object.name = "nano133-character";
  let reducedMotion = !!opts.reducedMotion;
  let disposed = false;
  let time = 0;
  /** The size of the record (a scale of the inner group) with the object's own scale: metres to one unit of the character's space. */
  const unit = () => (HEIGHTS[record.height] ?? 1) * (object.scale.y || 1);

  type Rig = { made: Made; a: Assembled; pose: ReturnType<typeof makePose> };
  const colorsNow = (): CharColors => ({ ...resolve(record).colors, ...over });
  function build(): Rig {
    const look = resolve(record);
    const spec = BASE_SPECS[look.base];
    const merged = worn.filter(merges);
    const made = buildWith(spec, look, merged.length ? { worn: merged } : {});
    paintCharacter(made, colorsNow());
    const a = assemble(made, { toon, ink: ink ?? toon });
    a.mesh.name = "character-toon";
    a.hullMesh.name = "character-ink";
    if (ink) followCanvas(a.hullMesh, ink);
    else {
      // One draw: no ink line.
      a.group.remove(a.hullMesh);
      made.hull.dispose();
    }
    a.group.scale.setScalar(HEIGHTS[record.height] ?? 1);
    object.add(a.group);
    const pose = makePose(a.list, a.bones as Record<BoneName, THREE.Bone>, unit);
    for (const n of SOCKETS) placeSocket(sockets[n], a.bones, spec, look, n);
    return { made, a, pose };
  }
  let rig = build();
  rig.pose.rest(reducedMotion);
  /** Hangs each worn model on its socket (in the order of the list). */
  const hang = () => {
    for (const w of worn) if (w.object && w.socket) sockets[w.socket].add(w.object);
  };
  hang();

  /** Frees a rig's geometry and skeleton. A rig that is replaced also leaves the object; a character that is disposed keeps its (dead) meshes, as it always did. */
  const free = (r: Rig, replaced: boolean) => {
    if (replaced) r.a.group.removeFromParent();
    r.made.body.dispose();
    if (ink) r.made.hull.dispose();
    r.a.skeleton.dispose();
  };

  return {
    object,
    get record() {
      return frozen(record);
    },
    get look() {
      return Object.freeze(toLegacy(record));
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
      if (!(step > 0)) return;
      time += step;
      rig.pose.step(step, motion ?? {}, reducedMotion);
      // The body's own moving parts (a tail, wings, long hair) follow what the pose did.
      rig.a.mover?.(step, time, rig.pose.state.speed, reducedMotion);
    },
    wave() {
      if (!disposed) rig.pose.wave();
    },
    setLook(next) {
      if (disposed) return;
      const to = recordOf(next, record);
      const rebuild = shapeOf(to) !== shapeOf(record);
      record = to;
      if (rebuild) {
        // A new base, hair or clothes: new geometry and bones. The stride carries over, so the walk does not jump.
        const was = rig;
        rig = build();
        Object.assign(rig.pose.state, was.pose.state);
        rig.pose.rest(reducedMotion);
        free(was, true);
      } else {
        paintCharacter(rig.made, colorsNow());
        rig.a.group.scale.setScalar(HEIGHTS[record.height] ?? 1);
      }
    },
    setColors(colors) {
      if (disposed) return;
      over = colors === null ? null : checkColors(colors);
      paintCharacter(rig.made, colorsNow());
    },
    socket(name) {
      if (!isSocketName(name)) throw new TypeError(`@nano133/nanoterra: there is no socket ${JSON.stringify(name)} (the sockets are ${SOCKETS.join(", ")})`);
      return sockets[name];
    },
    setWorn(next) {
      if (disposed) return;
      const to = checkWorn(next);
      const rebuild = worn.some(merges) || to.some(merges);
      for (const w of worn) if (w.object && !to.some((x) => x.object === w.object)) w.object.removeFromParent();
      worn = to;
      if (rebuild) {
        const was = rig;
        rig = build();
        Object.assign(rig.pose.state, was.pose.state);
        rig.pose.rest(reducedMotion);
        free(was, true);
      }
      hang();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      // The sockets leave the dead bones; what hangs on them is the game's.
      for (const n of SOCKETS) sockets[n].removeFromParent();
      free(rig, false);
      toon.dispose();
      ink?.dispose();
      ramp.dispose();
    },
  };
}
