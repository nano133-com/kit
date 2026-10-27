// How big each path is, minified and gzipped, without Three.js (esbuild comes with tsx). The numbers are printed so that a change of size is seen in the test
// output, and each path has a ceiling a little over today's size: a size that grows by accident fails here. The paths that load no Three.js must not name it in their bundle.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist/");
const esbuild = await import("esbuild").catch(() => null);
const ready = !!esbuild && existsSync(join(dist, "index.js"));

/** The path, the files it bundles, the ceiling in bytes (gzip) and whether it may import Three.js. */
const PATHS: [string, string[], number, boolean][] = [
  ["@nano133/nanoterra", ["index.js"], 200, false],
  ["@nano133/nanoterra/character/record", ["character/pure.js"], 6_500, false],
  ["@nano133/nanoterra/ticket", ["ticket/index.js"], 7_000, false],
  ["@nano133/nanoterra/looks", ["looks/index.js"], 3_000, false],
  ["@nano133/nanoterra/character", ["character/index.js"], 28_000, true],
];

async function bundle(files: string[], whole = true) {
  const contents = files.map((f) => `export * from ${JSON.stringify(dist + f)};`).join("\n");
  const r = await esbuild!.build({ stdin: { contents, resolveDir: dist }, bundle: true, minify: true, format: "esm", external: ["three"], write: false, treeShaking: !whole, logLevel: "silent" });
  return r.outputFiles[0].text;
}

test("each path's size is under its ceiling, and the paths with no Three.js do not name it", { skip: !ready && "run npm run build first (and have esbuild)" }, async () => {
  const rows: string[] = [];
  for (const [path, files, ceiling, three] of PATHS) {
    const text = await bundle(files);
    const gz = gzipSync(text, { level: 9 }).length;
    rows.push(`${path.padEnd(40)} ${String(text.length).padStart(7)} B minified ${String(gz).padStart(6)} B gzip`);
    assert.ok(gz <= ceiling, `${path} is ${gz} B gzipped, over its ceiling of ${ceiling} B`);
    if (!three) assert.doesNotMatch(text, /["']three["']/, `${path} names three`);
    else assert.match(text, /["']three["']/, `${path} is the one that draws`);
  }
  const all = gzipSync(await bundle(PATHS.flatMap(([, f]) => f)), { level: 9 }).length;
  rows.push(`${"all five paths".padEnd(40)} ${String(all).padStart(7)} B gzip (the shared record counted once)`);
  console.log(`\n${rows.join("\n")}`);
});
