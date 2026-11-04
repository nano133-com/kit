// The unmatched payments (the admin's "Unmatched payments" card): the receives on the creator's address that no order recorded. The scan matches a
// payment only to a held order of exactly its amount, first seen after that order was made (./scan.ts), so some payments match nothing: a second
// payment of an amount after its order was paid (the first one freed the amount), a wrong amount, a payment to the address with no order. They sit in
// the creator's wallet and nothing else lists them. The kit holds no key and sends nothing back: this list is for the creator, who checks each one and
// decides.
//
// It only READS, like the scan: ONE account_history call on the game's own nodes (`nodesFor`; no other server is asked), and the store's `usedHashes`
// and `held`. It fails closed: when no node answers, or a node answers with something that is not this address's history, the answer is "not read" and
// lists nothing, never an empty list that looks true.
//
// The bounds, so the creator's other income is not listed as money to send back: the newest UNMATCHED_ENTRIES entries of the address's history; only
// receives the node saw at or after the shop's oldest order (less the clock allowance; a receive the node keeps no time for is left out); none smaller
// than one step of a clean amount (0.0001 XNO: dust, which no order can ask for). A receive whose amount a held order still holds is not listed either:
// the payment check decides it (it is counted in `waiting`).

import { xnoText } from "../admin/amount.js";
import { STEP_RAW } from "./amount.js";
import { CLOCK_SLACK_MS } from "./match.js";
import { rpc, type NanoNode, type RpcOptions } from "./nodes.js";
import type { ShopStore } from "./store.js";

/** How many entries of the address's history one check reads, newest first. */
export const UNMATCHED_ENTRIES = 200;

/** One receive that no order recorded. */
export type UnmatchedPayment = {
  /** The hash of the payer's send block: what an order records when a payment matches it. */
  hash: string;
  /** The address it came from (where to send it back), or null when the node did not say. */
  sender: string | null;
  /** The amount in raw (digits). */
  amountRaw: string;
  /** The same amount in XNO, every significant digit: "0.2512". */
  xno: string;
  /** When the node saw the receive, in ms. */
  at: number;
  /** A send of the same amount from the address to `sender` came after it (in the entries read): it looks sent back already. */
  sentBack: boolean;
};

/**
 * What a check found. `read: false`: the address could not be read, and nothing is listed. Else the payments, newest first; `since`: the oldest order's
 * time that bounds the list (null: the shop has no order yet, and nothing was read); `entries`: how many entries of the history were read; `more`: the
 * history goes on past them and the read did not reach `since`, so an older payment may not be listed; `waiting`: receives whose amount a held order
 * holds (the payment check decides them).
 */
export type UnmatchedResult =
  | { read: true; payments: UnmatchedPayment[]; since: number | null; entries: number; more: boolean; waiting: number }
  | { read: false; error: string };

export type UnmatchedOptions = {
  /** The creator's address (a checked one: `payeeOf`). Null: nothing can be read. */
  address: string | null;
  /** The nodes to ask (`nodesFor`): the same as the scan's. */
  nodes: readonly NanoNode[];
  /** The time of the shop's oldest order in ms, or null when it has none (the admin handler gives it). */
  since: number | null;
  rpc?: RpcOptions;
};

const HASH = /^[0-9A-F]{64}$/i;
const ADDRESS = /^(?:nano|xrb)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
const RAW = /^[0-9]{1,39}$/;
const nanoPrefix = (a: string) => a.replace(/^xrb_/, "nano_");
/** How many hashes go to one `usedHashes` call (a D1 statement has a limit of bound values). */
const HASH_CHUNK = 50;

