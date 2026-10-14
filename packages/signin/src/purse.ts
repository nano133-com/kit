import * as nanoNs from "nanocurrency-web";
import { signinMessage } from "./message.js";

// A purse in the browser: account 0 of a seed (a passkey's seed from ./passkey, or one made in the browser), and
// its signature of the sign-in message. Browser-safe: no Node module here. The key is made from the seed only for
// the moment it signs, and is never returned.

const nanoWeb = ((nanoNs as unknown as { default?: typeof nanoNs }).default ?? nanoNs) as typeof nanoNs;
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The address of a seed's account 0. */
export const purseAddress = (seed: string) => nanoWeb.wallet.fromLegacySeed(seed).accounts[0]!.address;

/** A text signed by a seed's account 0, as the hex of its UTF-8 bytes (the form verifyMessage checks). */
export function signText(seed: string, text: string) {
  const a = nanoWeb.wallet.fromLegacySeed(seed).accounts[0]!;
  return { address: a.address, signature: nanoWeb.tools.sign(a.privateKey, hexOf(new TextEncoder().encode(text))) };
}

/** What the browser posts to sign in: { address, at, signature } over signinMessage(domain, address, at). */
export function signinBody(domain: string, seed: string, at = Date.now()) {
  const address = purseAddress(seed);
  return { address, at, signature: signText(seed, signinMessage(domain, address, at)).signature };
}
