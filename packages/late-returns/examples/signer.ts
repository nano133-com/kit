// An example Signer for @nano133/late-returns, built on nanocurrency-web and blakejs.
// Copy it into your site and load the key from your own secret storage.
//
// WARNING: a key on a server is a hot wallet. Keep only small amounts in it.

import * as nanoNs from "nanocurrency-web";
import { blake2b } from "blakejs";
import type { Signer, StateBlock } from "../src/types.js";

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;

/** The hash of a state block: BLAKE2b-256 of its fields. */
export function stateBlockHash(b: StateBlock): string {
  const hex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
  const balance = BigInt(b.balance).toString(16).padStart(32, "0");
  const parts = [
    "0".repeat(63) + "6",
    nanoWeb.tools.addressToPublicKey(b.account),
    b.previous,
    nanoWeb.tools.addressToPublicKey(b.representative),
    balance,
    b.link,
  ];
  return Buffer.from(blake2b(hex(parts.join("")), undefined, 32)).toString("hex").toUpperCase();
}

/** A Signer for account `index` of a legacy Nano seed (64 hex), as most wallets derive it. */
export function seedSigner(seed: string, index = 0): Signer {
  const acct = nanoWeb.wallet.legacyAccounts(seed, index, index)[0];
  const sign = (block: StateBlock) => ({ block, hash: stateBlockHash(block) });
  return {
    address: acct.address,
    publicKey: acct.publicKey.toUpperCase(),
    async send(p) {
      const block = nanoWeb.block.send(
        { walletBalanceRaw: p.balance.toString(), fromAddress: acct.address, toAddress: p.to, representativeAddress: p.representative, frontier: p.frontier, amountRaw: p.amount.toString(), work: p.work },
        acct.privateKey,
      ) as unknown as StateBlock;
      return sign(block);
    },
    async receive(p) {
      const block = nanoWeb.block.receive(
        { walletBalanceRaw: p.balance.toString(), toAddress: acct.address, representativeAddress: p.representative, frontier: p.frontier ?? "0".repeat(64), transactionHash: p.source, amountRaw: p.amount.toString(), work: p.work },
        acct.privateKey,
      ) as unknown as StateBlock;
      return sign(block);
    },
  };
}
