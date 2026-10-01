import { settleReturns, type ReturnStore, type Rpc, type Signer } from "@nano133/late-returns";

// Sending sign-in amounts back.
//
// A store set up with `returns` records each sign-in's return (pending) in the
// same step that signs the visitor in. This sends the pending returns, each
// exactly once, through @nano133/late-returns: the wallet receives the
// payment, then sends its amount back to the account that signed in.
//
// It needs the sign-in wallet's key on your server (a hot wallet: keep it
// nearly empty). It refuses to run against the Firestore emulator, so a test
// database can never move real money.

export type RefundOptions = {
  /** Your own node. */
  rpc: Rpc;
  /** Signs blocks for the sign-in wallet. */
  signer: Signer;
  /**
   * @nano133/late-returns' store for the sign-in wallet, on the same `returns`
   * collection as the sign-in store, with the sign-in payments collection in `used`.
   */
  store: ReturnStore;
  /** Returns per run. Default 10. */
  perRun?: number;
  work?: (root: string, kind: "send" | "receive") => Promise<string>;
  /** Tests with a mock ledger only: allow a run while FIRESTORE_EMULATOR_HOST is set. Works only with NODE_ENV=test. */
  mockLedger?: boolean;
};

/** One run: under the wallet's lock, sends pending sign-in returns back. Returns how many it sent. */
export async function settleSigninRefunds(o: RefundOptions): Promise<number> {
  if (o.mockLedger && process.env.NODE_ENV !== "test") throw new Error("refusing to send money: mockLedger is for tests only (NODE_ENV=test)");
  if (process.env.FIRESTORE_EMULATOR_HOST && !o.mockLedger) throw new Error("refusing to send money: FIRESTORE_EMULATOR_HOST is set");
  if (!(await o.store.pending(1)).length) return 0;
  const lock = o.store.lock(60_000);
  if (!(await lock.take())) return 0;
  try {
    return await settleReturns({ rpc: o.rpc, signer: o.signer, store: o.store, isClaimable: async () => true, perRun: Math.ceil((o.perRun ?? 10) / 2), work: o.work }, lock);
  } finally {
    await lock.release();
  }
}
