import assert from "node:assert/strict";
import { test } from "node:test";
import { defineRules, play } from "../src/index.js";
import { rules } from "./fixtures.js";
import { rules as coinRun } from "../examples/coin-run/run.js";

test("the same seed and inputs give the same result without changing the inputs", () => {
  const inputs = Object.freeze([0, 2]);
  const first = play(rules, "", inputs);
  for (let i = 0; i < 10; i++) assert.deepEqual(play(rules, "", inputs), first);
  assert.deepEqual(first, { valid: true, won: true, steps: 3, durationMs: 1500, result: { won: true, score: 2 } });
  assert.equal(play(rules, "", []).won, false);
  assert.equal(play(rules, "bonus", []).won, true);
});

test("inputs must be bounded whole steps in strictly rising order", () => {
  for (const inputs of [null, {}, "0", ["0"], [0.5], [-1], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER], [1, 1], [2, 0], [3], [0, 1, 2, 3], Array(2)]) {
    assert.equal(play(rules, "", inputs).valid, false, String(inputs));
  }
  assert.equal(play(defineRules({ ...rules, maxInputs: 1 }), "", [0, 1]).valid, false);
});

test("unused inputs, impossible inputs and a round that never ends are refused", () => {
  assert.equal(play(defineRules({ ...rules, maxSteps: 5 }), "", [4]).valid, false);
  assert.equal(play(defineRules({ ...rules, valid: (_s, pressed) => !pressed }), "", [0]).valid, false);
  assert.equal(play(defineRules({ ...rules, done: () => null }), "", []).valid, false);
});

test("rule definitions have finite bounds and a stable version", () => {
  assert.ok(Object.isFrozen(rules));
  for (const patch of [{ version: "" }, { hz: 0 }, { hz: Infinity }, { maxSteps: 1.5 }, { maxSteps: 1_000_001 }, { maxInputs: -1 }, { maxInputs: 4 }]) {
    assert.throws(() => defineRules({ ...rules, ...patch }));
  }
});

test("Coin Run keeps the source course and a known ten-coin replay", () => {
  const r = defineRules(coinRun);
  const jumps = [281, 371, 581, 671, 911, 1121, 1241, 1331];
  assert.deepEqual(play(r, "", jumps), {
    valid: true, won: true, steps: 1561, durationMs: 26017,
    result: { won: true, coins: 10, hits: 0 },
  });
  const walk = play(r, "", []);
  assert.equal(walk.valid, true);
  assert.equal(walk.won, false);
  assert.equal(play(r, "", [0, 1]).valid, false, "a second jump in the air is impossible");
});
