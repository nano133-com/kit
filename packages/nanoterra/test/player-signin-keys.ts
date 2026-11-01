// Test keys and the wallets' three ways of signing, for the player sign-in's tests. No network, no money. (The same forms as @nano133/signin's
// own test keys: each wallet signs one way, and the package's checks take each form only.)
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { eddsa } from "@noble/curves/abstract/edwards.js";
import { blake2b } from "@noble/hashes/blake2.js";
import * as nanoNs from "nanocurrency-web";

export const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;

/** A fixed account for a label. */
export const account = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0]!;

const clamp = (b: Uint8Array) => {
  b[0]! &= 248;
  b[31]! &= 127;
  b[31]! |= 64;
  return b;
};
const nanoEd = eddsa(ed25519.Point, (m: Uint8Array) => blake2b(m, { dkLen: 64 }), { adjustScalarBytes: clamp });
/** Ed25519-BLAKE2b over the bytes as given (Nautilus; Berry Wallet over the SHA-256 of its text). */
export const signBytes = (privateKey: string, bytes: Uint8Array) => Buffer.from(nanoEd.sign(bytes, Buffer.from(privateKey, "hex"))).toString("hex").toUpperCase();
/** NanChat's form: the text itself, signed with the library's sign(). */
export const signText = (privateKey: string, text: string) => nanoWeb.tools.sign(privateKey, text);
export const sha256 = (text: string) => new Uint8Array(createHash("sha256").update(text, "utf8").digest());
