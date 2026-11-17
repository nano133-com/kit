// The README's examples that are whole files (examples/*.ts): the package's own types check them, as a game's build would, so a change of the API
// that breaks one fails here. They import the package by its name (its `exports` and the built types in dist/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(root, "../../node_modules/typescript/bin/tsc");

test("the examples (examples/*.ts) type-check against the package's types", { skip: (!existsSync(join(root, "dist/shop/viewer/index.d.ts")) || !existsSync(tsc)) && "run npm run build first" }, () => {
  const r = spawnSync(process.execPath, [tsc, "-p", join(root, "examples/tsconfig.json")], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});
