import { nanoPrefix } from "./address.js";
import { sendOnce } from "./sendOnce.js";
import { LockLost, type BlockInfo, type ReturnStore, type Rpc, type Signer } from "./types.js";

export * from "./types.js";
export { sendOnce } from "./sendOnce.js";
export { publicKeyOf } from "./address.js";

// Late Payment Return.
//
// A site that takes Nano payments gives each checkout a unique amount and
// matches the payment that arrives. A payment that matches nothing (it came
// after its checkout closed, or someone sent the wrong amount) would otherwise
// stay in the site's wallet. This package sends such a payment back to where
// it came from, exactly once, under these rules:
//
// - at least `minRaw` (default 0.001 XNO), confirmed, and first seen at least
//   `minAgeSec` ago (default 2 hours, longer than any checkout's grace);
// - the site hasn't used the payment (store.isUsed) and none of its open
//   checkouts can still claim the amount (isClaimable);
// - never one sent by an address in `never` (your own wallets, an admin who
//   tops the wallet up);
// - at most `perRun` new returns per run and `perDay` per day.
//
// Each return is recorded together with a "used" mark for the payment, so a
// late claim can't also take it. The wallet then receives exactly that
// payment and sends exactly its amount back (sendOnce), under a lock.

export type LateReturnOptions = {
  /** Calls your Nano node. Use your own node: its answers decide whether money moves. */
  rpc: Rpc;
  store: ReturnStore;
  /** Signs blocks for the wallet. The package never sees the key. */
  signer: Signer;
  /**
   * Whether one of your open checkouts (including its grace period for late
   * payments) can still claim this payment. Return true to leave it alone.
   */
  isClaimable: (p: { hash: string; amount: string; from: string; seenAt: number }) => Promise<boolean>;
  /** Senders whose payments never go back (your own wallets, an admin's top-ups). */
  never?: string[];
  /** The smallest payment that goes back, in raw. Default 10^27 (0.001 XNO). */
  minRaw?: bigint;
  /** How long a payment waits before it can go back, in seconds. Default 7200 (2 hours). */
  minAgeSec?: number;
  /** New returns per run. Default 3. */
  perRun?: number;
  /** New returns per day (UTC). Default 30. */
  perDay?: number;
  /**
   * Also look at the wallet's recent receives, not only its waiting payments.
   * Turn on if something else receives into this wallet (a payout run does).
   */
  includeReceived?: boolean;
  /** The wallet's lock time. Default 60 s; it is renewed before every send. */
  lockTtlMs?: number;
  /** Proof of work for a block root. Default: the node's work_generate. */
  work?: (root: string, kind: "send" | "receive") => Promise<string>;
  /** A representative for a wallet that isn't opened yet. Default: the first payment's sender's representative. */
  representative?: string;
  /** The current time, ms (tests). */
  now?: number;
  /** Tests only: called between recording a send and publishing it. */
  beforePublish?: () => void | Promise<void>;
};

const SEND_DIFFICULTY = "fffffff800000000";
const RECEIVE_DIFFICULTY = "fffffe0000000000";

const defaults = (o: LateReturnOptions) => ({
  minRaw: o.minRaw ?? 10n ** 27n,
  minAgeSec: o.minAgeSec ?? 7200,
  perRun: o.perRun ?? 3,
  perDay: o.perDay ?? 30,
  now: o.now ?? Date.now(),
  work:
    o.work ??
    (async (root: string, kind: "send" | "receive") =>
      (await o.rpc<{ work: string }>({ action: "work_generate", hash: root, difficulty: kind === "send" ? SEND_DIFFICULTY : RECEIVE_DIFFICULTY }, 30_000)).work),
});

/** The wallet's waiting payments, and (optionally) its recent receives: hash → amount. */
async function candidates(o: LateReturnOptions, minRaw: bigint) {
  const out = new Map<string, string>();
  const waiting = await o.rpc<{ blocks: Record<string, { amount: string }> | "" }>({ action: "receivable", account: o.signer.address, count: "50", threshold: minRaw.toString(), source: "true" });
  for (const [hash, v] of Object.entries(waiting.blocks || {})) out.set(hash.toUpperCase(), v.amount);
  if (o.includeReceived) {
    type H = { subtype?: string; type?: string; amount?: string; link?: string };
    const hist = await o.rpc<{ history: H[] | "" }>({ action: "account_history", account: o.signer.address, count: "50", raw: "true" }).catch(() => ({ history: "" as const }));
    for (const h of hist.history || []) {
      // In raw history, a receive's link is the send it received.
      if ((h.subtype ?? h.type) === "receive" && h.link && /^\d+$/.test(h.amount ?? "") && BigInt(h.amount!) >= minRaw) out.set(h.link.toUpperCase(), h.amount!);
    }
  }
  return out;
}