/** Reads the creator's address once and lists the receives that no order recorded (see the top of this file). Never throws. */
export async function findUnmatched(store: Pick<ShopStore, "usedHashes" | "held">, opts: UnmatchedOptions): Promise<UnmatchedResult> {
  const address = opts.address;
  if (!address) return { read: false, error: "The game has no receive address." };
  if (opts.since === null || !Number.isFinite(opts.since)) return { read: true, payments: [], since: null, entries: 0, more: false, waiting: 0 };
  const since = opts.since;
  try {
    const { answer } = await rpc(opts.nodes, { action: "account_history", account: address, count: String(UNMATCHED_ENTRIES), raw: "true" }, opts.rpc ?? {});
    // A new address has no history yet: the node answers "Account not found" (null here).
    if (answer === null) return { read: true, payments: [], since, entries: 0, more: false, waiting: 0 };
    if (answer.account !== undefined && (typeof answer.account !== "string" || nanoPrefix(answer.account) !== address)) throw new Error("the node answered for another address");
    // An account with no entries: some nodes give "" for the list.
    const all: unknown = answer.history === "" ? [] : answer.history;
    if (!Array.isArray(all)) throw new Error("the node's answer is not a history");
    // A node that gives more than was asked for is read only as far as the bound.
    const list: unknown[] = all.slice(0, UNMATCHED_ENTRIES);

    const floor = since - CLOCK_SLACK_MS;
    type Receive = { index: number; hash: string; sender: string | null; amountRaw: string; at: number };
    const receives: Receive[] = [];
    const sends: { index: number; to: string; amountRaw: string }[] = [];
    let reached = false;
    for (let index = 0; index < list.length; index++) {
      const e = list[index] as Record<string, unknown> | null;
      if (!e || typeof e !== "object") continue;
      const kind = e.subtype ?? e.type;
      const at = Number(e.local_timestamp) * 1000;
      const timed = Number.isFinite(at) && at > 0;
      // The history is newest first: the first entry older than the shop ends the read.
      if (timed && at < floor) {
        reached = true;
        break;
      }
      const amountRaw = typeof e.amount === "string" && RAW.test(e.amount) ? e.amount : null;
      // In a history, a send's `account` is where it went, and a receive's is where it came from.
      const other = typeof e.account === "string" && ADDRESS.test(e.account) ? nanoPrefix(e.account) : null;
      if (kind === "send") {
        if (amountRaw && other) sends.push({ index, to: other, amountRaw });
        continue;
      }
      if (kind !== "receive" && kind !== "open") continue;
      if (!timed || e.confirmed === false || e.confirmed === "false") continue;
      // In a raw history, a receive's `link` is the hash of the send it received (`source` in an old, pre-state block).
      const link = typeof e.link === "string" ? e.link : e.source;
      if (typeof link !== "string" || !HASH.test(link) || !amountRaw || BigInt(amountRaw) < STEP_RAW) continue;
      receives.push({ index, hash: link.toUpperCase(), sender: other, amountRaw, at });
    }

    // A payment that paid (or was recorded for) an order is matched: paid, or paid late.
    const known = new Set<string>();
    for (let i = 0; i < receives.length; i += HASH_CHUNK) {
      for (const h of await store.usedHashes(receives.slice(i, i + HASH_CHUNK).map((r) => r.hash))) known.add(String(h).toUpperCase());
    }
    const held = receives.length ? await store.held() : [];
    let waiting = 0;
    const open: Receive[] = [];
    for (const r of receives) {
      if (known.has(r.hash)) continue;
      if (held.some((o) => o.amount === r.amountRaw && r.at >= o.createdAt - CLOCK_SLACK_MS)) waiting++;
      else open.push(r);
    }

    // A send back by hand: the first send after the receive, of the same amount, to the address it came from. One send answers one receive.
    const paired = new Set<number>();
    const back = new Set<number>();
    for (const r of [...open].reverse()) {
      if (!r.sender) continue;
      let best = -1;
      for (const s of sends) if (s.index < r.index && s.to === r.sender && s.amountRaw === r.amountRaw && !paired.has(s.index) && s.index > best) best = s.index;
      if (best >= 0) {
        paired.add(best);
        back.add(r.index);
      }
    }

    const more = !reached && (all.length >= UNMATCHED_ENTRIES || (typeof answer.previous === "string" && answer.previous !== ""));
    const payments = open.map((r): UnmatchedPayment => ({ hash: r.hash, sender: r.sender, amountRaw: r.amountRaw, xno: xnoText(r.amountRaw), at: r.at, sentBack: back.has(r.index) }));
    return { read: true, payments, since, entries: list.length, more, waiting };
  } catch (e) {
    // Fail closed: a list that could not be read is never shown as an empty one.
    return { read: false, error: e instanceof Error ? e.message : String(e) };
  }
}
