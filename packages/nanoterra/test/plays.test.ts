// The plays (plays.json): what `checkPlays` takes and what it refuses. Pay to play only: a play buys one use of the game, nothing else. These are guard
// tests: each refused field fails, a use outside the closed list fails, and a play never takes a look's id.
import assert from "node:assert/strict";
import test from "node:test";
import { PLAY_FIELDS, PLAY_ONE_USE, PLAY_REFUSED_FIELDS, PLAY_USES, PLAY_WAIT_DAYS, checkPlays, playProblems } from "../src/looks/index.js";
import { LOOKS } from "./shop-helpers.js";

const GOOD = { id: "extra-round", name: "Extra round", priceUsd: 0.05, use: "round" };

test("a good plays.json: each play comes back clean, with its wait filled in", () => {
  assert.deepEqual(checkPlays([GOOD, { id: "level-2", name: "Level 2", priceUsd: 0.0001, use: "level", useWithinDays: 7 }], LOOKS), [
    { ...GOOD, useWithinDays: PLAY_WAIT_DAYS },
    { id: "level-2", name: "Level 2", priceUsd: 0.0001, use: "level", useWithinDays: 7 },
  ]);
  assert.equal(PLAY_WAIT_DAYS, 30);
  assert.deepEqual(checkPlays([]), [], "an empty list sells no play");
  assert.deepEqual(playProblems([GOOD], LOOKS), []);
});

test("the closed list of uses is round, level, life and continue (the shop sells a life or a continue only while the Legal card says so)", () => {
  assert.deepEqual([...PLAY_USES], ["round", "level", "life", "continue"]);
  for (const use of PLAY_USES) assert.equal(checkPlays([{ ...GOOD, use }])[0].use, use);
  for (const use of ["pack", "spin", "Round", "Life", "lives", "", undefined, 1]) {
    assert.throws(() => checkPlays([{ ...GOOD, use }]), /"use" must be one of round, level, life, continue/, String(use));
  }
});

test("every refused field fails with the one-use words, in any case or form", () => {
  assert.deepEqual([...PLAY_REFUSED_FIELDS], ["prize", "reward", "odds", "chance", "random", "tickets", "tokens", "cash", "bonus"]);
  for (const field of [...PLAY_REFUSED_FIELDS, "Prize", "prizes", "ticket", "token", "rewardXno", "winChance", "randomLoot", "cashOut", "BONUS"]) {
    const problems = playProblems([{ ...GOOD, [field]: 1 }]);
    assert.equal(problems.length, 1, field);
    assert.equal(problems[0].field, field);
    assert.ok(problems[0].message.includes(PLAY_ONE_USE), problems[0].message);
    assert.throws(() => checkPlays([{ ...GOOD, [field]: false }]), new RegExp(PLAY_ONE_USE), field);
  }
});

test("an unknown field is a mistake, never dropped", () => {
  for (const field of ["count", "wear", "change", "slots", "difficulty", "__proto__", "constructor"]) {
    const raw = JSON.parse(JSON.stringify({ ...GOOD }).replace(/}$/, `, ${JSON.stringify(field)}: 1}`));
    assert.throws(() => checkPlays([raw]), /is not a field of a play/, field);
  }
  assert.deepEqual([...PLAY_FIELDS], ["id", "name", "priceUsd", "use", "useWithinDays"]);
});

test("a play and a look never share an id; ids are unique and plain", () => {
  assert.throws(() => checkPlays([{ ...GOOD, id: "red-coat" }], LOOKS), /"red-coat" is a look's id too/);
  assert.throws(() => checkPlays([{ ...GOOD, id: "plain" }], LOOKS), /a look's id too/, "a free look's id too");
  assert.throws(() => checkPlays([GOOD, { ...GOOD, name: "Again" }]), /used twice/);
  for (const id of ["", "Extra", "a b", "x".repeat(41), "play:x", 7]) assert.throws(() => checkPlays([{ ...GOOD, id }]), /"id" must be/, String(id));
});

test("the price is above 0, at most 1000, with at most 4 decimals; the name 1 to 40 characters; the wait 1 to 365 whole days", () => {
  for (const priceUsd of [0, -1, 1000.01, Number.NaN, "0.05", 0.00005, 0.12345]) assert.throws(() => checkPlays([{ ...GOOD, priceUsd }]), /priceUsd/, String(priceUsd));
  assert.equal(checkPlays([{ ...GOOD, priceUsd: 1000 }])[0].priceUsd, 1000);
  for (const name of ["", "   ", "x".repeat(41), 3]) assert.throws(() => checkPlays([{ ...GOOD, name }]), /"name"/, String(name));
  for (const useWithinDays of [0, 366, 1.5, "30", null]) assert.throws(() => checkPlays([{ ...GOOD, useWithinDays }]), /useWithinDays/, String(useWithinDays));
});

test("not a list, or a play that is not an object, fails; a getter cannot pass the check and change after", () => {
  assert.throws(() => checkPlays({ plays: [] }), /must be a list/);
  assert.throws(() => checkPlays(undefined), /must be a list/);
  assert.throws(() => checkPlays([null]), /must be an object/);
  assert.throws(() => checkPlays([["extra-round"]]), /must be an object/);
  let n = 0;
  const tricky = { ...GOOD, get priceUsd() { return n++ === 0 ? 0.05 : 0; } };
  const [play] = checkPlays([tricky]);
  assert.equal(play.priceUsd, 0.05, "one snapshot is checked and copied");
});
