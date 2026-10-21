import { randomBytes } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { DEFAULT_SEED_LABEL, checkLabel, checkSecret, derivedSigner, sameAccount } from "./derivedKeys.js";
import { SweepLeaseLost, type BlockInfo, type Checkout, type DerivedStore, type Rpc, type SweepIntent, type SweepPatch } from "./types.js";

// The sweep of a derived address: it moves what a paid checkout received on to YOUR address.
//
// A claim marks the checkout paid and stores the block it took (`hash`) and the quote (`amount`). A sweep then, for one
// paid checkout:
//   1. checks that the record is whole: its index gives its address, and the stored block is what the record says;
//   2. asks the node what that block is, and stops unless it is a CONFIRMED SEND to THIS address of THIS amount;
//   3. RECEIVES that one block with the address's own key (not "everything waiting": a wrong amount that waits there
//      belongs to Late Payment Return, which sends it back in full);
//   4. SENDS exactly the quote to `destination`, once: the block is recorded on the checkout BEFORE it is published,
//      so a crash or a second run finds it instead of sending again;
//   5. marks the checkout swept, and the send used, in one atomic step.
//
// `destination` is a value in YOUR code. It is never read from a checkout, a request or a database: a record, a bug or
// an attacker cannot make this code send anywhere else. The key exists only inside this function (inside a
// derivedSigner's closure) and is never logged or stored. This file writes no log line at all.

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const SEND_DIFFICULTY = "fffffff800000000";
const RECEIVE_DIFFICULTY = "fffffe0000000000";

export type SweepOptions = {
  rpc: Rpc;
  store: DerivedStore;
  /** The secret the addresses come from (the same one createDerivedCheckout used). */
  secret: string;
  /** The same label as createDerivedCheckout's. Default DEFAULT_SEED_LABEL. */
  label?: string;
  /**
   * Where the money goes: YOUR address, written as a fixed value in your code (or read from your own deploy settings).
   * Never take it from a checkout record, from a request or from a database row that a visitor can change.
   */
  destination: string;
  /** Proof of work for a block root. Default: the node's `work_generate` (your node must allow it). */
  work?: (root: string, kind: "send" | "receive") => Promise<string>;
  /** The representative of an address that is not opened yet. Default: the payer's representative. */
  representative?: string;
  /** How long one run keeps a checkout: default 60 s, renewed before every step that moves money. */
  leaseMs?: number;
  /** The current time, ms (tests). */
  now?: () => number;
  /** Tests only: called between recording the send and publishing it. */
  beforePublish?: () => void | Promise<void>;
};

/** "swept": this run moved it on. "already": an earlier run did. "waiting": the checkout is not paid. "busy": another run works on it. "unknown": no such checkout. */
export type SweepOutcome = "swept" | "already" | "waiting" | "busy" | "unknown";

const notFound = (e: unknown) => /not found/i.test(String((e as Error)?.message ?? e));

async function onLedger(rpc: Rpc, hash: string) {
  try {
    await rpc({ action: "block_info", hash, json_block: "true" });
    return true;
  } catch (e) {
    if (notFound(e)) return false;
    throw e;
  }
}

/** The send that followed `root` on the address's chain, if it went to `to` and left `balance`: an earlier run's send. */
async function successorSend(rpc: Rpc, account: string, root: string, to: string, balance: bigint): Promise<string | null> {
  type H = { hash: string; previous?: string; subtype?: string; type?: string; balance?: string; link?: string };
  const hist = await rpc<{ history: H[] | "" }>({ action: "account_history", account, count: "50", raw: "true" });
  const next = (hist.history || []).find((h) => (h.previous ?? "").toUpperCase() === root.toUpperCase());
  if (!next || (next.subtype ?? next.type) !== "send") return null;
  return (next.link ?? "").toUpperCase() === nanoWeb.tools.addressToPublicKey(to).toUpperCase() && BigInt(next.balance ?? "-1") === balance ? next.hash.toUpperCase() : null;
}

/**
 * Sweeps one paid checkout. Safe to run twice, or at the same time from two processes: a lease on the checkout lets one
 * run work, every write proves the lease is still held, and the send is recorded before it is published. A run that
 * fails leaves the checkout due: the next run checks the ledger before it sends anything.
 *
 * Throws, and moves nothing, when the record is not whole (its index does not give its address) or the stored block is
 * not a confirmed send of the quote to the address. Throws when the node does not answer.
 */
