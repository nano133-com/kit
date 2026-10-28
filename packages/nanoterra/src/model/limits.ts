// The limits a 3D model is checked against (@nano133/nanoterra/model; the README's "Model check"; on nano133.com
// docs/agents/launch.md, "The island model"). The checker (check.ts) is general: it takes one of these objects, so each
// kind of model (an island, a cosmetic on each socket) is a preset here with the same code. Pure data: no network, no DOM.

/** A named node the model must (or may) have. `empty`: a node with no mesh (a point, as `nano_door`); `mesh`: a node with a mesh that is never drawn (a collider). */
export type MarkerRule = { name: string; required: boolean; kind: "empty" | "mesh"; /** A `mesh` marker's own triangle limit (it is not counted in `maxTriangles`). */ maxTriangles?: number; /** What the marker is for, in plain words, for a fix line. */ purpose: string };

export type ZoneBox = { width: number; depth: number; height: number; below: number };
export type ZoneDisc = { radius: number; height: number; below: number };

export type ModelLimits = {
  /** What the model is, for a fix line ("island model"). */
  what: string;
  /** The whole .glb, in bytes. */
  maxBytes: number;
  /** The JSON chunk, in bytes (the model's description; the data is in the BIN chunk). */
  maxJsonBytes: number;
  /** Triangles drawn, every mesh instance counted, the `mesh` markers left out. */
  maxTriangles: number;
  /** Draw calls: each part (glTF primitive) of each drawn mesh instance. Left out: no limit. */
  maxDraws?: number;
  /** Images in the file. */
  maxTextures: number;
  /** The longest side of each image, in pixels. */
  maxTextureSide: number;
  /**
   * The build zone, in metres, in the model's own axes (glTF: +Y up). A box: x from -width/2 to width/2, z from -depth/2
   * to depth/2. A disc: every point at most `radius` from the y axis (x and z together). Both: y from -below to height.
   * The model's origin is the middle of the plot, on the ground.
   */
  zone: ZoneBox | ZoneDisc;
  markers: readonly MarkerRule[];
  /**
   * A marker whose origin is the attach point (a hand item's `grip_R`): when the file has it, the zone is measured from it, not from the
   * file's origin. It should be one of `markers` too (so a misspelt name gets a fix line).
   */
  anchor?: string;
  /** The glTF extensions the file may use (plain data only). Every other one is refused. */
  extensions: readonly string[];
  /** Animations, skins and morph targets: refused unless allowed. When allowed, the zone is checked in the rest pose only. */
  allowAnimations: boolean;
  allowSkins: boolean;
  allowMorphTargets: boolean;
  /** Caps on the description, so a hostile file costs little to read. */
  maxNodes: number;
  maxMeshes: number;
  maxPrimitives: number;
  maxAccessors: number;
  maxBufferViews: number;
  maxMaterials: number;
  /** The node tree's depth. */
  maxDepth: number;
  /** Vertex reads for the exact zone check (every rotated instance reads its vertices); past it, the box of each instance is used (larger, never smaller). */
  maxVertexWork: number;
  /** The whole check ends by then (ms). */
  maxMs: number;
};

/** The texture compression and material extensions three.js reads as plain data. */
export const PLAIN_EXTENSIONS = [
  "KHR_texture_transform",
  "KHR_texture_basisu",
  "EXT_texture_webp",
  "KHR_mesh_quantization",
  "KHR_materials_emissive_strength",
  "KHR_materials_unlit",
  "KHR_materials_ior",
  "KHR_materials_specular",
  "KHR_materials_clearcoat",
  "KHR_materials_sheen",
  "KHR_materials_transmission",
  "KHR_materials_volume",
  "KHR_materials_iridescence",
  "KHR_materials_anisotropy",
  "KHR_materials_dispersion",
  "KHR_xmp_json_ld",
] as const;

/**
 * A creator's island model (the creator islands gameplan, phase 2; Wes approved it on 2026-10-27): the entry of their
 * game on their plot. 5 MB, 50,000 triangles, 8 textures of at most 1,024 px, inside a disc of 10 m radius (20 m across)
 * and 18 m high on the plot's middle: the plot's free middle (PLOT_FREE_R in app/nanoterra/wheel/plots.ts; Wes chose the
 * disc over a 24 x 24 m box on 2026-10-28, as the box reached the gates' standing places); an empty `nano_door` where Play stands, an optional empty `nano_spawn` (the arrival point) and an
 * optional simple `nano_collide` mesh. No lights, no scripts, nothing outside the file. A still model for now.
 */
