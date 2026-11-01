// The rules that decide whether a payment arrived (the game starter's src/worker/match.ts, moved here unchanged). No network and no database here, so
// they are easy to test alone. DO NOT LOOSEN THEM: they are what stops a look from being given away.
//
// A payment to the creator's address is in one of two places: still receivable (no wallet took it yet), or
// received (the creator's wallet took it, and it shows in the address's history). Both are searched for the
// exact amount of a held order. A hit is only a candidate: the send block itself is then read, and it counts
// only when it is a confirmed send of exactly that amount to exactly that address, first seen by the node
// after the order was made.

/** Allowed difference between the Worker's clock and the node's clock. */
export const CLOCK_SLACK_MS = 120_000;

const HASH = /^[0-9A-F]{64}$/i;

const nanoPrefix = (a: unknown) => (typeof a === "string" ? a.replace(/^xrb_/, "nano_") : "");

/**
 * The send hashes in a scan that carry one of `amounts` exactly, with their amount.
 * `receivable`: the node's answer to `receivable` (source: true, or not). `history`: to `account_history` (raw).
 */
export function candidates(receivable: unknown, history: unknown, amounts: Set<string>): Map<string, string> {
  const found = new Map<string, string>();
  const blocks = (receivable as { blocks?: unknown } | null)?.blocks;
  if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
    for (const [hash, entry] of Object.entries(blocks as Record<string, unknown>)) {
      const amount = typeof entry === "string" ? entry : (entry as { amount?: unknown } | null)?.amount;
      if (HASH.test(hash) && typeof amount === "string" && amounts.has(amount)) found.set(hash.toUpperCase(), amount);
    }
  }
  const list = (history as { history?: unknown } | null)?.history;
  if (Array.isArray(list)) {
    for (const h of list as Record<string, unknown>[]) {
      const kind = h?.subtype ?? h?.type;
      if (kind !== "receive" && kind !== "open") continue;
      // In a raw history, a receive's `link` is the hash of the send it received.
      if (typeof h.amount === "string" && typeof h.link === "string" && HASH.test(h.link) && amounts.has(h.amount)) found.set(h.link.toUpperCase(), h.amount);
    }
  }
  return found;
}

export type Verdict =
  | { kind: "paid"; payer: string; seenMs: number }
  | { kind: "pending" } // the right send, not confirmed yet
  | { kind: "early" } // sent before the order, or the node keeps no time for it
  | { kind: "wrong" }; // not this payment

/**
 * Whether a send block (the node's `block_info` answer, json_block: true) pays `amount` to `address`, and
 * was first seen at or after `notBeforeMs` (the order's start, less the clock allowance).
 */
export function checkSend(info: unknown, address: string, amount: string, notBeforeMs: number): Verdict {
  const i = (info ?? {}) as Record<string, any>;
  const contents = (i.contents ?? {}) as Record<string, unknown>;
  const subtype = i.subtype ?? contents.subtype;
  if (subtype !== "send" || nanoPrefix(contents.link_as_account) !== address || i.amount !== amount) return { kind: "wrong" };
  // The node's own time for the send, in seconds. A block with no time cannot be shown to be newer than
  // the order, so it never counts.
  const seenMs = Number(i.local_timestamp) * 1000;
  if (!Number.isFinite(seenMs) || seenMs <= 0 || seenMs < notBeforeMs - CLOCK_SLACK_MS) return { kind: "early" };
  if (i.confirmed !== "true" && i.confirmed !== true) return { kind: "pending" };
  return { kind: "paid", payer: nanoPrefix(i.block_account), seenMs };
}
