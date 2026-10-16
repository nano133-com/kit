import { storeConfig } from "./config.js";
import type { Round, RoundStore, StoreOptions } from "./types.js";

/** Tests only. Transactions are serial and roll back on failure. A restart loses every record. */
export function memoryStore(options: StoreOptions): RoundStore {
  let rounds = new Map<string, Round>();
  let usage = new Map<string, number>();
  let active: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...storeConfig(options),
    transaction(body) {
      const run = tail.then(async () => {
        const nextRounds = structuredClone(rounds);
        const nextUsage = new Map(usage);
        let nextActive = active;
        const result = await body({
          getRound: async (id) => structuredClone(nextRounds.get(id) ?? null),
          createRound(round) {
            if (nextRounds.has(round.id)) throw new Error("round already exists");
            nextRounds.set(round.id, structuredClone(round));
          },
          setRound: (round) => { nextRounds.set(round.id, structuredClone(round)); },
          getUsage: async (key) => nextUsage.get(key) ?? 0,
          setUsage: (key, count) => { nextUsage.set(key, count); },
          getActivePrize: async () => nextActive,
          setActivePrize: (id) => { nextActive = id; },
        });
        rounds = nextRounds;
        usage = nextUsage;
        active = nextActive;
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
}
