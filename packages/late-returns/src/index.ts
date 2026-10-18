import { createHash } from "node:crypto";
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
// - at most `perRun` new returns per run and `perDay` per day;
// - with `perSenderPerDay` (off by default): at most that many returns per
//   sender per day. Later payments from that sender that day are kept: recorded
//   as "kept", marked used, not sent, until you release one (releaseKept).
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
  isClaimable: (p: { hash: string; amount: string; from: string; seenAt: number; to: string }) => Promise<boolean>;
  /**
   * More receiving addresses to scan beside the wallet's own `signer.address`
   * (for example one address per checkout). A list, or a function that returns
   * the list for this run. Needs `signerFor`. Default: only `signer.address`.
   * The limits (`perRun`, `perDay`, `perSenderPerDay`) count across ALL the
   * addresses together, not per address. The wallet's own address is scanned
   * first, then these in the order given.
   */
  addresses?: string[] | (() => string[] | Promise<string[]>);
  /**
   * The signer for one of the `addresses` (the package never sees a key).
   * Called with the address that received the payment, once per return.
   * Throw, or return null, for an address you can't sign for: its return waits.
   */
  signerFor?: (address: string) => Signer | null | Promise<Signer | null>;
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
   * Returns per sender per day (UTC). Off by default (no limit). When set, a
   * sender's later payments that day are kept: recorded with status "kept"
   * and reason "limit", marked used, never sent unless you call releaseKept().
   * Kept payments don't count toward `perDay`. Needs a store with
   * `senderLimit` (memoryStore and firestoreStore have it).
   */
  perSenderPerDay?: number;
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

/** The receiving addresses of a run: the wallet's own first, then `addresses` (no repeats). */
async function receivers(o: LateReturnOptions): Promise<string[]> {
  const out = [nanoPrefix(o.signer.address)];
  if (!o.addresses) return out;
  if (!o.signerFor) throw new Error("addresses needs signerFor");
  const list = typeof o.addresses === "function" ? await o.addresses() : o.addresses;
  for (const a of list) if (!out.includes(nanoPrefix(a))) out.push(nanoPrefix(a));
  return out;
}

/** The waiting payments of one address, and (optionally) its recent receives: hash → amount. */
async function candidates(o: LateReturnOptions, minRaw: bigint, address: string) {
  const out = new Map<string, string>();
  const waiting = await o.rpc<{ blocks: Record<string, { amount: string }> | "" }>({ action: "receivable", account: address, count: "50", threshold: minRaw.toString(), source: "true" });
  for (const [hash, v] of Object.entries(waiting.blocks || {})) out.set(hash.toUpperCase(), v.amount);
  if (o.includeReceived) {
    type H = { subtype?: string; type?: string; amount?: string; link?: string };
    const hist = await o.rpc<{ history: H[] | "" }>({ action: "account_history", account: address, count: "50", raw: "true" }).catch(() => ({ history: "" as const }));
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
  const addresses = await receivers(o);
  const never = new Set([...addresses, ...(o.never ?? [])].map(nanoPrefix));
  const day = { key: new Date(d.now).toISOString().slice(0, 10), max: d.perDay };
  const perSender = o.perSenderPerDay;
  if (perSender !== undefined && !o.store.senderLimit) throw new Error("perSenderPerDay needs a store with senderLimit (memoryStore and firestoreStore have it)");
  let made = 0;
  scan: for (const address of addresses) {
    // The first address (the wallet's own) must answer; a failing extra address is skipped so it can't block the others.
    const found = address === addresses[0] ? await candidates(o, d.minRaw, address) : await candidates(o, d.minRaw, address).catch(() => null);
    if (!found) continue;
    for (const [hash, amount] of found) {
      if (made >= d.perRun) break scan;
      if ((await o.store.get(hash)) || (await o.store.isUsed(hash))) continue;
      const info = await o.rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" }).catch(() => null);
      if (!info || info.confirmed !== "true" || (info.subtype ?? info.contents.subtype) !== "send") continue;
      if (nanoPrefix(info.contents.link_as_account ?? "") !== address || info.amount !== amount) continue;
      const from = nanoPrefix(info.block_account);
      if (never.has(from)) continue;
      const seenAt = Number(info.local_timestamp ?? 0) * 1000;
      if (!seenAt || d.now - seenAt < d.minAgeSec * 1000) continue;
      if (await o.isClaimable({ hash, amount, from, seenAt, to: address })) continue;
      const res = await o.store.record({ hash, amount, to: from, by: "auto" }, day, perSender === undefined ? undefined : { key: senderKey(day.key, from), max: perSender });
      if (res === "limit") break scan;
      if (res === "created") made++;
    }
  }
  return made;
}

/** A sender's counter for a day: the day and a hash of the address (the address itself is not stored in it). */
export const senderKey = (day: string, address: string) => `${day}-${createHash("sha256").update(nanoPrefix(address)).digest("hex").slice(0, 32)}`;

/**
 * Releases a kept payment: it goes back to its sender with the next run
 * (exactly once, like any return). The sender is read again from your node
 * (block_info), so this works even if your site replaced the stored address.
 * `by` records who released it. A payment that isn't kept is left alone.
 */
export async function releaseKept(o: Pick<LateReturnOptions, "rpc" | "store">, hash: string, by: string): Promise<"released" | "not-kept" | "missing"> {
  if (!o.store.release) throw new Error("this store can't release kept payments (it has no release())");
  const H = hash.toUpperCase();
  const r = await o.store.get(H);
  if (!r) return "missing";
  if (r.status !== "kept") return "not-kept";
  const info = await o.rpc<BlockInfo>({ action: "block_info", hash: H, json_block: "true" });
  return o.store.release(H, nanoPrefix(info.block_account), by);
}

/**
 * The signer for the address that received a payment. With no `addresses`
 * it is `o.signer`. Otherwise the receiving address is read from your node
 * (block_info), so a stored record needs no extra field: the wallet's own
 * address uses `o.signer`, any other asks `signerFor`.
 */
async function signerOf(o: LateReturnOptions, hash: string): Promise<Signer> {
  if (!o.addresses) return o.signer;
  const info = await o.rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" });
  const to = nanoPrefix(info.contents.link_as_account ?? "");
  if (to === nanoPrefix(o.signer.address)) return o.signer;
  const s = await o.signerFor!(to);
  if (!s || nanoPrefix(s.address) !== to) throw new Error("no signer for the receiving address");
  return s;
}

/** Sends the pending returns back, each exactly once. Returns how many it sent. Needs the lock. */
export async function settleReturns(o: LateReturnOptions, lock: ReturnType<ReturnStore["lock"]>): Promise<number> {
  const d = defaults(o);
  const { rpc } = o;
  let sent = 0;
  for (const job of await o.store.pending(d.perRun * 2)) {
    try {
      await lock.renew();
      const signer = await signerOf(o, job.hash);
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
