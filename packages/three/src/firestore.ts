import type { Firestore } from "firebase-admin/firestore";
import { storeConfig } from "./config.js";
import type { Round, RoundStore, StoreOptions } from "./types.js";

/** Use the same collections for every process that uses one prize wallet. Do not delete unpaid records. */
export function firestoreStore(db: Firestore, options: StoreOptions & { rounds: string; usage: string; wallet: string }): RoundStore {
  if (new Set([options.rounds, options.usage, options.wallet]).size !== 3) throw new Error("store collections must be different");
  const rounds = db.collection(options.rounds);
  const usage = db.collection(options.usage);
  const wallet = db.collection(options.wallet).doc("active");
  return {
    ...storeConfig(options),
    transaction: (body) => db.runTransaction((tx) => body({
      getRound: async (id) => ((await tx.get(rounds.doc(id))).data() as Round | undefined) ?? null,
      createRound: (round) => { tx.create(rounds.doc(round.id), round); },
      setRound: (round) => { tx.set(rounds.doc(round.id), round); },
      getUsage: async (key) => ((await tx.get(usage.doc(key))).data()?.count as number | undefined) ?? 0,
      setUsage: (key, count) => { tx.set(usage.doc(key), { count }); },
      getActivePrize: async () => ((await tx.get(wallet)).data()?.roundId as string | null | undefined) ?? null,
      setActivePrize: (roundId) => { tx.set(wallet, { roundId }); },
    })),
  };
}
