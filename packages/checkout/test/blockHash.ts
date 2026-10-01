import * as nanoNs from "nanocurrency-web";
import { blake2b } from "blakejs";
const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
type StateBlock = { account: string; previous: string; representative: string; balance: string; link: string };
/** Tests only: the hash of a state block (the mock ledger needs it). */
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
