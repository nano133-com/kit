// The Shelf's preview pictures: the flat picture stays until the real one is drawn, the drawing function loads once, and a page with no
// WebGL keeps the flat picture. (The pictures themselves are checked by eye, in a browser.)
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import type { Look } from "../src/looks/index.js";

const LOOK: Look = { id: "shovel", name: "Shovel", priceUsd: 0.5, change: { body: "#7b5532" }, slots: { hand: "shovel" } };
let previewPicture: typeof import("../src/admin/panel/index.js").previewPicture;
before(async () => {
  const win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event });
  ({ previewPicture } = await import("../src/admin/panel/index.js"));
});
const tick = () => new Promise((r) => setTimeout(r, 0));

test("the flat picture first, then the drawn one; the loader runs once for every look", async () => {
  let loads = 0;
  const asked: string[] = [];
  const picture = previewPicture(async () => {
    loads++;
    return async (l) => {
      asked.push(l.id);
      return "data:image/png;base64,AAAA";
    };
  });
  const a = picture(LOOK);
  const b = picture({ ...LOOK, id: "other" });
  assert.equal(a.querySelector("svg") !== null, true, "the flat picture at once");
  await tick();
  await tick();
  assert.equal(loads, 1);
  assert.deepEqual(asked, ["shovel", "other"]);
  const img = a.querySelector("img")!;
  assert.equal(img.getAttribute("src"), "data:image/png;base64,AAAA");
  assert.equal(img.getAttribute("alt"), "Shovel on the character");
  assert.equal(a.querySelector("svg"), null);
  assert.ok(b.querySelector("img"));
});

test("no picture (no WebGL) or a loader that fails: the flat picture stays", async () => {
  const none = previewPicture(async () => async () => null)(LOOK);
  const broken = previewPicture(async () => {
    throw new Error("no three");
  })(LOOK);
  await tick();
  await tick();
  for (const el of [none, broken]) {
    assert.ok(el.querySelector("svg"));
    assert.equal(el.querySelector("img"), null);
  }
});

test("createLookPreview with no WebGL answers null and keeps nothing alive", async () => {
  const { createLookPreview } = await import("../src/character/index.js");
  const p = createLookPreview<Look>();
  assert.equal(await p.render(LOOK), null);
  assert.equal(await p.render(LOOK), null, "the same answer from the cache");
  assert.equal(p.cached, 1);
  p.dispose();
  assert.equal(p.cached, 0);
  assert.equal(await p.render(LOOK), null);
});
