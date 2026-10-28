import type { MarkerRule, ModelLimits } from "./limits.js";

// The 3D model check (@nano133/nanoterra/model; the README's "Model check"; on nano133.com docs/agents/launch.md, "The
// island model"): reads a .glb (binary glTF 2.0) from its bytes and answers what is wrong with it, in plain words with a
// fix, what it measured, and advice that is not a failure. Pure: no network, no DOM, no database. General: the rules come
// from a ModelLimits object (limits.ts: ISLAND_MODEL, and the cosmetic presets HEAD_ITEM, HAND_ITEM and BACK_ITEM).
//
// The file comes from a stranger, so every read is bounded: no length or count in the file is trusted before it is
// checked against the bytes that are really there, nothing is allocated from a declared size, the work has a cap and a
// time limit, and the check never throws for a bad file (it answers a problem instead).

export type ModelRule = "file" | "size" | "embedded" | "extensions" | "lights" | "motion" | "triangles" | "textures" | "draws" | "zone" | "markers" | "time";
/** One thing wrong with the model: `fix` is one plain sentence or two, for the creator. */
export type ModelProblem = { rule: ModelRule; fix: string };
export type Vec3 = [number, number, number];
export type TextureFact = { type: "image/png" | "image/jpeg" | "image/webp" | "image/ktx2"; width: number; height: number; bytes: number };
export type ModelFacts = {
  bytes: number;
  /** Triangles drawn (every instance counted; the `mesh` markers, as `nano_collide`, left out). Null when not counted. */
  triangles: number | null;
  textures: TextureFact[];
  /**
   * Draws: each part (glTF primitive) of each drawn mesh instance is one draw call, the `mesh` markers left out. Null when not counted.
   * (A game may join parts or draw an ink outline; this counts the file as it is.)
   */
  draws: number | null;
  /** The materials that the drawn parts use (a part with no material uses the default one, which counts once). */
  materials: number;
  /**
   * The model's box in its own axes (metres), every drawn mesh and every `mesh` marker in it. Null when not measured. When the limits name an
   * `anchor` and the file has it, the box, the reach and the zone are measured from the anchor's point (`anchor`), not the file's origin.
   */
  bounds: { min: Vec3; max: Vec3 } | null;
  /** The farthest drawn point from the y axis (x and z together, metres), the `mesh` markers in it. Null when not measured. */
  reach: number | null;
  /** True: the box and the reach come from every vertex. False: past the work cap, from each instance's box (larger, never smaller). */
  exactBounds: boolean;
  /** Where each marker that the file has stands (its node's origin, in the model's axes). */
  markers: Record<string, Vec3>;
  /** The anchor's point in the file's axes (the limits' `anchor` marker), or null: the file's origin is the attach point. */
  anchor: Vec3 | null;
  nodes: number;
  meshes: number;
  extensions: string[];
};
/** `advice`: plain lines that would make the model lighter (never a failure: `ok` does not read them). */
export type ModelCheck = { ok: boolean; problems: ModelProblem[]; facts: ModelFacts; advice: string[] };

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const MAX_PROBLEMS = 20;
const MAX_ADVICE = 6;
/** A texture this long on a side or longer, as a PNG or a JPEG, gets the KTX2 advice. */
const ADVICE_TEXTURE_SIDE = 512;
/** This many vertices or more, as 32-bit floats, get the quantization advice. */
const ADVICE_VERTICES = 2_000;
/** Metres a model may pass the zone's edge by (float rounding). */
const EPS = 1e-3;
/** JSON values the extension scan visits at most. */
const SCAN_VALUES = 2_000_000;

/** A fault that stops the reading: the check answers it and what it found before. */
class Stop extends Error {
  constructor(
    readonly rule: ModelRule,
    readonly fix: string,
  ) {
    super(fix);
  }
}
class TimeUp extends Error {}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const isIndex = (v: unknown, n: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < n;
const isCount = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= 0xffffffff;
const nums = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x));
const m1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const thousands = (n: number) => n.toLocaleString("en-US");
const mbOf = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** What we say about an extension we refuse, when we know it. */
const EXTENSION_FIX: Record<string, string> = {
  KHR_draco_mesh_compression: "Export without Draco mesh compression: the check reads the plain mesh (texture compression, KTX2, is fine).",
  EXT_meshopt_compression: "Export without meshopt compression: the check reads the plain mesh (texture compression, KTX2, is fine).",
  EXT_mesh_gpu_instancing: "Export without GPU instancing (EXT_mesh_gpu_instancing): each copy must be its own node, so it is counted.",
  KHR_interactivity: "Take out KHR_interactivity: a model is data, never code.",
  KHR_animation_pointer: "Take out KHR_animation_pointer: the model must stay still.",
};

