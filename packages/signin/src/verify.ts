import { ed25519 } from "@noble/curves/ed25519.js";
import { eddsa } from "@noble/curves/abstract/edwards.js";
import { blake2b } from "@noble/hashes/blake2.js";
import * as nanoNs from "nanocurrency-web";

// Strict checks that a Nano account's key signed something. Wallets sign in three forms, and each check takes one
// form only, so a signature made for one purpose never passes as another:
//
//   verifyMessage(address, text, sig)  the text as the hex of its UTF-8 bytes, signed with the library's sign()
//                                      (a browser purse made with nanocurrency-web, and checkSignatureSignin)
//   verifyText(address, text, sig)     the text itself, signed with the library's sign() (NanChat)
//   verifyBytes(address, bytes, sig)   the bytes as given, signed as a block hash is signed (Nautilus)
//
// The library's own check also accepts two things a strict check must not:
// - a second form of the same signature (S + L), which a "use each signature once" record keyed on the
//   signature's bytes would not recognise, and
// - forgeries for the few "small-order" public keys (the burn address is one), which nobody holds a key for.
// And an account must be whole: its shape AND its checksum (validAddress), or one key would sign under every
// text that holds it with another checksum.

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const { tools } = nanoWeb;

const ADDRESS = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
/** The order of the Ed25519 group: a signature's S must be below it. */
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const littleEndian = (hex: string) => BigInt(`0x${Buffer.from(hex, "hex").reverse().toString("hex") || "0"}`);
const SIGNATURE = /^[0-9A-F]{128}$/i;

function strongKey(publicKey: string) {
  try {
    return !ed25519.Point.fromHex(publicKey.toLowerCase()).isSmallOrder();
  } catch {
    // Not a point on the curve at all.
    return false;
  }
}

/**
 * True for a whole Nano address: its shape and its checksum (the last 8 characters). An account is the one true
 * address of its key, so every check here asks this first. (The library's addressToPublicKey reads the key from
 * the first 52 characters and does not look at the checksum.)
 */
export function validAddress(address: unknown): address is string {
  if (typeof address !== "string" || !ADDRESS.test(address)) return false;
  try {
    return tools.validateAddress(address);
  } catch {
    return false;
  }
}

/** The key of a whole address with a strong key and a signature in its one canonical form, or null. */
function keyFor(address: string, signature: string): string | null {
  if (!validAddress(address) || typeof signature !== "string" || !SIGNATURE.test(signature)) return null;
  if (littleEndian(signature.slice(64)) >= L) return null;
  try {
    const publicKey = tools.addressToPublicKey(address);
    return strongKey(publicKey) ? publicKey : null;
  } catch {
    return null;
  }
}

/** True when `address`'s key signed `message` as the hex of its UTF-8 bytes; false for anything else. */
export function verifyMessage(address: string, message: string, signature: string) {
  const publicKey = keyFor(address, signature);
  if (!publicKey || typeof message !== "string") return false;
  try {
    return tools.verify(publicKey, signature, Buffer.from(message, "utf8").toString("hex"));
  } catch {
    return false;
  }
}

/**
 * True when `address`'s key signed `text` the way the library signs a text: sign(key, text), which is
 * Ed25519-BLAKE2b over the BLAKE2b-256 hash of the text's UTF-8 bytes. NanChat signs this way. It is not
 * verifyMessage: that one checks a signature over the HEX of a message's bytes, so one never passes as the other.
 */
export function verifyText(address: string, text: string, signature: string) {
  const publicKey = keyFor(address, signature);
  if (!publicKey || typeof text !== "string") return false;
  try {
    return tools.verify(publicKey, signature, text);
  } catch {
    return false;
  }
}

/**
 * Nano's own signature: Ed25519 with BLAKE2b-512, over the bytes as given, the way a wallet signs a block's hash.
 * (The library's sign and verify hash the input with BLAKE2b first, so they do not match this.)
 */
const nanoEd = eddsa(ed25519.Point, (msg: Uint8Array) => blake2b(msg, { dkLen: 64 }));

/**
 * True when `address`'s key signed exactly these bytes, as a wallet signs a block (no extra hashing); false for
 * anything else. Nautilus signs its sign-in text this way. No non-canonical encodings (zip215: false).
 */
export function verifyBytes(address: string, bytes: Uint8Array, signature: string) {
  const publicKey = keyFor(address, signature);
  if (!publicKey || !(bytes instanceof Uint8Array)) return false;
  try {
    return nanoEd.verify(Buffer.from(signature, "hex"), bytes, Buffer.from(publicKey, "hex"), { zip215: false });
  } catch {
    return false;
  }
}
