// What the package is made of: the exports map, what each path imports, and the proof that the paths that must not load Three.js do not.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HEIGHT, RADIUS } from "../src/character/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
const hasDist = existsSync(join(root, "dist/index.js"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const sources = walk(join(root, "src"));

/** Every module that a source file imports or exports from, or loads with import() or require(). */
function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** The files an entry reaches by relative imports, and the packages it names. */
function graph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) visit(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
      else packages.add(spec);
    }
  };
  visit(join(root, entry));
  return { files: [...files].map((f) => relative(join(root, "src"), f)), packages: [...packages] };
}

/** The files of the pure record part: they may be reached by the paths that load no Three.js. */
const PURE = /^character\/(look|lists|record|edit|color|pure)\.ts$/;

test("every source file imports only Three.js or a file of the package, with its .js name", () => {
  assert.ok(sources.length >= 40);
  for (const file of sources) {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec === "three") continue;
      assert.match(spec, /^\.{1,2}\/.*\.js$/, `${relative(root, file)} imports ${spec}`);
      assert.ok(existsSync(resolve(dirname(file), spec.replace(/\.js$/, ".ts"))), `${relative(root, file)}: ${spec} is not a file of the package`);
    }
  }
});

test("the character's code and the admin's and the friends' server code run in Node and in Workers: no window, no document, no storage, no clock of the page", () => {
  for (const file of sources.filter((f) => f.includes("/src/character/") || (f.includes("/src/admin/") && !f.includes("/src/admin/panel/")) || (f.includes("/src/friends/") && !f.includes("/src/friends/panel/")))) {
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /\b(?:window|document|localStorage|performance)\b/, `${relative(root, file)} reads a browser global`);
  }
});

test("the paths that must not load Three.js import no package at all (the record, the ticket, the looks, the small part)", () => {
  const record = graph("src/character/pure.ts");
  assert.deepEqual(record.packages, []);
  for (const entry of ["src/index.ts", "src/character/pure.ts", "src/ticket/index.ts", "src/looks/index.ts", "src/model/index.ts", "src/input/index.ts", "src/admin/index.ts", "src/admin/conformance.ts", "src/admin/adapters/d1.ts", "src/admin/adapters/firestore.ts"]) {
    const g = graph(entry);
    assert.deepEqual(g.packages, [], `${entry} names ${g.packages.join(", ")}`);
    const drawing = g.files.filter((f) => !PURE.test(f) && f.startsWith("character/"));
    assert.deepEqual(drawing, [], `${entry} reaches the builder: ${drawing.join(", ")}`);
  }
  // The ticket reads the character's record, so the record is in its graph; the looks do not touch the character.
  assert.ok(graph("src/ticket/index.ts").files.includes("character/record.ts"));
  assert.ok(!graph("src/looks/index.ts").files.some((f) => f.startsWith("character/")));
  // The model check is pure: it reads bytes, with no Three.js and no other part of the package.
  assert.ok(graph("src/model/index.ts").files.every((f) => f.startsWith("model/")));
  // The admin has no Three.js, no character and no looks code in its server part.
  assert.ok(!graph("src/admin/index.ts").files.some((f) => f.startsWith("character/")));
  // The server part never reaches the panel (which uses the DOM), and the panel imports no package and no drawing code.
  assert.ok(!graph("src/admin/index.ts").files.some((f) => f.startsWith("admin/panel/")));
  assert.ok(!graph("src/admin/conformance.ts").files.some((f) => f.startsWith("admin/panel/")));
  const panel = graph("src/admin/panel/index.ts");
  assert.deepEqual(panel.packages, []);
  assert.ok(!panel.files.some((f) => f.startsWith("character/")));
  // The friends: no package at all, the server part never reaches a panel, and the friends' panel reaches no drawing code.
  for (const entry of ["src/friends/index.ts", "src/friends/conformance.ts", "src/friends/adapters/d1.ts", "src/friends/adapters/firestore.ts", "src/friends/panel/index.ts"]) assert.deepEqual(graph(entry).packages, [], entry);
  for (const entry of ["src/friends/index.ts", "src/friends/conformance.ts", "src/friends/adapters/d1.ts", "src/friends/adapters/firestore.ts"]) assert.ok(!graph(entry).files.some((f) => f.includes("/panel/")), `${entry} reaches a panel`);
  assert.ok(!graph("src/friends/panel/index.ts").files.some((f) => f.startsWith("character/") || f.startsWith("looks/")));
  // The character's path draws: it names Three.js and nothing else.
  assert.deepEqual(graph("src/character/index.ts").packages, ["three"]);
});

