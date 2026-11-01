// The payment scan (the game starter's src/worker/sweep.ts): one look at the creator's address settles every held order at once. It READS the ledger and
// writes only the store: no key, no send. (The starter calls it "sweep"; it moves no money, unlike @nano133/checkout's sweep.)
//
// A player's pay screen asks for it every 5 seconds, the admin page on "Check payments now", and a cron every 10 minutes (for a player who paid and closed
// the page). Node load stays flat however many players pay: the whole game makes at most one scan every SCAN_GAP_MS, and none when no order is held.

import { candidates, checkSend } from "./match.js";
import { rpc, type NanoNode, type RpcOptions } from "./nodes.js";
import { smallestAmount } from "./orders.js";
import type { ShopOrder, ShopStore } from "./store.js";

export const SCAN_GAP_MS = 4000;
/** The most entries one RPC read asks for. */
const COUNT = "50";

export type ScanResult = { scanned: boolean; settled: { id: string; status: string }[]; error?: string };

/** A confirmed send never changes: its answer is kept for an hour (in this copy of the server). */
const blockCache = new Map<string, { info: Record<string, any>; until: number }>();

async function blockInfo(nodes: readonly NanoNode[], hash: string, o: RpcOptions, now: number) {
  const hit = blockCache.get(hash);
  if (hit && hit.until > now) return hit.info;
  const { answer } = await rpc(nodes, { action: "block_info", hash, json_block: "true" }, o);
  if (answer && (answer.confirmed === "true" || answer.confirmed === true)) {
    if (blockCache.size > 500) blockCache.clear();
    blockCache.set(hash, { info: answer, until: now + 3_600_000 });
  }
  return answer;
}

export type ScanOptions = {
  /** The creator's address (a checked one: `payeeOf`). Null: no scan. */
  address: string | null;
  /** The nodes to ask (`nodesFor`). */
  nodes: readonly NanoNode[];
  /** The time now in ms (default Date.now()). */
  at?: number;
  rpc?: RpcOptions;
};

/** Scans the creator's address once and settles the held orders it pays. Fails closed: when the nodes cannot be read, nothing is credited. */
export async function scanPayments(store: ShopStore, opts: ScanOptions): Promise<ScanResult> {
  const now = opts.at ?? Date.now();
  const o: RpcOptions = opts.rpc ?? {};
  await store.tidy(now);
  const address = opts.address;
  if (!address) return { scanned: false, settled: [] };
  const held = await store.held();
  if (!held.length) return { scanned: false, settled: [] };
  if (!(await store.claimScan(now, SCAN_GAP_MS))) return { scanned: false, settled: [] };

  const settled: ScanResult["settled"] = [];
  try {
    // Only amounts a held order asks for: small sends ("dust") cannot push a payment out of the list.
    const threshold = smallestAmount(held)!;
    const receivable = await rpc(opts.nodes, { action: "receivable", account: address, count: COUNT, threshold, source: "true" }, o);
    // A new address has no history yet: the node answers "Account not found" (null here).
    const history = await rpc(opts.nodes, { action: "account_history", account: address, count: COUNT, raw: "true" }, o);
    const byAmount = new Map<string, ShopOrder>(held.map((h) => [h.amount, h]));
    const found = candidates(receivable.answer, history.answer, new Set(byAmount.keys()));
    if (!found.size) return { scanned: true, settled };

    // A payment that already paid (or was recorded for) an order never counts again.
    const used = await store.usedHashes([...found.keys()]);
    for (const [hash, amount] of found) {
      if (used.has(hash)) continue;
      const order = byAmount.get(amount);
      if (!order) continue;
      const info = await blockInfo(opts.nodes, hash, o, now);
      if (!info) continue;
      const verdict = checkSend(info, address, order.amount, order.createdAt);
      if (verdict.kind !== "paid") continue;
      const result = await store.settle(order, { hash, payer: verdict.payer, seenMs: verdict.seenMs }, now);
      if (result === "paid" || result === "paid_late") {
        settled.push({ id: order.id, status: result });
        byAmount.delete(amount);
      }
    }
    return { scanned: true, settled };
  } catch (e) {
    // Fail closed: nothing is credited when the nodes cannot be read. The next scan tries again.
    return { scanned: false, settled, error: e instanceof Error ? e.message : String(e) };
  }
}

/** For tests: forget the kept send blocks. */
export function forgetBlocks(): void {
  blockCache.clear();
}
