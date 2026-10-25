import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HEIGHT, RADIUS } from "../src/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, "utf8");
const sources = readdirSync(`${root}src`).filter((f) => f.endsWith(".ts"));

/** Every module that a source file imports or exports from, or loads with import() or require(). */
function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

test("the package imports only three and its own files: no React, no react-three-fiber, nothing from the site", () => {
  assert.ok(sources.length >= 8);
  const all = new Set<string>();
  for (const file of sources) {
    for (const spec of specifiers(read(`src/${file}`))) {
      all.add(spec);
      assert.ok(spec === "three" || /^\.\/[a-z]+\.js$/.test(spec), `${file} imports ${spec}`);
      assert.ok(sources.includes(spec.replace(/^\.\//, "").replace(/\.js$/, ".ts")) || spec === "three", `${file}: ${spec} is not a file of the package`);
    }
  }
  assert.ok(all.has("three"));
  for (const file of sources) {
    const code = read(`src/${file}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /\b(?:window|document|localStorage|performance)\b/, `${file} reads a browser global: the package runs in Node`);
  }
});

test("package.json: no runtime dependency, three is a peer, version 0.1.0, the stage is Pre-alpha", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "@nano133/character");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.dependencies, undefined, "packages have no runtime dependencies");
  assert.deepEqual(pkg.peerDependencies, { three: "^0.186.0" });
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.publishConfig.access, "public");
  assert.deepEqual(Object.keys(pkg.exports), ["."]);
  assert.match(read("README.md"), /^# @nano133\/character\n\nStage: Pre-alpha\. What this means: https:\/\/nano133\.com\/stages\n/);
});

test("the README and the changelog say what the code says", () => {
  const readme = read("README.md");
  assert.ok(readme.includes(`HEIGHT\` = ${HEIGHT} m`), "the README states HEIGHT");
  assert.ok(readme.includes(`RADIUS\` = ${RADIUS} m`), "the README states RADIUS");
  assert.match(read("CHANGELOG.md"), /^# Changelog\n\n## 0\.1\.0\n/);
  for (const part of ["createCharacter", "update", "wave", "setLook", "dispose", "shadow", "isLook", "defaultLook", "LOOK_PARTS"]) assert.ok(readme.includes(part), `the README names ${part}`);
});
