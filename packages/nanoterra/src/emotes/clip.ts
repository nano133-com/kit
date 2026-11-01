import * as THREE from "three";
import { BONES } from "../character/skeleton.js";

// Plays an emote's clip on a character, over the pose the solver gave its bones this frame: nano133.com's app/island/character/emotes/play.ts, with
// the same numbers. A clip (./clips.ts) holds each bone's turn from its parent for every frame, 30 a second, in the character's own space: Blender's
// IK and all is already in them, so nothing here solves. A clip fades in, and out at its end; a "full" clip (the whole body) stops when the character
// moves, jumps or swims, an "upper" one (the spine, the arms and the head) plays over the walk and stops only in the water. A loop plays until it
// stops; with reduced motion an emote holds its one picture (the clip's `hold` frame) instead. The clips load on the first emote (one chunk of their
// own), not with the game.
//
// The island measures a clip's age on the page's clock; here it is the sum of the steps the character's `update` took, so a paused game pauses its
// emotes too, and a test steps them exactly.

/** One clip as the file holds it: whole numbers, each bone's first frame then each frame's change (`q`: the bone's index, then 4 numbers a frame). */
export type RawClip = { n: number; loop: boolean; from?: number; kind: "full" | "upper"; hold: number; label: string; q: number[][]; p?: number[] };
export type RawClips = { v: number; fps: number; bones: string[]; clips: Record<string, RawClip> };

export type Clip = {
  /** Frames (a loop's last frame is its first, so it is not among them). */
  n: number;
  loop: boolean;
  /** The frame a loop goes back to (0: the whole clip loops; more: an opening that plays once, then the loop). */
  from: number;
  kind: "full" | "upper";
  hold: number;
  /** A one-shot's length in seconds. */
  seconds: number;
  turns: { bone: string; q: Float32Array }[];
  /** The hips' place from their rest place, three numbers a frame (or one place), or null. */
  hips: Float32Array | null;
};

const FPS = 30;
const Q = 10000;
/** Fades, in seconds: in at the start, out at a one-shot's end, and out when a move stops it. */
export const FADE_IN = 0.12;
export const FADE_END = 0.22;
export const FADE_STOP = 0.18;
const HIPS_REST = (() => {
  const b = BONES.find((x) => x[0] === "hips")!;
  return new THREE.Vector3(b[2], b[3], b[4]);
})();

let clips: Map<string, Clip> | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the clips, once (about 84 kB, 19 kB gzipped). Call it when the wheel first opens; a clip that plays before calls it too, and starts when they
 * arrive. A failed load (the network) may be tried again.
 */
