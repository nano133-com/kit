// The character's record: the pure part ("@nano133/nanoterra/character/record"). It is two whole numbers on closed lists. These tests hold it to what
// every older Nanoterra game and the site's wire expect: every look of before comes through whole, and nothing off a list is believed.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_IDS, DEFAULT_RECORD, HAIRS, PACK_BITS, PANTS, SHIRTS, SHOES, SKINS, TODAY, baseRecord, clean, defaultLook, diceRecord, fromBlob, fromLegacy, isRecord, packLegacy, packRecord, recordProblem, toBlob, toLegacy, unpackRecord, withBase, withLegacy,
  type LookRecord,
} from "../src/character/pure.js";

/** A small seeded generator (mulberry32): the same numbers every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** All 8,192 looks of before the record: skin 8, hair 8, shirt 8, pants 4, shoes 4. */
function* oldLooks() {
  for (const skin of SKINS) for (const hair of HAIRS) for (const shirt of SHIRTS) for (const pants of PANTS.slice(0, TODAY.pants)) for (const shoes of SHOES.slice(0, TODAY.shoes)) yield { skin, hair, shirt, pants, shoes };
}

test("all 8,192 old looks round-trip: five colours to a record, to two numbers, and back", () => {
  let n = 0;
  const wire = new Set<number>();
  for (const look of oldLooks()) {
    n++;
    const rec = fromLegacy(look);
    assert.deepEqual(toLegacy(rec), look, "the five colours come back");
    const [a, b] = packRecord(rec);
    assert.deepEqual(unpackRecord(a, b), rec, "the two numbers come back as the record");
    assert.equal(recordProblem(rec), null);
    assert.equal(rec.base, 0, "an old look is a Classic");
    // The old wire number (the island's room before the record) is still made, one for each look.
    const w = packLegacy(look);
    assert.ok(Number.isInteger(w) && w >= 0 && w < 8192, `wire number ${w}`);
    wire.add(w);
  }
  assert.equal(n, 8 * 8 * 8 * 4 * 4);
  assert.equal(n, 8192);
  assert.equal(wire.size, 8192, "no two old looks share a wire number");
});

test("the default look is the default record, and a record of zeros dresses today's avatar", () => {
  assert.deepEqual(fromLegacy(defaultLook()), DEFAULT_RECORD);
  assert.deepEqual(toLegacy(DEFAULT_RECORD), defaultLook());
  const [a, b] = packRecord(DEFAULT_RECORD);
  assert.deepEqual(unpackRecord(a, b), DEFAULT_RECORD);
});

test("a colour that is not on the island's lists is the part's first, as it always was", () => {
  const rec = fromLegacy({ ...defaultLook(), shirt: "#c8461a", shoes: "#123456" });
  assert.equal(rec.shirt, 0);
  assert.equal(rec.shoeColor, 0);
});

test("the two numbers keep inside their bits for every base and a thousand random records", () => {
  const rand = rng(1);
  const records: LookRecord[] = [...BASE_IDS.map((b) => baseRecord(b)), ...Array.from({ length: 1000 }, () => diceRecord(rand))];
  for (const rec of records) {
    assert.equal(recordProblem(rec), null, JSON.stringify(rec));
    const [a, b] = packRecord(rec);
    assert.ok(Number.isInteger(a) && a >= 0 && a < 2 ** PACK_BITS[0], `a is ${a}`);
    assert.ok(Number.isInteger(b) && b >= 0 && b < 2 ** PACK_BITS[1], `b is ${b}`);
    assert.deepEqual(unpackRecord(a, b), rec);
  }
  assert.deepEqual(PACK_BITS, [28, 30]);
});

test("the dice make whole records on every base, and the same generator gives the same record", () => {
  for (const base of BASE_IDS) {
    const r1 = diceRecord(rng(7), base);
    const r2 = diceRecord(rng(7), base);
    assert.deepEqual(r1, r2);
    assert.equal(BASE_IDS[r1.base], base);
    assert.equal(isRecord(r1), true);
  }
});

