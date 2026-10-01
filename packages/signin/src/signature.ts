import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as nanoNs from "nanocurrency-web";
import { signinMessage } from "./message.js";

// Sign in with Nano, by signature: the wallet signs a short message with its
// key, and the server checks the signature against the address. No payment
// is needed, so a new user with no XNO can sign in.
//
// The check is strict. The usual library check also accepts two things a
// strict check must not: a second form of the same signature (S + L), and
// forgeries for the few "small-order" public keys (the burn address is one),
// which nobody holds a key for.

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const ADDRESS = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
/** The order of the Ed25519 group: a signature's S must be below it. */
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const littleEndian = (hex: string) => BigInt(`0x${Buffer.from(hex, "hex").reverse().toString("hex") || "0"}`);

function strongKey(publicKey: string) {
  try {
    return !ed25519.Point.fromHex(publicKey.toLowerCase()).isSmallOrder();
  } catch {
    return false;
  }
}

/** True when `address`'s key signed `message` (signed as the hex of its UTF-8 bytes); false for anything else. */
export function verifyMessage(address: string, message: string, signature: string) {
  if (!ADDRESS.test(address) || !/^[0-9A-F]{128}$/i.test(signature)) return false;
  if (littleEndian(signature.slice(64)) >= L) return false;
  try {
    const publicKey = nanoWeb.tools.addressToPublicKey(address);
    if (!strongKey(publicKey)) return false;
    return nanoWeb.tools.verify(publicKey, signature, Buffer.from(message, "utf8").toString("hex"));
  } catch {
    return false;
  }
}

export class SigninError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checks a signature sign-in and returns the address. `useOnce(key, ttlMs)`
 * must record `key` atomically and answer false when it was already there
 * (a database row with a unique key). Throws SigninError otherwise.
 */
export async function checkSignatureSignin(
  o: { domain: string; useOnce: (key: string, ttlMs: number) => Promise<boolean>; windowMs?: number; now?: () => number },
  p: { address: string; at: number; signature: string },
): Promise<string> {
  const windowMs = o.windowMs ?? 5 * 60_000;
  const now = o.now?.() ?? Date.now();
  if (typeof p.address !== "string" || !ADDRESS.test(p.address)) throw new SigninError(400, "invalid address");
  if (!Number.isFinite(p.at) || Math.abs(now - p.at) > windowMs) throw new SigninError(400, "that sign-in is too old; try again");
  if (typeof p.signature !== "string" || !/^[0-9A-F]{128}$/i.test(p.signature)) throw new SigninError(400, "invalid signature");
  const message = signinMessage(o.domain, p.address, p.at);
  if (!verifyMessage(p.address, message, p.signature)) throw new SigninError(401, "the signature does not match");
  // Once only, by the message it signed (a signature can have more than one form).
  const key = createHash("sha256").update(`nano-signin signature v1|${message}`).digest("hex");
  if (!(await o.useOnce(key, 2 * windowMs))) throw new SigninError(409, "that sign-in was already used");
  return p.address;
}