export function loadEmotes(): Promise<void> {
  loading ??= import("./clips.js").then(
    (m) => {
      clips = decodeClips(m.default);
    },
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** True once the clips are loaded. */
export const emotesLoaded = (): boolean => clips !== null;
/** A loaded clip by its id, or null. */
export const emoteClip = (id: string): Clip | null => clips?.get(id) ?? null;

/** Whole numbers, the first frame then each frame's change, back to the frames (`width` numbers each); one frame when it never changes. */
function unpack(vals: readonly number[], width: number): Float32Array {
  const out = new Float32Array(vals.length);
  const acc = new Array<number>(width).fill(0);
  for (let i = 0; i < vals.length; i++) {
    acc[i % width] += vals[i];
    out[i] = acc[i % width] / Q;
  }
  return out;
}

export function decodeClips(raw: RawClips): Map<string, Clip> {
  const out = new Map<string, Clip>();
  for (const [id, c] of Object.entries(raw.clips)) {
    const turns = c.q.map(([bone, ...vals]) => {
      const q = unpack(vals, 4);
      // The whole numbers round each turn a little: back to unit length.
      for (let i = 0; i < q.length; i += 4) {
        const l = Math.hypot(q[i], q[i + 1], q[i + 2], q[i + 3]) || 1;
        for (let k = 0; k < 4; k++) q[i + k] /= l;
      }
      return { bone: raw.bones[bone], q };
    });
    out.set(id, { n: c.n, loop: c.loop, from: c.from ?? 0, kind: c.kind, hold: c.hold, seconds: (c.n - 1) / (raw.fps || FPS), turns, hips: c.p ? unpack(c.p, 3) : null });
  }
  return out;
}

/** What one character keeps between frames: the clip on show, its age (s), when a move or `stop` stopped it (its age then, or -1), and why it ended. */
export type ClipRun = { id: string | null; age: number; stopAge: number; stopWhy: "move" | "stop"; waiting: boolean; ended: "end" | "move" | "stop" | null };
export const newRun = (): ClipRun => ({ id: null, age: 0, stopAge: -1, stopWhy: "move", waiting: false, ended: null });

/**
 * Starts a clip on a run, `age` seconds in (a remote player's emote that began a little before). A loop already on show, and not stopping, goes on
 * through its own repeat: a player's loop is sent again for those who come later.
 */
export function startClip(run: ClipRun, id: string, age = 0): void {
  const now = run.id ? clips?.get(run.id) : null;
  if (run.id === id && now && now.loop && run.stopAge < 0) return;
  run.id = id;
  run.age = Math.max(0, age);
  run.stopAge = -1;
  run.waiting = !clips;
  run.ended = null;
}

/** Stops the clip on show with its fade (`stop` from the game). */
export function stopClip(run: ClipRun): void {
  if (run.id && run.stopAge < 0) {
    run.stopAge = run.age;
    run.stopWhy = "stop";
  }
}

export type ClipFrame = {
  /** The step (s). */
  dt: number;
  moving: boolean;
  air: boolean;
  swim: boolean;
  calm: boolean;
};

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const smooth = (w: number) => w * w * (3 - 2 * w);

/** Where a clip is at `age` seconds: the frame before, the frame after and how far between. */
function frameAt(c: Clip, age: number, calm: boolean): [number, number, number] {
  if (calm) return [c.hold, c.hold, 0];
  let f = age * FPS;
  if (c.loop && f >= c.n) f = c.from + ((f - c.from) % (c.n - c.from));
  else f = Math.min(f, c.n - 1);
  const i0 = Math.floor(f);
  const i1 = i0 + 1 >= c.n ? (c.loop ? c.from : c.n - 1) : i0 + 1;
  return [i0, i1, f - i0];
}

/**
 * One frame of the clip on a character: `bones` by name, already posed by the solver. Returns whether the clip showed. When it ends (its end, a move,
 * the water or `stopClip`), `run.id` goes back to null and `run.ended` says why.
 */
export function stepClip(run: ClipRun, bones: Readonly<Record<string, THREE.Bone>>, o: ClipFrame): boolean {
  if (!run.id) return false;
  const clip = clips?.get(run.id);
  if (!clip) {
    // Not loaded yet (or not a clip): it starts when the clips arrive, from its first frame.
    if (!clips) {
      run.waiting = true;
      void loadEmotes().catch(() => undefined);
    } else run.id = null;
    return false;
  }
  if (run.waiting) {
    run.waiting = false;
    run.age = 0;
  } else run.age += o.dt;
  const age = run.age;
  const stop = o.swim || (clip.kind === "full" && (o.moving || o.air));
  if (stop && run.stopAge < 0) {
    run.stopAge = age;
    run.stopWhy = "move";
  }
  let w = Math.min(1, age / FADE_IN);
  if (!clip.loop) w = Math.min(w, (clip.seconds - age) / FADE_END);
  if (run.stopAge >= 0) w = Math.min(w, 1 - (age - run.stopAge) / FADE_STOP);
  if (w <= 0) {
    if (run.stopAge >= 0 || (!clip.loop && age >= clip.seconds)) {
      run.ended = run.stopAge >= 0 ? run.stopWhy : "end";
      run.id = null;
    }
    return false;
  }
  w = smooth(Math.min(1, w));
  const [i0, i1, t] = frameAt(clip, age, o.calm);
  for (const tr of clip.turns) {
    const bone = bones[tr.bone];
    if (!bone) continue;
    if (tr.q.length === 4) qa.fromArray(tr.q, 0);
    else {
      qa.fromArray(tr.q, i0 * 4);
      qb.fromArray(tr.q, i1 * 4);
      qa.slerp(qb, t);
    }
    bone.quaternion.slerp(qa, w);
  }
  const hips = bones.hips;
  if (clip.hips && hips) {
    if (clip.hips.length === 3) va.fromArray(clip.hips, 0);
    else va.fromArray(clip.hips, i0 * 3).lerp(vb.fromArray(clip.hips, i1 * 3), t);
    hips.position.lerp(va.add(HIPS_REST), w);
  }
  return true;
}
