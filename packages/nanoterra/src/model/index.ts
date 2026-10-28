// "@nano133/nanoterra/model": the 3D model check. Pure: no Three.js, no network, no DOM. It reads a .glb from its bytes and says what is
// wrong with it (with a fix for each), what it measured and how to make it lighter, against a preset of limits: an island model, or a
// cosmetic for one of the character's three sockets (head, hand, back).
export { checkModel, modelSummary, sniffTexture, type ModelCheck, type ModelFacts, type ModelProblem, type ModelRule, type TextureFact, type Vec3 } from "./check.js";
export { BACK_ITEM, COSMETIC_LIMITS, HAND_ITEM, HEAD_ITEM, ISLAND_MODEL, PLAIN_EXTENSIONS, type MarkerRule, type ModelLimits, type ZoneBox, type ZoneDisc } from "./limits.js";