/** Finds late payments and records their returns (it sends nothing). Returns how many it recorded. */
export async function findLateReturns(o: LateReturnOptions): Promise<number> {
  const d = defaults(o);
  const never = new Set([o.signer.address, ...(o.never ?? [])].map(nanoPrefix));
  const day = { key: new Date(d.now).toISOString().slice(0, 10), max: d.perDay };
  let made = 0;
  for (const [hash, amount] of await candidates(o, d.minRaw)) {
    if (made >= d.perRun) break;
    if ((await o.store.get(hash)) || (await o.store.isUsed(hash))) continue;
    const info = await o.rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" }).catch(() => null);
    if (!info || info.confirmed !== "true" || (info.subtype ?? info.contents.subtype) !== "send") continue;
    if (nanoPrefix(info.contents.link_as_account ?? "") !== nanoPrefix(o.signer.address) || info.amount !== amount) continue;
    const from = nanoPrefix(info.block_account);
    if (never.has(from)) continue;
    const seenAt = Number(info.local_timestamp ?? 0) * 1000;
    if (!seenAt || d.now - seenAt < d.minAgeSec * 1000) continue;
    if (await o.isClaimable({ hash, amount, from, seenAt })) continue;
    const res = await o.store.record({ hash, amount, to: from, by: "auto" }, day);
    if (res === "limit") break;
    if (res === "created") made++;
  }
  return made;
}

/** Sends the pending returns back, each exactly once. Returns how many it sent. Needs the lock. */
export async function settleReturns(o: LateReturnOptions, lock: ReturnType<ReturnStore["lock"]>): Promise<number> {
  const d = defaults(o);
  const { rpc, signer } = o;
  let sent = 0;
  for (const job of await o.store.pending(d.perRun * 2)) {
    try {
      await lock.renew();
      type Info = { frontier?: string; balance?: string; representative?: string };
      const info: Info = await rpc<Info>({ action: "account_info", account: signer.address, representative: "true" }).catch((e: Error) =>
        /not found/i.test(e.message) ? ({} as Info) : Promise.reject(e),
      );
      let frontier = info.frontier ?? null;
      let balance = BigInt(info.balance ?? "0");
      let rep = info.representative ?? o.representative ?? null;
      // Receive this job's own payment first, by its hash: a return is never sent until its payment is in the wallet.
      if (!job.recv) {
        rep ??= (await rpc<{ representative?: string }>({ action: "account_info", account: job.to, representative: "true" }).catch(() => null))?.representative ?? job.to;
        const { block } = await signer.receive({ frontier, balance, representative: rep, source: job.hash, amount: BigInt(job.amount), work: await d.work(frontier ?? signer.publicKey, "receive") });
        let recv: string;
        try {
          await lock.renew();
          recv = (await rpc<{ hash: string }>({ action: "process", json_block: "true", subtype: frontier ? "receive" : "open", block })).hash;
          frontier = recv;
          balance += BigInt(job.amount);
        } catch (e) {
          // "Unreceivable": something received it earlier (a payout run, or an earlier run whose record was lost).
          if (!/unreceivable/i.test(String((e as Error).message))) throw e;
          recv = "earlier";
        }
        await lock.update(job.hash, { recv });
        job.recv = recv;
      }
      if (!frontier) throw new Error("the payment isn't in the wallet");
      await sendOnce({ rpc, signer, lock, job, state: { frontier, balance, representative: rep! }, work: (root) => d.work(root, "send"), beforePublish: o.beforePublish });
      sent++;
    } catch (e) {
      // Lost the lock: stop at once; whoever holds it now carries on.
      if (e instanceof LockLost) break;
      // Leave it pending; the next run checks the ledger before it sends anything.
      await lock.update(job.hash, { error: String((e as Error).message ?? e).slice(0, 200), tries: (job.tries ?? 0) + 1 }).catch(() => undefined);
    }
  }
  return sent;
}

/**
 * One run: takes the wallet's lock, records new returns, sends the pending
 * ones, and releases the lock. Call it every few minutes (a cron job, or a
 * page load with your own throttle). Returns false when another run holds the lock.
 */
export async function runLateReturns(o: LateReturnOptions): Promise<{ ran: boolean; recorded: number; sent: number }> {
  const lock = o.store.lock(o.lockTtlMs ?? 60_000);
  if (!(await lock.take())) return { ran: false, recorded: 0, sent: 0 };
  try {
    const recorded = await findLateReturns(o).catch(() => 0);
    const sent = await settleReturns(o, lock);
    return { ran: true, recorded, sent };
  } finally {
    await lock.release();
  }
}