export const ISLAND_MODEL: ModelLimits = {
  what: "island model",
  maxBytes: 5 * 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  maxTriangles: 50_000,
  maxTextures: 8,
  maxTextureSide: 1024,
  zone: { radius: 10, height: 18, below: 0 },
  markers: [
    { name: "nano_door", required: true, kind: "empty", purpose: "where Play stands" },
    { name: "nano_spawn", required: false, kind: "empty", purpose: "where players arrive" },
    { name: "nano_collide", required: false, kind: "mesh", maxTriangles: 5_000, purpose: "the simple shape players walk on" },
  ],
  extensions: PLAIN_EXTENSIONS,
  allowAnimations: false,
  allowSkins: false,
  allowMorphTargets: false,
  maxNodes: 4096,
  maxMeshes: 1024,
  maxPrimitives: 4096,
  maxAccessors: 16_384,
  maxBufferViews: 16_384,
  maxMaterials: 256,
  maxDepth: 64,
  maxVertexWork: 4_000_000,
  maxMs: 2_000,
};

/**
 * The caps on the description of a cosmetic: a worn thing is small, so a file far past these is not one (and costs little to refuse).
 */
const COSMETIC_CAPS = {
  maxJsonBytes: 256 * 1024,
  extensions: PLAIN_EXTENSIONS,
  allowAnimations: false,
  allowSkins: false,
  allowMorphTargets: false,
  maxNodes: 256,
  maxMeshes: 32,
  maxPrimitives: 64,
  maxAccessors: 1024,
  maxBufferViews: 1024,
  maxMaterials: 16,
  maxDepth: 32,
  maxVertexWork: 500_000,
  maxMs: 1_000,
} as const;

/**
 * A worn thing on the character's head socket (@nano133/nanoterra/character, `socket("head")`; Wes approved the cosmetic limits on
 * 2026-10-28). The origin is the socket's point, the middle of the hat frame of the Classic's head, in metres for a character
 * 2.29 m tall (the socket scales it to every other head). The zone is 0.9 x 0.9 m and 0.8 m high, from 0.1 m below the origin.
 * 3,000 triangles, 1 texture of at most 512 px, 2 draws, 300 KB. Rigid: no skin, no animation (it rides its bone).
 */
export const HEAD_ITEM: ModelLimits = {
  ...COSMETIC_CAPS,
  what: "head item",
  maxBytes: 300 * 1024,
  maxTriangles: 3_000,
  maxDraws: 2,
  maxTextures: 1,
  maxTextureSide: 512,
  zone: { width: 0.9, depth: 0.9, height: 0.7, below: 0.1 },
  markers: [],
};

/**
 * A worn thing in the character's right hand (`socket("hand")`). Its attach point is its `grip_R` marker (an empty node where the right
 * hand holds it), else the file's origin; a `grip_L` marker (where a left hand would hold it) is allowed. The zone is 0.4 x 0.4 m and 1.6 m
 * long, from 0.3 m below the grip: a thing that stands up from the grip (+Y; the hand holds it pointing forward). 3,000 triangles,
 * 1 texture of at most 512 px, 2 draws, 300 KB.
 */
export const HAND_ITEM: ModelLimits = {
  ...COSMETIC_CAPS,
  what: "hand item",
  maxBytes: 300 * 1024,
  maxTriangles: 3_000,
  maxDraws: 2,
  maxTextures: 1,
  maxTextureSide: 512,
  zone: { width: 0.4, depth: 0.4, height: 1.3, below: 0.3 },
  markers: [
    { name: "grip_R", required: false, kind: "empty", purpose: "where the right hand holds it" },
    { name: "grip_L", required: false, kind: "empty", purpose: "where a left hand would hold it" },
  ],
  anchor: "grip_R",
};

/**
 * A worn thing on the character's back (`socket("back")`). The origin is the socket's point, on the back of the torso at the chest's
 * height; the side that touches the body is at the origin and the bulk goes back (-Z). The zone is 1.0 m wide, 0.6 m deep (its middle at
 * the origin) and 1.2 m high, from 0.6 m below. 4,000 triangles, 1 texture of at most 512 px, 2 draws, 400 KB.
 */
export const BACK_ITEM: ModelLimits = {
  ...COSMETIC_CAPS,
  what: "back item",
  maxBytes: 400 * 1024,
  maxTriangles: 4_000,
  maxDraws: 2,
  maxTextures: 1,
  maxTextureSide: 512,
  zone: { width: 1.0, depth: 0.6, height: 0.6, below: 0.6 },
  markers: [],
};

/** The cosmetic preset of each socket. */
export const COSMETIC_LIMITS = { head: HEAD_ITEM, hand: HAND_ITEM, back: BACK_ITEM } as const;
