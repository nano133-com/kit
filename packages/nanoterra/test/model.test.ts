// The model check (@nano133/nanoterra/model): the cosmetic presets of the three sockets, the anchor (a hand item's grip_R), the draw count,
// the materials and the advice. The island preset's own full set (every rule and hostile files) runs on nano133.com
// (tests/launch/model-test.mts), against the same code. Every sample .glb is built here in code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Buffer } from "node:buffer";
import { BACK_ITEM, COSMETIC_LIMITS, HAND_ITEM, HEAD_ITEM, ISLAND_MODEL, checkModel, modelSummary, type ModelLimits } from "../src/model/index.js";

type Json = Record<string, any>;
/** A .glb from a glTF JSON and its BIN bytes. `o` lets a test lie in the header or the chunks. */
function glb(json: Json, bin: Buffer | null, o: { total?: number; jsonLen?: number; binLen?: number; version?: number; magic?: number; tail?: Buffer; text?: (s: string) => string } = {}): Buffer {
  const text = JSON.stringify(json);
  let j = Buffer.from(o.text ? o.text(text) : text, "utf8");
  if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - (j.length % 4), 0x20)]);
  let b = bin;
  if (b && b.length % 4) b = Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
  const parts: Buffer[] = [];
  const head = Buffer.alloc(12);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(o.jsonLen ?? j.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  parts.push(head, jh, j);
  if (b) {
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(o.binLen ?? b.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    parts.push(bh, b);
  }
  if (o.tail) parts.push(o.tail);
  const all = Buffer.concat(parts);
  all.writeUInt32LE(o.magic ?? 0x46546c67, 0);
  all.writeUInt32LE(o.version ?? 2, 4);
  all.writeUInt32LE(o.total ?? all.length, 8);
  return all;
}

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const ktx2 = (w: number, h: number) => {
  const b = Buffer.alloc(48);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32LE(w, 20);
  b.writeUInt32LE(h, 24);
  return b;
};

/** A builder of one model: meshes of boxes, nodes, images; `make()` lays out the BIN chunk and the JSON. */
class Model {
  json: Json = { asset: { version: "2.0", generator: "model-test" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
  chunks: Buffer[] = [];
  at = 0;
  view(data: Buffer, stride?: number) {
    const pad = (4 - (this.at % 4)) % 4;
    if (pad) this.chunks.push(Buffer.alloc(pad));
    this.at += pad;
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.at, byteLength: data.length, ...(stride ? { byteStride: stride } : {}) });
    this.chunks.push(data);
    this.at += data.length;
    return this.json.bufferViews.length - 1;
  }
  /** A box of half sizes hx, hy, hz around (cx, cy, cz), as 8 float vertices and 36 indices (12 triangles). The file's min and max may lie. */
  box(h: [number, number, number], c: [number, number, number] = [0, 0, 0], o: { claim?: [number[], number[]]; mode?: number; noIndices?: boolean } = {}) {
    const pos = Buffer.alloc(8 * 12);
    for (let i = 0; i < 8; i++) {
      pos.writeFloatLE(c[0] + (i & 1 ? h[0] : -h[0]), i * 12);
      pos.writeFloatLE(c[1] + (i & 2 ? h[1] : -h[1]), i * 12 + 4);
      pos.writeFloatLE(c[2] + (i & 4 ? h[2] : -h[2]), i * 12 + 8);
    }
    const pv = this.view(pos);
    const min = o.claim?.[0] ?? [c[0] - h[0], c[1] - h[1], c[2] - h[2]];
    const max = o.claim?.[1] ?? [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
    this.json.accessors.push({ bufferView: pv, componentType: 5126, count: 8, type: "VEC3", min, max });
    const position = this.json.accessors.length - 1;
    const prim: Json = { attributes: { POSITION: position }, ...(o.mode !== undefined ? { mode: o.mode } : {}) };
    if (!o.noIndices) {
      const idx = Buffer.alloc(36 * 2);
      const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
      faces.forEach((f, i) => idx.writeUInt16LE(f, i * 2));
      this.json.accessors.push({ bufferView: this.view(idx), componentType: 5123, count: 36, type: "SCALAR" });
      prim.indices = this.json.accessors.length - 1;
    }
    this.json.meshes.push({ primitives: [prim] });
    return this.json.meshes.length - 1;
  }
  node(n: Json, root = true) {
    this.json.nodes.push(n);
    const i = this.json.nodes.length - 1;
    if (root) this.json.scenes[0].nodes.push(i);
    return i;
  }
  image(data: Buffer, mimeType: string) {
    this.json.images ??= [];
    this.json.textures ??= [];
    this.json.images.push({ bufferView: this.view(data), mimeType });
    this.json.textures.push({ source: this.json.images.length - 1 });
  }
  make(o: Parameters<typeof glb>[2] = {}) {
    const bin = Buffer.concat(this.chunks);
    this.json.buffers = [{ byteLength: bin.length }];
    return glb(this.json, bin, o);
  }
}


const run = (b: Buffer, limits: ModelLimits) => checkModel(new Uint8Array(b.buffer, b.byteOffset, b.length), limits);
const rules = (r: ReturnType<typeof run>) => r.problems.map((p) => p.rule);

test("a hand item that stands up from its grip_R passes; the zone is measured from the grip", () => {
  const m = new Model();
  // A stick 1.2 m long, its grip 0.4 m above the file's origin: from the grip it reaches 0.2 below and 1.0 above.
  m.node({ name: "stick", mesh: m.box([0.03, 0.6, 0.03], [0, 0.6, 0]) });
  m.node({ name: "grip_R", translation: [0, 0.2, 0] });
  const r = run(m.make(), HAND_ITEM);
  assert.deepEqual(r.problems, []);
  assert.ok(r.ok);
  assert.deepEqual(r.facts.anchor, [0, 0.2, 0]);
  assert.ok(Math.abs(r.facts.bounds!.min[1] - -0.2) < 1e-6 && Math.abs(r.facts.bounds!.max[1] - 1.0) < 1e-6);
  assert.equal(r.facts.draws, 1);
  assert.equal(r.facts.materials, 1);
});

test("a hand item that hangs below its grip fails the zone, and the fix names the grip", () => {
  const m = new Model();
  m.node({ name: "stick", mesh: m.box([0.03, 0.5, 0.03], [0, 0.5, 0]) });
  m.node({ name: "grip_R", translation: [0, 0.99, 0] });
  const r = run(m.make(), HAND_ITEM);
  assert.ok(!r.ok);
  assert.deepEqual(rules(r), ["zone"]);
  assert.match(r.problems[0].fix, /from 0\.3 m below to 1\.3 m above the grip_R marker/);
});

test("with no grip_R the file's origin is the attach point; a misspelt grip gets a rename line", () => {
  const m = new Model();
  m.node({ name: "stick", mesh: m.box([0.03, 0.5, 0.03], [0, 0.5, 0]) });
  m.node({ name: "Grip_R", translation: [0, 0.99, 0] });
  const r = run(m.make(), HAND_ITEM);
  assert.equal(r.facts.anchor, null);
  assert.ok(r.problems.some((p) => p.rule === "markers" && /Rename the node "Grip_R" to grip_R/.test(p.fix)));
});

test("draws: each part on each node counts; past the preset's limit it fails; the island has no draw limit", () => {
  const m = new Model();
  const mesh = m.box([0.05, 0.05, 0.05], [0, 0.2, 0]);
  for (let i = 0; i < 3; i++) m.node({ name: `part${i}`, mesh });
  const r = run(m.make(), HEAD_ITEM);
  assert.equal(r.facts.draws, 3);
  assert.deepEqual(rules(r), ["draws"]);
  assert.match(r.problems[0].fix, /drawn in 3 parts.*Keep it to 2/);
  assert.equal(ISLAND_MODEL.maxDraws, undefined);
});

test("materials: counted from the parts; parts that share one get the join advice, which is not a failure", () => {
  const m = new Model();
  m.json.materials = [{ name: "a" }, { name: "b" }];
  const a = m.box([0.05, 0.05, 0.05], [0, 0.2, 0]);
  const b = m.box([0.05, 0.05, 0.05], [0.1, 0.2, 0]);
  m.json.meshes[a].primitives[0].material = 0;
  m.json.meshes[b].primitives[0].material = 0;
  m.node({ name: "a", mesh: a });
  m.node({ name: "b", mesh: b });
  const r = run(m.make(), HEAD_ITEM);
  assert.ok(r.ok, JSON.stringify(r.problems));
  assert.equal(r.facts.materials, 1);
  assert.ok(r.advice.some((l) => /2 mesh parts but 1 material: joining/.test(l)));
  m.json.meshes[b].primitives[0].material = 7;
  assert.ok(rules(run(m.make(), HEAD_ITEM)).includes("file"), "a material that is not there");
});

test("advice: a 512 px PNG gets the KTX2 line; a texture over the cosmetic limit fails", () => {
  const m = new Model();
  m.node({ name: "hat", mesh: m.box([0.3, 0.2, 0.3], [0, 0.2, 0]) });
  m.image(png(512, 512), "image/png");
  const r = run(m.make(), HEAD_ITEM);
  assert.ok(r.ok);
  assert.ok(r.advice.some((l) => /Image 0 is a 512 px PNG: KTX2/.test(l)));
  const big = new Model();
  big.node({ name: "hat", mesh: big.box([0.3, 0.2, 0.3], [0, 0.2, 0]) });
  big.image(png(1024, 1024), "image/png");
  big.image(png(64, 64), "image/png");
  assert.deepEqual(rules(run(big.make(), HEAD_ITEM)).sort(), ["textures", "textures"]);
});

test("the presets: the table's numbers", () => {
  const z = (L: ModelLimits) => L.zone as { width: number; depth: number; height: number; below: number };
  assert.deepEqual([z(HEAD_ITEM).width, z(HEAD_ITEM).depth, Math.round((z(HEAD_ITEM).height + z(HEAD_ITEM).below) * 1e6) / 1e6, z(HEAD_ITEM).below], [0.9, 0.9, 0.8, 0.1]);
  assert.deepEqual([z(HAND_ITEM).width, z(HAND_ITEM).depth, Math.round((z(HAND_ITEM).height + z(HAND_ITEM).below) * 1e6) / 1e6, z(HAND_ITEM).below], [0.4, 0.4, 1.6, 0.3]);
  assert.deepEqual([z(BACK_ITEM).width, z(BACK_ITEM).depth, Math.round((z(BACK_ITEM).height + z(BACK_ITEM).below) * 1e6) / 1e6, z(BACK_ITEM).below], [1.0, 0.6, 1.2, 0.6]);
  assert.deepEqual([HEAD_ITEM, HAND_ITEM, BACK_ITEM].map((L) => [L.maxTriangles, L.maxTextures, L.maxTextureSide, L.maxDraws, L.maxBytes / 1024]), [
    [3000, 1, 512, 2, 300],
    [3000, 1, 512, 2, 300],
    [4000, 1, 512, 2, 400],
  ]);
  assert.deepEqual(Object.keys(COSMETIC_LIMITS), ["head", "hand", "back"]);
  assert.deepEqual(ISLAND_MODEL.zone, { radius: 10, height: 18, below: 0 });
  for (const L of [HEAD_ITEM, HAND_ITEM, BACK_ITEM]) assert.ok(!L.allowSkins && !L.allowAnimations && !L.allowMorphTargets, `${L.what} is rigid`);
});

test("a back item: wider than its zone fails; the summary line reads the box", () => {
  const m = new Model();
  m.node({ name: "pack", mesh: m.box([0.6, 0.4, 0.15], [0, 0, -0.1]) });
  const r = run(m.make(), BACK_ITEM);
  assert.deepEqual(rules(r), ["zone"]);
  assert.match(modelSummary(r.facts), /12 triangles, 0 textures, 1 KB, 1\.2 x 0\.3 x 0\.8 m/);
});

test("never throws: garbage, an empty file and a cut file answer a problem", () => {
  for (const b of [new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(400).fill(255)]) {
    const r = checkModel(b, HAND_ITEM);
    assert.ok(!r.ok && r.problems.length > 0);
  }
  assert.ok(!checkModel("x" as never, HAND_ITEM).ok);
});
