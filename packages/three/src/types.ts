import type { Replay, Rules } from "./rules.js";

/** Only server code may create this from an authenticated player and a verified Nano address. */
export type TrustedPlayer = { id: string; payee: string };
export type PrizeLimits = { perPlayerPerDay: number; totalPerDay: number };
export type NoPrizeReason = "lost" | "invalid" | "player-limit" | "day-limit" | "empty";

/** A signed Nano state block. The caller supplies its signer; this package holds no key. */
export type SignedSend = {
  hash: string;
  block: {
    type: "state";
    account: string;
    previous: string;
    representative: string;
    balance: string;
    link: string;
    signature: string;
    work: string;
  };
};

export interface PrizeSender {
  /** Never publish here. Return null only if the wallet lacks funds and no block was signed. */
  sign(input: { roundId: string; payee: string; amountRaw: string }): Promise<SignedSend | null>;
  /** Publish this exact saved block. Resolve for an identical block that is already on the ledger too. */
  publish(send: SignedSend): Promise<void>;
}

export type Round = {
  id: string;
  rulesVersion: string;
  seed: string;
  startedAt: number;
  player: TrustedPlayer;
  status: "open" | "checked" | "signing" | "closed" | "paid";
  checkedAt?: number;
  replay?: Replay;
  noPrize?: NoPrizeReason;
  /** A reserved prize counts on this UTC day, even if it is published on a later day. */
  prize?: { day: string; amountRaw: string };
  send?: SignedSend;
};

/** All reads must precede all writes. A database may retry the callback; never sign or publish in it. */
export interface RoundTransaction {
  getRound(id: string): Promise<Round | null>;
  createRound(round: Round): void;
  setRound(round: Round): void;
  getUsage(key: string): Promise<number>;
  setUsage(key: string, count: number): void;
  /** One prize wallet per store. Keep the slot until its saved send is published. */
  getActivePrize(): Promise<string | null>;
  setActivePrize(roundId: string | null): void;
}

export interface RoundStore {
  rules(version: string): Rules<any> | undefined;
  now(): number;
  transaction<T>(body: (tx: RoundTransaction) => Promise<T>): Promise<T>;
}

export type StoreOptions = {
  /** Keep every version that an unfinished round can name. Never change a version's meaning. */
  rules: readonly Rules<any>[];
  /** The server clock; override only in tests. */
  now?: () => number;
};

export type CheckResult =
  | { state: "checked"; replay: Replay }
  | { state: "soon"; waitMs: number }
  | { state: "unknown" | "used" | "rules-unavailable" };

export type PrizeResult =
  | { state: "paid"; won: true; hash: string; again: boolean }
  | { state: "no-prize"; won: boolean; reason: NoPrizeReason }
  | { state: "pending"; won: true; reason: "signing" | "wallet-busy" }
  | { state: "unknown" | "unchecked" };
