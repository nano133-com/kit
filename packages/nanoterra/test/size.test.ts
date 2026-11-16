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

// The connect's ceilings (0.17.0): measured 10,959 B, 10,953 B and 11,402 B here (10,113, 10,158 and 10,492 before the security review's fixes: the
// secret's floor, the setup page, the Node body's time bound). Server code: a game's page loads none of it. The core holds the record's closed lists
// (about 4.4 kB) and the address check; the Worker's adapter adds the D1 counter (shop/adapters/d1-limit.ts) and nothing of the shop.
const CONNECT_CEILING = 11_400;
const CONNECT_WORKER_CEILING = 11_400;
const CONNECT_NODE_CEILING = 11_900;

/** The path, the files it bundles, the ceiling in bytes (gzip) and whether it may import Three.js. */
const PATHS: [string, string[], number, boolean][] = [
  ["@nano133/nanoterra", ["index.js"], 200, false],
  ["@nano133/nanoterra/character/record", ["character/pure.js"], 6_500, false],
  ["@nano133/nanoterra/ticket", ["ticket/index.js"], 7_000, false],
  // Since 0.15.0 the looks path holds the plays too (checkPlays, plays.json).
  ["@nano133/nanoterra/looks", ["looks/index.js"], 4_100, false],
  ["@nano133/nanoterra/character", ["character/index.js"], 28_000, true],
  ["@nano133/nanoterra/emotes", ["emotes/index.js"], 2_500, false],
  // The wheel: 6.8 kB since layerIn (the wheel in document.body, with the theme copied), the options' "Less motion" and the places that fit the longest name.
  // 0.15.1: 7.1 kB here and 7.2 kB on CI (its gzip gives about 100 B more), the options' keyLabel for the key cap (the Keys settings' words), the tiles'
  // measured edges and layerClass.
  ["@nano133/nanoterra/emotes/wheel", ["emotes/panel/index.js"], 7_400, false],
  ["@nano133/nanoterra/emotes/player", ["emotes/player.js"], 3_500, true],
  // Since 0.15.0 the shop sells plays too (checkPlays, the credits, the plays' routes; the Worker's D1 store with the plays' statements), with the creator's
  // Legal card (the age step, a life or a continue, the refund words, the owner's confirmation).
  // Since 0.15.0 both hold the plays' security fixes (the schema read, each credit's own end, forget's mark, the open orders in the cap, the hashed limit
  // keys) and findUnmatched (the admin's "Unmatched payments": one history read, about 0.85 kB).
  ["@nano133/nanoterra/shop", ["shop/index.js"], 12_900, false],
  ["@nano133/nanoterra/shop/worker", ["shop/worker.js"], 14_500, false],
  // Since 0.15.0 the panel sells plays too (buyPlay, the "18 or older" step, the Play key, ready()).
  // 0.16.0: 13.1 kB, the pay sheet of design A (the item's picture, the main way by the device, the success that stays, the offer step, the trust line,
  // the ended order without its ways to pay); the design note estimated about +1.4 kB.
  // 0.17.1: 13.6 kB (13,550 B here), the QR code's versions 11 to 40 and level L (a wallet's sign-in link; +0.32 kB: the tables are four strings of 40 characters).
  // 0.18.0: 14.3 kB (14,325 B here, +0.78 kB): the try-on's hook (the layout that keeps the stage while the list is drawn again, the Try on keys of the
  // rows, Escape and Up close's switch, three words). The try-on's sheet part (./tryon.js) and the viewer are chunks of their own (below, and the next row).
  ["@nano133/nanoterra/shop/panel", ["shop/panel/index.js"], 14_500, false],
  // 0.18.0: the try-on stage (Three.js, an optional peer): loaded by the game's `tryOn` when the sheet opens. The kit's character is a chunk of its own (below).
  // 6.3 kB here (6,289 B): the renderer, the pointer, the wheel, the keys and the framing (inspect.ts).
  ["@nano133/nanoterra/shop/viewer", ["shop/viewer/index.js"], 6_600, true],
  // The admin's sign-in: the server part without @nano133/signin (an optional peer, outside the bundle), the stores, and the panel with its QR code.
  // Since 0.12.0 each holds the owner's passkeys too (the routes, the link's store methods, the Passkey tile and the Owner passkeys card; the passkey code itself stays outside).
  ["@nano133/nanoterra/admin-signin", ["admin-signin/index.js"], 7_300, false],
  ["@nano133/nanoterra/admin-signin/d1", ["admin-signin/adapters/d1.js"], 1_950, false],
  ["@nano133/nanoterra/admin-signin/firestore", ["admin-signin/adapters/firestore.js"], 2_300, false],
  // 0.17.1: the QR code's versions 11 to 40, so Nautilus's admin link (about 540 to 740 bytes) is a code too (9,793 B here, +0.33 kB).
  ["@nano133/nanoterra/admin-signin/panel", ["admin-signin/panel/index.js"], 10_000, false],
  // Since 0.17.0 the connect (Sign in from Nanoterra): server code only (no byte of it reaches a page); the core holds the record's lists and the address
  // check, the Worker's adapter the D1 store too.
  ["@nano133/nanoterra/connect", ["connect/index.js"], CONNECT_CEILING, false],
  ["@nano133/nanoterra/connect/worker", ["connect/worker.js"], CONNECT_WORKER_CEILING, false],
  ["@nano133/nanoterra/connect/node", ["connect/node.js"], CONNECT_NODE_CEILING, false],
];
/** The emote clips: their own chunk, loaded on the first emote (never in a path's bundle above: "./clips.js" stays outside). */
/** The name, the file, the ceiling (gzip), whether it has a default export, and the files it shares with the path that loads it (a bundler keeps those in that path's chunk). */
const LAZY: [string, string, number, boolean, string[]?][] = [
  ["the emote clips (loaded on the first emote)", "emotes/clips.js", 21_000, true],
  // 0.18.0: the sheet's try-on part (what is tried on, the stage's box, Up close, the tray), loaded by mountShop only when the game gives `tryOn`.
  ["the sheet's try-on part (loaded with tryOn)", "shop/panel/tryon.js", 3_000, false, ["./pay.js", "./words.js", "../../admin/panel/dom.js", "../../looks/look.js"]],
  // 0.18.0: the kit's character as a try-on body (the viewer with no `body`): the character's builder (shared with /character in a game that has it) and the hats.
  ["the viewer's kit character (loaded with no body)", "shop/viewer/kit.js", 24_500, false, ["../../looks/look.js"]],
];