const IDENTITY = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a × b, 4 x 4, column-major (glTF's order). */
function mul(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

/** T × R × S, as glTF (and three.js's Matrix4.compose) builds a node's matrix. `q` is a unit quaternion [x, y, z, w]. */
function compose(t: readonly number[], q: readonly number[], s: readonly number[]): number[] {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

/** True when each row of the linear part has at most one entry that is not 0 (a scale, a flip or a quarter turn): a box then maps to a box exactly. */
function boxToBox(m: readonly number[]): boolean {
  for (let r = 0; r < 3; r++) if ((m[r] !== 0 ? 1 : 0) + (m[4 + r] !== 0 ? 1 : 0) + (m[8 + r] !== 0 ? 1 : 0) > 1) return false;
  return true;
}

type Box = { min: Vec3; max: Vec3 };
const emptyBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
function grow(b: Box, x: number, y: number, z: number) {
  if (x < b.min[0]) b.min[0] = x;
  if (y < b.min[1]) b.min[1] = y;
  if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x;
  if (y > b.max[1]) b.max[1] = y;
  if (z > b.max[2]) b.max[2] = z;
}
const point = (m: readonly number[], x: number, y: number, z: number): Vec3 => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

// ---- Pictures: the size from the first bytes ---------------------------------------------------------------------

/** The picture's type and size from its bytes (never from the file's word for it), or null. */
export function sniffTexture(b: Uint8Array): Omit<TextureFact, "bytes"> | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = b.length;
  const ascii = (at: number, s: string) => at + s.length <= n && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  if (n >= 24 && dv.getUint32(0) === 0x89504e47 && dv.getUint32(4) === 0x0d0a1a0a && ascii(12, "IHDR")) return { type: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 4 <= n) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i += 1;
        continue;
      }
      // A start of frame (baseline, progressive and the rest), never the DHT, JPG or DAC markers.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return i + 9 <= n ? { type: "image/jpeg", height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) } : null;
      if (m === 0xda || m === 0xd9) return null;
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        i += 2;
        continue;
      }
      const len = dv.getUint16(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (n >= 30 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    if (ascii(12, "VP8X")) return { type: "image/webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (ascii(12, "VP8L") && b[20] === 0x2f) {
      const bits = dv.getUint32(21, true);
      return { type: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (ascii(12, "VP8 ")) return { type: "image/webp", width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    return null;
  }
  const KTX2 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (n >= 28 && KTX2.every((x, i) => b[i] === x)) return { type: "image/ktx2", width: dv.getUint32(20, true), height: Math.max(1, dv.getUint32(24, true)) };
  return null;
}

// ---- The check ---------------------------------------------------------------------------------------------------

/** Checks a .glb against `limits`. Never throws: a file that cannot be read answers a problem. */
export function checkModel(input: Uint8Array, limits: ModelLimits): ModelCheck {
  const facts: ModelFacts = { bytes: input instanceof Uint8Array ? input.byteLength : 0, triangles: null, draws: null, materials: 0, textures: [], bounds: null, reach: null, exactBounds: true, markers: {}, anchor: null, nodes: 0, meshes: 0, extensions: [] };
  const problems: ModelProblem[] = [];
  const advice: string[] = [];
  const add = (rule: ModelRule, fix: string) => {
    if (problems.length < MAX_PROBLEMS && !problems.some((p) => p.fix === fix)) problems.push({ rule, fix });
  };
  const tip = (line: string) => {
    if (advice.length < MAX_ADVICE && !advice.includes(line)) advice.push(line);
  };
  try {
    if (!(input instanceof Uint8Array)) throw new Stop("file", "The file could not be read.");
    read(input, limits, facts, add, tip, Date.now() + limits.maxMs);
  } catch (e) {
    if (e instanceof Stop) add(e.rule, e.fix);
    else if (e instanceof TimeUp) add("time", `The check of your ${limits.what} took too long. Make it simpler: fewer nodes, meshes and vertices.`);
    else add("file", `The file could not be read as a glTF model. Export it again as glTF binary (.glb).`);
  }
  return { ok: problems.length === 0, problems, facts, advice };
}

/** One short line of what was measured: "12,000 triangles, 3 textures, 1.2 MB, 20.0 x 15.0 x 10.0 m". */
export function modelSummary(f: ModelFacts): string {
  const parts = [`${thousands(f.triangles ?? 0)} triangles`, `${f.textures.length} texture${f.textures.length === 1 ? "" : "s"}`, mbOf(f.bytes)];
  if (f.bounds) parts.push(`${m1(f.bounds.max[0] - f.bounds.min[0])} x ${m1(f.bounds.max[2] - f.bounds.min[2])} x ${m1(f.bounds.max[1] - f.bounds.min[1])} m`);
  return parts.join(", ");
}

function read(bytes: Uint8Array, L: ModelLimits, facts: ModelFacts, add: (rule: ModelRule, fix: string) => void, tip: (line: string) => void, deadline: number) {
  let ops = 0;
  const tick = () => {
    if ((++ops & 0xffff) === 0 && Date.now() > deadline) throw new TimeUp();
  };
  const what = L.what;
  const n = bytes.byteLength;

  // The container: the 12-byte header, the JSON chunk, the BIN chunk, nothing after.
  if (n > L.maxBytes) throw new Stop("size", `Your ${what} is ${mbOf(n)}. Make it ${mbOf(L.maxBytes)} or smaller (smaller textures help most).`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n);
  if (n < 12 || dv.getUint32(0, true) !== MAGIC) throw new Stop("file", `This is not a .glb file. Export your ${what} as glTF binary (.glb), not .gltf, .fbx or .obj.`);
  if (dv.getUint32(4, true) !== 2) throw new Stop("file", `The file is glTF version ${dv.getUint32(4, true)}. Export it as glTF 2.0 binary (.glb).`);
  const total = dv.getUint32(8, true);
  if (total > n) throw new Stop("file", "The file is cut short: it says it is longer than it is. Upload the whole file again.");
  if (total < n) throw new Stop("file", "The file has extra bytes after its end. Export it again as glTF binary (.glb).");
  if (n < 20) throw new Stop("file", "The file is cut short: it has no JSON chunk. Upload the whole file again.");
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON) throw new Stop("file", "The file's first chunk is not its JSON chunk. Export it again as glTF binary (.glb).");
  if (jsonLen === 0 || 20 + jsonLen > n) throw new Stop("file", "The JSON chunk's length is wrong: it runs past the end of the file. Export it again.");
  if (jsonLen > L.maxJsonBytes) throw new Stop("size", `The model's description (its JSON chunk) is ${mbOf(jsonLen)}. Keep it under ${mbOf(L.maxJsonBytes)}: fewer nodes and meshes.`);
  let binStart = 0;
  let binLen = 0;
  const after = 20 + jsonLen;
  if (after < n) {
    if (after + 8 > n) throw new Stop("file", "The file ends inside a chunk header. Upload the whole file again.");
    const len = dv.getUint32(after, true);
    if (dv.getUint32(after + 4, true) !== CHUNK_BIN) throw new Stop("file", "The file has a chunk that is not glTF's BIN chunk. Export it again as glTF binary (.glb).");
    if (after + 8 + len > n) throw new Stop("file", "The BIN chunk's length is wrong: it runs past the end of the file. Export it again.");
    if (after + 8 + len < n) throw new Stop("file", "The file has extra data after its BIN chunk. Export it again as glTF binary (.glb).");
    binStart = after + 8;
    binLen = len;
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLen)));
  } catch {
    throw new Stop("file", "The model's JSON chunk is not valid JSON. Export it again as glTF binary (.glb).");
  }
  if (!isObj(json)) throw new Stop("file", "The model's JSON chunk is not a glTF object. Export it again.");
  const asset = json.asset;
  if (!isObj(asset) || typeof asset.version !== "string" || !/^2\.\d+$/.test(asset.version) || (asset.minVersion !== undefined && asset.minVersion !== "2.0")) throw new Stop("file", "The file does not say it is glTF 2.0. Export it as glTF 2.0 binary (.glb).");

  // Extensions: every name the file uses, from extensionsUsed and from every "extensions" object at any depth.
  const used = new Set<string>();
  for (const key of ["extensionsUsed", "extensionsRequired"] as const) {
    const v = json[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > 256 || !v.every((x) => typeof x === "string" && x.length <= 128)) throw new Stop("file", `"${key}" is not a list of names. Export the file again.`);
    for (const x of v) used.add(x);
  }
  {
    const stack: unknown[] = [json];
    let seen = 0;
    while (stack.length) {
      const v = stack.pop();
      if (++seen > SCAN_VALUES) throw new Stop("size", `The model's description is too large. Make it simpler.`);
      tick();
      if (Array.isArray(v)) {
        for (const x of v) if (x && typeof x === "object") stack.push(x);
      } else if (isObj(v)) {
        for (const [k, x] of Object.entries(v)) {
          if (k === "extensions" && isObj(x)) for (const name of Object.keys(x)) if (name.length <= 128) used.add(name);
          if (x && typeof x === "object") stack.push(x);
        }
      }
    }
  }
  facts.extensions = [...used].sort();
  for (const name of facts.extensions) {
    if (name === "KHR_lights_punctual") add("lights", `Take the lights out of your ${what}: the level lights it. For a glow, use an emissive colour.`);
    else if (!L.extensions.includes(name)) add("extensions", EXTENSION_FIX[name] ?? `Take out the extension ${name}: only plain material and texture extensions are allowed.`);
  }
  if (json.lights !== undefined) add("lights", `Take the lights out of your ${what}: the level lights it. For a glow, use an emissive colour.`);

  const list = (key: string, max: number): Json[] => {
    const v = json[key as keyof typeof json];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Stop("file", `"${key}" is not a list. Export the file again.`);
    if (v.length > max) throw new Stop("size", `Your ${what} has ${thousands(v.length)} ${key}. Keep it to ${thousands(max)} or fewer.`);
    if (!v.every(isObj)) throw new Stop("file", `An item in "${key}" is not an object. Export the file again.`);
    return v;
  };
  const buffers = list("buffers", 16);
  const views = list("bufferViews", L.maxBufferViews);
  const accessors = list("accessors", L.maxAccessors);
  const meshes = list("meshes", L.maxMeshes);
  const nodes = list("nodes", L.maxNodes);
  const images = list("images", Math.max(L.maxTextures, 64));
  const textures = list("textures", 256);
  const materials = list("materials", L.maxMaterials);
  const scenes = list("scenes", 64);
  const animations = list("animations", 1024);
  const skins = list("skins", 1024);
  facts.nodes = nodes.length;
  facts.meshes = meshes.length;

  // Everything inside the file: no buffer or image at an address (external or data:).
  let outside = false;
  buffers.forEach((b, i) => {
    if (b.uri !== undefined) {
      outside = true;
      const data = typeof b.uri === "string" && /^data:/i.test(b.uri.trim());
      add("embedded", data ? `Buffer ${i} is written as a data: address. Export as glTF binary (.glb), so its data is in the file's BIN chunk.` : `Buffer ${i} points at a file outside the .glb. Export as glTF binary (.glb) with everything inside one file.`);
    } else if (i > 0) {
      outside = true;
      add("embedded", "The file has more than one buffer. Export as glTF binary (.glb), with all its data in one BIN chunk.");
    }
    if (!isCount(b.byteLength, 1)) throw new Stop("file", `Buffer ${i} has no valid length. Export the file again.`);
  });
  images.forEach((im, i) => {
    if (im.uri !== undefined) {
      outside = true;
      const data = typeof im.uri === "string" && /^data:/i.test(im.uri.trim());
      add("embedded", data ? `Image ${i} is written as a data: address. Export as glTF binary (.glb), so each image is inside the BIN chunk.` : `Image ${i} points at a picture outside the .glb. Export as glTF binary (.glb), with the textures inside the file.`);
    }
  });
  if (outside) return;
  if (buffers.length && (buffers[0].byteLength as number) > binLen) throw new Stop("file", "The buffer says it is longer than the file's BIN chunk. Export the file again.");
  const bufLen = buffers.length ? (buffers[0].byteLength as number) : 0;

  /** A buffer view, checked against the bytes that are there: its start in `bytes` and its length. */
  const viewCache = new Map<number, { start: number; length: number; stride: number | undefined }>();
  const viewOf = (i: unknown, who: string) => {
    if (!isIndex(i, views.length)) throw new Stop("file", `${who} names a buffer view that is not there. Export the file again.`);
    const hit = viewCache.get(i);
    if (hit) return hit;
    const v = views[i];
    const off = v.byteOffset ?? 0;
    if (!isIndex(v.buffer, buffers.length) || !isCount(off) || !isCount(v.byteLength, 1) || off + v.byteLength > bufLen) throw new Stop("file", `Buffer view ${i} runs past the end of the file's data. Export the file again.`);
    if (v.byteStride !== undefined && (!isCount(v.byteStride, 4) || v.byteStride > 252 || v.byteStride % 4)) throw new Stop("file", `Buffer view ${i} has a stride that glTF does not allow. Export the file again.`);
    const out = { start: binStart + off, length: v.byteLength, stride: v.byteStride as number | undefined };
    viewCache.set(i, out);
    return out;
  };

  type Span = { count: number; at: number; stride: number; comps: number; ctype: number; normalized: boolean };
  const spanCache = new Map<number, Span>();
  /** An accessor that is read, checked: every element it names lies inside its buffer view. Nothing is allocated from its count. */
  const spanOf = (i: unknown, who: string, want?: { types: readonly string[]; ctypes: readonly number[] }): Span => {
    if (!isIndex(i, accessors.length)) throw new Stop("file", `${who} names an accessor that is not there. Export the file again.`);
    const a = accessors[i];
    const hit = spanCache.get(i);
    if (hit && !want) return hit;
    const comps = TYPE_COMPONENTS[a.type as string];
    const csize = COMPONENT_BYTES[a.componentType as number];
    if (!comps || !csize) throw new Stop("file", `Accessor ${i} has a type that the check does not read. Export the file again.`);
    if (want && (!want.types.includes(a.type as string) || !want.ctypes.includes(a.componentType as number))) throw new Stop("file", `${who} uses accessor ${i} with a type that glTF does not allow there. Export the file again.`);
    if (a.sparse !== undefined) throw new Stop("file", `Accessor ${i} is sparse. Export without sparse accessors.`);
    if (!isCount(a.count, 1)) throw new Stop("file", `Accessor ${i} has no valid count. Export the file again.`);
    const view = viewOf(a.bufferView, `Accessor ${i}`);
    const off = a.byteOffset ?? 0;
    const elem = comps * csize;
    const stride = view.stride ?? elem;
    if (!isCount(off) || off % csize || stride < elem) throw new Stop("file", `Accessor ${i} is not laid out as glTF says. Export the file again.`);
    // The last element must end inside the view; a count that the bytes cannot hold is a lie.
    if (off + stride * (a.count - 1) + elem > view.length) throw new Stop("file", `Accessor ${i} says it has ${thousands(a.count)} items, more than its data holds. Export the file again.`);
    const out = { count: a.count, at: view.start + off, stride, comps, ctype: a.componentType as number, normalized: a.normalized === true };
    spanCache.set(i, out);
    return out;
  };

  // The textures: inside the file, PNG or JPEG (and WebP or KTX2 when the limits allow their extensions), the size read from the picture itself.
  const mimes = new Set(["image/png", "image/jpeg", ...(L.extensions.includes("EXT_texture_webp") ? ["image/webp"] : []), ...(L.extensions.includes("KHR_texture_basisu") ? ["image/ktx2"] : [])]);
  if (images.length > L.maxTextures) add("textures", `Your ${what} has ${images.length} textures. Use ${L.maxTextures} or fewer (an atlas joins small ones).`);
  images.forEach((im, i) => {
    const v = viewOf(im.bufferView, `Image ${i}`);
    const info = sniffTexture(bytes.subarray(v.start, v.start + v.length));
    if (!info) return add("textures", `Image ${i} is not a PNG${mimes.has("image/jpeg") ? ", JPEG" : ""}${mimes.has("image/webp") ? ", WebP" : ""}${mimes.has("image/ktx2") ? " or KTX2" : ""} picture that the check can read. Export it again.`);
    if (!mimes.has(info.type)) return add("textures", `Image ${i} is ${info.type.slice(6).toUpperCase()}. Use PNG or JPEG.`);
    if (im.mimeType !== info.type) add("textures", `Image ${i} says it is "${String(im.mimeType ?? "no type")}" but it is ${info.type}. Export it again.`);
    facts.textures.push({ ...info, bytes: v.length });
    if ((info.type === "image/png" || info.type === "image/jpeg") && Math.max(info.width, info.height) >= ADVICE_TEXTURE_SIDE && L.extensions.includes("KHR_texture_basisu"))
      tip(`Image ${i} is a ${thousands(Math.max(info.width, info.height))} px ${info.type.slice(6).toUpperCase()}: KTX2 (KHR_texture_basisu) makes it smaller on the phone's graphics card.`);
    if (!info.width || !info.height) add("textures", `Image ${i} has no size. Export it again.`);
    else if (info.width > L.maxTextureSide || info.height > L.maxTextureSide) add("textures", `Image ${i} is ${info.width} x ${info.height} px. Make each texture ${thousands(L.maxTextureSide)} px or smaller on a side.`);
  });
  textures.forEach((t, i) => {
    const sources = [t.source, ...Object.values(isObj(t.extensions) ? t.extensions : {}).map((x) => (isObj(x) ? x.source : undefined))].filter((x) => x !== undefined);
    if (!sources.every((s) => isIndex(s, images.length))) throw new Stop("file", `Texture ${i} names an image that is not there. Export the file again.`);
  });

  // Still models: no animation, no skin, no morph target, unless the limits allow them.
  if (animations.length && !L.allowAnimations) add("motion", `Take the animations out of your ${what}: it must stand still for now.`);
  if (skins.length && !L.allowSkins) add("motion", `Take the armature (skin) out of your ${what}: it must stand still for now. Apply it to the mesh first.`);

  // The scene: the file's own default scene, its node tree walked once (a node in it twice, or a loop, is refused).
  if (!scenes.length) throw new Stop("file", `The file has no scene. Export your ${what} with its scene.`);
  const sceneIndex = json.scene ?? 0;
  if (!isIndex(sceneIndex, scenes.length)) throw new Stop("file", "The file's default scene is not there. Export the file again.");
  const roots = scenes[sceneIndex].nodes ?? [];
  if (!Array.isArray(roots) || roots.length > L.maxNodes) throw new Stop("file", "The scene's node list is not valid. Export the file again.");
  type Placed = { node: number; world: number[] };
  const drawn: Placed[] = [];
  const named = new Map<string, Placed[]>();
  const placed = new Uint8Array(nodes.length);
  const stack: { node: unknown; parent: number[]; depth: number }[] = roots.map((r) => ({ node: r, parent: IDENTITY(), depth: 1 }));
  let badRotation = false;
  while (stack.length) {
    const { node, parent, depth } = stack.pop()!;
    tick();
    if (!isIndex(node, nodes.length)) throw new Stop("file", "A node in the scene is not there. Export the file again.");
    if (placed[node]) throw new Stop("file", `Node ${node} is in the scene twice (or in a loop). Export the file again.`);
    placed[node] = 1;
    if (depth > L.maxDepth) throw new Stop("file", `The node tree is deeper than ${L.maxDepth}. Flatten it.`);
    const nd = nodes[node];
    let local: number[];
    if (nd.matrix !== undefined) {
      if (nd.translation !== undefined || nd.rotation !== undefined || nd.scale !== undefined) throw new Stop("file", `Node ${node} has both a matrix and a move, turn or scale. Export the file again.`);
      if (!nums(nd.matrix, 16)) throw new Stop("file", `Node ${node}'s matrix is not 16 numbers. Export the file again.`);
      local = nd.matrix;
      if (local[3] !== 0 || local[7] !== 0 || local[11] !== 0 || local[15] !== 1) throw new Stop("file", `Node ${node}'s matrix is not a plain move, turn and scale. Apply the transforms and export again.`);
    } else {
      const t = nd.translation ?? [0, 0, 0];
      const q = nd.rotation ?? [0, 0, 0, 1];
      const s = nd.scale ?? [1, 1, 1];
      if (!nums(t, 3) || !nums(q, 4) || !nums(s, 3)) throw new Stop("file", `Node ${node} has a move, turn or scale that is not numbers. Export the file again.`);
      const len = Math.hypot(q[0], q[1], q[2], q[3]);
      if (Math.abs(len - 1) > 1e-3) badRotation = true;
      local = compose(t, len > 0 ? q.map((x) => x / len) : [0, 0, 0, 1], s);
    }
    const world = mul(parent, local);
    if (!world.every(Number.isFinite)) throw new Stop("zone", `Node ${node} is placed too far away. Keep your ${what} inside its zone.`);
    const p = { node, world };
    if (typeof nd.name === "string") named.set(nd.name, [...(named.get(nd.name) ?? []), p]);
    if (nd.mesh !== undefined) {
      if (!isIndex(nd.mesh, meshes.length)) throw new Stop("file", `Node ${node} names a mesh that is not there. Export the file again.`);
      drawn.push(p);
    }
    if (nd.skin !== undefined && !L.allowSkins) add("motion", `Take the armature (skin) out of your ${what}: it must stand still for now. Apply it to the mesh first.`);
    const kids = nd.children ?? [];
    if (!Array.isArray(kids) || kids.length > L.maxNodes) throw new Stop("file", `Node ${node}'s children are not a list. Export the file again.`);
    for (const k of kids) stack.push({ node: k, parent: world, depth: depth + 1 });
  }
  if (badRotation) add("file", "A node's turn is not a unit quaternion. Apply the transforms (in Blender: Object, Apply, All Transforms) and export again.");

  // The meshes: each one's primitives checked once, then each drawn instance counted and measured.
  const quantized = L.extensions.includes("KHR_mesh_quantization") && used.has("KHR_mesh_quantization");
  const positionTypes = { types: ["VEC3"], ctypes: quantized ? [5126, 5120, 5121, 5122, 5123] : [5126] } as const;
  const indexTypes = { types: ["SCALAR"], ctypes: [5121, 5123, 5125] } as const;
  type Prim = { position: number; triangles: number; mode: number; material: number };
  const meshCache = new Map<number, Prim[]>();
  let primitives = 0;
  let badVertex = false;
  const meshOf = (m: number): Prim[] => {
    const hit = meshCache.get(m);
    if (hit) return hit;
    const prims = meshes[m].primitives;
    if (!Array.isArray(prims) || !prims.length || !prims.every(isObj)) throw new Stop("file", `Mesh ${m} has no primitives. Export the file again.`);
    primitives += prims.length;
    if (primitives > L.maxPrimitives) throw new Stop("size", `Your ${what} has more than ${thousands(L.maxPrimitives)} mesh parts. Join meshes that share a material.`);
    const out = prims.map((pr, j): Prim => {
      const who = `Mesh ${m}, part ${j}`;
      const mode = pr.mode ?? 4;
      if (!isIndex(mode, 7)) throw new Stop("file", `${who} has a draw mode that glTF does not have. Export the file again.`);
      if (!isObj(pr.attributes)) throw new Stop("file", `${who} has no attributes. Export the file again.`);
      const position = pr.attributes.POSITION;
      const pos = spanOf(position, who, positionTypes);
      for (const [name, acc] of Object.entries(pr.attributes)) if (name !== "POSITION") spanOf(acc, `${who} (${name.slice(0, 32)})`);
      const count = pr.indices !== undefined ? spanOf(pr.indices, `${who} (indices)`, indexTypes).count : pos.count;
      if (pr.targets !== undefined && !L.allowMorphTargets) add("motion", `Take the shape keys (morph targets) out of your ${what}: it must stand still for now.`);
      const triangles = mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
      if (pr.material !== undefined && !isIndex(pr.material, materials.length)) throw new Stop("file", `${who} names a material that is not there. Export the file again.`);
      if (pos.ctype === 5126 && pos.count >= ADVICE_VERTICES && L.extensions.includes("KHR_mesh_quantization"))
        tip("The positions are 32-bit floats: KHR_mesh_quantization (for example gltf-transform quantize) makes them half the size.");
      return { position: position as number, triangles, mode, material: pr.material === undefined ? -1 : (pr.material as number) };
    });
    meshCache.set(m, out);
    return out;
  };
  /** One position, as glTF reads it (a quantized one normalised when the accessor says so). */
  const component = (at: number, ctype: number, norm: boolean): number => {
    switch (ctype) {
      case 5126:
        return dv.getFloat32(at, true);
      case 5120:
        return norm ? Math.max(dv.getInt8(at) / 127, -1) : dv.getInt8(at);
      case 5121:
        return norm ? dv.getUint8(at) / 255 : dv.getUint8(at);
      case 5122:
        return norm ? Math.max(dv.getInt16(at, true) / 32767, -1) : dv.getInt16(at, true);
      default:
        return norm ? dv.getUint16(at, true) / 65535 : dv.getUint16(at, true);
    }
  };
  /** Calls `f` with every vertex of the accessor. Reads the bytes in place: nothing is allocated. */
  const eachVertex = (s: Span, f: (x: number, y: number, z: number) => void) => {
    const size = COMPONENT_BYTES[s.ctype];
    for (let v = 0, at = s.at; v < s.count; v++, at += s.stride) {
      tick();
      const x = component(at, s.ctype, s.normalized), y = component(at + size, s.ctype, s.normalized), z = component(at + 2 * size, s.ctype, s.normalized);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        badVertex = true;
        continue;
      }
      f(x, y, z);
    }
  };
  /** The accessor's own box, from its real vertices (never from the min and max that the file claims). */
  const localBoxes = new Map<number, Box>();
  const localBox = (acc: number): Box => {
    const hit = localBoxes.get(acc);
    if (hit) return hit;
    const b = emptyBox();
    eachVertex(spanOf(acc, "A mesh"), (x, y, z) => grow(b, x, y, z));
    localBoxes.set(acc, b);
    return b;
  };

  const markerOf = new Map<number, MarkerRule>();
  for (const rule of L.markers) for (const p of named.get(rule.name) ?? []) markerOf.set(p.node, rule);
  // The attach point: the anchor marker's origin when the limits name one and the file has it (the first, if it has two).
  const anchorNode = L.anchor ? named.get(L.anchor)?.[0] : undefined;
  const A: Vec3 = anchorNode ? point(anchorNode.world, 0, 0, 0) : [0, 0, 0];
  facts.anchor = anchorNode ? A : null;
  const bounds = emptyBox();
  /** The square of the reach (x and z from the y axis). */
  let reach2 = 0;
  const take = (p: Vec3) => {
    const x: Vec3 = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
    grow(bounds, ...x);
    const r2 = x[0] * x[0] + x[2] * x[2];
    if (r2 > reach2) reach2 = r2;
  };
  const disc = "radius" in L.zone;
  let triangles = 0;
  let draws = 0;
  const usedMaterials = new Set<number>();
  let work = 0;
  let drawnCount = 0;
  const markerTriangles = new Map<string, number>();
  for (const p of drawn) {
    const marker = markerOf.get(p.node);
    const prims = meshOf(nodes[p.node].mesh as number);
    for (const pr of prims) {
      if (marker) markerTriangles.set(marker.name, (markerTriangles.get(marker.name) ?? 0) + pr.triangles);
      else {
        triangles += pr.triangles;
        draws++;
        usedMaterials.add(pr.material);
      }
      const local = localBox(pr.position);
      if (local.min[0] > local.max[0]) continue;
      const count = spanOf(pr.position, "A mesh").count;
      if ((boxToBox(p.world) && !disc) || work + count > L.maxVertexWork) {
        // A box maps to a box exactly under a scale, a flip or a quarter turn (a disc needs every vertex: a box's corners
        // reach farther than a round model); past the work cap the turned box is used (larger, never smaller).
        if (!boxToBox(p.world) || disc) facts.exactBounds = false;
        for (let c = 0; c < 8; c++) take(point(p.world, c & 1 ? local.max[0] : local.min[0], c & 2 ? local.max[1] : local.min[1], c & 4 ? local.max[2] : local.min[2]));
      } else {
        work += count;
        eachVertex(spanOf(pr.position, "A mesh"), (x, y, z) => take(point(p.world, x, y, z)));
      }
    }
    if (!marker) drawnCount++;
  }
  facts.triangles = triangles;
  facts.draws = draws;
  facts.materials = usedMaterials.size;
  if (badVertex) add("file", "A vertex position is not a number. Export the file again.");
  if (!drawnCount) add("file", `Your ${what} has no mesh to draw. Export it with its meshes.`);
  if (triangles > L.maxTriangles) add("triangles", `Your ${what} has ${thousands(triangles)} triangles. Make it ${thousands(L.maxTriangles)} or fewer (a Decimate step helps).`);
  if (L.maxDraws !== undefined && draws > L.maxDraws)
    add("draws", `Your ${what} is drawn in ${draws} parts (one for each mesh part on each node). Keep it to ${L.maxDraws}: join the meshes, and give them ${L.maxDraws === 1 ? "one material" : `at most ${L.maxDraws} materials`}.`);
  else if (draws > usedMaterials.size && draws > 1) tip(`The model has ${draws} mesh parts but ${usedMaterials.size} material${usedMaterials.size === 1 ? "" : "s"}: joining the parts that share a material saves draws.`);

  // The zone: x and z around the middle (a box, or a disc around the y axis), y from the ground up.
  const Z = L.zone;
  const R = "radius" in Z ? Z.radius : Infinity;
  const lo: Vec3 = "radius" in Z ? [-R, -Z.below, -R] : [-Z.width / 2, -Z.below, -Z.depth / 2];
  const hi: Vec3 = "radius" in Z ? [R, Z.height, R] : [Z.width / 2, Z.height, Z.depth / 2];
  const origin = facts.anchor ? `the ${L.anchor} marker` : "the origin";
  const zoneWords = `${"radius" in Z ? `a circle ${m1(2 * R)} m across` : `${m1(Z.width)} x ${m1(Z.depth)} m`} and ${Z.below ? `from ${m1(Z.below)} m below to ${m1(Z.height)} m above ${origin}` : `${m1(Z.height)} m high`}, its middle at ${origin}${Z.below ? "" : " and its base at height 0"}`;
  const inZone = (x: Vec3) => [0, 1, 2].every((k) => x[k] >= lo[k] - EPS && x[k] <= hi[k] + EPS) && Math.hypot(x[0], x[2]) <= R + EPS;
  if (bounds.min[0] <= bounds.max[0]) {
    facts.bounds = { min: bounds.min, max: bounds.max };
    facts.reach = Math.sqrt(reach2);
    const axis = ["x (side to side)", "y (height)", "z (front to back)"];
    for (const k of "radius" in Z ? [1] : [0, 1, 2])
      if (bounds.min[k] < lo[k] - EPS || bounds.max[k] > hi[k] + EPS) add("zone", `Your ${what} reaches ${m1(bounds.min[k])} to ${m1(bounds.max[k])} m on ${axis[k]}; the zone is ${m1(lo[k])} to ${m1(hi[k])} m. Keep it inside ${zoneWords}.`);
    if (facts.reach > R + EPS) add("zone", `Your ${what} reaches ${m1(facts.reach)} m from its middle across the ground; the zone reaches ${m1(R)} m. Keep it inside ${zoneWords}.`);
  }

  // The markers: by exact name; an empty marker has no mesh, a mesh marker has one; each one inside the zone.
  for (const rule of L.markers) {
    const found = named.get(rule.name) ?? [];
    if (!found.length) {
      const near = [...named.keys()].find((k) => k.toLowerCase().replace(/[\s-]+/g, "_").replace(/[._]\d+$/, "") === rule.name.toLowerCase());
      if (near) add("markers", `Rename the node "${near.slice(0, 40)}" to ${rule.name} exactly (lower case, no number after it).`);
      else if (rule.required) add("markers", `Add ${rule.kind === "empty" ? "an empty node" : "a mesh"} named ${rule.name}: ${rule.purpose}.`);
      continue;
    }
    if (found.length > 1) add("markers", `Keep one node named ${rule.name}: the file has ${found.length}.`);
    const p = found[0];
    const nd = nodes[p.node];
    const at = point(p.world, 0, 0, 0);
    facts.markers[rule.name] = at;
    if (rule.kind === "empty" && nd.mesh !== undefined) add("markers", `Make ${rule.name} an empty node (no mesh): it marks ${rule.purpose}.`);
    if (rule.kind === "mesh") {
      if (nd.mesh === undefined) add("markers", `Give ${rule.name} a mesh: ${rule.purpose}.`);
      else {
        const prims = meshOf(nd.mesh as number);
        if (prims.some((pr) => pr.mode < 4)) add("markers", `Make ${rule.name} of triangles only: ${rule.purpose}.`);
        const t = markerTriangles.get(rule.name) ?? 0;
        if (rule.maxTriangles !== undefined && t > rule.maxTriangles) add("markers", `${rule.name} has ${thousands(t)} triangles. Keep it simple: ${thousands(rule.maxTriangles)} or fewer.`);
      }
    }
    if (!inZone([at[0] - A[0], at[1] - A[1], at[2] - A[2]])) add("markers", `${rule.name} stands at ${at.map(m1).join(", ")} m, outside the zone. Move it inside ${zoneWords}.`);
  }
}
