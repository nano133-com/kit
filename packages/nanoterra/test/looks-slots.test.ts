import assert from "node:assert/strict";
import { test } from "node:test";
import { SLOTS_MAX, checkLooks, cleanSlots, diffLooks, lookProblems, looksJson, removalProblems, sameSlots, type Look } from "../src/looks/index.js";

// Slots: what a game defines for itself on a look ("wings": "ember", "trail": "#ffcf5a"). Words and #rrggbb colours only, at most 8 a look.

const look = (over: Partial<Look> & { id: string }): Look => ({ name: "A look", priceUsd: 0.05, change: { body: "#336699" }, ...over });
const FREE = look({ id: "free", priceUsd: 0 });
const EMBER = look({ id: "ember-wings", name: "Ember wings", priceUsd: 0.25, change: { body: "#ff7a3d" }, slots: { wings: "ember", trail: "#ffcf5a" } });

test("a look with slots is good, written on one line after change, and read back whole, in the creator's order", () => {
  const text = looksJson([FREE, EMBER]);
  assert.equal(
    text,
    `[\n  { "id": "free", "name": "A look", "priceUsd": 0, "change": { "body": "#336699" } },\n  { "id": "ember-wings", "name": "Ember wings", "priceUsd": 0.25, "change": { "body": "#ff7a3d" }, "slots": { "wings": "ember", "trail": "#ffcf5a" } }\n]\n`,
  );
  const raw = JSON.parse(text);
  assert.deepEqual(lookProblems(raw), []);
  const back = checkLooks(raw);
  assert.deepEqual(back[1].slots, { wings: "ember", trail: "#ffcf5a" });
  assert.deepEqual(Object.keys(back[1].slots!), ["wings", "trail"]);
  assert.equal(looksJson(back), text, "written, read and written again: the same text");
});

test("a look with no slots, or with empty slots, is the same look and is written exactly as before", () => {
  const plain = looksJson([FREE]);
  assert.ok(!plain.includes("slots"));
  assert.equal(looksJson([{ ...FREE, slots: {} }]), plain);
  assert.deepEqual(lookProblems([{ ...FREE, slots: {} }]), []);
  assert.equal("slots" in checkLooks([{ ...FREE, slots: {} }])[0], false, "an empty slots is dropped by checkLooks");
  assert.equal("slots" in checkLooks([FREE])[0], false);
});

test("the mistakes in slots are listed with the look, the field and plain words", () => {
  const say = (slots: unknown) => lookProblems([{ ...FREE, slots }]).map((p) => `${p.look}:${p.field}`);
  for (const bad of ["x", 1, true, null, [], [["wings", "ember"]], () => 1]) assert.deepEqual(say(bad), ["1:slots"], String(bad));
  assert.deepEqual(say({ Wings: "ember" }), ["1:slots.Wings"]);
  assert.deepEqual(say({ "1wings": "ember" }), ["1:slots.1wings"]);
  assert.deepEqual(say({ "": "ember" }), ["1:slots."]);
  assert.deepEqual(say({ "a b": "ember" }), ["1:slots.a b"]);
  assert.deepEqual(say({ [`a${"b".repeat(24)}`]: "x" }), [`1:slots.a${"b".repeat(24)}`], "a name of 25 characters");
  assert.deepEqual(say({ [`a${"b".repeat(23)}`]: "x" }), [], "a name of 24 characters is the longest");
  assert.deepEqual(say({ wings: "" }), ["1:slots.wings"]);
  assert.deepEqual(say({ wings: "Ember" }), ["1:slots.wings"], "a word is lower case");
  assert.deepEqual(say({ wings: "x".repeat(41) }), ["1:slots.wings"]);
  assert.deepEqual(say({ wings: "x".repeat(40) }), []);
  assert.deepEqual(say({ wings: "#fff" }), ["1:slots.wings"]);
  assert.deepEqual(say({ wings: "#gggggg" }), ["1:slots.wings"]);
  assert.deepEqual(say({ wings: "#FFCF5A" }), [], "a colour may be upper case");
  for (const v of [1, null, true, {}, ["a"], undefined]) assert.deepEqual(say({ wings: v }), ["1:slots.wings"], String(v));
  assert.match(lookProblems([{ ...FREE, slots: { Wings: "x" } }])[0].message, /^looks\.json, look 1: the slot name "Wings" must be 1 to 24 lowercase letters, digits or dashes, starting with a letter$/);
  assert.match(lookProblems([{ ...FREE, slots: { wings: "Ember" } }])[0].message, /^looks\.json, look 1: "slots\.wings" must be a word .* or a colour like "#ffcf5a"$/);
});

