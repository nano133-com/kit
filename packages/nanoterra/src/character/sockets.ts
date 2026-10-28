import * as THREE from "three";
import type { BaseSpec } from "./bases/spec.js";
import { BUILD_FACTORS } from "./make.js";
import type { BoneName } from "./skeleton.js";

// The character's three attach points (sockets): the head, the right hand and the back. A socket is a THREE.Object3D on one bone of the
// island's skeleton, so a thing hung on it follows the walk, the run, the jump and the wave, and costs its own draws (a model of the game's,
// a .glb say). A worn thing that is merged into the body's geometry (ctx.ts `WornAdapter.add`) adds no draw and needs no socket.
//
// Each socket's place depends on the base and on the look (the build widens the body and moves the hands out; the head's size scales the
// head). `socketFrame` works it out; `createCharacter` keeps its sockets on the new bones after a rebuild (a new base, hair or clothes).

/** The names of the sockets. */
export const SOCKETS = ["head", "hand", "back"] as const;
export type SocketName = (typeof SOCKETS)[number];

/** Where a socket sits: its bone, and its place, turn and scale in that bone's space (the units of the character's own space). */
export type SocketFrame = { bone: BoneName; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

/** The head bone's rest height. */
const HEAD_BONE_Y = 1.5;
/** The chest bone's rest height. */
const CHEST_BONE_Y = 1.12;

/**
 * The hand's hold: a hand item is modelled standing up (+Y), its grip at the origin, its front at +Z. The hand holds it pointing forward,
 * as a torch is held out: the item's +Y along the character's forward (+Z), its front (+Z) up, its +X to the character's right (-X).
 */
export const HAND_HOLD = Object.freeze(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 1).normalize(), Math.PI));

/** What `socketFrame` reads of a look: its build and its head's size. */
export type SocketLook = { build: keyof typeof BUILD_FACTORS; head: number };

/**
 * A socket's frame on a base for a look.
 *  - "head": on the head bone, at the base's hat frame (`spec.hat`), scaled by the hat frame and the head's size: a thing made for the
 *    Classic's head, round the middle of the head (the game starter's hats are made so), fits every head.
 *  - "hand": on grip_R, in the middle of the right hand (the hands of a wide body are drawn further out than their bone), turned by
 *    `HAND_HOLD`.
 *  - "back": on the chest bone, on the back of the torso (`spec.back`, else the chest's height and the torso's radius there); its axes are the
 *    character's, so a back item is modelled with the side that touches the body at the origin and its bulk towards -Z.
 */
export function socketFrame(spec: BaseSpec, look: SocketLook, name: SocketName): SocketFrame {
  const t = BUILD_FACTORS[look.build] ?? BUILD_FACTORS.regular;
  const hs = look.head;
  if (name === "head") {
    const h = spec.hat;
    return {
      bone: "head",
      position: new THREE.Vector3(0, (h.y - HEAD_BONE_Y) * hs, (h.z ?? 0) * hs),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(h.s[0] * hs, h.s[1] * hs, h.s[2] * hs),
    };
  }
  if (name === "hand") {
    // limbs.ts draws the hand at 0.47 + 0.45 (torso - 1) + armOut from the middle; the bone stays at 0.47.
    const out = 0.45 * (t.torso - 1) + (spec.limbs.armOut ?? 0);
    const at = spec.handAt ?? [0, 0, 0];
    return { bone: "grip_R", position: new THREE.Vector3(-out + at[0], at[1], at[2]), quaternion: HAND_HOLD.clone(), scale: new THREE.Vector3(1, 1, 1) };
  }
  if (name === "back") {
    const y = spec.back?.y ?? CHEST_BONE_Y;
    const z = spec.back?.z ?? -spec.torsoR(y) * t.torso;
    return { bone: "chest", position: new THREE.Vector3(0, y - CHEST_BONE_Y, z), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) };
  }
  throw new TypeError(`@nano133/nanoterra: there is no socket ${JSON.stringify(name)} (the sockets are ${SOCKETS.join(", ")})`);
}

/** Puts a socket object on its bone (from `bones`) at its frame. The object keeps its children: a hung item moves with it. */
export function placeSocket(socket: THREE.Object3D, bones: Partial<Record<BoneName, THREE.Object3D>>, spec: BaseSpec, look: SocketLook, name: SocketName) {
  const f = socketFrame(spec, look, name);
  const bone = bones[f.bone];
  if (!bone) throw new TypeError(`@nano133/nanoterra: the skeleton has no bone ${f.bone} for the socket ${name}`);
  socket.position.copy(f.position);
  socket.quaternion.copy(f.quaternion);
  socket.scale.copy(f.scale);
  bone.add(socket);
  return socket;
}

export const isSocketName = (v: unknown): v is SocketName => typeof v === "string" && (SOCKETS as readonly string[]).includes(v);
