// Test keys and the wallets' three ways of signing. No network, no money.
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { eddsa } from "@noble/curves/abstract/edwards.js";
import { blake2b } from "@noble/hashes/blake2.js";
import * as nanoNs from "nanocurrency-web";

export const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
/** A fixed account for a label (a seed made from it). */
export const account = (label: string) => nanoWeb.wallet.legacyAccounts(createHash("sha256").update(label).digest("hex"), 0, 0)[0]!;
export const seedOf = (label: string) => createHash("sha256").update(label).digest("hex").toUpperCase();

/** A purse's form: the text's UTF-8 bytes as hex, signed with the library's sign(). */
export const signHexText = (privateKey: string, text: string) => nanoWeb.tools.sign(privateKey, Buffer.from(text, "utf8").toString("hex"));
/** NanChat's form: the text itself, signed with the library's sign(). */
export const signText = (privateKey: string, text: string) => nanoWeb.tools.sign(privateKey, text);
/** Nautilus's form: Ed25519-BLAKE2b over the bytes as given, the scalar clamped as Nano derives keys. */
const clamp = (b: Uint8Array) => {
  b[0]! &= 248;
  b[31]! &= 127;
  b[31]! |= 64;
  return b;
};
const nanoEd = eddsa(ed25519.Point, (m: Uint8Array) => blake2b(m, { dkLen: 64 }), { adjustScalarBytes: clamp });
export const signBytes = (privateKey: string, bytes: Uint8Array) => Buffer.from(nanoEd.sign(bytes, Buffer.from(privateKey, "hex"))).toString("hex").toUpperCase();
export const publicKeyOf = (privateKey: string) => Buffer.from(nanoEd.getPublicKey(Buffer.from(privateKey, "hex"))).toString("hex").toUpperCase();

/** The signature's second form (S + L): the same signature, which a strict check refuses. */
export function plusL(signature: string) {
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const le = (hex: string) => BigInt(`0x${Buffer.from(hex, "hex").reverse().toString("hex")}`);
  const s = le(signature.slice(64)) + L;
  const hex = s.toString(16).padStart(64, "0");
  return (signature.slice(0, 64) + Buffer.from(hex, "hex").reverse().toString("hex")).toUpperCase();
}