test("at most 8 slots, so at most 512 characters of names and values", () => {
  const n = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`s${i}`, "v"]));
  assert.deepEqual(lookProblems([{ ...FREE, slots: n(SLOTS_MAX) }]), []);
  const nine = lookProblems([{ ...FREE, slots: n(SLOTS_MAX + 1) }]);
  assert.deepEqual(nine.map((p) => p.field), ["slots"]);
  assert.match(nine[0].message, /at most 8 slots \(this one has 9\)/);
  // The biggest good look: 8 names of 24 characters and 8 values of 40: 512 characters.
  const big = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${String.fromCharCode(97 + i)}${"x".repeat(23)}`, "y".repeat(40)]));
  assert.deepEqual(lookProblems([{ ...FREE, slots: big }]), []);
  const chars = Object.entries(big).reduce((t, [k, v]) => t + k.length + v.length, 0);
  assert.equal(chars, 512);
});

test("checkLooks keeps the slots, drops every other unknown field, and returns a clean copy", () => {
  const raw = [{ ...FREE, extra: 1, price: 5, slots: { wings: "ember" } }];
  const [out] = checkLooks(raw);
  assert.deepEqual(Object.keys(out).sort(), ["change", "id", "name", "priceUsd", "slots"]);
  raw[0].slots.wings = "changed";
  assert.equal(out.slots!.wings, "ember", "the copy does not follow the input");
});

test("a key that could touch the prototype is refused, and nothing is polluted", () => {
  const raw = JSON.parse('[{"id":"free","name":"A","priceUsd":0,"change":{"body":"#336699"},"slots":{"__proto__":"x","constructor":"y"}}]');
  const p = lookProblems(raw);
  assert.deepEqual(p.map((x) => x.field), ["slots.__proto__"]);
  assert.equal(({} as Record<string, unknown>).x, undefined);
  assert.equal(Object.getPrototypeOf(cleanSlots(raw[0].slots)!), Object.prototype);
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test("sameSlots: the same names and values, in any order; none and empty are the same; a colour is the same in either case", () => {
  assert.ok(sameSlots(undefined, undefined));
  assert.ok(sameSlots(undefined, {}));
  assert.ok(sameSlots({ a: "x", b: "#ABCDEF" }, { b: "#abcdef", a: "x" }));
  assert.ok(!sameSlots({ a: "x" }, { a: "y" }));
  assert.ok(!sameSlots({ a: "x" }, { b: "x" }));
  assert.ok(!sameSlots({ a: "x" }, {}));
  assert.ok(!sameSlots({ a: "x" }, { a: "x", b: "y" }));
  assert.ok(!sameSlots({ a: "x", b: "y" }, { a: "x", c: "y" }));
  assert.ok(!sameSlots({ a: "Ember" }, { a: "ember" }), "a word is not folded");
  assert.ok(!sameSlots({ toString: "x" }, { a: "x" }), "a name like an Object method is not confused with a missing name");
});

test("diffLooks: a change of slots is a change of the look, with the field 'slots'", () => {
  const before = [FREE, EMBER];
  const add = diffLooks(before, [FREE, { ...EMBER, slots: { ...EMBER.slots, glow: "soft" } }]);
  assert.deepEqual(add.changed.map((c) => [c.id, c.fields]), [["ember-wings", ["slots"]]]);
  const drop = diffLooks(before, [FREE, { ...EMBER, slots: undefined }]);
  assert.deepEqual(drop.changed.map((c) => c.fields), [["slots"]]);
  const value = diffLooks(before, [FREE, { ...EMBER, slots: { wings: "flame", trail: "#ffcf5a" } }]);
  assert.deepEqual(value.changed.map((c) => c.fields), [["slots"]]);
  const withName = diffLooks(before, [FREE, { ...EMBER, name: "Flame wings", slots: { wings: "flame", trail: "#ffcf5a" } }]);
  assert.deepEqual(withName.changed[0].fields, ["name", "slots"]);
  // Not changes: the order of the names, the case of a colour, none against empty.
  assert.equal(diffLooks(before, [FREE, { ...EMBER, slots: { trail: "#FFCF5A", wings: "ember" } }]).changed.length, 0);
  assert.equal(diffLooks([FREE], [{ ...FREE, slots: {} }]).changed.length, 0);
});

test("removalProblems: a changed slot on a look that a player owns is a mistake; every other change of an owned look stays allowed", () => {
  const before = [FREE, EMBER, look({ id: "plain" })];
  const owned = ["ember-wings", "plain"];
  const say = (after: Look[], own: string[] = owned) => removalProblems(before, after, own).map((p) => `${p.look}:${p.field}`);
  // The mistake: a slot value, a new slot, a removed slot, a slot added to an owned look that had none.
  assert.deepEqual(say([FREE, { ...EMBER, slots: { wings: "flame", trail: "#ffcf5a" } }, before[2]]), ["2:slots"]);
  assert.deepEqual(say([FREE, { ...EMBER, slots: { ...EMBER.slots, glow: "soft" } }, before[2]]), ["2:slots"]);
  assert.deepEqual(say([FREE, { ...EMBER, slots: { wings: "ember" } }, before[2]]), ["2:slots"]);
  assert.deepEqual(say([FREE, EMBER, { ...before[2], slots: { aura: "blue" } }]), ["3:slots"]);
  const text = removalProblems(before, [FREE, { ...EMBER, slots: { wings: "flame", trail: "#ffcf5a" } }, before[2]], owned)[0].message;
  assert.equal(text, 'The slots of the look "ember-wings" (Ember wings) changed, and a player owns it. Keep its slots as they were, or add a new look with the new slots.');
  // Allowed: the order of the names, the case of a colour, a price, a name, a body colour, a hat; a slot change on a look that nobody owns; the free look; a new look with slots.
  assert.deepEqual(say([FREE, { ...EMBER, slots: { trail: "#FFCF5A", wings: "ember" } }, before[2]]), []);
  assert.deepEqual(say([FREE, { ...EMBER, priceUsd: 0.5, name: "Ember wings II", change: { body: "#000000", hat: "crown", hatColor: "#ffffff" } }, before[2]]), []);
  assert.deepEqual(say([FREE, { ...EMBER, slots: { wings: "flame" } }, before[2]], ["plain"]), [], "ember-wings is not owned in this list");
  assert.deepEqual(say([{ ...FREE, slots: { skin: "pale" } }, EMBER, before[2]]), [], "the free look is every player's and no order owns it: its slots may change");
  assert.deepEqual(say([FREE, EMBER, before[2], look({ id: "brand-new", slots: { a: "b" } })]), []);
  // Both mistakes at once are both listed: a removed id and a changed slot.
  const both = removalProblems(before, [FREE, { ...EMBER, slots: { wings: "x" } }], owned);
  assert.deepEqual(both.map((p) => p.field).sort(), ["id", "slots"]);
});

test("a file from before slots: every look reads and writes the same, and a change of a price on an owned look is still allowed", () => {
  const old = [FREE, look({ id: "a", priceUsd: 0.25 })];
  assert.deepEqual(removalProblems(old, [FREE, { ...old[1], priceUsd: 0.5 }], ["a"]), []);
  assert.deepEqual(removalProblems(old, [FREE], ["a"]).map((p) => p.field), ["id"]);
});
