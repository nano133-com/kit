import type { BlockInfo, Rpc } from "./types.js";

// A checkout's payment must have been sent while that checkout could be paid.
// Its amount is unique only while it is reserved: from the checkout's start
// until its expiry plus its grace. Outside that window the same amount may
// belong to an older or a newer checkout, so a send only counts when the node
// first saw it inside the window.

/** How far a node's clock may be from yours: a block counts this long before the window opens and after it closes. */
export const CLOCK_SLACK_MS = 2 * 60_000;
export type PaymentWindow = { from: number; until: number };

/** Whether the node first saw the block inside the window (a block with no time is not trusted). */
export function inWindow(info: Pick<BlockInfo, "local_timestamp">, w: PaymentWindow) {
  const seen = Number(info.local_timestamp ?? 0) * 1000;
  return seen > 0 && seen >= w.from - CLOCK_SLACK_MS && seen <= w.until + CLOCK_SLACK_MS;
}

const notFound = (e: unknown) => /not found/i.test(String((e as Error)?.message ?? e));

/** The first receivable send of exactly `amount` to `to` that was sent inside the window (an older one is skipped). */
export async function findInWindow(rpc: Rpc, to: string, amount: string, w: PaymentWindow): Promise<{ hash: string; info: BlockInfo } | null> {
  const r = await rpc<{ blocks: Record<string, { amount: string }> | "" }>({ action: "receivable", account: to, count: "50", source: "true", threshold: amount });
  for (const [hash, v] of Object.entries(r.blocks || {})) {
    if (v.amount !== amount) continue;
    const info = await rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" }).catch((e) => (notFound(e) ? null : Promise.reject(e)));
    if (info && inWindow(info, w)) return { hash: hash.toUpperCase(), info };
  }
  return null;
}

export type PaymentCheck =
  | { state: "none" }
  | { state: "invalid" }
  | { state: "unknown" }
  | { state: "wrong" }
  | { state: "unconfirmed"; hash: string; info: BlockInfo }
  | { state: "paid"; hash: string; info: BlockInfo };

const prefix = (a = "") => a.replace(/^xrb_/, "nano_");

/**
 * A checkout's payment: the block the browser named (`hash`) or, without one,
 * a search; then a send of exactly `amount` to `to`, first seen inside the
 * window, and confirmed. Throws when the node doesn't answer (fail closed).
 */
export async function checkPayment(rpc: Rpc, o: { hash: string | null; to: string; amount: string; window: PaymentWindow }): Promise<PaymentCheck> {
  let hash = o.hash;
  let info: BlockInfo | null = null;
  if (!hash) {
    const found = await findInWindow(rpc, o.to, o.amount, o.window);
    if (!found) return { state: "none" };
    ({ hash, info } = found);
  }
  if (!/^[0-9A-F]{64}$/i.test(hash)) return { state: "invalid" };
  info ??= await rpc<BlockInfo>({ action: "block_info", hash, json_block: "true" }).catch((e) => (notFound(e) ? null : Promise.reject(e)));
  if (!info) return { state: "unknown" };
  const subtype = info.subtype ?? info.contents.subtype;
  if (subtype !== "send" || prefix(info.contents.link_as_account) !== prefix(o.to) || info.amount !== o.amount) return { state: "wrong" };
  if (!inWindow(info, o.window)) return { state: "none" };
  const H = hash.toUpperCase();
  return info.confirmed === "true" ? { state: "paid", hash: H, info } : { state: "unconfirmed", hash: H, info };
}