export async function sweepCheckout(o: SweepOptions, id: string): Promise<SweepOutcome> {
  checkSecret(o.secret);
  const label = o.label ?? DEFAULT_SEED_LABEL;
  checkLabel(label);
  if (typeof o.destination !== "string" || !nanoWeb.tools.validateAddress(o.destination)) throw new Error("destination is not a valid Nano address");
  const clock = () => o.now?.() ?? Date.now();
  const leaseMs = o.leaseMs ?? 60_000;

  const first = await o.store.get(id);
  if (!first) return "unknown";
  if (first.index === undefined) throw new Error("this is not a derived checkout");
  if (first.sweep?.status === "done") return "already";
  if (first.status !== "paid" || first.sweep?.status !== "due") return "waiting";
  const hash = String(first.hash ?? "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hash) || !/^\d+$/.test(first.amount) || BigInt(first.amount) <= 0n) throw new Error("the record has no valid paid block");
  // The key for this index. It must be the key of this address, or nothing moves.
  const signer = derivedSigner(o.secret, first.index, label);
  if (!sameAccount(signer.address, first.to)) throw new Error("the record's index does not give its address");
  if (sameAccount(signer.address, o.destination)) throw new Error("destination is the address being swept");

  const owner = randomBytes(8).toString("hex");
  if (!(await o.store.claimSweep(id, owner, clock(), leaseMs))) return "busy";
  // Every write proves the lease is still held (SweepLeaseLost otherwise) and renews it.
  const write = (patch: SweepPatch) => o.store.patchSweep(id, owner, patch, clock(), leaseMs);
  const amount = BigInt(first.amount);
  const toKey = nanoWeb.tools.addressToPublicKey(o.destination).toUpperCase();
  const work =
    o.work ?? (async (root: string, kind: "send" | "receive") => (await o.rpc<{ work: string }>({ action: "work_generate", hash: root, difficulty: kind === "send" ? SEND_DIFFICULTY : RECEIVE_DIFFICULTY }, 25_000)).work);
  try {
    // 1. The paid block is what the record says: confirmed, a send, to this address, of this amount.
    const block = await o.rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" });
    if (block.confirmed !== "true" || (block.subtype ?? block.contents.subtype) !== "send" || !sameAccount(block.contents.link_as_account ?? "", first.to) || block.amount !== first.amount) {
      throw new Error("the paid block is not a confirmed send of the quote to this address");
    }

    // 2. The address's state, read from the ledger BEFORE the checkout's record: a send that is on the ledger always has
    //    its record written first, so a run that sees the send on the ledger also sees its record.
    type Info = { frontier?: string; balance?: string; representative?: string };
    const info: Info = await o.rpc<Info>({ action: "account_info", account: signer.address, representative: "true" }).catch((e: Error) => (notFound(e) ? ({} as Info) : Promise.reject(e)));
    let frontier = info.frontier ?? null;
    let balance = BigInt(info.balance ?? "0");
    let rep = info.representative ?? null;
    const rec = await o.store.get(id);
    if (!rec || rec.sweep?.status === "done") return "already";
    // The record must still be the one that was checked.
    if (rec.index !== first.index || !sameAccount(rec.to, first.to) || rec.amount !== first.amount || String(rec.hash ?? "").toUpperCase() !== hash) throw new Error("the record changed while it was swept");
    const state = rec.sweep!;

    // 3. Receive that one block (once: "unreceivable" means an earlier run did, and the balance has it).
    if (!state.recv) {
      rep ??= o.representative ?? (await o.rpc<{ representative?: string }>({ action: "account_info", account: block.block_account, representative: "true" }).catch(() => null))?.representative ?? block.block_account;
      const { block: recvBlock } = await signer.receive({ frontier, balance, representative: rep, source: hash, amount, work: await work(frontier ?? signer.publicKey, "receive") });
      let recv: string;
      try {
        await write({});
        recv = (await o.rpc<{ hash: string }>({ action: "process", json_block: "true", subtype: frontier ? "receive" : "open", block: recvBlock })).hash.toUpperCase();
        frontier = recv;
        balance += amount;
      } catch (e) {
        if (e instanceof SweepLeaseLost || !/unreceivable/i.test(String((e as Error)?.message ?? e))) throw e;
        recv = "earlier";
      }
      await write({ recv });
    }
    if (!frontier) throw new Error("the payment is not in the address");

    // 4. Send exactly the quote to `destination`, once.
    const finish = async (sendHash: string): Promise<SweepOutcome> => {
      await o.store.finishSweep(id, owner, sendHash, clock());
      return "swept";
    };
    /** Whether `h` is on the ledger: it must then be a send of the quote from this address to the destination. */
    const ours = async (h: string) => {
      const b = await o.rpc<BlockInfo>({ action: "block_info", hash: h, json_block: "true" }).catch((e) => (notFound(e) ? null : Promise.reject(e)));
      if (!b) return false;
      if (!sameAccount(b.block_account, signer.address) || (b.subtype ?? b.contents.subtype) !== "send" || !sameAccount(b.contents.link_as_account ?? "", o.destination) || b.amount !== first.amount) {
        throw new Error("the recorded send is not this sweep's send");
      }
      return true;
    };
    const intent: SweepIntent | null = state.send ?? null;
    if (intent) {
      // An earlier run made this send. Is it on the ledger?
      if (await ours(intent.hash)) return await finish(intent.hash);
      const same = intent.root.toUpperCase() === frontier.toUpperCase();
      // Publish that same block again only if it is exactly this send: from this address, to this destination, the quote.
      const sound =
        same &&
        sameAccount(intent.block.account, signer.address) &&
        intent.block.previous.toUpperCase() === frontier.toUpperCase() &&
        intent.block.link.toUpperCase() === toKey &&
        balance - BigInt(intent.block.balance) === amount;
      if (sound) {
        await write({});
        try {
          await o.rpc<{ hash: string }>({ action: "process", json_block: "true", subtype: "send", block: intent.block });
        } catch (e) {
          // The node already has it after all ("Old block"): check again.
          if (e instanceof SweepLeaseLost || !(await ours(intent.hash))) throw e;
        }
        return await finish(intent.hash);
      }
      // The frontier moved and the ledger doesn't know that hash. Before trusting that, look at what came right after
      // the recorded frontier: if it is a send of this amount to this address, it is ours.
      const found = await successorSend(o.rpc, signer.address, intent.root, o.destination, BigInt(intent.block.balance));
      if (found) return await finish(found);
      // Nothing of ours follows it: that block can never be valid (or it is not this send). Forget it and make a new one.
      await write({ send: null });
    }
    if (balance < amount) throw new Error("not enough in the address for this send");
    const { block: sendBlock, hash: sendHash } = await signer.send({ frontier, balance, representative: rep ?? block.block_account, to: o.destination, amount, work: await work(frontier, "send") });
    // Phase 1: record the block before it exists anywhere else.
    await write({ send: { hash: sendHash.toUpperCase(), root: frontier, block: sendBlock } });
    await o.beforePublish?.();
    // Phase 2: publish, then mark it done. If either is lost, the next run finds the block by its hash.
    await write({});
    const published = (await o.rpc<{ hash: string }>({ action: "process", json_block: "true", subtype: "send", block: sendBlock })).hash.toUpperCase();
    // The node took our signed block: its hash is the truth (ours should match).
    return await finish(published);
  } catch (e) {
    // Lost the lease: someone else works on it now, and every write here is refused. Any other failure is written down.
    if (!(e instanceof SweepLeaseLost)) {
      const tries = ((await o.store.get(id).catch(() => null))?.sweep?.tries ?? 0) + 1;
      await write({ error: String((e as Error)?.message ?? e).slice(0, 200), tries }).catch(() => undefined);
    }
    throw e;
  } finally {
    await o.store.releaseSweep(id, owner).catch(() => undefined);
  }
}

/**
 * Sweeps up to `max` (default 10) paid checkouts whose sweep is due: call it from a timer. A checkout that failed before
 * is tried after the ones that did not, so a few bad records never hide the others. Returns how many it moved on, how
 * many another run held, and each failure (the checkout's id and the error text: never a key, a seed or an address).
 */
export async function sweepPaid(o: SweepOptions, p: { max?: number } = {}): Promise<{ swept: number; busy: number; failed: { id: string; error: string }[] }> {
  const max = p.max ?? 10;
  const due = (await o.store.unswept(max * 5)).sort((a: Checkout, b: Checkout) => (a.sweep?.tries ?? 0) - (b.sweep?.tries ?? 0)).slice(0, max);
  const out = { swept: 0, busy: 0, failed: [] as { id: string; error: string }[] };
  for (const c of due) {
    try {
      const r = await sweepCheckout(o, c.id);
      if (r === "swept") out.swept++;
      else if (r === "busy") out.busy++;
    } catch (e) {
      out.failed.push({ id: c.id, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return out;
}