test("package.json: no runtime dependency, three is an optional peer, version 0.6.0, MIT", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "@nano133/nanoterra");
  assert.equal(pkg.version, "0.6.0");
  assert.equal(pkg.dependencies, undefined, "packages have no runtime dependencies");
  assert.deepEqual(pkg.peerDependencies, { three: ">=0.174.0" });
  assert.deepEqual(pkg.peerDependenciesMeta, { three: { optional: true } }, "a game that reads tickets alone needs no Three.js");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.files.slice().sort(), ["CHANGELOG.md", "LICENSE", "README.md", "ai", "dist", "src"], "files holds no test, no script and no secret");
  assert.match(read("README.md"), /^# @nano133\/nanoterra\n\nStage: Pre-alpha\. What this means: https:\/\/nano133\.com\/stages\n/);
  assert.match(read("CHANGELOG.md"), /^# Changelog\n\n(## Unreleased\n[\s\S]*?\n)?## 0\.6\.0 \(2026-10-30\)\n[\s\S]*?\n## 0\.5\.0 \(2026-10-30\)\n[\s\S]*?\n## 0\.4\.0 \(2026-10-30\)\n[\s\S]*?\n## 0\.3\.2 \(2026-10-29\)\n[\s\S]*?\n## 0\.3\.1 \(2026-10-29\)\n[\s\S]*?\n## 0\.3\.0 \(2026-10-28\)\n[\s\S]*?\n## 0\.2\.0 \(2026-10-27\)\n[\s\S]*?\n## 0\.1\.0\n/);
});

test("the exports map: the small part, the character, its record, the ticket, the looks, the model check, the admin and the friends, each with types", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.deepEqual(Object.keys(pkg.exports), [".", "./character", "./character/record", "./ticket", "./looks", "./model", "./input", "./admin", "./admin/conformance", "./admin/d1", "./admin/firestore", "./admin/panel", "./admin/style.css", "./friends", "./friends/conformance", "./friends/d1", "./friends/d1.sql", "./friends/firestore", "./friends/panel", "./friends/style.css"]);
  assert.equal(pkg.exports["./admin/style.css"], "./src/admin/panel/style.css");
  assert.ok(existsSync(join(root, "src/admin/panel/style.css")), "the stylesheet is shipped in src");
  assert.equal(pkg.exports["./friends/style.css"], "./src/friends/panel/style.css");
  assert.equal(pkg.exports["./friends/d1.sql"], "./src/friends/adapters/d1.sql");
  for (const f of ["src/friends/panel/style.css", "src/friends/adapters/d1.sql"]) assert.ok(existsSync(join(root, f)), `${f} is shipped in src`);
  const want: Record<string, string> = { ".": "index", "./character": "character/index", "./character/record": "character/pure", "./ticket": "ticket/index", "./looks": "looks/index", "./model": "model/index", "./input": "input/index", "./admin": "admin/index", "./admin/conformance": "admin/conformance", "./admin/d1": "admin/adapters/d1", "./admin/firestore": "admin/adapters/firestore", "./admin/panel": "admin/panel/index", "./friends": "friends/index", "./friends/conformance": "friends/conformance", "./friends/d1": "friends/adapters/d1", "./friends/firestore": "friends/adapters/firestore", "./friends/panel": "friends/panel/index" };
  for (const [path, file] of Object.entries(want)) {
    assert.deepEqual(pkg.exports[path], { types: `./dist/${file}.d.ts`, import: `./dist/${file}.js` }, path);
    assert.ok(existsSync(join(root, `src/${file}.ts`)), `${path} has its source src/${file}.ts`);
    if (hasDist) {
      assert.ok(existsSync(join(root, `dist/${file}.js`)), `${path}: dist/${file}.js is built`);
      assert.ok(existsSync(join(root, `dist/${file}.d.ts`)), `${path}: dist/${file}.d.ts is built`);
    }
  }
  assert.equal(pkg.main, "dist/index.js");
  assert.equal(pkg.types, "dist/index.d.ts");
});

