import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRound, payPrize, startRound, type PrizeSender, type RoundStore } from "../src/server.js";
import { epoch, getRound, limits, mockSender, player, rules, setup, wonRound } from "./fixtures.js";

const prize = (roundId: string, extra = {}) => ({ roundId, payee: player.payee, amountRaw: 1n, limits, ...extra });

test("a prize is saved with the closed round before publication; every retry republishes it", async () => {
  const { store } = setup();
  const roundId = await wonRound(store);
  const mock = mockSender();
  const sender: PrizeSender = {
    sign: mock.sender.sign,
    async publish(send) {
      const saved = (await getRound(store, roundId))!;
      assert.equal(saved.status, mock.published.length ? "paid" : "closed");
      assert.deepEqual(saved.send, send);
      await mock.sender.publish(send);
    },
  };
  assert.deepEqual(await payPrize(store, sender, prize(roundId)), { state: "paid", won: true, hash: (await getRound(store, roundId))!.send!.hash, again: false });
  assert.equal((await payPrize(store, sender, prize(roundId))).state, "paid");
  assert.equal(mock.signed.length, 1);
  assert.equal(mock.published.length, 2);
  assert.deepEqual(mock.published[0], mock.published[1]);
  assert.equal(mock.ledger.size, 1);
  assert.equal(await store.transaction((tx) => tx.getActivePrize()), null);
});

test("a lost node answer retries the saved block and never signs twice", async () => {
  const { store } = setup();
  const roundId = await wonRound(store);
  const mock = mockSender();
  let first = true;
  const sender: PrizeSender = {
    sign: mock.sender.sign,
    async publish(send) {
      await mock.sender.publish(send);
      if (first) { first = false; throw new Error("node answer lost"); }
    },
  };
  await assert.rejects(payPrize(store, sender, prize(roundId)), /answer lost/);
  assert.equal((await getRound(store, roundId))!.status, "closed");
  const answer = await payPrize(store, sender, prize(roundId));
  assert.ok(answer.state === "paid" && answer.again);
  assert.equal(mock.signed.length, 1);
  assert.equal(mock.ledger.size, 1);
  assert.deepEqual(mock.published[0], mock.published[1]);
});

test("two requests cannot sign the same prize, even while the first signer waits", async () => {
  const { store } = setup();
  const roundId = await wonRound(store);
  const mock = mockSender();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sender: PrizeSender = {
    async sign(input) { entered(); await gate; return mock.sender.sign(input); },
    publish: mock.sender.publish,
  };
  const first = payPrize(store, sender, prize(roundId));
  await enteredPromise;
  assert.deepEqual(await payPrize(store, sender, prize(roundId)), { state: "pending", won: true, reason: "signing" });
  release();
  assert.equal((await first).state, "paid");
  assert.equal(mock.signed.length, 1);
});

test("an uncertain signing error retains the reservation and blocks a second signing", async () => {
  const { store } = setup();
  const roundId = await wonRound(store);
  let calls = 0;
  const sender: PrizeSender = {
    async sign() { calls++; throw new Error("signer interrupted"); },
    async publish() { assert.fail("no saved block may be published"); },
  };
  await assert.rejects(payPrize(store, sender, prize(roundId)), /interrupted/);
  assert.deepEqual(await payPrize(store, sender, prize(roundId)), { state: "pending", won: true, reason: "signing" });
  assert.equal(calls, 1);
  assert.equal((await getRound(store, roundId))!.status, "signing");
});

test("a failed save never publishes and never permits a fresh signing on retry", async () => {
  const { store } = setup();
  const roundId = await wonRound(store);
  const mock = mockSender();
  const failing: RoundStore = {
    ...store,
    transaction: (body) => store.transaction((tx) => body({
      ...tx,
      setRound(round) {
        if (round.send) throw new Error("save failed");
        tx.setRound(round);
      },
    })),
  };
  await assert.rejects(payPrize(failing, mock.sender, prize(roundId)), /save failed/);
  assert.equal((await payPrize(store, mock.sender, prize(roundId))).state, "pending");
  assert.equal(mock.signed.length, 1);
  assert.equal(mock.published.length, 0);
});

test("an unpaid saved block holds the wallet slot until its retry completes", async () => {
  const { store } = setup();
  const a = await wonRound(store);
  const other = { id: "other", payee: "mock-other-address" };
  const b = await wonRound(store, other);
  const mock = mockSender();
  const broken: PrizeSender = { sign: mock.sender.sign, publish: async () => { throw new Error("offline"); } };
  await assert.rejects(payPrize(store, broken, prize(a)), /offline/);
  assert.deepEqual(await payPrize(store, mock.sender, prize(b, { payee: other.payee })), { state: "pending", won: true, reason: "wallet-busy" });
  assert.equal(mock.signed.length, 1);
  await payPrize(store, mock.sender, prize(a));
  assert.equal((await payPrize(store, mock.sender, prize(b, { payee: other.payee }))).state, "paid");
  assert.equal(mock.signed.length, 2);
});

