// "@nano133/nanoterra/character": the character kit, plain three.js and nothing else (no React, no react-three-fiber, no site code). The island, the 3D
// room and a creator's game call the same functions. A look is a record of small whole numbers (record.ts); `buildCharacter` makes the geometry;
// `assemble` binds it to the island's skeleton with the host's two materials; the host turns the 28 bones with its own solver and calls `mover` for the
// character's own. `createCharacter` does all of that for a game that wants a character and nothing more (create.ts).
import { BASE_SPECS } from "./bases/index.js";
import { buildWith, type MakeOptions } from "./make.js";
import type { CharLook } from "./record.js";

/** The geometry of a character (its base is the look's). */
export function buildCharacter(look: CharLook, opts: MakeOptions = {}) {
  return buildWith(BASE_SPECS[look.base], look, opts);
}

export { BASE_SPECS } from "./bases/index.js";
export { assemble, type Assembled } from "./assemble.js";
export { makeBones, BONES, boneIndex, type BoneName } from "./skeleton.js";
export { paintCharacter, buildWith, headMatrix, BUILD_FACTORS, type Made, type MakeOptions } from "./make.js";
export { makeMover, type Mover } from "./motion.js";
export { torsoWeights } from "./torso.js";
export { mtx, G, roundedBox } from "./kit.js";
export { NO_FIT, type Ctx, type HairFit, type HatPart, type HeadSpec, type WornAdapter, type WornPart } from "./ctx.js";
export { armFit, bodyDelta, buddyFit, slotFit, type FitSlot } from "./fit.js";
export type { ExtraBone, Fit, Paint, PaintFn, Weights } from "./build.js";
export * from "./lists.js";
export * from "./record.js";
export * from "./edit.js";
export * from "./look.js";
export { createCharacter, HEIGHT, RADIUS, type Character, type CharacterOptions, type Quality } from "./create.js";
export { WAVE_SECONDS, MAX_DT, type Motion } from "./pose.js";
export { createLookPreview, type LookPreview, type LookPreviewOptions, type PreviewBody } from "./preview.js";
export { SOCKETS, HAND_HOLD, socketFrame, placeSocket, isSocketName, type SocketName, type SocketFrame, type SocketLook } from "./sockets.js";