test("the built paths load, and the ones that must not load Three.js do not (a loader that refuses 'three' stands in)", { skip: !hasDist && "run npm run build first" }, () => {
  const hook = `export async function resolve(s, c, n) { if (s === "three" || s.startsWith("three/")) throw new Error("THREE-LOADED"); return n(s, c); }`;
  const register = `import { register } from "node:module"; register("data:text/javascript,${encodeURIComponent(hook)}");`;
  const run = (entry: string, code: string) =>
    spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(register)}`, "--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(join(root, "dist", entry)).href)}); ${code}`], { encoding: "utf8" });
  const probes: [string, string][] = [
    ["index.js", "process.stdout.write('ok')"],
    ["character/pure.js", "if (typeof m.packRecord !== 'function' || typeof m.fromLegacy !== 'function' || typeof m.toLegacy !== 'function' || typeof m.diceRecord !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["ticket/index.js", "if (typeof m.readTicket !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["looks/index.js", "if (typeof m.checkLooks !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["model/index.js", "if (typeof m.checkModel !== 'function' || !m.HAND_ITEM || !m.ISLAND_MODEL) throw new Error('missing'); process.stdout.write('ok')"],
    ["input/index.js", "if (typeof m.releaseWhenLost !== 'function' || typeof m.pauseWhenLeft !== 'function' || typeof m.swallowsKeyup !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["admin/index.js", "if (typeof m.adminAccess !== 'function' || typeof m.createAdminHandler !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["admin/conformance.js", "if (typeof m.adminConformance !== 'function' || typeof m.adminStoreConformance !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["admin/adapters/d1.js", "if (typeof m.createD1Store !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["admin/adapters/firestore.js", "if (typeof m.createFirestoreStore !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["friends/index.js", "if (typeof m.createFriendsHandler !== 'function' || typeof m.createMemoryFriends !== 'function' || m.FRIEND_LIMIT !== 100) throw new Error('missing'); process.stdout.write('ok')"],
    ["friends/conformance.js", "if (typeof m.friendsStoreConformance !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["friends/adapters/d1.js", "if (typeof m.createD1Friends !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
    ["friends/adapters/firestore.js", "if (typeof m.createFirestoreFriends !== 'function') throw new Error('missing'); process.stdout.write('ok')"],
  ];
  for (const [entry, code] of probes) {
    const r = run(entry, code);
    assert.equal(r.stdout, "ok", `${entry}: ${r.stderr.slice(0, 300)}`);
  }
  // The control: the same loader stops the character path, so the proof above means something.
  const control = run("character/index.js", "process.stdout.write('ok')");
  assert.notEqual(control.stdout, "ok");
  assert.match(control.stderr, /THREE-LOADED/);
});

test("npm pack would ship the built files, the sources, the README, the changelog, the licence and the AI files, and nothing else", { skip: !hasDist && "run npm run build first" }, () => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const files: string[] = JSON.parse(r.stdout)[0].files.map((f: { path: string }) => f.path);
  for (const f of ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "dist/index.js", "dist/character/index.js", "dist/character/pure.js", "dist/ticket/index.js", "dist/looks/index.js", "dist/model/index.js", "dist/input/index.js", "dist/admin/index.js", "dist/admin/conformance.js", "dist/admin/adapters/d1.js", "dist/admin/adapters/firestore.js", "dist/admin/panel/index.js", "src/admin/panel/style.css", "dist/friends/index.js", "dist/friends/panel/index.js", "src/friends/panel/style.css", "src/friends/adapters/d1.sql", "ai/PROMPT.md", "ai/SPEC.md"]) assert.ok(files.includes(f), `${f} is shipped`);
  for (const f of files) {
    assert.ok(/^(dist|src|ai)\//.test(f) || ["package.json", "README.md", "CHANGELOG.md", "LICENSE"].includes(f), `${f} would be published`);
    assert.doesNotMatch(f, /^test\/|\.env|\.tsbuildinfo|\.test\.|secret|\.key$/i, `${f} must not be published`);
  }
});

test("the README and the changelog say what the code says", () => {
  const readme = read("README.md");
  assert.ok(readme.includes(`HEIGHT\` = ${HEIGHT} m`), "the README states HEIGHT");
  assert.ok(readme.includes(`RADIUS\` = ${RADIUS} m`), "the README states RADIUS");
  for (const part of ["createCharacter", "update", "wave", "setLook", "setColors", "dispose", "readTicket", "record", "fromLegacy", "toLegacy", "packRecord", "unpackRecord", "diceRecord", "checkLooks", "PRICE_LADDER", "socket", "setWorn", "checkModel", "HAND_ITEM", "@nano133/nanoterra/model", "releaseWhenLost", "pauseWhenLeft", "@nano133/nanoterra/input", "@nano133/nanoterra/character", "@nano133/nanoterra/character/record", "@nano133/nanoterra/ticket", "@nano133/nanoterra/looks"]) {
    assert.ok(readme.includes(part), `the README names ${part}`);
  }
  assert.match(read("CHANGELOG.md"), /@nano133\/character`? 0\.1\.0/);
  assert.match(read("CHANGELOG.md"), /@nano133\/ticket`? 0\.1\.0/);
  assert.match(read("CHANGELOG.md"), /@nano133\/looks`? 0\.1\.0/);
});
