/** A Nano node RPC call. It must reject when the answer has an `error` field (for example "Block not found"). */
export type Rpc = <T>(body: Record<string, unknown>, timeoutMs?: number) => Promise<T>;

/** A state block as the node's `process` action takes it (json_block). */
export type StateBlock = {
  type?: string;
  account: string;
  previous: string;
  representative: string;
  balance: string;
  link: string;
  signature?: string;
  work?: string;
};

/**
 * Signs blocks for the wallet that receives payments. The package never sees
 * the private key: the site builds this from its own key storage (see
 * examples/signer.ts). `hash` is the block's hash, which the package records
 * before it publishes the block.
 */
export interface Signer {
  /** The wallet's nano_ address. */
  address: string;
  /** The wallet's public key (64 hex), the work root of its first block. */
  publicKey: string;
  send(p: { frontier: string; balance: bigint; representative: string; to: string; amount: bigint; work: string }): Promise<{ block: StateBlock; hash: string }>;
  receive(p: { frontier: string | null; balance: bigint; representative: string; source: string; amount: bigint; work: string }): Promise<{ block: StateBlock; hash: string }>;
}

/** A send recorded before it is published, so a later run can find it instead of sending again. */
export type SendIntent = { hash: string; root: string; block: StateBlock };

export type ReturnRecord = {
  /** The late payment's send block hash (upper-case). */
  hash: string;
  amount: string;
  /** Where it goes back to: the payment's sender. */
  to: string;
  /** "kept": over the sender's daily limit (perSenderPerDay); it waits, unsent, until releaseKept(). */
  status: "pending" | "returned" | "kept";
  /** "auto" for the scan, or who asked (an admin). */
  by: string;
  createdAt: number;
  /** Why a payment was kept ("limit"), and the UTC day it counted on. */
  reason?: string | null;
  day?: string | null;
  /** Who released a kept payment, and when. */
  releasedBy?: string | null;
  releasedAt?: number | null;
  /** The receive of this payment, once the wallet has it ("earlier" when an earlier run received it). */
  recv?: string | null;
  send?: SendIntent | null;
  returnHash?: string | null;
  error?: string | null;
  tries?: number;
};

export type RecordResult = "created" | "exists" | "used" | "limit" | "kept";

/** A sender's daily limit for record(): `key` names the sender and the day (it holds no address), `max` the returns it may have. */
export type SenderLimit = { key: string; max: number };

/** The wallet's lock: one run at a time. Every money write proves it still holds the lock. */
export interface Lock {
  /** Takes the lock, or returns false when another run holds it. */
  take(): Promise<boolean>;
  /** Renews it, or throws LockLost. */
  renew(): Promise<void>;
  release(): Promise<void>;
}

/**
 * Where returns are kept, and how the site's own payment records are read.
 * Implementations: memoryStore (tests, one process) and firestoreStore.
 */
export interface ReturnStore {
  /** Whether the site already used this payment (a checkout claimed it), or it was returned. */
  isUsed(hash: string): Promise<boolean>;
  /**
   * In one atomic step: unless a return exists for the hash, the payment is
   * used, or today's count reached `day.max`, create the pending return, mark
   * the payment used (so no checkout can claim it later) and count it.
   *
   * With `sender` (only when the store has `senderLimit`): a payment whose
   * sender already has `sender.max` returns today is recorded as "kept"
   * instead (marked used, not sent, not counted in `day`), and the result is
   * "kept". Otherwise the sender's count goes up with the day's.
   */
  record(r: { hash: string; amount: string; to: string; by: string }, day: { key: string; max: number }, sender?: SenderLimit): Promise<RecordResult>;
  /** True when record() takes a SenderLimit, and release() exists (perSenderPerDay needs both). */
  senderLimit?: boolean;
  /**
   * A kept payment goes back after all: in one atomic step, a "kept" record
   * becomes "pending" (sent by the next run), going to `to`. Anything else is
   * left alone.
   */
  release?(hash: string, to: string, by: string): Promise<"released" | "not-kept" | "missing">;
  get(hash: string): Promise<ReturnRecord | null>;
  pending(limit: number): Promise<ReturnRecord[]>;
  /** A lock for one run, held for `ttlMs` unless renewed. */
  lock(ttlMs: number): Lock & StoreWriter;
}

/** Writes made while holding a lock: each one fails with LockLost if the lock was lost. */
export interface StoreWriter {
  update(hash: string, patch: Partial<ReturnRecord>): Promise<void>;
}

/** The run no longer holds the lock: it must stop before it writes or sends anything else. */
export class LockLost extends Error {
  constructor() {
    super("the wallet lock was lost");
  }
}

/** What the node's block_info answer carries (json_block). */
export type BlockInfo = {
  block_account: string;
  amount: string;
  confirmed: string;
  subtype?: string;
  local_timestamp?: string;
  contents: { link_as_account?: string; subtype?: string };
};
