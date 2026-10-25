import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLooks, diffLooks, HATS, lookProblems, looksJson, PRICE_LADDER, priceText, removalProblems, rungOf, slugId, usdText, wholeCents, type Look } from "../src/index.js";

// looks.json of the game starter at 86b04e2 (nano133-com/nano-game-starter), byte for byte: looksJson must write it back as it is.
const STARTER_FILE = `[
  { "id": "classic", "name": "Classic", "priceUsd": 0, "change": { "body": "#4aa8ff" } },
  { "id": "sunset", "name": "Sunset", "priceUsd": 0.25, "change": { "body": "#ff8a3d" } },
  { "id": "mint-cap", "name": "Mint Cap", "priceUsd": 0.25, "change": { "body": "#3ddc97", "hat": "cap", "hatColor": "#1c6e4f" } },
  { "id": "berry-beanie", "name": "Berry Beanie", "priceUsd": 0.5, "change": { "body": "#e0457b", "hat": "beanie", "hatColor": "#6a2bd9" } },
  { "id": "royal", "name": "Royal", "priceUsd": 1, "change": { "body": "#7b5cff", "hat": "crown", "hatColor": "#ffd23f" } },
  { "id": "top-hat", "name": "Top Hat", "priceUsd": 1, "change": { "body": "#e9e4d8", "hat": "tophat", "hatColor": "#22242e" } }
]
`;

const look = (over: Partial<Look> & { id: string }): Look => ({ name: "A look", priceUsd: 0.05, change: { body: "#336699" }, ...over });
const FREE = look({ id: "free", priceUsd: 0 });

test("the starter's own looks.json is good, and looksJson writes it back byte for byte", () => {
  const looks = checkLooks(JSON.parse(STARTER_FILE));
  assert.equal(looks.length, 6);
  assert.equal(looksJson(looks), STARTER_FILE);
});

test("looksJson then JSON.parse gives the same looks, and the text is a good list", () => {
  const looks = [FREE, look({ id: "a", priceUsd: 1.1, change: { body: "#AABBCC", hat: "crown", hatColor: "#112233" } }), look({ id: "b", name: 'Quote "x" \\ y', priceUsd: 0.07 })];
  const text = looksJson(looks);
  assert.ok(text.endsWith("]\n"));
  assert.deepEqual(JSON.parse(text), looks);
  assert.deepEqual(lookProblems(JSON.parse(text)), []);
});

test("the messages are the starter's words", () => {
  const say = (raw: unknown) => lookProblems(raw)[0]?.message;
  assert.equal(say([]), "looks.json must be a list with at least one look");
  assert.equal(say("x"), "looks.json must be a list with at least one look");
  assert.equal(say([{ ...FREE, id: "Bad Id" }]), 'looks.json, look 1: "id" must be 1 to 40 lowercase letters, digits or dashes');
  assert.equal(say([FREE, FREE]), 'looks.json, look 2: the id "free" is used twice');
  assert.equal(say([{ ...FREE, name: " " }]), 'looks.json, look 1: "name" must be 1 to 40 characters');
  assert.equal(say([{ ...FREE, name: "x".repeat(41) }]), 'looks.json, look 1: "name" must be 1 to 40 characters');
  assert.equal(say([{ ...FREE, priceUsd: -1 }]), 'looks.json, look 1: "priceUsd" must be a number from 0 to 1000');
  assert.equal(say([{ ...FREE, priceUsd: 1000.01 }]), 'looks.json, look 1: "priceUsd" must be a number from 0 to 1000');
  assert.equal(say([{ ...FREE, priceUsd: "1" }]), 'looks.json, look 1: "priceUsd" must be a number from 0 to 1000');
  assert.equal(say([FREE, { ...FREE, id: "x", priceUsd: 0.001 }]), 'looks.json, look 2: "priceUsd" can have at most 2 decimals (cents)');
  assert.equal(say([{ ...FREE, change: { body: "red" } }]), 'looks.json, look 1: "change.body" must be a colour like "#4aa8ff"');
  assert.equal(say([{ ...FREE, change: {} }]), 'looks.json, look 1: "change.body" must be a colour like "#4aa8ff"');
  assert.equal(say([{ ...FREE, change: { body: "#336699", hat: "fez" } }]), `looks.json, look 1: "change.hat" must be one of ${HATS.join(", ")}`);
  assert.equal(say([{ ...FREE, change: { body: "#336699", hat: "cap", hatColor: "blue" } }]), 'looks.json, look 1: "change.hatColor" must be a colour like "#1c6e4f"');
  assert.equal(say([look({ id: "paid" })]), "looks.json needs at least one free look (priceUsd 0): every player starts with it");
  assert.throws(() => checkLooks([look({ id: "paid" })]), /needs at least one free look/);
  assert.throws(() => checkLooks(null), /at least one look/);
});

