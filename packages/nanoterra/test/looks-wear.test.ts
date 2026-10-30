import assert from "node:assert/strict";
import { test } from "node:test";
import { OUTFIT, checkLooks, diffLooks, isOutfit, lookProblems, looksJson, removalProblems, wearOf, type Look } from "../src/looks/index.js";

// Wear slots: a look fills one. An outfit (no "wear") is the character's own look, with its body colour and hat; an item of another slot ("shovel") has no
// "change": the game knows what it is. A player wears one outfit and one item in each other slot.

const FREE: Look = { id: "free", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } };
const SPADE: Look = { id: "toy-spade", name: "Toy Spade", priceUsd: 0.1, wear: "shovel" };
const BAT: Look = { id: "echo-bat", name: "Echo Bat", priceUsd: 1, wear: "pinger", slots: { ring: "ripples" } };

test("an item of a wear slot is good: written on one line with its slot and no change, and read back whole", () => {
  const text = looksJson([FREE, SPADE, BAT]);
  assert.equal(
    text,
    `[\n  { "id": "free", "name": "Classic", "priceUsd": 0, "change": { "body": "#4aa8ff" } },\n  { "id": "toy-spade", "name": "Toy Spade", "priceUsd": 0.1, "wear": "shovel" },\n  { "id": "echo-bat", "name": "Echo Bat", "priceUsd": 1, "wear": "pinger", "slots": { "ring": "ripples" } }\n]\n`,
  );
  const raw = JSON.parse(text);
  assert.deepEqual(lookProblems(raw), []);
  const back = checkLooks(raw);
  assert.deepEqual(back[1], SPADE);
  assert.deepEqual(back[2], BAT);
  assert.equal(looksJson(back), text, "written, read and written again: the same text");
});

test("an outfit is a look with no wear, or with the wear \"outfit\": the same look, written as before", () => {
  const named = { ...FREE, wear: OUTFIT };
  assert.deepEqual(lookProblems([named]), []);
  assert.equal("wear" in checkLooks([named])[0], false, "checkLooks leaves the outfit's wear out");
  assert.equal(looksJson([named]), looksJson([FREE]));
  assert.equal(wearOf(FREE), OUTFIT);
  assert.equal(wearOf(named), OUTFIT);
  assert.equal(wearOf(SPADE), "shovel");
  assert.equal(isOutfit(FREE), true);
  assert.equal(isOutfit(SPADE), false);
});

test("the mistakes of a wear slot are listed with the look, the field and plain words", () => {
  const say = (l: unknown) => lookProblems([FREE, l]).map((p) => `${p.look}:${p.field}`);
  for (const bad of ["Shovel", "1shovel", "", "a b", "x".repeat(25), "constructor", "prototype", 1, true, null, ["shovel"]]) assert.deepEqual(say({ ...SPADE, wear: bad }), ["2:wear"], String(bad));
  // an item never changes the body: its "change" is refused, with words that say why
  const withChange = lookProblems([FREE, { ...SPADE, change: { body: "#ff0000" } }]);
  assert.deepEqual(withChange.map((p) => `${p.look}:${p.field}`), ["2:change"]);
  assert.match(withChange[0]!.message, /only for an outfit/);
  // an outfit still needs its body colour
  assert.deepEqual(say({ id: "plain", name: "Plain", priceUsd: 0.05 }), ["2:change.body"]);
  assert.deepEqual(say({ id: "plain", name: "Plain", priceUsd: 0.05, wear: OUTFIT }), ["2:change.body"]);
});

test("one free OUTFIT is needed: a free item does not count, and a list of outfits only keeps the starter's words", () => {
  const items = lookProblems([{ ...FREE, priceUsd: 0.25 }, { ...SPADE, priceUsd: 0 }]);
  assert.deepEqual(items.map((p) => p.field), ["free"]);
  assert.match(items[0]!.message, /free outfit/);
  const outfits = lookProblems([{ ...FREE, priceUsd: 0.25 }]);
  assert.equal(outfits[0]!.message, "looks.json needs at least one free look (priceUsd 0): every player starts with it");
  assert.deepEqual(lookProblems([FREE, { ...SPADE, priceUsd: 0 }]), [], "a free item beside a free outfit is fine");
});

test("an owned item stays in its wear slot: moving it to another slot, or making it an outfit, is refused", () => {
  const before = [FREE, SPADE, BAT];
  const moved = [FREE, { ...SPADE, wear: "pinger" }, BAT];
  const p = removalProblems(before, moved, ["toy-spade"]);
  assert.deepEqual(p.map((x) => `${x.look}:${x.field}`), ["2:wear"]);
  assert.match(p[0]!.message, /"shovel" slot/);
  const outfit: Look[] = [FREE, { id: "toy-spade", name: "Toy Spade", priceUsd: 0.1, change: { body: "#ff0000" } }, BAT];
  assert.deepEqual(removalProblems(before, outfit, ["toy-spade"]).map((x) => x.field), ["wear"]);
  // nobody owns it: the creator may move it
  assert.deepEqual(removalProblems(before, moved, []), []);
  // a price or a name of an owned item may change
  assert.deepEqual(removalProblems(before, [FREE, { ...SPADE, priceUsd: 0.25, name: "Beach Spade" }, BAT], ["toy-spade"]), []);
});

test("a change of the wear slot is listed by diffLooks, and an item's missing change is not a change", () => {
  const d = diffLooks([FREE, SPADE], [FREE, { ...SPADE, wear: "charm" }]);
  assert.deepEqual(d.changed.map((c) => c.fields), [["wear"]]);
  assert.deepEqual(diffLooks([FREE, SPADE, BAT], [FREE, { ...SPADE }, { ...BAT }]).changed, []);
});
