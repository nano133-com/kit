import { createHash } from "node:crypto";
import { defineRules } from "../src/index.js";
import { memoryStore } from "../src/memory.js";
import { checkRound, startRound, type PrizeSender, type RoundStore, type SignedSend, type TrustedPlayer } from "../src/server.js";

export const rules = defineRules({
  version: "test:1", hz: 2, maxSteps: 3, maxInputs: 3,
  start: (seed: string) => ({ step: 0, score: seed === "bonus" ? 1 : 0 }),
  step: (s, pressed) => { s.step++; if (pressed) s.score++; },
  valid: () => true,
  done: (s) => s.step === 3 ? { won: s.score > 0, score: s.score } : null,
});
export const player: TrustedPlayer = { id: "test-player", payee: "mock-trusted-nano-address" };
export const limits = { perPlayerPerDay: 1, totalPerDay: 2 };
export const epoch = Date.UTC(2026, 9, 15, 12);
export const getRound = (store: RoundStore, id: string) => store.transaction((tx) => tx.getRound(id));

export function setup() {
  let now = epoch;
  const store = memoryStore({ rules: [rules], now: () => now });
  return { store, now: () => now, setNow: (value: number) => { now = value; } };
}

export async function wonRound(store: RoundStore, who = player) {
  const round = await startRound(store, { rulesVersion: rules.version, seed: "bonus", player: who });
  await checkRound(store, { roundId: round.roundId, inputs: [], now: store.now() + 1500 });
  return round.roundId;
}

// A fake signer with no key, no node and no money. Its strings are not real wallet data.
export function mockSender() {
  const signed: { roundId: string; payee: string; amountRaw: string }[] = [];
  const published: SignedSend[] = [];
  const ledger = new Map<string, SignedSend>();
  const sender: PrizeSender = {
    async sign(input) {
      signed.push({ ...input });
      return {
        hash: createHash("sha256").update(input.roundId).digest("hex"),
        block: {
          type: "state", account: "mock-prize-wallet", previous: "0".repeat(64), representative: "mock-representative",
          balance: "100", link: "1".repeat(64), signature: "f".repeat(128), work: "0".repeat(16),
        },
      };
    },
    async publish(send) {
      published.push(structuredClone(send));
      ledger.set(send.hash, structuredClone(send));
    },
  };
  return { sender, signed, published, ledger };
}
