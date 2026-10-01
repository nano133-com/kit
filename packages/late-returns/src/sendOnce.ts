import { publicKeyOf } from "./address.js";
import type { Lock, ReturnRecord, Rpc, SendIntent, Signer, StoreWriter } from "./types.js";

// Sending exactly once.
//
// A send is published first and recorded after in most code, so any gap
// between the two (an answer lost on its way back from the node, a stopped
// server, a run that outlived its lock) leaves the job looking unsent, and the
// next run sends it again. Here every send goes in two phases:
//
//   1. Sign the block and record { its hash, the frontier it builds on, the
//      block } on the job, while the run still holds the wallet's lock.
//   2. Publish it, then mark the job returned.
//
// A job that already has a recorded block is never sent anew until the ledger
// shows that block can't land: if it is on the ledger, the job is done; if not
// and the wallet's frontier hasn't moved, the same block is published again
// (it can only ever land once); only when the frontier moved without it is a
// new block made, after a look at what followed that frontier.

export type WalletState = { frontier: string; balance: bigint; representative: string };

async function onLedger(rpc: Rpc, hash: string) {
  try {
    await rpc({ action: "block_info", hash, json_block: "true" });
    return true;
  } catch (e) {
    if (/not found/i.test(String((e as Error).message))) return false;
    throw e;
  }
}

/** The send that followed `root` on the wallet's chain, if it went to `to` and left `balance`: an earlier run's send. */
async function successorSend(rpc: Rpc, account: string, root: string, to: string, balance: bigint): Promise<string | null> {
  type H = { hash: string; previous?: string; subtype?: string; type?: string; balance?: string; link?: string };
  const hist = await rpc<{ history: H[] | "" }>({ action: "account_history", account, count: "50", raw: "true" });
  const next = (hist.history || []).find((h) => (h.previous ?? "").toUpperCase() === root.toUpperCase());
  if (!next || (next.subtype ?? next.type) !== "send") return null;
  return (next.link ?? "").toUpperCase() === publicKeyOf(to) && BigInt(next.balance ?? "-1") === balance ? next.hash.toUpperCase() : null;
}

/**
 * Sends the job's amount back to its sender, at most once ever. `state` is the
 * wallet's state right now (read from the node). Returns the wallet's state
 * after the send.
 */
export async function sendOnce(o: {
  rpc: Rpc;
  signer: Signer;
  lock: Lock & StoreWriter;
  job: ReturnRecord;
  state: WalletState;
  work: (root: string) => Promise<string>;
  /** Tests only: called between recording the block and publishing it. */
  beforePublish?: () => void | Promise<void>;
}): Promise<WalletState> {
  const { rpc, signer, lock, job, state } = o;
  const amount = BigInt(job.amount);
  const done = (hash: string) => lock.update(job.hash, { status: "returned", returnHash: hash, error: null });
  const intent: SendIntent | null | undefined = job.send;

  if (intent) {
    if (await onLedger(rpc, intent.hash)) {
      await done(intent.hash);
      return state;
    }
    if (intent.root === state.frontier) {
      // Not there, and nothing was built on the wallet since: publish that same block again.
      await lock.renew();
      try {
        await rpc({ action: "process", json_block: "true", subtype: "send", block: intent.block });
      } catch (e) {
        // The node already has it after all ("Old block"): check again.
        if (!(await onLedger(rpc, intent.hash))) throw e;
      }
      await done(intent.hash);
      return { ...state, frontier: intent.hash, balance: BigInt(intent.block.balance) };
    }
    const ours = await successorSend(rpc, signer.address, intent.root, job.to, BigInt(intent.block.balance));
    if (ours) {
      await done(ours);
      return state;
    }
    // Nothing of ours follows that frontier: the recorded block can never be valid. Forget it.
    await lock.update(job.hash, { send: null });
  }

  if (state.balance < amount) throw new Error("not enough in the wallet for this send");
  const { block, hash } = await signer.send({ ...state, to: job.to, amount, work: await o.work(state.frontier) });
  // Phase 1: record the block before it exists anywhere else.
  await lock.update(job.hash, { send: { hash: hash.toUpperCase(), root: state.frontier, block } });
  await o.beforePublish?.();
  // Phase 2: publish, then mark it done. If either is lost, the next run finds the block by its hash.
  await lock.renew();
  const published = (await rpc<{ hash: string }>({ action: "process", json_block: "true", subtype: "send", block })).hash.toUpperCase();
  await done(published);
  return { ...state, frontier: published, balance: BigInt(block.balance) };
}
