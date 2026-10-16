import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { firestoreStore } from "../src/firestore.js";
import { checkRound, payPrize, startRound, type RoundStore } from "../src/server.js";
import { epoch, getRound, limits, mockSender, player, rules, wonRound } from "./fixtures.js";
import { fakeFirestore } from "./fakeFirestore.js";

async function exercise(store: RoundStore, restart: () => RoundStore) {
  const a = await startRound(store, { rulesVersion: rules.version, player, seed: "bonus" });
  assert.equal((await checkRound(store, { roundId: a.roundId, inputs: [], now: epoch + 1499 })).state, "soon");
  assert.equal((await checkRound(store, { roundId: a.roundId, inputs: [], now: epoch + 1500 })).state, "checked");
  assert.equal((await checkRound(store, { roundId: a.roundId, inputs: [] })).state, "used");
  const mock = mockSender();
  const input = { roundId: a.roundId, payee: player.payee, amountRaw: 1n, limits };
  await assert.rejects(payPrize(store, { ...mock.sender, publish: async () => { throw new Error("offline"); } }, input));
  const reloaded = restart();
  const saved = (await getRound(reloaded, a.roundId))!.send;
  assert.ok(saved);
  assert.equal((await payPrize(reloaded, mock.sender, input)).state, "paid");
  assert.equal(mock.signed.length, 1, "a retried transaction and a restarted adapter must not sign twice");
  assert.deepEqual(mock.published[0], saved);
  const b = await wonRound(reloaded);
  assert.deepEqual(await payPrize(reloaded, mock.sender, { ...input, roundId: b }), { state: "no-prize", won: true, reason: "player-limit" });
  const other = { id: "other/player", payee: "other-trusted-payee" };
  const c = await wonRound(reloaded, other);
  assert.equal((await payPrize(reloaded, mock.sender, { ...input, roundId: c, payee: other.payee })).state, "paid");
  const third = { id: "third", payee: "third-trusted-payee" };
  const d = await wonRound(reloaded, third);
  assert.deepEqual(await payPrize(reloaded, mock.sender, { ...input, roundId: d, payee: third.payee }), { state: "no-prize", won: true, reason: "day-limit" });
  assert.equal(mock.signed.length, 2);
}

test("Firestore adapter: transaction retries, a restart, limits and saved sends", async () => {
  const { db, attempts } = fakeFirestore();
  const make = () => firestoreStore(db, { rules: [rules], now: () => epoch, rounds: "rounds", usage: "usage", wallet: "wallet" });
  await exercise(make(), make);
  assert.ok(attempts() > 20);
  assert.throws(() => firestoreStore(db, { rules: [rules], rounds: "same", usage: "same", wallet: "wallet" }), /different/);
});

test("Firestore adapter: an empty wallet releases counts and the wallet slot", async () => {
  const { db } = fakeFirestore();
  const store = firestoreStore(db, { rules: [rules], now: () => epoch, rounds: "rounds", usage: "usage", wallet: "wallet" });
  const a = await wonRound(store);
  const empty = await payPrize(store, { sign: async () => null, publish: async () => assert.fail("empty") }, { roundId: a, payee: player.payee, amountRaw: 1n, limits });
  assert.equal(empty.state, "no-prize");
  const b = await wonRound(store);
  assert.equal((await payPrize(store, mockSender().sender, { roundId: b, payee: player.payee, amountRaw: 1n, limits })).state, "paid");
});

test("Firestore adapter on an emulator only", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "set FIRESTORE_EMULATOR_HOST to run it" }, async () => {
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId: "demo-nano133-three" }, `three-${randomUUID()}`);
  const db = getFirestore(app);
  const tag = randomUUID();
  const make = () => firestoreStore(db, { rules: [rules], now: () => epoch, rounds: `rounds-${tag}`, usage: `usage-${tag}`, wallet: `wallet-${tag}` });
  try { await exercise(make(), make); } finally { await db.terminate(); await deleteApp(app); }
});
