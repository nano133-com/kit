import { createHmac } from "node:crypto";
import * as nanoNs from "nanocurrency-web";
import { blake2b } from "@noble/hashes/blake2.js";
import { PRICE_STEP_RAW } from "./amount.js";
import type { StateBlock } from "./types.js";

// Derived-address mode: one receiving address for each checkout.
//
// The old way (createCheckout) gives every checkout the SAME address and a unique amount: the price plus a tail in the
// last digits. A wallet that rounds the amount (Cake Wallet sent 0.0593 for a quote of 0.059300000000000000000000801448)
// can never be matched. Here the ADDRESS names the checkout, so the amount is clean (the price rounded up to a whole
// 0.0001 XNO, no tail, no amount lock) and the payment must be exactly that amount, at exactly that address.
//
// Each address comes from one secret and an index: the Nano seed is HMAC-SHA256(secret, label) in hex, and address n is
// the legacy account n of that seed (blake2b of the seed and the index), as most wallets derive it. The server therefore
// holds a seed: a hot wallet. Money at a derived address is moved on by sweepCheckout() to an address that YOU fix in
// your code. Nothing in this module returns, logs or stores a seed or a private key: a key exists only inside a signer's
// closure (derivedSigner) and inside the sweep.
//
// This module needs two packages that "@nano133/checkout" itself does not: `nanocurrency-web` and `@noble/hashes`.
// The package's main entry never imports this file, so the unique-amount way keeps its zero dependencies.

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;

/** The highest index plus one. The counter that would pass it throws: a bug or an attack, never a shop. */
export const DERIVED_INDEX_CAP = 1_000_000;

/**
 * The default label that turns your secret into the Nano seed. It is a parameter (`label`) so that two uses of one
 * secret never share addresses. It is NOT the label nano133.com's own site uses: the site keeps its own, so a seed
 * that someone reuses here and there never gives the same address in both. Change the label or the secret after the
 * first checkout and every earlier address can no longer be derived: their money cannot be swept or returned.
 */
export const DEFAULT_SEED_LABEL = "nano133 kit checkout seed v1";

/** A quote is a whole number of this many raw: 0.0001 XNO. */
export const CLEAN_STEP_RAW = PRICE_STEP_RAW;

/** How long Late Payment Return keeps watching an address after its checkout and grace end: 7 days. */
export const DEFAULT_KEEP_MS = 7 * 86_400_000;

/** The most addresses `derivedReturns().addresses` gives in one run (newest first). */
export const DEFAULT_ADDRESS_LIST_MAX = 300;

export const nano = (a: string) => a.replace(/^xrb_/, "nano_");

/** Whether `a` and `b` are the same account (the prefix `xrb_` is the old spelling of `nano_`). */
export const sameAccount = (a: string, b: string) => nano(a) === nano(b);

/**
 * The quote for `price` (raw): rounded UP to a whole 0.0001 XNO. A price below one step (0.0001 XNO) is refused: rounding
 * it up would charge many times its price, so the price has to be changed instead.
 */
export function cleanQuote(price: bigint): bigint {
  if (typeof price !== "bigint") throw new TypeError("the price must be a bigint, in raw");
  if (price < CLEAN_STEP_RAW) throw new RangeError("the price is below 0.0001 XNO (10^26 raw): a clean quote is at least one step of 0.0001 XNO");
  return ((price + CLEAN_STEP_RAW - 1n) / CLEAN_STEP_RAW) * CLEAN_STEP_RAW;
}

/** Whether `raw` is a clean quote: above 0 and a whole number of 0.0001 XNO. */
export const isCleanQuote = (raw: bigint) => raw > 0n && raw % CLEAN_STEP_RAW === 0n;

export function checkSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("the secret must be a string of at least 32 characters (use 32 random bytes in hex, 64 characters)");
}

export function checkLabel(label: unknown): asserts label is string {
  if (typeof label !== "string" || !label) throw new Error("the label must be a non-empty string");
}

export function checkIndex(index: unknown): asserts index is number {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw new Error(`the index must be a whole number from 0 (got ${String(index)})`);
  if (index >= DERIVED_INDEX_CAP) throw new Error(`the index ${index} is past the cap of ${DERIVED_INDEX_CAP}`);
}

type Account = { address: string; publicKey: string; privateKey: string };

/** Account `index` of the seed made from the secret and the label. Private: the key never leaves this file's functions. */
function accountOf(secret: string, index: number, label: string): Account {
  checkSecret(secret);
  checkLabel(label);
  checkIndex(index);
  const seed = createHmac("sha256", secret).update(label).digest("hex").toUpperCase();
  const a = nanoWeb.wallet.legacyAccounts(seed, index, index)[0];
  return { address: a.address, publicKey: a.publicKey.toUpperCase(), privateKey: a.privateKey };
}

/** The address of account `index`, and its public key. No private key leaves. */
export function deriveAddress(secret: string, index: number, label: string = DEFAULT_SEED_LABEL): { index: number; address: string; publicKey: string } {
  const a = accountOf(secret, index, label);
  return { index, address: a.address, publicKey: a.publicKey };
}

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const key = (address: string) => hex(nanoWeb.tools.addressToPublicKey(address));

/** BLAKE2b-256 of preamble (6), account, previous, representative, balance (16 bytes, big-endian) and link. */
export function stateBlockHash(b: Pick<StateBlock, "account" | "previous" | "representative" | "balance" | "link">): string {
  const balance = BigInt(b.balance).toString(16).padStart(32, "0");
  const parts = [hex("0".repeat(63) + "6"), key(b.account), hex(b.previous), key(b.representative), hex(balance), hex(b.link)];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return Array.from(blake2b(bytes, { dkLen: 32 }), (x) => x.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Signs blocks for one derived address. It has the shape of `Signer` in `@nano133/late-returns` (0.4.0), so it can be
 * its `signerFor` answer. The private key is inside the closure: this object has no property that holds it.
 */
export type DerivedSigner = {
  address: string;
  publicKey: string;
  send(p: { frontier: string; balance: bigint; representative: string; to: string; amount: bigint; work: string }): Promise<{ block: StateBlock; hash: string }>;
  receive(p: { frontier: string | null; balance: bigint; representative: string; source: string; amount: bigint; work: string }): Promise<{ block: StateBlock; hash: string }>;
};

/** A signer for account `index`. Use it for Late Payment Return's `signerFor`, or in the sweep. */
export function derivedSigner(secret: string, index: number, label: string = DEFAULT_SEED_LABEL): DerivedSigner {
  const acct = accountOf(secret, index, label);
  const signed = (block: StateBlock) => ({ block, hash: stateBlockHash(block) });
  return {
    address: acct.address,
    publicKey: acct.publicKey,
    async send(p) {
      const block = nanoWeb.block.send(
        { walletBalanceRaw: p.balance.toString(), fromAddress: acct.address, toAddress: p.to, representativeAddress: p.representative, frontier: p.frontier, amountRaw: p.amount.toString(), work: p.work },
        acct.privateKey,
      ) as unknown as StateBlock;
      return signed(block);
    },
    async receive(p) {
      const block = nanoWeb.block.receive(
        { walletBalanceRaw: p.balance.toString(), toAddress: acct.address, representativeAddress: p.representative, frontier: p.frontier ?? "0".repeat(64), transactionHash: p.source, amountRaw: p.amount.toString(), work: p.work },
        acct.privateKey,
      ) as unknown as StateBlock;
      return signed(block);
    },
  };
}
