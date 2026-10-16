import assert from "node:assert/strict";
import { test } from "node:test";
import { defineRules } from "../src/index.js";
import { memoryStore } from "../src/memory.js";
import { checkRound, startRound, type RoundStore } from "../src/server.js";
import { epoch, getRound, player, rules, setup } from "./fixtures.js";

test("the server stores a private start time, seed, version and trusted player", async () => {
  const { store } = setup();
  const round = await startRound(store, { rulesVersion: rules.version, player });
  const stored = (await getRound(store, round.roundId))!;
  assert.equal(stored.startedAt, epoch);
  assert.equal(stored.seed, round.seed);
  assert.match(round.seed, /^[0-9a-f]{64}$/);
  assert.equal(stored.rulesVersion, rules.version);
  assert.deepEqual(stored.player, player);
  assert.equal("player" in round, false, "the public answer has no player address");
  const other = await startRound(store, { rulesVersion: rules.version, player });
  assert.notEqual(other.seed, round.seed);
  assert.notEqual(other.roundId, round.roundId);
  await assert.rejects(startRound(store, { rulesVersion: "unknown", player }), /version/);
});

test("a round cannot end before its exact replay length; a retry can pass", async () => {
  const { store } = setup();
  const { roundId } = await startRound(store, { rulesVersion: rules.version, seed: "bonus", player });
  assert.deepEqual(await checkRound(store, { roundId, inputs: [], now: epoch + 1499 }), { state: "soon", waitMs: 1 });
  assert.equal((await getRound(store, roundId))!.status, "open");
  const answer = await checkRound(store, { roundId, inputs: [], now: epoch + 1500 });
  assert.equal(answer.state, "checked");
  if (answer.state === "checked") assert.equal(answer.replay.won, true);
  assert.equal((await checkRound(store, { roundId, inputs: [0], now: epoch + 2000 })).state, "used");
});

test("the replay uses the stored version and seed, including after a new version ships", async () => {
  const newer = defineRules({ ...rules, version: "test:2", done: (s) => s.step === 3 ? { won: false } : null });
  const store = memoryStore({ rules: [rules, newer], now: () => epoch });
  const old = await startRound(store, { rulesVersion: rules.version, seed: "bonus", player });
  const next = await startRound(store, { rulesVersion: newer.version, seed: "bonus", player });
  const a = await checkRound(store, { roundId: old.roundId, inputs: [], now: epoch + 1500 });
  const b = await checkRound(store, { roundId: next.roundId, inputs: [], now: epoch + 1500 });
  assert.ok(a.state === "checked" && a.replay.won);
  assert.ok(b.state === "checked" && !b.replay.won);
  assert.throws(() => memoryStore({ rules: [rules, rules] }), /unique/);
});

test("a missing old version refuses the check and leaves the round open", async () => {
  const { store } = setup();
  const { roundId } = await startRound(store, { rulesVersion: rules.version, player });
  const missing: RoundStore = { ...store, rules: () => undefined };
  assert.deepEqual(await checkRound(missing, { roundId, inputs: [], now: epoch + 2000 }), { state: "rules-unavailable" });
  assert.equal((await getRound(store, roundId))!.status, "open");
});

test("invalid inputs close the round and two simultaneous checks count it once", async () => {
  const { store } = setup();
  const bad = await startRound(store, { rulesVersion: rules.version, player });
  const result = await checkRound(store, { roundId: bad.roundId, inputs: [0.1], now: epoch });
  assert.ok(result.state === "checked" && !result.replay.valid);
  assert.equal((await getRound(store, bad.roundId))!.noPrize, "invalid");
  const round = await startRound(store, { rulesVersion: rules.version, player });
  const checked = await Promise.all([0, 1].map(() => checkRound(store, { roundId: round.roundId, inputs: [0], now: epoch + 1500 })));
  assert.deepEqual(checked.map((a) => a.state).sort(), ["checked", "used"]);
  assert.equal((await checkRound(store, { roundId: "unknown", inputs: [] })).state, "unknown");
});

test("memory transactions roll back and returned records do not change stored records", async () => {
  const { store } = setup();
  const { roundId } = await startRound(store, { rulesVersion: rules.version, player });
  await assert.rejects(store.transaction(async (tx) => {
    const round = (await tx.getRound(roundId))!;
    tx.setRound({ ...round, status: "paid" });
    tx.setUsage("test", 1);
    tx.setActivePrize(roundId);
    throw new Error("rollback");
  }));
  const copy = (await getRound(store, roundId))!;
  assert.equal(copy.status, "open");
  copy.player.payee = "changed";
  assert.equal((await getRound(store, roundId))!.player.payee, player.payee);
  assert.equal(await store.transaction((tx) => tx.getUsage("test")), 0);
  assert.equal(await store.transaction((tx) => tx.getActivePrize()), null);
});