test("two numbers that are not a whole record are refused, not believed", () => {
  const [a, b] = packRecord(baseRecord("critter"));
  const bad: [unknown, unknown][] = [
    [1.5, b], [a, 0.5], [-1, b], [a, -1], [2 ** 28, b], [a, 2 ** 30], [NaN, b], [a, Infinity], ["1", "2"], [null, b], [undefined, undefined], [{}, []],
    // the base has six values in three bits: 6 and 7 are whole numbers inside the limit and not a base
    [(a & ((1 << 25) - 1)) | (6 << 25), b], [(a & ((1 << 25) - 1)) | (7 << 25), b],
  ];
  for (const [x, y] of bad) assert.equal(unpackRecord(x, y), null, `${String(x)}, ${String(y)}`);
});

test("recordProblem says in one sentence what is wrong", () => {
  const good = baseRecord("round");
  assert.equal(recordProblem(good), null);
  const cases: [unknown, RegExp][] = [
    [null, /record must be a character record.*null/],
    [[], /record must be a character record/],
    [{ ...good, v: 1 }, /record\.v must be 2/],
    [{ ...good, base: 9 }, /record\.base must be a whole number on its list, not number/],
    [{ ...good, face: 1.5 }, /record\.face must be a whole number on its list/],
    [{ ...good, top: "tee" }, /record\.top must be a whole number on its list, not "tee"/],
    [{ v: 2 }, /record\.base must be a whole number/],
  ];
  for (const [rec, message] of cases) {
    assert.match(recordProblem(rec) ?? "", message);
    assert.equal(isRecord(rec), false);
  }
});

test("clean puts a wrong number back to the default and never throws", () => {
  assert.deepEqual(clean(null), DEFAULT_RECORD);
  assert.deepEqual(clean({ base: 99, face: -1 }), DEFAULT_RECORD);
  assert.equal(clean({ base: 3 }).base, 3);
});

test("five colours go into the record that is there: the skin only on a Classic, the shoes not on a Round", () => {
  const bee = baseRecord("bee");
  const l = { skin: SKINS[6], hair: HAIRS[2], shirt: SHIRTS[3], pants: PANTS[2], shoes: SHOES[1] };
  const into = withLegacy(bee, l);
  assert.equal(into.base, bee.base, "the base stays");
  assert.equal(into.skin, bee.skin, "a Bee has its own body colour");
  assert.equal(into.shirt, 3);
  const round = withLegacy(baseRecord("round"), l);
  assert.equal(round.shoeColor, baseRecord("round").shoeColor, "a Round's feet are the room's");
  const classic = withLegacy(DEFAULT_RECORD, l);
  assert.equal(classic.skin, 6);
  assert.equal(classic.shoeColor, 1);
});

test("withBase keeps the face and the sizes, and takes off what the new base does not wear", () => {
  const person: LookRecord = { ...DEFAULT_RECORD, face: 3, height: 5, head: 3, hairStyle: 2, top: 2, bottom: 1 };
  for (const base of BASE_IDS) {
    const r = withBase(person, base);
    assert.equal(BASE_IDS[r.base], base);
    assert.equal(r.height, 5);
    assert.equal(recordProblem(r), null);
  }
  const bee = withBase(person, "bee");
  assert.equal(bee.top, 5, "a Bee wears no top");
  assert.equal(bee.bottom, 4, "or bottom");
});

test("the room blob maps to a Round and back", () => {
  const pick = { body: 4, visor: 6, feet: 9, height: 1 as const, width: 2 as const, pattern: 3 as const };
  const rec = fromBlob(pick);
  assert.equal(BASE_IDS[rec.base], "round");
  assert.deepEqual(toBlob(rec), pick);
  assert.equal(toBlob(DEFAULT_RECORD), null, "a Classic is not a blob");
});