async function bundle(files: string[], whole = true, withDefault = false, shared: string[] = []) {
  const contents = files.map((f) => `export * from ${JSON.stringify(dist + f)};${withDefault ? ` export { default } from ${JSON.stringify(dist + f)};` : ""}`).join("\n");
  const r = await esbuild!.build({ stdin: { contents, resolveDir: dist }, bundle: true, minify: true, format: "esm", external: ["three", "./clips.js", "./tryon.js", "./kit.js", "@nano133/signin", ...shared], write: false, treeShaking: !whole, logLevel: "silent" });
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
  const all = gzipSync(await bundle(PATHS.slice(0, 5).flatMap(([, f]) => f)), { level: 9 }).length;
  rows.push(`${"all five paths".padEnd(40)} ${String(all).padStart(7)} B gzip (the shared record counted once)`);
  for (const [name, file, ceiling, withDefault, shared] of LAZY) {
    const text = await bundle([file], true, withDefault, shared);
    const gz = gzipSync(text, { level: 9 }).length;
    rows.push(`${name.padEnd(40)} ${String(text.length).padStart(7)} B minified ${String(gz).padStart(6)} B gzip`);
    assert.ok(gz <= ceiling, `${name} is ${gz} B gzipped, over its ceiling of ${ceiling} B`);
  }
  console.log(`\n${rows.join("\n")}`);
});
