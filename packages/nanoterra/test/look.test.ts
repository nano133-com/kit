import assert from "node:assert/strict";
import { test } from "node:test";
import { createCharacter } from "../src/character/index.js";
import { assertLook, defaultLook, isLook, LOOK_KEYS, LOOK_PARTS, lookProblem } from "../src/character/pure.js";

test("a good look: five parts, each #rrggbb", () => {
  assert.equal(isLook(defaultLook()), true);
  assert.equal(isLook({ skin: "#F2C29B", hair: "#3a2a1e", shirt: "#ff00aa", pants: "#000000", shoes: "#ffffff" }), true, "any six hex digits, any case: a shop dye is not one of the five");
  assert.equal(lookProblem(defaultLook()), null);
  assert.doesNotThrow(() => assertLook(defaultLook()));
  assert.equal(isLook({ ...defaultLook(), note: "extra keys are ignored" }), true);
});

test("every free colour of the island is a good colour", () => {
  assert.deepEqual([...LOOK_KEYS], ["skin", "hair", "shirt", "pants", "shoes"]);
  assert.deepEqual(Object.keys(LOOK_PARTS), [...LOOK_KEYS]);
  for (const key of LOOK_KEYS) {
    for (const colour of LOOK_PARTS[key]) assert.equal(isLook({ ...defaultLook(), [key]: colour }), true, `${key} ${colour}`);
  }
  // the island's counts (app/island/looks.ts)
  assert.deepEqual(LOOK_KEYS.map((k) => LOOK_PARTS[k].length), [8, 8, 8, 4, 4]);
  // the first colour of each part is not the default: the default is what a new player starts with
  const d = defaultLook();
  assert.deepEqual(d, { skin: "#f2c29b", hair: "#3a2a1e", shirt: "#2a9df4", pants: "#1e2a4a", shoes: "#ffffff" });
});

test("defaultLook gives a new object each time", () => {
  const a = defaultLook();
  a.shirt = "#000000";
  assert.equal(defaultLook().shirt, "#2a9df4");
  assert.notEqual(defaultLook(), defaultLook());
});

test("a bad look is refused, and the message names the part and the value", () => {
  const good = defaultLook();
  const cases: [unknown, RegExp][] = [
    [null, /look must be an object.*not null/],
    [undefined, /look must be an object.*not undefined/],
    ["#ffffff", /look must be an object.*not "#ffffff"/],
    [[], /look must be an object/],
    [{}, /look\.skin is missing/],
    [{ ...good, hair: undefined }, /look\.hair is missing/],
    [{ ...good, shirt: "red" }, /look\.shirt must be a colour like "#2a9df4".*not "red"/],
    [{ ...good, shirt: "#fff" }, /look\.shirt must be a colour.*not "#fff"/],
    [{ ...good, pants: "1e2a4a" }, /look\.pants must be a colour.*not "1e2a4a"/],
    [{ ...good, shoes: "#12345g" }, /look\.shoes must be a colour.*not "#12345g"/],
    [{ ...good, skin: "#f2c29b00" }, /look\.skin must be a colour/],
    [{ ...good, skin: 0xf2c29b }, /look\.skin must be a colour.*not number/],
    [{ ...good, hair: null }, /look\.hair must be a colour.*not null/],
    [{ ...good, hair: "#" + "a".repeat(80) }, /look\.hair must be a colour.*\.\.\./],
  ];
  for (const [look, message] of cases) {
    assert.equal(isLook(look), false, JSON.stringify(look));
    assert.match(lookProblem(look) ?? "", message);
    assert.throws(() => assertLook(look), (e: Error) => e instanceof TypeError && message.test(e.message) && e.message.startsWith("@nano133/nanoterra: "));
    // (a look left out means the default look)
    if (look !== undefined) assert.throws(() => createCharacter({ look: look as never }), message);
  }
});

test("the first problem is the first missing or bad part, in the island's order", () => {
  assert.match(lookProblem({ skin: "x", hair: "y" }) ?? "", /look\.skin/);
  assert.match(lookProblem({ skin: "#000000", hair: "y" }) ?? "", /look\.hair/);
});