test("player and total limits close a winning round with a normal no-prize answer", async () => {
  const { store } = setup();
  const mock = mockSender();
  await payPrize(store, mock.sender, prize(await wonRound(store)));
  const b = await wonRound(store);
  assert.deepEqual(await payPrize(store, mock.sender, prize(b)), { state: "no-prize", won: true, reason: "player-limit" });
  assert.deepEqual(await payPrize(store, mock.sender, prize(b, { limits: { perPlayerPerDay: 100, totalPerDay: 100 } })), { state: "no-prize", won: true, reason: "player-limit" });
  const other = { id: "other", payee: "other-trusted-address" };
  await payPrize(store, mock.sender, prize(await wonRound(store, other), { payee: other.payee }));
  const third = { id: "third", payee: "third-trusted-address" };
  const c = await wonRound(store, third);
  assert.deepEqual(await payPrize(store, mock.sender, prize(c, { payee: third.payee })), { state: "no-prize", won: true, reason: "day-limit" });
  assert.equal(mock.signed.length, 2);
});

test("concurrent requests cannot exceed a daily limit", async () => {
  const { store } = setup();
  const mock = mockSender();
  const one = { perPlayerPerDay: 1, totalPerDay: 1 };
  const a = await wonRound(store);
  const other = { id: "other", payee: "other-trusted-address" };
  const b = await wonRound(store, other);
  const answers = await Promise.all([
    payPrize(store, mock.sender, prize(a, { limits: one })),
    payPrize(store, mock.sender, prize(b, { payee: other.payee, limits: one })),
  ]);
  assert.deepEqual(answers.map((a) => a.state).sort(), ["no-prize", "paid"]);
  assert.equal(mock.signed.length, 1);
});

test("a zero limit is normal; an empty wallet releases its reserved daily counts", async () => {
  const { store } = setup();
  const mock = mockSender();
  const zero = await wonRound(store);
  assert.deepEqual(await payPrize(store, mock.sender, prize(zero, { limits: { perPlayerPerDay: 0, totalPerDay: 0 } })), { state: "no-prize", won: true, reason: "player-limit" });
  assert.equal(mock.signed.length, 0);
  const empty = await wonRound(store);
  let attempts = 0;
  const sender: PrizeSender = { sign: async () => { attempts++; return null; }, publish: async () => assert.fail("empty wallet") };
  assert.deepEqual(await payPrize(store, sender, prize(empty)), { state: "no-prize", won: true, reason: "empty" });
  assert.equal((await payPrize(store, sender, prize(empty))).state, "no-prize");
  assert.equal(attempts, 1);
  assert.equal((await payPrize(store, mock.sender, prize(await wonRound(store)))).state, "paid");
});

test("limits use UTC and a retry on a new day stays on its reserved day", async () => {
  const { store, setNow } = setup();
  const mock = mockSender();
  const a = await wonRound(store);
  await assert.rejects(payPrize(store, { ...mock.sender, publish: async () => { throw new Error("offline"); } }, prize(a)));
  const reservedDay = (await getRound(store, a))!.prize!.day;
  setNow(epoch + 86_400_000);
  await payPrize(store, mock.sender, prize(a));
  assert.equal((await getRound(store, a))!.prize!.day, reservedDay);
  assert.equal((await payPrize(store, mock.sender, prize(await wonRound(store)))).state, "paid");
  assert.equal(mock.signed.length, 2);
});

test("only the saved trusted payee is accepted, including on a retry", async () => {
  const { store } = setup();
  const mock = mockSender();
  const roundId = await wonRound(store);
  await assert.rejects(payPrize(store, mock.sender, prize(roundId, { payee: "address-from-request" })), /trusted player/);
  assert.equal(mock.signed.length, 0);
  await payPrize(store, mock.sender, prize(roundId));
  assert.equal(mock.signed[0].payee, player.payee);
  await assert.rejects(payPrize(store, mock.sender, prize(roundId, { payee: "address-from-request" })), /trusted player/);
  await assert.rejects(payPrize(store, mock.sender, prize(roundId, { amountRaw: 2n })), /cannot change/);
  assert.equal(mock.published.length, 1);
});

test("a loss, invalid replay, unknown round or unchecked round never calls the signer", async () => {
  const { store } = setup();
  const mock = mockSender();
  const a = await startRound(store, { rulesVersion: rules.version, player, seed: "" });
  assert.equal((await payPrize(store, mock.sender, prize(a.roundId))).state, "unchecked");
  await checkRound(store, { roundId: a.roundId, inputs: [], now: epoch + 1500 });
  assert.deepEqual(await payPrize(store, mock.sender, prize(a.roundId)), { state: "no-prize", won: false, reason: "lost" });
  const b = await startRound(store, { rulesVersion: rules.version, player });
  await checkRound(store, { roundId: b.roundId, inputs: [-1] });
  assert.deepEqual(await payPrize(store, mock.sender, prize(b.roundId)), { state: "no-prize", won: false, reason: "invalid" });
  assert.equal((await payPrize(store, mock.sender, prize("unknown"))).state, "unknown");
  assert.equal(mock.signed.length, 0);
});

test("unsafe amounts and limit counts fail before signing", async () => {
  const { store } = setup();
  const mock = mockSender();
  const roundId = await wonRound(store);
  for (const amountRaw of [0n, -1n, "01", "1.5", (1n << 128n).toString()]) {
    await assert.rejects(payPrize(store, mock.sender, prize(roundId, { amountRaw })), /amountRaw/);
  }
  for (const limit of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(payPrize(store, mock.sender, prize(roundId, { limits: { ...limits, totalPerDay: limit } })), /limits/);
  }
  assert.equal(mock.signed.length, 0);
});