test("every mistake is listed, with its look and field", () => {
  const p = lookProblems([{ id: "BAD", name: "", priceUsd: -3, change: { body: "x", hat: "fez", hatColor: "y" } }, FREE, { ...FREE, id: "other", change: null }]);
  assert.deepEqual(p.map((x) => `${x.look}:${x.field}`), ["1:id", "1:name", "1:priceUsd", "1:change.body", "1:change.hat", "1:change.hatColor", "3:change.body"]);
  assert.equal(lookProblems(null)[0].look, null);
});

test("a price with whole cents is good, whatever the floating point says (the starter refused 35 of the first 301)", () => {
  const refused: number[] = [];
  for (let c = 0; c <= 100_000; c++) if (!wholeCents(c / 100)) refused.push(c / 100);
  assert.deepEqual(refused, []);
  for (const usd of [0.07, 0.14, 0.28, 0.29, 0.55, 0.56, 0.57, 0.58, 1.09, 1.1, 1.11, 2.01, 999.99, 1000]) {
    assert.deepEqual(lookProblems([FREE, look({ id: "p", priceUsd: usd })]), [], `$${usd}`);
  }
  for (const usd of [0.001, 0.005, 0.255, 1.999, 10.001]) assert.equal(wholeCents(usd), false, `$${usd}`);
});

test("usdText and priceText", () => {
  assert.equal(usdText(0.25), "$0.25");
  assert.equal(usdText(0), "$0.00");
  assert.deepEqual([0.01, 0.05, 0.25, 0.5, 1, 1.1, 2.5].map(priceText), ["1¢", "5¢", "25¢", "50¢", "$1", "$1.10", "$2.50"]);
});

test("the price ladder is nano133.com's: 1¢, 2¢, 5¢, 25¢, 50¢, $1", () => {
  assert.deepEqual(PRICE_LADDER.map((r) => `${r.name}:${r.cents}`), ["dye:1", "charm:2", "piece:5", "statement:25", "set:50", "outfit:100"]);
  assert.equal(rungOf(0.25)?.name, "statement");
  assert.equal(rungOf(0.01)?.name, "dye");
  assert.equal(rungOf(1)?.name, "outfit");
  assert.equal(rungOf(0.3), undefined);
  for (const r of PRICE_LADDER) assert.ok(wholeCents(r.cents / 100));
});

test("slugId: lowercase letters, digits and dashes, at most 40, unique", () => {
  assert.equal(slugId("Mint Cap"), "mint-cap");
  assert.equal(slugId("  Crème brûlée!! "), "creme-brulee");
  assert.equal(slugId("Mint Cap", ["mint-cap"]), "mint-cap-2");
  assert.equal(slugId("Mint Cap", ["mint-cap", "mint-cap-2"]), "mint-cap-3");
  assert.equal(slugId("!!!"), "look");
  assert.equal(slugId("日本語"), "look");
  assert.ok(slugId("x".repeat(100)).length <= 40);
  assert.ok(slugId("x".repeat(100), [slugId("x".repeat(100))]).length <= 40);
  for (const n of ["Mint Cap", "A", "9 lives", "-a-", "x".repeat(60)]) assert.match(slugId(n), /^[a-z0-9-]{1,40}$/);
});

test("removalProblems: a look that a player owns must stay in the file", () => {
  const before = [FREE, look({ id: "hat", name: "Hat" }), look({ id: "old", name: "Old" })];
  assert.deepEqual(removalProblems(before, before, ["hat"]), []);
  assert.deepEqual(removalProblems(before, [FREE, before[1]], []), []);
  const p = removalProblems(before, [FREE, before[1]], ["old", "hat"]);
  assert.equal(p.length, 1);
  assert.match(p[0].message, /"old" \(Old\) is owned by a player/);
  assert.equal(removalProblems(before, [FREE], new Set(["hat", "old"])).length, 2);
});

test("diffLooks: added, removed and changed, by id; the order is not a change", () => {
  const a = look({ id: "a", name: "A", priceUsd: 0.05, change: { body: "#112233", hat: "cap", hatColor: "#445566" } });
  const b = look({ id: "b" });
  const c = look({ id: "c" });
  const same = diffLooks([FREE, a, b], [b, a, FREE]);
  assert.deepEqual([same.added, same.removed, same.changed], [[], [], []]);
  const a2 = { ...a, name: "A2", priceUsd: 0.25, change: { body: "#112234", hat: "crown" as const, hatColor: "#445567" } };
  const d = diffLooks([FREE, a, b], [FREE, a2, c]);
  assert.deepEqual(d.added.map((l) => l.id), ["c"]);
  assert.deepEqual(d.removed.map((l) => l.id), ["b"]);
  assert.deepEqual(d.changed.map((x) => [x.id, x.fields]), [["a", ["name", "priceUsd", "body", "hat", "hatColor"]]]);
  // a colour in another case is the same colour
  assert.deepEqual(diffLooks([a], [{ ...a, change: { body: "#112233".toUpperCase(), hat: "cap", hatColor: "#445566" } }]).changed, []);
});
