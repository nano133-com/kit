// An in-memory Nano ledger that answers the RPC calls @nano133/late-returns makes. No network, no money.
import { createHash } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { stateBlockHash } from "../examples/signer.js";
import type { StateBlock } from "../src/types.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;

type Blk = StateBlock & { subtype: string; amount: bigint; at: number; confirmed: boolean };

export class MockLedger {
  blocks = new Map<string, Blk>();
  accounts = new Map<string, { frontier: string; balance: bigint; rep: string }>();
  received = new Set<string>();
  faults: { loseSendAnswer?: boolean } = {};
  calls: Record<string, number> = {};

  /** A send from `from` to `to`, first seen `ageSec` ago. Returns its hash. */
  pay(from: string, to: string, amount: bigint, ageSec = 0, confirmed = true) {
    const hash = createHash("sha256").update(`pay ${Math.random()}`).digest("hex").toUpperCase();
    this.blocks.set(hash, { account: from, previous: "0".repeat(64), representative: from, balance: "0", link: nanoWeb.tools.addressToPublicKey(to).toUpperCase(), subtype: "send", amount, at: Math.floor(Date.now() / 1000) - ageSec, confirmed });
    return hash;
  }
  /** Sends from `wallet` to `to`. */
  sendsFrom(wallet: string, to: string) {
    const pk = nanoWeb.tools.addressToPublicKey(to).toUpperCase();
    return [...this.blocks.entries()].filter(([, b]) => b.subtype === "send" && b.account === wallet && b.link.toUpperCase() === pk);
  }
  balance(wallet: string) {
    return this.accounts.get(wallet)?.balance ?? 0n;
  }

  rpc = async <T>(body: Record<string, unknown>): Promise<T> => {
    const a = String(body.action);
    this.calls[a] = (this.calls[a] ?? 0) + 1;
    if (a === "work_generate") return { work: "0000000000000000" } as T;
    if (a === "account_info") {
      const acc = this.accounts.get(body.account as string);
      if (!acc) throw new Error("Account not found");
      return { frontier: acc.frontier, balance: acc.balance.toString(), representative: acc.rep } as T;
    }
    if (a === "receivable") {
      const pk = nanoWeb.tools.addressToPublicKey(String(body.account)).toUpperCase();
      const out: Record<string, { amount: string; source: string }> = {};
      for (const [h, b] of this.blocks) if (b.subtype === "send" && b.link.toUpperCase() === pk && !this.received.has(h) && b.amount >= BigInt(String(body.threshold ?? "1"))) out[h] = { amount: b.amount.toString(), source: b.account };
      return { blocks: Object.keys(out).length ? out : "" } as T;
    }
    if (a === "account_history") {
      const mine = [...this.blocks.entries()].filter(([, b]) => b.account === body.account);
      if (!mine.length) throw new Error("Account not found");
      return { history: mine.reverse().map(([hash, b]) => ({ hash, type: "state", subtype: b.subtype, previous: b.previous, link: b.link, balance: b.balance, amount: b.amount.toString() })) } as T;
    }
    if (a === "block_info") {
      const H = String(body.hash).toUpperCase();
      const b = this.blocks.get(H);
      if (!b) throw new Error("Block not found");
      const to = b.subtype === "send" ? nanoWeb.tools.publicKeyToAddress(b.link) : undefined;
      return { block_account: b.account, amount: b.amount.toString(), confirmed: b.confirmed ? "true" : "false", subtype: b.subtype, local_timestamp: String(b.at), contents: { link_as_account: to, subtype: b.subtype } } as T;
    }
    if (a === "process") {
      const blk = body.block as StateBlock;
      const hash = stateBlockHash(blk);
      if (this.blocks.has(hash)) throw new Error("Old block");
      const acc = this.accounts.get(blk.account);
      if (blk.previous.toUpperCase() !== (acc?.frontier ?? "0".repeat(64)).toUpperCase()) throw new Error("Fork");
      const bal = BigInt(blk.balance);
      const was = acc?.balance ?? 0n;
      if (bal > was) {
        const src = blk.link.toUpperCase();
        if (this.received.has(src) || !this.blocks.has(src)) throw new Error("Unreceivable");
        if (this.blocks.get(src)!.amount !== bal - was) throw new Error("Balance and amount delta do not match");
        this.received.add(src);
        this.blocks.set(hash, { ...blk, subtype: acc ? "receive" : "open", amount: bal - was, at: Math.floor(Date.now() / 1000), confirmed: true });
      } else {
        this.blocks.set(hash, { ...blk, subtype: "send", amount: was - bal, at: Math.floor(Date.now() / 1000), confirmed: true });
      }
      this.accounts.set(blk.account, { frontier: hash, balance: bal, rep: blk.representative });
      if (bal < was && this.faults.loseSendAnswer) {
        this.faults.loseSendAnswer = false;
        throw new Error("The operation was aborted due to timeout");
      }
      return { hash } as T;
    }
    throw new Error(`mock: ${a}`);
  };
}
