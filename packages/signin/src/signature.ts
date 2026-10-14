import { createHash } from "node:crypto";
import { signinMessage } from "./message.js";
import { validAddress, verifyMessage } from "./verify.js";

// Sign in with Nano, by a signature from a key the browser holds: a purse made from a passkey (./passkey and
// ./purse), or any wallet that signs a message as the hex of its bytes. The browser signs
// signinMessage(domain, address, at) and posts { address, at, signature }; the server checks it here. No payment
// is needed, so a new user with no XNO can sign in. The check is strict (./verify).

export { validAddress, verifyMessage };

export class SigninError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Records `key` atomically and answers false when it was already there (a database row with a unique key).
 * `address` is the account that signed: keep it on the row, so that a "delete my data" can find the rows of a
 * person. memoryOnce and firestoreOnce do.
 */
export type UseOnce = (key: string, ttlMs: number, address: string) => Promise<boolean>;

export type SignatureOptions = {
  /** The site's domain, exactly as users see it ("example.com"): the message names it. */
  domain: string;
  useOnce: UseOnce;
  /** How old a signature may be, either way (default 5 minutes). */
  windowMs?: number;
  now?: () => number;
  /** The label of the once-only key (default "nano-signin signature v1"). Keep one label for the life of a site. */
  onceLabel?: string;
};

/** The once-only key of a signed message: one key for every form of its signature. */
export const onceKey = (message: string, label = "nano-signin signature v1") => createHash("sha256").update(`${label}|${message}`).digest("hex");

/** Checks a signature sign-in and returns the address. Throws SigninError otherwise. */
export async function checkSignatureSignin(o: SignatureOptions, p: { address: string; at: number; signature: string }): Promise<string> {
  if (typeof o.domain !== "string" || !o.domain.trim()) throw new Error("set the site's domain");
  const windowMs = o.windowMs ?? 5 * 60_000;
  const now = o.now?.() ?? Date.now();
  if (!validAddress(p.address)) throw new SigninError(400, "invalid address");
  if (!Number.isFinite(p.at) || Math.abs(now - p.at) > windowMs) throw new SigninError(400, "that sign-in is too old; try again");
  if (typeof p.signature !== "string" || !/^[0-9A-F]{128}$/i.test(p.signature)) throw new SigninError(400, "invalid signature");
  const message = signinMessage(o.domain, p.address, p.at);
  if (!verifyMessage(p.address, message, p.signature)) throw new SigninError(401, "the signature does not match");
  // Once only, by the message it signed (a signature can have more than one form).
  if (!(await o.useOnce(onceKey(message, o.onceLabel), 2 * windowMs, p.address))) throw new SigninError(409, "that sign-in was already used");
  return p.address;
}
